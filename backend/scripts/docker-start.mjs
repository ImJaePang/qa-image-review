// 컨테이너 시작 순서: 마이그레이션 적용 → (선택) 데모 데이터 준비 → API 서버 실행.
// 환경변수(POSTGRES_*, JWT_SECRET 등)는 컨테이너 설정으로 받으므로 --env-file을 쓰지 않는다.
//   DEMO_MODE=false      : 데모 계정(1234)을 정리하고 ADMIN_PASSWORD(+ADMIN_EMAIL)로 관리자 설정, 없으면 시작 거부 (scripts/bootstrap-admin.mjs)
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

// 데모 모드가 아니면(공개 서버) 시드의 데모 계정(비밀번호 1234)을 정리하고 관리자 비밀번호를 ADMIN_PASSWORD로 설정한다.
// 설정이 없거나 약하면 여기서 멈춰 서버가 뜨지 않는다 (알려진 비밀번호로 공개되는 것을 막는다).
const { config } = await import('../src/config.mjs')
if (!config.demoMode) run(['scripts/bootstrap-admin.mjs'])

const count = Number(process.env.DEMO_DATA_COUNT ?? 0)
const filesDir = process.env.FILES_DIR
if (count > 0 && filesDir && !existsSync(join(filesDir, 'results.jsonl'))) {
  console.log(`데모 데이터 ${count}장 준비 중…`)
  run(['scripts/generate-mock.mjs', '--count', String(count), '--out', filesDir])
  run(['scripts/load-results.mjs', '--dir', filesDir])
}

// 데모 모드: 처음 열었을 때 화면이 비어 있지 않도록 데모 배정을 하나 만든다 (이미 배정이 있으면 건너뜀)
if (count > 0 && config.demoMode) run(['scripts/seed-demo.mjs'])

await import('../src/server.mjs')
