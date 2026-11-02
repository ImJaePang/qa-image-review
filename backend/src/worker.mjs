// 수신 워커 프로세스: npm run worker  (API와 별도로 실행, 동시성 1, 같은 폴더에 워커를 둘 이상 띄우지 않는다)
// 하는 일은 runCycle 반복뿐이다. 로직은 src/ingest/ 에 있고 테스트도 거기를 직접 호출한다.
import pg from 'pg'
import { config } from './config.mjs'
import { DEFAULT_FOLDER_CONFIG } from './ingest/folder-config.mjs'
import { runCycle } from './ingest/cycle.mjs'
import { recoverStuck } from './ingest/process.mjs'
import { loadAdapter } from './model/index.mjs'

pg.types.setTypeParser(20, Number)
pg.types.setTypeParser(1700, Number)

const pool = new pg.Pool(config.db)
const adapter = loadAdapter(config.modelAdapter)
const log = (m) => console.log(`${new Date().toISOString()} ${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let stopping = false
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => ((stopping = true), log('종료 요청: 진행 중인 1장까지만 마치고 멈춥니다')))

async function main() {
  const stuck = await recoverStuck(pool)
  if (stuck) log(`처리 중에 멈춰 있던 ${stuck}장을 대기로 되돌렸습니다`)

  // 개발 편의: 연계가 하나도 없으면 기본 폴더 연계를 만든다 (이후에는 연계 관리 화면에서 관리)
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM integrations')
  if (!rows[0].n) {
    await pool.query(`INSERT INTO integrations (kind, name, config) VALUES ('FOLDER', '기본 폴더', $1)`, [JSON.stringify(DEFAULT_FOLDER_CONFIG)])
    log(`기본 폴더 연계를 만들었습니다: ${config.ingestRoot}/${DEFAULT_FOLDER_CONFIG.watchDir}`)
  }

  log(`워커 시작 (모델: ${adapter.modelVersion}, 허용 루트: ${config.ingestRoot})`)
  const state = { seen: new Map(), lastScan: new Map() }
  while (!stopping) {
    try {
      const s = await runCycle({ pool, adapter, root: config.ingestRoot, filesDir: config.filesDir, ruleName: config.ruleName, state, log })
      for (const e of s.errors) log(`[오류] ${e}`)
      if (s.done + s.failed > 0) log(`추론 완료 ${s.done}장, 실패 ${s.failed}장`)
      if (s.done + s.failed === 0) await sleep(1000) // 할 일이 없으면 쉰다
    } catch (err) {
      log(`[주기 오류] ${err.message}`) // DB 끊김 등: 죽지 않고 다음 주기에 재시도
      await sleep(5000)
    }
  }
  await pool.end()
  log('워커 종료')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
