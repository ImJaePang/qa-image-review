// 데모 배정 만들기: 배정이 하나도 없고 수신 완료된 이미지가 있을 때만, qa1에게 점검 대상 배정 1건을 만든다.
// 신규 배정 API(POST /api/assignments)를 그대로 호출하므로 규칙·이력이 실제 사용과 같다. 관리자 비밀번호는 쓰지 않고 토큰을 직접 발급한다.
// 사용: node scripts/seed-demo.mjs   (POSTGRES_*, JWT_SECRET 필요. 컨테이너 시작 시 DEMO_MODE=true면 docker-start가 실행)
import { buildApp } from '../src/app.mjs'
import { pool } from '../src/db.mjs'

const app = await buildApp()
try {
  const existing = (await pool.query('SELECT count(*)::int AS n FROM assignments')).rows[0].n
  const images = (await pool.query(`SELECT count(*)::int AS n FROM images WHERE ingest_status = 'DONE'`)).rows[0].n
  const admin = (await pool.query(`SELECT id, role, name FROM users WHERE email = 'admin@example.com' AND status = 'ACTIVE'`)).rows[0]
  const qa = (await pool.query(`SELECT id FROM users WHERE email = 'qa1@example.com' AND status = 'ACTIVE'`)).rows[0]
  if (existing > 0 || !images || !admin || !qa) {
    console.log('데모 배정: 건너뜀 (이미 배정이 있거나 데이터·계정이 없음)')
  } else {
    const token = app.jwt.sign({ sub: String(admin.id), role: admin.role, name: admin.name })
    const due = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10)
    const r = await app.inject({
      method: 'POST',
      url: '/api/assignments',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '데모 점검 배정 (의심·불량 위주)', assigneeId: String(qa.id), dueDate: due, verdicts: ['SUSPECT', 'DEFECT'], count: 40 },
    })
    console.log(r.statusCode === 201 ? `데모 배정 생성: ${r.json().id} (${r.json().count}장)` : `데모 배정 실패: ${r.statusCode} ${r.body}`)
  }
} finally {
  await app.close() // 연결 종료
}
