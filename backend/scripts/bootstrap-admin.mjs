// 공개 서버 첫 시작: 데모 계정(비밀번호 1234)을 정리하고 관리자 비밀번호를 .env의 ADMIN_PASSWORD로 설정한다.
// 사용: npm run bootstrap-admin   (컨테이너는 DEMO_MODE가 아닐 때 docker-start가 자동 실행)
// 값은 출력하지 않는다. 문제가 있으면 종료 코드 1.
import { bootstrapAdmin } from '../src/bootstrap.mjs'
import { pool } from '../src/db.mjs'

try {
  const r = await bootstrapAdmin(pool, { adminEmail: process.env.ADMIN_EMAIL || undefined, adminPassword: process.env.ADMIN_PASSWORD || undefined })
  if (r.adminReset) console.log('관리자 비밀번호를 ADMIN_PASSWORD로 설정했습니다.')
  if (r.disabled.length) console.log(`데모 계정 ${r.disabled.length}개를 비활성화했습니다: ${r.disabled.join(', ')}`)
  if (!r.adminReset && !r.disabled.length) console.log('정리할 데모 계정 없음')
} catch (err) {
  console.error(err.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
