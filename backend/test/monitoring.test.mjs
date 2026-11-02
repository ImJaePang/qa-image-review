// 소요 시간 분석 API 테스트: 시각을 직접 넣어 계산 결과를 정확히 검증한다.
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, loginAs, resetTestDb, startApp } from './helpers.mjs'

let app, admin, qa1
let pool
const get = (url, who) => call(app, 'GET', url, who)

before(async () => {
  await resetTestDb()
  app = await startApp()
  ;({ pool } = await import('../src/db.mjs'))
  admin = (await loginAs(app, 'admin@example.com')).headers
  qa1 = (await loginAs(app, 'qa1@example.com')).headers
})
after(async () => {
  await app?.close()
})

describe('접근 제어와 입력 검증', () => {
  test('로그인 없이 401, QA는 403, 관리자는 200', async () => {
    assert.equal((await get('/api/monitoring/time')).status, 401)
    assert.equal((await get('/api/monitoring/time', qa1)).status, 403)
    assert.equal((await get('/api/monitoring/time', admin)).status, 200)
  })

  test('gapMinutes 범위를 벗어나면 400', async () => {
    assert.equal((await get('/api/monitoring/time?gapMinutes=0', admin)).status, 400)
    assert.equal((await get('/api/monitoring/time?gapMinutes=999', admin)).status, 400)
  })

  test('검수 기록이 없으면 빈 목록과 기본값(5분)', async () => {
    const r = (await get('/api/monitoring/time', admin)).body
    assert.equal(r.gapMinutes, 5)
    assert.deepEqual([r.reviewers, r.assignments, r.batches], [[], [], []])
  })
})

describe('계산 결과 (시각을 직접 넣은 시나리오)', () => {
  let code

  before(async () => {
    // 이미지 5장(의심/불량)을 qa1(id=2)에게 배정한 배정 하나
    const a = await pool.query(
      `INSERT INTO assignments (title, assignee_id, created_by, due_date, status)
       VALUES ('시간 테스트', 2, 1, '2026-12-31', 'CONFIRMED') RETURNING id, code`,
    )
    const aid = a.rows[0].id
    code = a.rows[0].code
    const runs = await pool.query(
      `SELECT mr.image_id, mr.id AS run_id FROM model_runs mr WHERE mr.overall_score < 0.9 ORDER BY mr.overall_score LIMIT 5`,
    )
    for (const [i, r] of runs.rows.entries()) {
      await pool.query(`INSERT INTO assignment_images (assignment_id, image_id, run_id, position) VALUES ($1, $2, $3, $4)`, [aid, r.image_id, r.run_id, i + 1])
    }
    const img = runs.rows.map((r) => r.image_id)

    const hist = (from, to, at) =>
      pool.query(`INSERT INTO assignment_history (assignment_id, from_status, to_status, action, actor_id, at) VALUES ($1, $2, $3, 'x', 1, $4)`, [aid, from, to, at])
    await hist(null, 'ASSIGNED', '2026-01-01 09:00:00+00')
    await hist('ASSIGNED', 'PRECHECKED', '2026-01-01 09:30:00+00')
    await hist('PRECHECKED', 'IN_REVIEW', '2026-01-01 10:00:00+00')
    await hist('IN_REVIEW', 'REVIEWED', '2026-01-01 10:15:00+00')
    await hist('REVIEWED', 'CONFIRMED', '2026-01-01 11:00:00+00')

    // qa1: 30초, 30초, (자리 비움 10분), 20초, 번복 20초 간격
    const rev = (reviewer, image, at) =>
      pool.query(`INSERT INTO reviews (assignment_id, image_id, reviewer_id, status, decided_at) VALUES ($1, $2, $3, 'APPROVED', $4)`, [aid, image, reviewer, at])
    await rev(2, img[0], '2026-01-01 10:00:30+00')
    await rev(2, img[1], '2026-01-01 10:01:00+00')
    await rev(2, img[2], '2026-01-01 10:01:30+00')
    await rev(2, img[3], '2026-01-01 10:11:30+00') // 직전과 600초 간격
    await rev(2, img[4], '2026-01-01 10:11:50+00')
    await rev(2, img[4], '2026-01-01 10:12:10+00') // 같은 이미지 번복
    // qa2(id=3)가 같은 배정에 한 번 끼어든다: qa1의 간격 계산에 영향이 없어야 한다
    await rev(3, img[0], '2026-01-01 10:05:00+00')

    // 모델 처리 시간: 100ms x 9, 200, 300, 1000
    await pool.query(`UPDATE model_runs SET duration_ms = 100`)
    for (const [ms, id] of [[200, 1], [300, 2], [1000, 3]]) await pool.query(`UPDATE model_runs SET duration_ms = $1 WHERE id = $2`, [ms, id])

    // 사전배치: 5장을 10초에 처리, 그리고 끝나지 않은 실패 건
    await pool.query(
      `INSERT INTO batch_jobs (assignment_id, model_version, status, total_count, processed_count, started_at, finished_at)
       VALUES ($1, 'test-v1', 'SUCCEEDED', 5, 5, '2026-01-01 09:20:00+00', '2026-01-01 09:20:10+00')`,
      [aid],
    )
    await pool.query(
      `INSERT INTO batch_jobs (assignment_id, model_version, status, total_count, processed_count, failed_count, started_at)
       VALUES ($1, 'test-v1', 'FAILED', 5, 0, 5, '2026-01-01 09:10:00+00')`,
      [aid],
    )
  })

  test('담당자별: 자리 비움(5분 초과)은 평균에서 제외, 번복 횟수 집계', async () => {
    const r = (await get('/api/monitoring/time', admin)).body
    const q = r.reviewers.find((x) => x.name === '김검수')
    assert.equal(q.decisions, 6)
    assert.equal(q.images, 5)
    assert.equal(q.overturned, 1)
    assert.equal(q.timedDecisions, 4) // 30, 30, 20, 20
    assert.equal(q.idleGaps, 1) // 600초
    assert.equal(q.activeSeconds, 100)
    assert.equal(q.avgSecondsPerImage, 25)
    assert.equal(q.medianSecondsPerImage, 25)
  })

  test('다른 담당자의 검수가 끼어들어도 서로의 간격에 영향이 없다', async () => {
    const r = (await get('/api/monitoring/time', admin)).body
    const q2 = r.reviewers.find((x) => x.name === '이점검')
    assert.equal(q2.decisions, 1)
    assert.equal(q2.timedDecisions, 0)
    assert.equal(q2.avgSecondsPerImage, null)
  })

  test('기준 시간을 늘리면 자리 비움 구간이 포함된다 (15분)', async () => {
    const r = (await get('/api/monitoring/time?gapMinutes=15', admin)).body
    const q = r.reviewers.find((x) => x.name === '김검수')
    assert.equal(r.gapMinutes, 15)
    assert.equal(q.timedDecisions, 5)
    assert.equal(q.idleGaps, 0)
    assert.equal(q.activeSeconds, 700)
    assert.equal(q.avgSecondsPerImage, 140)
  })

  test('배정별: 점검 시작~완료 시간 ÷ 검수한 이미지 수, 배정~확인 소요', async () => {
    const r = (await get('/api/monitoring/time', admin)).body
    const a = r.assignments.find((x) => x.id === code)
    assert.equal(a.totalImages, 5)
    assert.equal(a.reviewed, 5)
    assert.equal(a.reviewSeconds, 900)
    assert.equal(a.avgSecondsPerImage, 180) // 900 / 5
    assert.equal(a.activeSeconds, 100 + 0) // qa2의 단독 검수는 간격이 없다
    assert.equal(a.avgActiveSecondsPerImage, 20) // 100 / 5
    assert.equal(a.leadSeconds, 7200)
  })

  test('아직 점검이 끝나지 않은 배정은 소요 시간이 null', async () => {
    const later = await pool.query(
      `INSERT INTO assignments (title, assignee_id, created_by, due_date) VALUES ('진행 전', 2, 1, '2026-12-31') RETURNING code`,
    )
    const r = (await get('/api/monitoring/time', admin)).body
    const a = r.assignments.find((x) => x.id === later.rows[0].code)
    assert.equal(a.reviewSeconds, null)
    assert.equal(a.avgSecondsPerImage, null)
    assert.equal(a.leadSeconds, null)
  })

  test('모델: 평균, p95, 최대 처리 시간', async () => {
    const m = (await get('/api/monitoring/time', admin)).body.models[0]
    assert.equal(m.modelVersion, 'test-v1')
    assert.equal(m.runs, 12)
    assert.equal(m.avgMs, 200)
    assert.equal(m.p95Ms, 615)
    assert.equal(m.maxMs, 1000)
  })

  test('사전배치: 장당 초, 끝나지 않은 건은 null', async () => {
    const b = (await get('/api/monitoring/time', admin)).body.batches
    const ok = b.find((x) => x.status === 'SUCCEEDED')
    assert.equal(ok.seconds, 10)
    assert.equal(ok.secondsPerImage, 2)
    const failed = b.find((x) => x.status === 'FAILED')
    assert.equal(failed.seconds, null)
    assert.equal(failed.secondsPerImage, null)
    assert.equal(failed.failed, 5)
  })
})
