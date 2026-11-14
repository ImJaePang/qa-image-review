// 컨테이너 시작 순서: 마이그레이션 적용 → (선택) 데모 데이터 준비 → API 서버 실행.
// 환경변수(POSTGRES_*, JWT_SECRET 등)는 컨테이너 설정으로 받으므로 --env-file을 쓰지 않는다.
//   DEMO_MODE=true       : 데모 배정 1건도 만든다 (scripts/seed-demo.mjs)
//   DEMO_DATA_COUNT=300  : 처음 한 번 목 이미지 N장을 만들어 DB에 적재 (0이면 하지 않음). 이미 만들어져 있으면 건너뛴다.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const run = (args) => {
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`실패: node ${args.join(' ')}`)
    process.exit(r.status ?? 1)
  }
}

run(['scripts/migrate.mjs'])

const count = Number(process.env.DEMO_DATA_COUNT ?? 0)
const filesDir = process.env.FILES_DIR
if (count > 0 && filesDir && !existsSync(join(filesDir, 'results.jsonl'))) {
  console.log(`데모 데이터 ${count}장 준비 중…`)
  run(['scripts/generate-mock.mjs', '--count', String(count), '--out', filesDir])
  run(['scripts/load-results.mjs', '--dir', filesDir])
}

// 데모 모드: 처음 열었을 때 화면이 비어 있지 않도록 데모 배정을 하나 만든다 (이미 배정이 있으면 건너뜀)
if (count > 0 && process.env.DEMO_MODE === 'true') run(['scripts/seed-demo.mjs'])

await import('../src/server.mjs')
