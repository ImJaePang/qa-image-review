// MAIL_MODE=log: 임시 비밀번호가 메일로만 가고 관리자 응답에는 없다. 기록에는 본문이 없다.
import './env-mail-log.mjs'
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

test('메일이 켜져 있으면 비밀번호는 사용자 메일로만 가고 관리자 응답에는 없다', async () => {
  const id = String((await pool.query(`SELECT id FROM users WHERE email = 'qa2@example.com'`)).rows[0].id)
  const lines = []
  const orig = console.log
  console.log = (...a) => lines.push(a.join(' '))
  let r
  try {
    r = await call(app, 'POST', `/api/admin/users/${id}/reset-password`, admin)
  } finally {
    console.log = orig
  }
  assert.equal(r.status, 200)
  assert.equal(r.body.tempPassword, undefined)
  assert.equal(r.body.sent, true)
  assert.equal(r.body.to, 'q***@example.com')

  const mailText = lines.join('\n')
  assert.match(mailText, /\[mail:log\] to=qa2@example\.com/)
  const temp = mailText.match(/임시 비밀번호: (\S+)/)[1]
  // 메일에 적힌 비밀번호로 로그인되고 변경이 강제된다
  const login = await loginAs(app, 'qa2@example.com', temp)
  assert.equal(JSON.parse(login.res.body).user.mustChangePassword, true)

  // 발송 기록: 받는 사람·종류·성공 여부만, 본문(비밀번호)은 없다
  const log = (await pool.query('SELECT * FROM mail_log ORDER BY id DESC LIMIT 1')).rows[0]
  assert.equal(log.kind, 'TEMP_PASSWORD')
  assert.equal(log.status, 'SENT')
  assert.equal(log.to_address, 'qa2@example.com')
  assert.equal(JSON.stringify(log).includes(temp), false)
  const h = (await call(app, 'GET', `/api/admin/users/${id}`, admin)).body.history[0]
  assert.equal(JSON.stringify(h).includes(temp), false)
})
