// PatchCore 모델 어댑터: 추론은 별도 Python 프로세스(python/serve.py)가 하고, 이 어댑터는 그 프로세스와
// 한 줄에 JSON 하나씩(JSON Lines)으로 대화해 기획서 5장 계약 객체를 받아온다.
//
// 프로토콜 (stdin/stdout, 한 줄 = JSON 하나)
//   서버 → {"event":"ready"}                       모델을 다 불러왔다 (이 줄이 와야 요청을 보낸다)
//   어댑터 → {"id":1,"imageKey","fileName","filePath","outputDir"}
//   서버 → {"id":1,"ok":true,"result":{계약 객체}}  또는 {"id":1,"ok":false,"error":"사유"}
//   로그는 stderr로만 낸다 (stdout은 프로토콜 전용).
// 모델 버전은 모델 폴더의 meta.json(학습 때 기록)에서 읽는다: 어떤 학습본으로 판정했는지 항상 남기기 위해서다.
// 요청은 한 번에 하나씩 처리하고, 프로세스가 죽거나 시간 초과가 나면 그 이미지는 실패(예외)로 알리고 다음 요청 때 다시 띄운다.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { assertValidResult } from './contract.mjs'

export function readModelMeta(modelDir) {
  let meta
  try {
    meta = JSON.parse(readFileSync(join(modelDir, 'meta.json'), 'utf8'))
  } catch (err) {
    throw new Error(`PatchCore 모델 정보(meta.json)를 읽을 수 없습니다 (${modelDir}): ${err.message}. python/train.py로 먼저 학습하세요.`)
  }
  if (typeof meta.modelVersion !== 'string' || !meta.modelVersion) throw new Error(`meta.json에 modelVersion이 없습니다 (${modelDir})`)
  return meta
}

/**
 * @param opts.modelDir      학습 결과 폴더 (meta.json 포함)
 * @param opts.command/args  추론 서버 실행 명령 (기본: python/.venv의 python + python/serve.py)
 * @param opts.startTimeoutMs 모델 로딩 대기 (기본 5분)  opts.requestTimeoutMs 이미지 한 장 (기본 2분)
 */
export function createPatchcoreAdapter({ modelDir, command, args = [], startTimeoutMs = 300_000, requestTimeoutMs = 120_000, log = (m) => console.error(m) }) {
  const meta = readModelMeta(modelDir)
  let proc = null
  let ready = null // 프로세스가 준비되면 resolve되는 Promise
  let pending = null // { id, resolve, reject, timer }
  let seq = 0
  let chain = Promise.resolve() // 요청을 한 줄로 세운다

  function killProc(reason) {
    const p = proc
    proc = null
    ready = null
    if (p && !p.killed) p.kill()
    if (pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
      pending = null
    }
  }

  function start() {
    const child = spawn(command, [...args, '--model-dir', modelDir], { stdio: ['pipe', 'pipe', 'pipe'] })
    proc = child
    child.stderr.on('data', (d) => log(`[patchcore] ${String(d).trimEnd()}`))
    child.on('error', (err) => proc === child && killProc(`추론 프로세스를 실행하지 못했습니다: ${err.message}`))
    child.on('exit', (code) => proc === child && killProc(`추론 프로세스가 종료됨 (코드 ${code})`))
    child.stdin.on('error', () => {}) // 죽은 프로세스에 쓰는 오류는 exit 처리에서 알린다
    ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('추론 프로세스가 시간 안에 준비되지 않았습니다'))
        killProc('추론 프로세스 준비 시간 초과')
      }, startTimeoutMs)
      createInterface({ input: child.stdout }).on('line', (line) => {
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          return log(`[patchcore] 해석할 수 없는 출력 무시: ${line.slice(0, 200)}`)
        }
        if (msg.event === 'ready') {
          clearTimeout(timer)
          resolve()
        } else if (pending && msg.id === pending.id) {
          clearTimeout(pending.timer)
          const p = pending
          pending = null
          msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error ?? '추론 실패'))
        }
      })
      child.once('exit', () => {
        clearTimeout(timer)
        reject(new Error('추론 프로세스가 준비 전에 종료됨'))
      })
      child.once('error', (err) => {
        clearTimeout(timer) // 실행 파일이 없는 경우 등: exit가 오지 않으므로 여기서 바로 실패시킨다
        reject(new Error(`추론 프로세스를 실행하지 못했습니다: ${err.message}`))
      })
    })
    ready.catch(() => {}) // 처리되지 않은 거부 방지 (실제 오류는 요청 쪽에서 받는다)
  }

  async function request(payload) {
    if (!proc) start()
    await ready
    return new Promise((resolve, reject) => {
      const id = ++seq
      const timer = setTimeout(() => killProc(`추론 시간 초과 (${requestTimeoutMs}ms)`), requestTimeoutMs)
      pending = { id, resolve, reject, timer }
      proc.stdin.write(`${JSON.stringify({ id, ...payload })}\n`)
    })
  }

  return {
    modelVersion: meta.modelVersion,
    meta,
    async infer({ imageKey, fileName, filePath, outputDir }) {
      const run = chain.then(() => request({ imageKey, fileName, filePath, outputDir }))
      chain = run.catch(() => {}) // 한 장이 실패해도 다음 장은 계속
      const result = await run
      // 서버가 보낸 모델 버전이 학습본과 다르면 기록이 거짓이 되므로 막는다
      if (result?.modelVersion !== meta.modelVersion) throw new Error(`모델 버전 불일치: 서버 ${result?.modelVersion} ≠ meta ${meta.modelVersion}`)
      return assertValidResult(result)
    },
    /** 워커 종료 때 추론 프로세스를 정리한다 */
    close() {
      killProc('어댑터 종료')
    },
  }
}
