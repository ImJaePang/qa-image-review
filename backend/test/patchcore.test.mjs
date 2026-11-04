// PatchCore 어댑터 테스트: 실제 Python 대신 같은 프로토콜(JSON Lines)로 대답하는 가짜 서버로 어댑터의 동작을 검증한다.
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPatchcoreAdapter, readModelMeta } from '../src/model/patchcore.mjs'

let dir, modelDir, serverPath
const quiet = () => {}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'qa-pc-'))
  modelDir = join(dir, 'model')
  serverPath = join(dir, 'fake-serve.mjs')
  // 가짜 추론 서버: 파일 이름으로 동작을 고른다
  writeFileSync(
    serverPath,
    `
import { createInterface } from 'node:readline'
const version = process.env.FAKE_VERSION ?? 'patchcore-test-1'
console.log('잡음: JSON이 아닌 줄은 무시되어야 한다')
console.log(JSON.stringify({ event: 'ready' }))
createInterface({ input: process.stdin }).on('line', (line) => {
  const q = JSON.parse(line)
  const reply = (o) => console.log(JSON.stringify({ id: q.id, ...o }))
  if (q.fileName.startsWith('crash')) process.exit(3)
  if (q.fileName.startsWith('hang')) return
  if (q.fileName.startsWith('err')) return reply({ ok: false, error: '이미지를 읽을 수 없음' })
  reply({
    ok: true,
    result: {
      imageId: q.imageKey, fileName: q.fileName, width: 100, height: 80, modelVersion: version,
      overallScore: q.fileName.startsWith('bad') ? 5 : 0.8, heatmapUrl: '/heatmaps/' + q.imageKey + '.png',
      boxes: [{ x: 10, y: 10, width: 20, height: 20, score: 0.4, reasonCode: 'UNKNOWN' }],
    },
  })
})
`,
  )
})
after(() => rmSync(dir, { recursive: true, force: true }))

async function withMeta(version = 'patchcore-test-1') {
  mkdirSync(modelDir, { recursive: true })
  writeFileSync(join(modelDir, 'meta.json'), JSON.stringify({ modelVersion: version }))
}
const make = (extra = {}) => createPatchcoreAdapter({ modelDir, command: process.execPath, args: [serverPath], log: quiet, ...extra })
const req = (name, key = 'img_1') => ({ imageKey: key, fileName: name, filePath: '/x/' + name, outputDir: '/out' })

describe('PatchCore 어댑터', () => {
  test('모델 폴더에 meta.json이 없으면 시작 시 알기 쉬운 오류', () => {
    assert.throws(() => readModelMeta(join(dir, 'nope')), /python\/train\.py로 먼저 학습/)
  })

  test('modelVersion은 meta.json에서 읽고, 추론 결과는 계약대로 돌려준다 (UNKNOWN 사유 포함)', async () => {
    await withMeta()
    const a = make()
    try {
      assert.equal(a.modelVersion, 'patchcore-test-1')
      const r = await a.infer(req('ok.png'))
      assert.equal(r.imageId, 'img_1')
      assert.equal(r.boxes[0].reasonCode, 'UNKNOWN')
      assert.equal(r.modelVersion, 'patchcore-test-1')
    } finally {
      a.close()
    }
  })

  test('요청이 몰려도 순서대로 하나씩 처리하고 각자 자기 결과를 받는다', async () => {
    await withMeta()
    const a = make()
    try {
      const rs = await Promise.all([a.infer(req('a.png', 'k1')), a.infer(req('b.png', 'k2')), a.infer(req('c.png', 'k3'))])
      assert.deepEqual(rs.map((r) => r.imageId), ['k1', 'k2', 'k3'])
    } finally {
      a.close()
    }
  })

  test('서버가 오류를 알리면 그 이미지만 실패하고 다음 이미지는 정상 처리된다', async () => {
    await withMeta()
    const a = make()
    try {
      await assert.rejects(a.infer(req('err.png')), /이미지를 읽을 수 없음/)
      assert.equal((await a.infer(req('ok.png', 'k2'))).imageId, 'k2')
    } finally {
      a.close()
    }
  })

  test('계약을 어긴 출력은 거부한다 (점수 범위 밖)', async () => {
    await withMeta()
    const a = make()
    try {
      await assert.rejects(a.infer(req('bad.png')), /계약/)
    } finally {
      a.close()
    }
  })

  test('추론 프로세스가 죽으면 그 이미지는 실패로 알리고, 다음 요청에서 다시 띄운다', async () => {
    await withMeta()
    const a = make()
    try {
      await assert.rejects(a.infer(req('crash.png')), /종료됨/)
      assert.equal((await a.infer(req('ok.png', 'k2'))).imageId, 'k2')
    } finally {
      a.close()
    }
  })

  test('응답이 없으면 시간 초과로 실패시키고 이후 요청은 계속된다', async () => {
    await withMeta()
    const a = make({ requestTimeoutMs: 300 })
    try {
      await assert.rejects(a.infer(req('hang.png')), /시간 초과/)
      assert.equal((await a.infer(req('ok.png', 'k2'))).imageId, 'k2')
    } finally {
      a.close()
    }
  })

  test('서버가 보고한 모델 버전이 meta.json과 다르면 막는다 (판정 기록이 거짓이 되지 않게)', async () => {
    await withMeta('patchcore-meta-2')
    const a = make()
    try {
      await assert.rejects(a.infer(req('ok.png')), /모델 버전 불일치/)
    } finally {
      a.close()
    }
  })

  test('실행할 수 없는 명령이면 이미지 실패로 알린다 (워커가 죽지 않는다)', async () => {
    await withMeta()
    const a = createPatchcoreAdapter({ modelDir, command: join(dir, 'no-such-python'), log: quiet })
    await assert.rejects(a.infer(req('ok.png')), /실행하지 못했습니다|종료/)
    a.close()
  })
})
