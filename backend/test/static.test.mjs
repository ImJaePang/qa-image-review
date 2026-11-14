// FRONTEND_DIST가 있으면 API 서버가 화면도 내려준다: 실제 파일은 그대로, 모르는 화면 경로는 index.html, /api 는 JSON 404.
import './env-static.mjs'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { resetTestDb, startApp } from './helpers.mjs'

let app
before(async () => {
  await resetTestDb()
  app = await startApp()
})
after(async () => app.close())

test('실제 파일은 그대로, 화면 경로는 index.html', async () => {
  const js = await app.inject({ method: 'GET', url: '/assets/app.js' })
  assert.equal(js.statusCode, 200)
  assert.equal(js.body, 'console.log(1)')
  for (const url of ['/', '/review/assignments', '/settings/users']) {
    const r = await app.inject({ method: 'GET', url })
    assert.equal(r.statusCode, 200, url)
    assert.match(r.body, /<title>spa<\/title>/)
  }
})

test('/api 는 화면으로 넘기지 않고 JSON 오류를 준다', async () => {
  const health = await app.inject({ method: 'GET', url: '/api/health' })
  assert.deepEqual(JSON.parse(health.body), { ok: true })
  const missing = await app.inject({ method: 'GET', url: '/api/없는-경로' })
  assert.equal(missing.statusCode, 404)
  assert.equal(JSON.parse(missing.body).message, '찾을 수 없습니다.')
  const post = await app.inject({ method: 'POST', url: '/없는-화면' })
  assert.equal(post.statusCode, 404)
})
