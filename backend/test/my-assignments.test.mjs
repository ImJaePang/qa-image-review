// 내 배정: GET /api/assignments?mine=true 는 나에게 배정된 것만, 상태별 건수도 같은 범위.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, loginAs, resetTestDb, startApp } from './helpers.mjs'

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

test('내 배정에는 나에게 배정된 것만, 전체 목록에는 모두 보인다', async () => {
  const users = (await api('GET', '/api/users', admin)).body.items
  const id = (email) => users.find((u) => u.email === email).id
  const make = (title, assigneeId, count) => api('POST', '/api/assignments', admin, { title, assigneeId, dueDate: '2030-01-01', verdicts: ['SUSPECT', 'DEFECT'], count })
  assert.equal((await make('qa1 것 A', id('qa1@example.com'), 2)).status, 201)
  assert.equal((await make('qa1 것 B', id('qa1@example.com'), 1)).status, 201)
  assert.equal((await make('qa2 것', id('qa2@example.com'), 1)).status, 201)

  const all = (await api('GET', '/api/assignments', qa1)).body
  assert.equal(all.total, 3)

  const mine1 = (await api('GET', '/api/assignments?mine=true', qa1)).body
  assert.equal(mine1.total, 2)
  assert.deepEqual(mine1.items.map((a) => a.title).sort(), ['qa1 것 A', 'qa1 것 B'])
  assert.equal(mine1.statusCounts.ASSIGNED, 2) // 요약 카드도 내 것만

  const mine2 = (await api('GET', '/api/assignments?mine=true', qa2)).body
  assert.deepEqual(mine2.items.map((a) => a.title), ['qa2 것'])
  assert.equal(mine2.statusCounts.ASSIGNED, 1)

  // 관리자는 맡은 배정이 없으므로 내 배정이 비어 있다 (검색·상태 필터와도 함께 동작)
  assert.equal((await api('GET', '/api/assignments?mine=true', admin)).body.total, 0)
  assert.equal((await api('GET', '/api/assignments?mine=true&status=ASSIGNED&q=%EA%B2%83%20A', qa1)).body.total, 1)
})
