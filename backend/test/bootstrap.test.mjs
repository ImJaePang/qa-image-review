// 공개 서버 첫 시작: 데모 계정(1234) 정리와 관리자 비밀번호 설정.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resetTestDb, startApp } from './helpers.mjs'
import { pool } from '../src/db.mjs'
import { bootstrapAdmin, checkAdminPassword } from '../src/bootstrap.mjs'

const NEW_PW = 'Correct-Horse-Battery-9'
let app
const login = (email, password) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })
before(async () => {
  await resetTestDb()
  app = await startApp()
})
after(async () => app.close())

test('비밀번호 검사: 없음·짧음·1234·이메일과 같음은 거부', () => {
  assert.match(checkAdminPassword('', 'a@x.com'), /설정되어 있지 않습니다/)
  assert.match(checkAdminPassword('short-pass', 'a@x.com'), /12자 이상/)
  assert.match(checkAdminPassword('1234', 'a@x.com'), /12자 이상/)
  assert.match(checkAdminPassword('admin@example.com', 'ADMIN@example.com'), /너무 쉽습니다/)
  assert.equal(checkAdminPassword(NEW_PW, 'a@x.com'), null)
})

test('ADMIN_PASSWORD가 없거나 약하면 거부하고 아무것도 바꾸지 않는다', async () => {
  await assert.rejects(() => bootstrapAdmin(pool, {}), /ADMIN_PASSWORD/)
  await assert.rejects(() => bootstrapAdmin(pool, { adminPassword: 'short' }), /12자 이상/)
  assert.equal((await login('admin@example.com', '1234')).statusCode, 200) // 그대로
  assert.equal((await login('qa1@example.com', '1234')).statusCode, 200)
})

test('관리자는 새 비밀번호로 바뀌고, 나머지 데모 계정은 비활성화되며 1234로 들어올 수 없다', async () => {
  const r = await bootstrapAdmin(pool, { adminEmail: 'owner@mysite.dev', adminPassword: NEW_PW })
  assert.equal(r.adminReset, true)
  assert.deepEqual(r.disabled, ['qa1@example.com', 'qa2@example.com', 'qa3@example.com'])
  assert.equal((await login('owner@mysite.dev', NEW_PW)).statusCode, 200)
  assert.equal((await login('owner@mysite.dev', '1234')).statusCode, 401)
  assert.equal((await login('admin@example.com', NEW_PW)).statusCode, 401) // 이메일이 바뀌었다
  assert.notEqual((await login('qa1@example.com', '1234')).statusCode, 200)
  // 이력: 값은 남기지 않고 방식만
  const h = (await pool.query(`SELECT action, detail FROM user_history WHERE detail->>'via' = 'BOOTSTRAP' ORDER BY id`)).rows
  assert.deepEqual(h.map((x) => x.action), ['PASSWORD_RESET', 'DISABLE', 'DISABLE', 'DISABLE'])
  assert.ok(!JSON.stringify(h).includes(NEW_PW))
  // 다시 켜도 비밀번호는 1234가 아니다
  await pool.query(`UPDATE users SET status = 'ACTIVE' WHERE email = 'qa1@example.com'`)
  assert.notEqual((await login('qa1@example.com', '1234')).statusCode, 200)
})

test('다시 실행해도 아무것도 하지 않고, 관리자가 나중에 바꾼 비밀번호를 덮어쓰지 않는다', async () => {
  await pool.query(`UPDATE users SET password_hash = crypt('my-own-new-password', gen_salt('bf')) WHERE email = 'owner@mysite.dev'`)
  const r = await bootstrapAdmin(pool, { adminPassword: 'Another-Long-Password-1' })
  assert.deepEqual(r, { adminReset: false, disabled: [] })
  assert.equal((await login('owner@mysite.dev', 'my-own-new-password')).statusCode, 200)
})

test('스크립트: 설정이 없으면 종료 코드 1, 출력에 비밀번호가 없다', async () => {
  await pool.query(`UPDATE users SET password_hash = crypt('1234', gen_salt('bf')) WHERE email = 'owner@mysite.dev'`)
  const run = (env) => spawnSync(process.execPath, ['scripts/bootstrap-admin.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, ...env }, encoding: 'utf8' })
  const bad = run({ ADMIN_PASSWORD: '' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /ADMIN_PASSWORD/)
  const ok = run({ ADMIN_PASSWORD: NEW_PW })
  assert.equal(ok.status, 0)
  assert.ok(!(ok.stdout + ok.stderr).includes(NEW_PW))
})
