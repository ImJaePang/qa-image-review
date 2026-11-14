// MAIL_MODE=smtp인데 서버에 연결할 수 없으면: 502, 비밀번호 변경은 취소(롤백), 실패 기록은 남는다
import './env-mail-down.mjs'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { call, loginAs, resetTestDb, startApp } from './helpers.mjs'
import { pool } from '../src/db.mjs'

let app
let admin
before(async () => {
  await resetTestDb()
  app = await startApp()
  admin = (await loginAs(app, 'admin@example.com')).headers
})
after(async () => app.close())

test('메일 발송이 실패하면 비밀번호도 바뀌지 않는다', async () => {
  const id = String((await pool.query(`SELECT id FROM users WHERE email = 'qa2@example.com'`)).rows[0].id)
  const r = await call(app, 'POST', `/api/admin/users/${id}/reset-password`, admin)
  assert.equal(r.status, 502)
  assert.equal(r.body.tempPassword, undefined)
  // 원래 비밀번호가 그대로고 변경 강제도 걸리지 않았다
  const login = await loginAs(app, 'qa2@example.com', '1234')
  assert.equal(login.res.statusCode, 200)
  assert.equal(JSON.parse(login.res.body).user.mustChangePassword, false)
  const log = (await pool.query('SELECT status, error FROM mail_log ORDER BY id DESC LIMIT 1')).rows[0]
  assert.equal(log.status, 'FAILED')
  assert.ok(log.error)
  // 이력에도 남지 않는다
  const h = (await call(app, 'GET', `/api/admin/users/${id}`, admin)).body.history.map((x) => x.action)
  assert.equal(h.includes('PASSWORD_RESET'), false)
})
