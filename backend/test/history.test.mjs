// 점검 이력: 검수 기록(번복 포함)을 내 것/전체로, 상태·검색·페이지로 본다.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, loginAs, resetTestDb, startApp } from './helpers.mjs'

let app
let admin, qa1, qa2
let code
const api = (method, url, who, payload) => call(app, method, url, who, payload)

before(async () => {
  await resetTestDb()
  app = await startApp()
  admin = (await loginAs(app, 'admin@example.com')).headers
  qa1 = (await loginAs(app, 'qa1@example.com')).headers
  qa2 = (await loginAs(app, 'qa2@example.com')).headers

  const users = (await api('GET', '/api/users', admin)).body.items
  const id = (email) => users.find((u) => u.email === email).id
  const made = await api('POST', '/api/assignments', admin, { title: '이력 시험', assigneeId: id('qa1@example.com'), dueDate: '2030-01-01', verdicts: ['SUSPECT', 'DEFECT'], count: 3 })
  code = made.body.id
  await api('POST', `/api/assignments/${code}/status`, qa1, { to: 'IN_REVIEW' })
  const imgs = (await api('GET', `/api/assignments/${code}/images`, qa1)).body.items
  const review = (img, status, comment) => api('PUT', `/api/assignments/${code}/images/${img.imageId}/review`, qa1, { status, comment })
  await review(imgs[0], 'APPROVED', '문제 없음')
  await review(imgs[1], 'REJECTED', '합성 경계 이상')
  await review(imgs[0], 'REJECTED', '다시 보니 반려') // 번복
})
after(async () => app.close())

test('내 이력: 번복도 한 줄씩, 가장 최근 결정만 isCurrent', async () => {
  const r = (await api('GET', '/api/review-history', qa1)).body
  assert.equal(r.total, 3)
  assert.deepEqual(r.statusCounts, { APPROVED: 1, REJECTED: 2 })
  // 최신순: 번복한 반려 → 반려 → 처음 승인
  assert.deepEqual(r.items.map((x) => [x.status, x.comment, x.isCurrent]), [
    ['REJECTED', '다시 보니 반려', true],
    ['REJECTED', '합성 경계 이상', true],
    ['APPROVED', '문제 없음', false], // 이후에 번복됨
  ])
  const first = r.items[0]
  assert.equal(first.assignmentId, code)
  assert.equal(first.assignmentTitle, '이력 시험')
  assert.equal(first.reviewerName, '김검수')
  assert.match(first.thumbUrl, /^\/api\/images\/.+\/thumb$/)
  assert.ok(['NORMAL', 'SUSPECT', 'DEFECT'].includes(first.verdict))
})

test('남의 기록은 내 이력에 없고, 전체 보기는 배정 관리 권한이 있어야 한다', async () => {
  assert.equal((await api('GET', '/api/review-history', qa2)).body.total, 0)
  assert.equal((await api('GET', '/api/review-history?scope=all', qa2)).status, 403)
  const all = (await api('GET', '/api/review-history?scope=all', admin)).body
  assert.equal(all.total, 3)
  assert.equal((await api('GET', '/api/review-history', admin)).body.total, 0) // 관리자 본인 기록은 없다
  assert.equal((await api('GET', '/api/review-history', undefined)).status, 401)
})

test('상태 필터·검색·페이지', async () => {
  assert.equal((await api('GET', '/api/review-history?status=APPROVED', qa1)).body.total, 1)
  const found = (await api('GET', `/api/review-history?q=${encodeURIComponent('합성')}`, qa1)).body
  assert.deepEqual(found.items.map((x) => x.comment), ['합성 경계 이상'])
  assert.equal((await api('GET', '/api/review-history?q=%EC%9D%B4%EB%A0%A5', qa1)).body.total, 3) // 배정명 '이력 시험'
  const p2 = (await api('GET', '/api/review-history?pageSize=2&page=2', qa1)).body
  assert.equal(p2.items.length, 1)
  assert.equal(p2.total, 3)
  assert.equal((await api('GET', '/api/review-history?status=BAD', qa1)).status, 400)
})

test('history.view 권한이 없으면 403', async () => {
  const { pool } = await import('../src/db.mjs')
  await pool.query(`DELETE FROM role_permissions WHERE role_code = 'qa' AND permission_code = 'history.view'`)
  try {
    assert.equal((await api('GET', '/api/review-history', qa1)).status, 403)
  } finally {
    await pool.query(`INSERT INTO role_permissions (role_code, permission_code) VALUES ('qa', 'history.view')`)
  }
})
