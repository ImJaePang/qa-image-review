// 로그인 시도 횟수 제한: 이메일·접속 주소 기준 잠금, 잠금 중 거부, 성공 시 초기화, 구간 만료, 만료 해제 요청과 공유
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { call, loginAs, resetTestDb, startApp } from './helpers.mjs'
import { pool } from '../src/db.mjs'

let app
before(async () => {
  await resetTestDb()
  app = await startApp()
})
after(async () => {
  await app.close() // 앱이 닫힐 때 DB 풀도 함께 닫힌다
})
beforeEach(async () => {
  await pool.query('DELETE FROM login_failures')
})

const wrong = (email) => loginAs(app, email, 'wrong-password')

test('같은 이메일로 5번 틀리면 잠기고, 맞는 비밀번호도 잠금 중에는 거부된다', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await wrong('qa1@example.com')).res.statusCode, 401)
  const locked = await wrong('qa1@example.com')
  assert.equal(locked.res.statusCode, 429)
  assert.equal(JSON.parse(locked.res.body).code, 'LOCKED')
  assert.match(JSON.parse(locked.res.body).message, /다시 시도/)
  assert.ok(Number(locked.res.headers['retry-after']) > 0)
  // 맞는 비밀번호도 거부 (비밀번호를 검사하지 않는다)
  const right = await loginAs(app, 'qa1@example.com')
  assert.equal(right.res.statusCode, 429)
  assert.deepEqual(right.headers, {})
  // 다른 이메일은 영향이 없다
  assert.equal((await loginAs(app, 'qa2@example.com')).res.statusCode, 200)
})

test('이메일 대소문자·공백이 달라도 같은 계정으로 센다', async () => {
  for (const e of ['QA1@example.com', 'qa1@EXAMPLE.com', ' qa1@example.com ', 'Qa1@Example.Com', 'qa1@example.com']) await wrong(e)
  assert.equal((await wrong('qa1@example.com')).res.statusCode, 429)
})

test('없는 이메일도 똑같이 잠긴다 (존재 여부가 응답으로 드러나지 않는다)', async () => {
  const codes = []
  for (let i = 0; i < 6; i++) codes.push((await wrong('nobody@example.com')).res.statusCode)
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429])
})

test('잠금 중에는 실패를 더 세지 않아 잠금이 늘어나지 않는다', async () => {
  for (let i = 0; i < 5; i++) await wrong('qa1@example.com')
  const before = (await pool.query(`SELECT failures, locked_until FROM login_failures WHERE scope='EMAIL' AND key='qa1@example.com'`)).rows[0]
  for (let i = 0; i < 3; i++) await wrong('qa1@example.com')
  const after = (await pool.query(`SELECT failures, locked_until FROM login_failures WHERE scope='EMAIL' AND key='qa1@example.com'`)).rows[0]
  assert.equal(after.failures, before.failures)
  assert.equal(after.locked_until.getTime(), before.locked_until.getTime())
})

test('로그인에 성공하면 실패 횟수가 지워진다', async () => {
  for (let i = 0; i < 4; i++) await wrong('qa1@example.com')
  assert.equal((await loginAs(app, 'qa1@example.com')).res.statusCode, 200)
  for (let i = 0; i < 4; i++) assert.equal((await wrong('qa1@example.com')).res.statusCode, 401)
  assert.equal((await loginAs(app, 'qa1@example.com')).res.statusCode, 200)
})

test('잠금 시간이 지나면 다시 시도할 수 있고, 횟수는 1부터 다시 센다', async () => {
  for (let i = 0; i < 5; i++) await wrong('qa1@example.com')
  await pool.query(`UPDATE login_failures SET locked_until = now() - interval '1 second' WHERE scope='EMAIL'`)
  assert.equal((await wrong('qa1@example.com')).res.statusCode, 401)
  const row = (await pool.query(`SELECT failures, locked_until FROM login_failures WHERE scope='EMAIL' AND key='qa1@example.com'`)).rows[0]
  assert.equal(row.failures, 1)
  assert.equal(row.locked_until, null)
  assert.equal((await loginAs(app, 'qa1@example.com')).res.statusCode, 200)
})

test('구간(15분)이 지난 실패는 합치지 않는다', async () => {
  for (let i = 0; i < 4; i++) await wrong('qa1@example.com')
  await pool.query(`UPDATE login_failures SET window_started_at = now() - interval '16 minutes' WHERE scope='EMAIL'`)
  for (let i = 0; i < 4; i++) assert.equal((await wrong('qa1@example.com')).res.statusCode, 401)
})

test('한 주소에서 여러 이메일을 돌려 30번 틀리면 새 이메일도 막힌다', async () => {
  for (let i = 0; i < 30; i++) assert.equal((await wrong(`guess${i}@example.com`)).res.statusCode, 401)
  assert.equal((await wrong('another@example.com')).res.statusCode, 429)
  assert.equal((await loginAs(app, 'qa2@example.com')).res.statusCode, 429)
})

test('만료 해제 요청도 같은 횟수를 공유한다', async () => {
  for (let i = 0; i < 5; i++) {
    const { status } = await call(app, 'POST', '/api/auth/expiry-release-request', {}, { email: 'qa1@example.com', password: 'wrong' })
    assert.equal(status, 401)
  }
  assert.equal((await wrong('qa1@example.com')).res.statusCode, 429)
  const { status } = await call(app, 'POST', '/api/auth/expiry-release-request', {}, { email: 'qa1@example.com', password: '1234' })
  assert.equal(status, 429)
})

test('비밀번호가 맞으면 승인 대기 같은 상태 안내여도 실패로 세지 않고 횟수를 지운다', async () => {
  await pool.query(`INSERT INTO users (name, email, password_hash, role, status) VALUES ('대기', 'wait@example.com', crypt('1234', gen_salt('bf')), 'qa', 'PENDING')`)
  for (let i = 0; i < 4; i++) await wrong('wait@example.com')
  const pending = await loginAs(app, 'wait@example.com')
  assert.equal(pending.res.statusCode, 403)
  assert.equal((await pool.query(`SELECT 1 FROM login_failures WHERE scope='EMAIL' AND key='wait@example.com'`)).rowCount, 0)
})
