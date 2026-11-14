// 데모 모드: 화면이 로그인 전에 읽는 설정(/api/config)과 데모 배정 만들기 스크립트.
import './env-demo-off.mjs'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resetTestDb, startApp } from './helpers.mjs'
import { pool } from '../src/db.mjs'

let app
before(async () => {
  await resetTestDb()
  app = await startApp()
})
after(async () => app.close())

test('DEMO_MODE=false면 /api/config가 demoMode:false (로그인 없이 읽을 수 있다)', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/config' })
  assert.equal(r.statusCode, 200)
  assert.deepEqual(r.json(), { demoMode: false })
})

test('데모 배정 스크립트: 배정이 없으면 qa1에게 1건 만들고, 다시 실행해도 늘지 않는다', async () => {
  const run = () =>
    execFileSync(process.execPath, ['scripts/seed-demo.mjs'], { cwd: new URL('..', import.meta.url), env: process.env, encoding: 'utf8' })
  await pool.query('DELETE FROM assignment_history; DELETE FROM assignment_images; DELETE FROM assignments')
  assert.match(run(), /데모 배정 생성/)
  const first = (await pool.query(`SELECT count(*)::int AS n, max(u.email) AS who FROM assignments a JOIN users u ON u.id = a.assignee_id`)).rows[0]
  assert.equal(first.n, 1)
  assert.equal(first.who, 'qa1@example.com')
  assert.match(run(), /건너뜀/)
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM assignments')).rows[0].n, 1)
})
