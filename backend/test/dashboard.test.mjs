// 대시보드: 범위(전체/내 것), 미배정 검수 대상, 검수 진행, 최근 7일, 내 할 일.
// 픽스처: 이미지 12장 = 정상 6 / 의심 3 / 불량 3
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, loginAs, resetTestDb, startApp } from './helpers.mjs'
import { pool } from '../src/db.mjs'

let app
let admin, qa1, qa2
const api = (method, url, who, payload) => call(app, method, url, who, payload)

before(async () => {
  await resetTestDb()
  app = await startApp()
  admin = (await loginAs(app, 'admin@example.com')).headers
  qa1 = (await loginAs(app, 'qa1@example.com')).headers
  qa2 = (await loginAs(app, 'qa2@example.com')).headers
})
after(async () => app.close())

test('처음: 관리자는 전체 분포와 미배정 검수 대상을 보고, QA는 비어 있다', async () => {
  const a = (await api('GET', '/api/dashboard', admin)).body
  assert.deepEqual(a.scope, { images: 'all', work: 'all' })
  assert.deepEqual(a.images, { NORMAL: 6, SUSPECT: 3, DEFECT: 3 })
  assert.deepEqual(a.unassignedTargets, { SUSPECT: 3, DEFECT: 3 })
  assert.deepEqual(a.assignments, { ASSIGNED: 0, IN_REVIEW: 0, REVIEWED: 0, CONFIRMED: 0 })
  assert.deepEqual(a.review, { total: 0, reviewed: 0, approved: 0, rejected: 0 })
  assert.equal(a.daily.length, 7)
  assert.ok(a.daily.every((d) => d.count === 0))

  const q = (await api('GET', '/api/dashboard', qa1)).body
  assert.deepEqual(q.scope, { images: 'mine', work: 'mine' })
  assert.deepEqual(q.images, { NORMAL: 0, SUSPECT: 0, DEFECT: 0 })
  assert.equal(q.unassignedTargets, null) // 배정 관리 권한이 없으면 주지 않는다
  assert.deepEqual(q.mine, { openAssignments: 0, unreviewed: 0 })
})

test('배정하고 검수하면 진행·최근 7일·내 할 일에 반영된다', async () => {
  const users = (await api('GET', '/api/users', admin)).body.items
  const qa1Id = users.find((u) => u.email === 'qa1@example.com').id
  const made = await api('POST', '/api/assignments', admin, { title: '대시보드 시험', assigneeId: qa1Id, dueDate: '2030-01-01', verdicts: ['SUSPECT', 'DEFECT'], count: 4 })
  const code = made.body.id
  await api('POST', `/api/assignments/${code}/status`, qa1, { to: 'IN_REVIEW' })
  const imgs = (await api('GET', `/api/assignments/${code}/images`, qa1)).body.items
  await api('PUT', `/api/assignments/${code}/images/${imgs[0].imageId}/review`, qa1, { status: 'APPROVED', comment: '' })
  await api('PUT', `/api/assignments/${code}/images/${imgs[1].imageId}/review`, qa1, { status: 'REJECTED', comment: '', reasons: ['TEXTURE_ANOMALY'] })

  const a = (await api('GET', '/api/dashboard', admin)).body
  assert.equal(a.unassignedTargets.SUSPECT + a.unassignedTargets.DEFECT, 2) // 6장 중 4장 배정
  assert.equal(a.assignments.IN_REVIEW, 1)
  assert.deepEqual(a.review, { total: 4, reviewed: 2, approved: 1, rejected: 1 })
  assert.equal(a.daily.at(-1).count, 2) // 오늘 2건
  assert.equal(a.daily.reduce((n, d) => n + d.count, 0), 2)

  const q = (await api('GET', '/api/dashboard', qa1)).body
  assert.equal(q.images.SUSPECT + q.images.DEFECT, 4) // 내게 배정된 이미지만
  assert.deepEqual(q.review, { total: 4, reviewed: 2, approved: 1, rejected: 1 })
  assert.deepEqual(q.mine, { openAssignments: 1, unreviewed: 2 })

  const other = (await api('GET', '/api/dashboard', qa2)).body // 남의 일은 보이지 않는다
  assert.deepEqual(other.review, { total: 0, reviewed: 0, approved: 0, rejected: 0 })
  assert.ok(other.daily.every((d) => d.count === 0))
  assert.equal(other.assignments.IN_REVIEW, 0)
})

test('시간대: 올바른 값은 받고 잘못된 값은 400, 로그인·권한 필요', async () => {
  assert.equal((await api('GET', '/api/dashboard?tz=Asia/Seoul', admin)).status, 200)
  assert.equal((await api('GET', '/api/dashboard?tz=Not/AZone', admin)).status, 400)
  assert.equal((await api('GET', '/api/dashboard?tz=%27%3B%20DROP', admin)).status, 400) // 형식 검사
  assert.equal((await api('GET', '/api/dashboard')).status, 401)
  await pool.query(`DELETE FROM role_permissions WHERE role_code = 'qa' AND permission_code = 'dashboard.view'`)
  try {
    assert.equal((await api('GET', '/api/dashboard', qa1)).status, 403)
  } finally {
    await pool.query(`INSERT INTO role_permissions (role_code, permission_code) VALUES ('qa', 'dashboard.view')`)
  }
})
