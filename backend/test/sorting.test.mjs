// 검수 순서(정렬 5종)와 정상 표본: 배정할 때 순서를 고정하고, 검수 화면에서 정렬·필터·건수·다음 미검토가 같은 기준을 따른다.
// 픽스처: 이미지 12장 = 점수 [0.95 0.93 0.92 0.91 0.99 0.97 | 0.8 0.7 0.6 | 0.4 0.3 0.2] (img_0001~0012), 규칙 v1 기준점 0.90 / 0.50
//   정상 6 / 의심 3(0.8 0.7 0.6) / 불량 3(0.4 0.3 0.2), 0.9 미만에는 박스 1개씩
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, loginAs, resetTestDb, startApp } from './helpers.mjs'
import { pool } from '../src/db.mjs'
import { sampleSize } from '../src/imageOrder.mjs'

let app
let admin, qa1
let qa1Id
const api = (method, url, who, payload) => call(app, method, url, who, payload)

before(async () => {
  await resetTestDb()
  app = await startApp()
  admin = (await loginAs(app, 'admin@example.com')).headers
  qa1 = (await loginAs(app, 'qa1@example.com')).headers
  qa1Id = (await api('GET', '/api/users', admin)).body.items.find((u) => u.email === 'qa1@example.com').id
  // 박스 수가 갈리도록: 점수 0.7(img_0008)에 2개, 0.4(img_0010)에 1개를 더한다
  for (const [key, extra] of [['img_0008', 2], ['img_0010', 1]]) {
    for (let i = 0; i < extra; i++) {
      await pool.query(
        `INSERT INTO detections (run_id, x, y, width, height, score, reason_code)
         SELECT mr.id, 300 + $2, 300, 40, 40, 0.5, 'SHAPE_DISTORTION' FROM model_runs mr JOIN images i ON i.id = mr.image_id WHERE i.image_key = $1`,
        [key, i * 50],
      )
    }
  }
})
after(async () => app.close())

const clear = () => pool.query('DELETE FROM assignment_history; DELETE FROM assignment_images; DELETE FROM assignments')
const assign = (extra = {}) => api('POST', '/api/assignments', admin, { title: '정렬 시험', assigneeId: qa1Id, dueDate: '2030-01-01', verdicts: ['SUSPECT', 'DEFECT'], count: 6, ...extra })
const scoresOf = async (code, query = '') => (await api('GET', `/api/assignments/${code}/images${query}`, qa1)).body.items.map((x) => x.overallScore)

test('정상 표본 장수 계산', () => {
  assert.equal(sampleSize(2081, 5), 104)
  assert.equal(sampleSize(2081, 100), 2081)
  assert.equal(sampleSize(6, 1), 1) // 후보가 있으면 최소 1장
  assert.equal(sampleSize(0, 50), 0)
  assert.equal(sampleSize(10, 0), 0)
})

test('배정 순서: 점수 낮은 순(기본)·높은 순', async () => {
  let r = await assign()
  assert.equal(r.status, 201)
  assert.deepEqual(await scoresOf(r.body.id), [0.2, 0.3, 0.4, 0.6, 0.7, 0.8])
  await clear()
  r = await assign({ order: 'score_desc' })
  assert.deepEqual(await scoresOf(r.body.id), [0.8, 0.7, 0.6, 0.4, 0.3, 0.2])
  await clear()
})

test('배정 순서: 경계에 가까운 순(기준점 0.9/0.5), 이상 영역 많은 순, 최신 수신순', async () => {
  let r = await assign({ order: 'boundary' })
  const s = await scoresOf(r.body.id)
  // 기준점까지 거리: 0.8·0.6·0.4 = 0.1(가장 애매), 0.7·0.3 = 0.2, 0.2 = 0.3
  assert.deepEqual(s.slice(0, 3).sort(), [0.4, 0.6, 0.8])
  assert.deepEqual(s.slice(3, 5).sort(), [0.3, 0.7])
  assert.equal(s[5], 0.2)
  await clear()

  r = await assign({ order: 'boxes_desc' })
  // 박스: 0.7=3개, 0.4=2개, 나머지 1개(점수 낮은 순)
  assert.deepEqual(await scoresOf(r.body.id), [0.7, 0.4, 0.2, 0.3, 0.6, 0.8])
  await clear()

  r = await assign({ order: 'newest', verdicts: ['NORMAL', 'SUSPECT', 'DEFECT'], count: 12 })
  const keys = (await api('GET', `/api/assignments/${r.body.id}/images`, qa1)).body.items.map((x) => x.imageId)
  assert.equal(keys[0], 'img_0012')
  assert.equal(keys.at(-1), 'img_0001')
  await clear()
})

test('이미지 수 상한은 고른 순서대로 자른다', async () => {
  const r = await assign({ count: 3 })
  assert.deepEqual(await scoresOf(r.body.id), [0.2, 0.3, 0.4]) // 점수 낮은 3장
  await clear()
  const b = await assign({ count: 3, order: 'boundary' })
  assert.equal(b.body.count, 3)
  assert.ok((await scoresOf(b.body.id)).every((x) => [0.4, 0.6, 0.8].includes(x))) // 가장 애매한 3장
  await clear()
})

test('정상 표본: 비율만큼만 뽑고 의심·불량은 전부, 이력에 기준이 남는다', async () => {
  // 정상 6장 중 50% = 3장
  let r = await assign({ verdicts: ['NORMAL'], normalPercent: 50, count: 100 })
  assert.equal(r.body.count, 3)
  const items = (await api('GET', `/api/assignments/${r.body.id}/images`, qa1)).body.items
  assert.ok(items.every((x) => x.verdict === 'NORMAL'))
  let hist = (await api('GET', `/api/assignments/${r.body.id}`, qa1)).body.history
  assert.match(JSON.stringify(hist), /정상 표본 50% \(3장\)/)
  await clear()

  // 의심 3 + 불량 3은 전부, 정상은 1%라 최소 1장
  r = await assign({ verdicts: ['NORMAL', 'SUSPECT', 'DEFECT'], normalPercent: 1, count: 100 })
  assert.equal(r.body.count, 7)
  await clear()

  // 100%(기본)이면 정상 전부
  r = await assign({ verdicts: ['NORMAL'], count: 100 })
  assert.equal(r.body.count, 6)
  hist = (await api('GET', `/api/assignments/${r.body.id}`, qa1)).body.history
  assert.match(JSON.stringify(hist), /정상 전체 \(6장\)/)
  assert.match(JSON.stringify(hist), /검수 순서: 점수 낮은 순/)
  await clear()

  assert.equal((await assign({ normalPercent: 0 })).status, 400)
  assert.equal((await assign({ normalPercent: 101 })).status, 400)
  assert.equal((await assign({ order: 'random' })).status, 400) // 무작위는 없다
})

test('검수 화면: 정렬·필터·판정·건수가 같은 기준', async () => {
  const made = await assign() // 점수 낮은 순 위치: 0.2 0.3 0.4 0.6 0.7 0.8
  const code = made.body.id
  assert.equal((await api('POST', `/api/assignments/${code}/status`, qa1, { to: 'IN_REVIEW' })).status, 200)
  const imgs = (await api('GET', `/api/assignments/${code}/images`, qa1)).body.items
  const review = (img, status) => api('PUT', `/api/assignments/${code}/images/${img.imageId}/review`, qa1, { status, comment: '', reasons: status === 'REJECTED' ? ['TEXTURE_ANOMALY'] : [] })
  await review(imgs[0], 'APPROVED') // 0.2
  await review(imgs[2], 'REJECTED') // 0.4

  assert.deepEqual(await scoresOf(code, '?sort=score_desc'), [0.8, 0.7, 0.6, 0.4, 0.3, 0.2])
  assert.deepEqual(await scoresOf(code, '?sort=boxes_desc'), [0.7, 0.4, 0.2, 0.3, 0.6, 0.8])
  assert.deepEqual(await scoresOf(code, '?filter=unreviewed'), [0.3, 0.6, 0.7, 0.8]) // 배정 순서 기준
  assert.deepEqual(await scoresOf(code, '?filter=approved'), [0.2])
  assert.deepEqual(await scoresOf(code, '?filter=rejected&sort=score_desc'), [0.4])
  assert.deepEqual(await scoresOf(code, '?verdict=DEFECT&sort=score_desc'), [0.4, 0.3, 0.2])
  assert.equal((await api('GET', `/api/assignments/${code}/images?sort=random`, qa1)).status, 400)
  const page = (await api('GET', `/api/assignments/${code}/images?filter=unreviewed&sort=score_desc`, qa1)).body
  assert.equal(page.total, 4)

  const counts = (await api('GET', `/api/assignments/${code}/image-counts`, qa1)).body
  assert.deepEqual(counts, { all: 6, unreviewed: 4, approved: 1, rejected: 1 })
  const defectCounts = (await api('GET', `/api/assignments/${code}/image-counts?verdict=DEFECT`, qa1)).body
  assert.deepEqual(defectCounts, { all: 3, unreviewed: 1, approved: 1, rejected: 1 })
  assert.equal((await api('GET', `/api/assignments/${code}/image-counts?verdict=BAD`, qa1)).status, 400)
})

test('다음 미검토: 지금 보는 목록(정렬·필터)을 기준으로 한 위치, 끝에서는 처음으로 돌아간다', async () => {
  const [code] = (await api('GET', '/api/assignments', admin)).body.items.map((a) => a.id)
  const next = async (q) => (await api('GET', `/api/assignments/${code}/next-unreviewed?${q}`, qa1)).body.position
  // 배정 순서(기본): 0.2·0.4는 검수됨 → 다음 미검토는 2번째(0.3)
  assert.equal(await next('after=0'), 2)
  assert.equal(await next('after=2'), 4) // 3번째(0.4)는 검수됨 → 4번째(0.6)
  // 점수 높은 순 [0.8 0.7 0.6 0.4 0.3 0.2]: 미검토는 1·2·3·5번째
  assert.equal(await next('after=0&sort=score_desc'), 1)
  assert.equal(await next('after=1&sort=score_desc'), 2)
  assert.equal(await next('after=3&sort=score_desc'), 5) // 4번째(0.4)는 검수됨
  // 불량만(배정 순서) [0.2 0.3 0.4]: 미검토는 2번째(0.3)뿐
  assert.equal(await next('after=0&verdict=DEFECT'), 2)
  assert.equal(await next('after=2&verdict=DEFECT'), 2) // 뒤에 없으면 처음부터 다시 찾는다
  // 승인된 것만 보는 중에는 미검토가 없다
  assert.equal(await next('after=0&filter=approved'), null)
  assert.equal((await api('GET', `/api/assignments/${code}/next-unreviewed?sort=random`, qa1)).status, 400)
})
