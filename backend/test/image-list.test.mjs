// 이미지 목록: 범위(전체 열람 권한 / 내게 배정된 것), 판정·배정 여부·검색·정렬·페이지, 상세.
// 픽스처: 이미지 12장, 점수 [0.95 0.93 0.92 0.91 0.99 0.97 | 0.8 0.7 0.6 | 0.4 0.3 0.2] → 정상 6 / 의심 3 / 불량 3, 점수 0.9 미만에는 박스 1개
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

test('관리자(전체 열람)는 수신 완료된 12장 전부, 판정별 건수 포함', async () => {
  const r = (await api('GET', '/api/image-list', admin)).body
  assert.equal(r.total, 12)
  assert.deepEqual(r.verdictCounts, { NORMAL: 6, SUSPECT: 3, DEFECT: 3 })
  assert.equal(r.items.length, 12)
  const first = r.items[0] // 최신순: 마지막에 넣은 이미지
  assert.equal(first.fileName, 'tank_12.png')
  assert.match(first.thumbUrl, /^\/api\/images\/img_0012\/thumb$/)
  assert.equal(first.assignmentId, null)
})

test('판정 필터·정렬·검색·페이지', async () => {
  const defect = (await api('GET', '/api/image-list?verdict=DEFECT', admin)).body
  assert.equal(defect.total, 3)
  assert.deepEqual(defect.verdictCounts, { NORMAL: 6, SUSPECT: 3, DEFECT: 3 }) // 판정 칩 건수는 판정 필터와 무관
  const asc = (await api('GET', '/api/image-list?sort=score_asc&pageSize=3', admin)).body
  assert.deepEqual(asc.items.map((x) => x.overallScore), [0.2, 0.3, 0.4])
  const desc = (await api('GET', '/api/image-list?sort=score_desc&pageSize=1', admin)).body
  assert.equal(desc.items[0].overallScore, 0.99)
  assert.equal((await api('GET', '/api/image-list?q=tank_12', admin)).body.total, 1)
  assert.equal((await api('GET', '/api/image-list?q=img_0003', admin)).body.total, 1) // 이미지 키로도 찾는다
  const p3 = (await api('GET', '/api/image-list?pageSize=5&page=3', admin)).body
  assert.equal(p3.items.length, 2)
  assert.equal((await api('GET', '/api/image-list?verdict=BAD', admin)).status, 400)
})

test('QA는 내게 배정된 이미지만 보이고, 배정 여부 필터가 동작한다', async () => {
  assert.equal((await api('GET', '/api/image-list', qa1)).body.total, 0)
  const users = (await api('GET', '/api/users', admin)).body.items
  const qa1Id = users.find((u) => u.email === 'qa1@example.com').id
  const made = await api('POST', '/api/assignments', admin, { title: '목록 시험', assigneeId: qa1Id, dueDate: '2030-01-01', verdicts: ['SUSPECT', 'DEFECT'], count: 4 })
  assert.equal(made.status, 201)

  const mine = (await api('GET', '/api/image-list', qa1)).body
  assert.equal(mine.total, 4)
  assert.ok(mine.items.every((x) => x.assignmentId === made.body.id && x.assignmentStatus === 'ASSIGNED'))
  assert.equal((await api('GET', '/api/image-list', qa2)).body.total, 0) // 남에게 배정된 것은 보이지 않는다

  const unassigned = (await api('GET', '/api/image-list?assigned=unassigned', admin)).body
  assert.equal(unassigned.total, 8)
  assert.equal((await api('GET', '/api/image-list?assigned=assigned', admin)).body.total, 4)
})

test('상세: 박스·히트맵을 주고, 남의 이미지는 403, 없는 이미지는 404', async () => {
  const d = (await api('GET', '/api/image-list/img_0010', admin)).body
  assert.equal(d.imageId, 'img_0010')
  assert.equal(d.boxes.length, 1)
  assert.equal(d.boxes[0].reasonCode, 'TEXTURE_ANOMALY')
  assert.match(d.heatmapUrl, /heatmap$/)
  assert.equal(d.review.status, 'NONE')
  // qa1에게 배정된 이미지는 열 수 있고, 배정되지 않은 것(img_0001)은 403
  const assignedKey = (await api('GET', '/api/image-list?assigned=assigned', admin)).body.items[0].imageKey
  assert.equal((await api('GET', `/api/image-list/${assignedKey}`, qa1)).status, 200)
  assert.equal((await api('GET', '/api/image-list/img_0001', qa1)).status, 403)
  assert.equal((await api('GET', '/api/image-list/img_9999', admin)).status, 404)
})

test('로그인 필요, image_list.view 권한 필요, 수신 미완료 이미지는 나오지 않는다', async () => {
  assert.equal((await api('GET', '/api/image-list')).status, 401)
  await pool.query(`UPDATE images SET ingest_status = 'FAILED' WHERE image_key = 'img_0001'`)
  assert.equal((await api('GET', '/api/image-list', admin)).body.total, 11)
  assert.equal((await api('GET', '/api/image-list/img_0001', admin)).status, 404)
  await pool.query(`DELETE FROM role_permissions WHERE role_code = 'qa' AND permission_code = 'image_list.view'`)
  try {
    assert.equal((await api('GET', '/api/image-list', qa1)).status, 403)
  } finally {
    await pool.query(`INSERT INTO role_permissions (role_code, permission_code) VALUES ('qa', 'image_list.view')`)
  }
})
