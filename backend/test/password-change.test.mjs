// 임시 비밀번호(메일 꺼짐) → 비밀번호 변경 강제 → 본인 변경
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

const idOf = async (email) => String((await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id)

test('초기화한 계정은 비밀번호를 바꾸기 전까지 내 정보·비밀번호 변경만 쓸 수 있다', async () => {
  const id = await idOf('qa2@example.com')
  const r = await call(app, 'POST', `/api/admin/users/${id}/reset-password`, admin)
  assert.equal(r.status, 200)
  assert.ok(r.body.tempPassword)

  const login = await loginAs(app, 'qa2@example.com', r.body.tempPassword)
  assert.equal(login.res.statusCode, 200)
  assert.equal(JSON.parse(login.res.body).user.mustChangePassword, true)

  const blocked = await call(app, 'GET', '/api/assignments', login.headers)
  assert.equal(blocked.status, 403)
  assert.equal(blocked.body.code, 'MUST_CHANGE_PASSWORD')
  const me = await call(app, 'GET', '/api/auth/me', login.headers)
  assert.equal(me.status, 200)
  assert.equal(me.body.user.mustChangePassword, true)

  // 틀린 현재 비밀번호 / 너무 짧음 / 같은 비밀번호
  const wrong = await call(app, 'POST', '/api/auth/change-password', login.headers, { currentPassword: 'nope', newPassword: 'new-password-1' })
  assert.equal(wrong.status, 400)
  assert.equal(wrong.body.code, 'WRONG_PASSWORD')
  assert.equal((await call(app, 'POST', '/api/auth/change-password', login.headers, { currentPassword: r.body.tempPassword, newPassword: 'short' })).status, 400)
  const same = await call(app, 'POST', '/api/auth/change-password', login.headers, { currentPassword: r.body.tempPassword, newPassword: r.body.tempPassword })
  assert.equal(same.body.code, 'SAME_PASSWORD')

  const ok = await call(app, 'POST', '/api/auth/change-password', login.headers, { currentPassword: r.body.tempPassword, newPassword: 'new-password-1' })
  assert.equal(ok.status, 200)
  // 이제 일반 API를 쓸 수 있고, 옛 임시 비밀번호는 못 쓴다
  assert.equal((await call(app, 'GET', '/api/assignments', login.headers)).status, 200)
  assert.equal((await call(app, 'GET', '/api/auth/me', login.headers)).body.user.mustChangePassword, false)
  assert.equal((await loginAs(app, 'qa2@example.com', r.body.tempPassword)).res.statusCode, 401)
  const again = await loginAs(app, 'qa2@example.com', 'new-password-1')
  assert.equal(again.res.statusCode, 200)
  assert.equal(JSON.parse(again.res.body).user.mustChangePassword, false)

  const history = (await call(app, 'GET', `/api/admin/users/${id}`, admin)).body.history.map((h) => h.action)
  assert.deepEqual(history.slice(0, 2), ['PASSWORD_CHANGE', 'PASSWORD_RESET'])
})

test('현재 비밀번호를 5번 틀리면 로그인과 같은 횟수 제한으로 잠긴다', async () => {
  await pool.query('DELETE FROM login_failures')
  const { headers } = await loginAs(app, 'qa1@example.com')
  for (let i = 0; i < 5; i++) assert.equal((await call(app, 'POST', '/api/auth/change-password', headers, { currentPassword: 'x', newPassword: 'abcdefgh1' })).status, 400)
  assert.equal((await call(app, 'POST', '/api/auth/change-password', headers, { currentPassword: '1234', newPassword: 'abcdefgh1' })).status, 429)
})

test('로그인하지 않으면 비밀번호를 바꿀 수 없다', async () => {
  assert.equal((await call(app, 'POST', '/api/auth/change-password', {}, { currentPassword: '1234', newPassword: 'abcdefgh1' })).status, 401)
})
