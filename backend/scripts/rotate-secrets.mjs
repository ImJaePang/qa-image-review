// 비밀값 교체: .env의 POSTGRES_PASSWORD와 JWT_SECRET을 새 무작위 값으로 바꾸고, 실행 중인 DB 사용자의 비밀번호도 같이 바꾼다.
// 값은 화면·로그에 절대 출력하지 않는다 (상태만 출력). DB 비밀번호는 명령줄이 아니라 표준입력(stdin)으로 넘긴다.
//   사용:  cd backend && npm run rotate-secrets          (--dry-run: 아무것도 바꾸지 않고 전제 조건만 확인)
// 순서: ① .env 읽기·검사 → ② 백업 → ③ 새 값을 .env에 쓰기 → ④ DB 비밀번호 변경 (실패하면 .env를 되돌림)
//       → ⑤ 새/옛 비밀번호로 접속해 확인 → ⑥ 백업 삭제.
// 끝난 뒤: JWT_SECRET이 바뀌어 모든 로그인 세션이 만료된다. API는 다시 시작해야 새 값을 읽는다
//   (`npm run dev`는 backend/src/server.mjs 파일을 저장(touch)하면 자동으로 다시 시작).
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const ENV = resolve(import.meta.dirname, '../../.env')
const CONTAINER = process.env.DB_CONTAINER ?? 'qa-db'
const dryRun = process.argv.includes('--dry-run')

const fail = (msg) => {
  console.error(`중단: ${msg}`)
  process.exit(1)
}

if (!existsSync(ENV)) fail('.env 파일이 없습니다.')
const raw = readFileSync(ENV, 'utf8')
const get = (key) => new RegExp(`^${key}=(.*?)\\r?$`, 'm').exec(raw)?.[1]
const user = get('POSTGRES_USER')
const db = get('POSTGRES_DB')
const oldPw = get('POSTGRES_PASSWORD')
const port = Number(get('POSTGRES_PORT') ?? 5432)
if (!user || !db || !oldPw || !get('JWT_SECRET')) fail('.env에 POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, JWT_SECRET이 모두 있어야 합니다.')
if (!/^[A-Za-z0-9_]+$/.test(user)) fail('POSTGRES_USER에 영문·숫자·밑줄 외의 문자가 있어 안전하게 처리할 수 없습니다.')

const docker = spawnSync('docker', ['exec', CONTAINER, 'pg_isready', '-U', user, '-d', db], { encoding: 'utf8' })
if (docker.status !== 0) fail(`DB 컨테이너(${CONTAINER})에 연결할 수 없습니다. docker compose up -d 로 먼저 켜세요.`)
console.log('전제 조건 확인: .env 키, DB 컨테이너 OK')
if (dryRun) {
  console.log('--dry-run: 여기서 끝냅니다 (아무것도 바꾸지 않았습니다).')
  process.exit(0)
}

const backup = `${ENV}.rotate-bak`
copyFileSync(ENV, backup)
const newPw = randomBytes(24).toString('hex') // 영문 소문자·숫자만이라 SQL 따옴표 문제가 없다
const newJwt = randomBytes(48).toString('hex')
const put = (text, key, val) => text.replace(new RegExp(`^${key}=.*?(\\r?)$`, 'm'), (_m, cr) => `${key}=${val}${cr}`)
writeFileSync(ENV, put(put(raw, 'POSTGRES_PASSWORD', newPw), 'JWT_SECRET', newJwt))

const alter = spawnSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', user, '-d', db, '-v', 'ON_ERROR_STOP=1'], { input: `ALTER USER "${user}" PASSWORD '${newPw}';\n` })
if (alter.status !== 0) {
  copyFileSync(backup, ENV)
  unlinkSync(backup)
  fail('DB 비밀번호 변경에 실패해 .env를 원래대로 되돌렸습니다. (오류 내용은 비밀번호 보호를 위해 출력하지 않습니다)')
}
console.log('DB 비밀번호 변경: 성공')

const works = async (password) => {
  const c = new pg.Client({ host: 'localhost', port, user, password, database: db })
  try {
    await c.connect()
    await c.query('SELECT 1')
    await c.end()
    return true
  } catch {
    return false
  }
}
const [newOk, oldOk] = [await works(newPw), await works(oldPw)]
console.log(`접속 확인: 새 비밀번호 ${newOk ? '성공' : '실패'}, 옛 비밀번호 ${oldOk ? '아직 통함(DB 설정 확인 필요)' : '거부됨'}`)
if (!newOk) fail('새 비밀번호로 접속되지 않습니다. 백업은 .env.rotate-bak에 남겨 두었습니다.')
unlinkSync(backup)
console.log('JWT_SECRET 교체: 완료 (로그인 세션은 모두 만료됩니다). API를 다시 시작하세요.')
