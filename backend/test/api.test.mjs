// API 통합 테스트: 실제 Postgres(테스트 전용 DB)에 대해 app.inject로 호출한다.
// 실행: cd backend && npm test   (DB 컨테이너가 떠 있어야 함)
import { after, before, describe, test } from 'node:test'
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
after(async () => {
  await app?.close()
})

const qa1Id = async () => (await api('GET', '/api/users', admin)).body.items.find((u) => u.email === 'qa1@example.com').id

describe('인증', () => {
  test('로그인 없이 보호된 API는 401', async () => {
    assert.equal((await api('GET', '/api/assignments')).status, 401)
    assert.equal((await api('GET', '/api/users')).status, 401)
  })

  test('잘못된 비밀번호는 401, 쿠키 없음', async () => {
    const { res } = await loginAs(app, 'admin@example.com', 'wrong')
    assert.equal(res.statusCode, 401)
    assert.equal(res.cookies.length, 0)
  })

  test('로그인 성공 시 사용자 정보와 httpOnly 쿠키', async () => {
    const { res } = await loginAs(app, 'qa1@example.com')
    assert.equal(res.statusCode, 200)
    assert.equal(JSON.parse(res.body).user.role, 'qa')
    assert.equal(res.cookies[0].httpOnly, true)
  })

  test('가입은 항상 qa 역할 (role을 보내도 무시), 중복 이메일은 409', async () => {
    const r = await api('POST', '/api/auth/signup', null, { name: '신규', email: 'new@example.com', password: '1234', role: 'admin' })
    assert.equal(r.status, 201)
    assert.equal(r.body.user.role, 'qa')
    const dup = await api('POST', '/api/auth/signup', null, { name: '신규', email: 'new@example.com', password: '1234' })
    assert.equal(dup.status, 409)
  })

  test('입력 검증: 너무 짧은 비밀번호는 400', async () => {
    const r = await api('POST', '/api/auth/signup', null, { name: 'a', email: 'a@example.com', password: '1' })
    assert.equal(r.status, 400)
  })
})

describe('배정 흐름 (생성 → 사전배치 → 점검 → 완료 → 확인)', () => {
  let code
  let keys

  test('미배정 이미지 수는 판정별로 집계된다', async () => {
    const r = await api('GET', '/api/unassigned-counts', admin)
    assert.deepEqual(r.body, { NORMAL: 6, SUSPECT: 3, DEFECT: 3 })
  })

  test('QA는 배정을 만들 수 없다 (403)', async () => {
    const r = await api('POST', '/api/assignments', qa1, {
      title: 't', assigneeId: '2', dueDate: '2026-12-31', verdicts: ['DEFECT'], count: 1,
    })
    assert.equal(r.status, 403)
  })

  test('잘못된 입력은 400', async () => {
    const r = await api('POST', '/api/assignments', admin, { title: '', assigneeId: 'x', dueDate: 'bad', verdicts: [], count: 0 })
    assert.equal(r.status, 400)
  })

  test('의심+불량 6장을 배정하면 점수 낮은 순으로 정렬된다', async () => {
    const r = await api('POST', '/api/assignments', admin, {
      title: '테스트 배정', assigneeId: await qa1Id(), dueDate: '2026-12-31', verdicts: ['SUSPECT', 'DEFECT'], count: 6,
    })
    assert.equal(r.status, 201)
    assert.equal(r.body.count, 6)
    code = r.body.id
    const list = await api('GET', `/api/assignments/${code}/images`, qa1)
    assert.deepEqual(list.body.items.map((i) => i.overallScore), [0.2, 0.3, 0.4, 0.6, 0.7, 0.8])
    keys = list.body.items.map((i) => i.imageId)
    assert.equal(list.body.total, 6)
    assert.equal(list.body.items[0].verdict, 'DEFECT')
    assert.equal(list.body.items[0].review.status, 'NONE')
    assert.equal(list.body.items[0].boxes.length, 1)
  })

  test('이미 배정된 이미지는 다시 배정되지 않는다', async () => {
    const counts = (await api('GET', '/api/unassigned-counts', admin)).body
    assert.deepEqual(counts, { NORMAL: 6, SUSPECT: 0, DEFECT: 0 })
    const r = await api('POST', '/api/assignments', admin, {
      title: '중복', assigneeId: await qa1Id(), dueDate: '2026-12-31', verdicts: ['DEFECT'], count: 3,
    })
    assert.equal(r.status, 400)
  })

  test('목록·상세에 건수와 이력이 나온다', async () => {
    const list = await api('GET', '/api/assignments', qa1)
    assert.equal(list.body.total, 1)
    assert.equal(list.body.statusCounts.ASSIGNED, 1)
    assert.deepEqual(list.body.items[0].counts, { total: 6, normal: 0, suspect: 3, defect: 3, reviewed: 0 })
    const d = await api('GET', `/api/assignments/${code}`, qa1)
    assert.equal(d.body.modelVersion, 'test-v1')
    assert.equal(d.body.history.length, 1)
  })

  test('단계를 건너뛸 수 없다 (409), 권한 없는 사람은 403', async () => {
    assert.equal((await api('POST', `/api/assignments/${code}/status`, admin, { to: 'IN_REVIEW' })).status, 409)
    assert.equal((await api('POST', `/api/assignments/${code}/status`, qa1, { to: 'PRECHECKED' })).status, 403)
  })

  test('사전배치 후에는 batch_jobs 기록이 남는다', async () => {
    const r = await api('POST', `/api/assignments/${code}/status`, admin, { to: 'PRECHECKED' })
    assert.equal(r.status, 200)
    const { pool } = await import('../src/db.mjs')
    const jobs = await pool.query('SELECT status, total_count, processed_count, model_version FROM batch_jobs')
    assert.deepEqual(jobs.rows, [{ status: 'SUCCEEDED', total_count: 6, processed_count: 6, model_version: 'test-v1' }])
  })

  test('점검 전에는 검수할 수 없다 (409)', async () => {
    const r = await api('PUT', `/api/assignments/${code}/images/${keys[0]}/review`, qa1, { status: 'APPROVED' })
    assert.equal(r.status, 409)
  })

  test('담당자가 아닌 QA는 점검을 시작할 수 없다 (403)', async () => {
    assert.equal((await api('POST', `/api/assignments/${code}/status`, qa2, { to: 'IN_REVIEW' })).status, 403)
  })

  test('담당자가 점검을 시작한다', async () => {
    assert.equal((await api('POST', `/api/assignments/${code}/status`, qa1, { to: 'IN_REVIEW' })).status, 200)
  })

  test('검수: 다른 QA 403, 잘못된 값 400, 배정에 없는 이미지 404', async () => {
    const url = (k) => `/api/assignments/${code}/images/${k}/review`
    assert.equal((await api('PUT', url(keys[0]), qa2, { status: 'APPROVED' })).status, 403)
    assert.equal((await api('PUT', url(keys[0]), qa1, { status: 'MAYBE' })).status, 400)
    assert.equal((await api('PUT', url('img_0001'), qa1, { status: 'APPROVED' })).status, 404)
  })

  test('미검토가 남아 있으면 점검 완료는 거부된다 (409)', async () => {
    const r = await api('POST', `/api/assignments/${code}/status`, qa1, { to: 'REVIEWED' })
    assert.equal(r.status, 409)
    assert.match(r.body.message, /6장/)
  })

  test('검수 저장, 번복은 행 추가, 같은 내용 재전송은 행을 늘리지 않는다', async () => {
    const url = `/api/assignments/${code}/images/${keys[0]}/review`
    const first = await api('PUT', url, qa1, { status: 'APPROVED' })
    assert.equal(first.status, 200)
    assert.equal(first.body.progress.reviewed, 1)

    const flip = await api('PUT', url, qa1, { status: 'REJECTED', comment: '번복' })
    assert.deepEqual([flip.body.progress.approved, flip.body.progress.rejected], [0, 1])

    await api('PUT', url, qa1, { status: 'REJECTED', comment: '번복' }) // 동일 내용
    const { pool } = await import('../src/db.mjs')
    const rows = await pool.query('SELECT status FROM reviews ORDER BY id')
    assert.deepEqual(rows.rows.map((r) => r.status), ['APPROVED', 'REJECTED']) // 3번째 요청은 행을 만들지 않음
  })

  test('다음 미검토 위치: 뒤에서 찾고, 없으면 처음부터, 전부 검토했으면 null', async () => {
    // 지금까지 첫 번째만 검수됨 (position 1)
    const next = (after) => api('GET', `/api/assignments/${code}/next-unreviewed?after=${after}`, qa1).then((r) => r.body.position)
    assert.equal(await next(0), 2)
    assert.equal(await next(3), 4)
    assert.equal(await next(6), 2) // 끝을 넘으면 처음부터 다시 찾는다
  })

  test('나머지를 검수하면 필터와 건수가 맞다', async () => {
    for (const [i, k] of keys.slice(1).entries()) {
      await api('PUT', `/api/assignments/${code}/images/${k}/review`, qa1, { status: i % 2 ? 'REJECTED' : 'APPROVED' })
    }
    const unreviewed = await api('GET', `/api/assignments/${code}/images?filter=unreviewed`, qa1)
    assert.equal(unreviewed.body.total, 0)
    const none = await api('GET', `/api/assignments/${code}/next-unreviewed?after=0`, qa1)
    assert.equal(none.body.position, null)
    const rejected = await api('GET', `/api/assignments/${code}/images?filter=rejected`, qa1)
    assert.equal(rejected.body.total, 3)
    const d = await api('GET', `/api/assignments/${code}`, qa1)
    assert.deepEqual([d.body.counts.reviewed, d.body.counts.approved, d.body.counts.rejected], [6, 3, 3])
  })

  test('페이지네이션: pageSize로 나눠 받는다', async () => {
    const p2 = await api('GET', `/api/assignments/${code}/images?pageSize=4&page=2`, qa1)
    assert.equal(p2.body.items.length, 2)
    assert.equal(p2.body.total, 6)
  })

  test('점검 내용 저장은 담당자만, 이력에 남는다', async () => {
    assert.equal((await api('PUT', `/api/assignments/${code}/note`, qa2, { note: 'x' })).status, 403)
    assert.equal((await api('PUT', `/api/assignments/${code}/note`, qa1, { note: '메모' })).status, 200)
    const d = await api('GET', `/api/assignments/${code}`, qa1)
    assert.equal(d.body.inspectionNote, '메모')
    assert.ok(d.body.history.some((h) => h.action === '점검 내용 저장'))
  })

  test('점검 완료 → 확인 완료(관리자만)', async () => {
    assert.equal((await api('POST', `/api/assignments/${code}/status`, qa1, { to: 'REVIEWED' })).status, 200)
    assert.equal((await api('POST', `/api/assignments/${code}/status`, qa1, { to: 'CONFIRMED' })).status, 403)
    assert.equal((await api('POST', `/api/assignments/${code}/status`, admin, { to: 'CONFIRMED' })).status, 200)
    const d = await api('GET', `/api/assignments/${code}`, admin)
    assert.deepEqual(d.body.history.map((h) => h.action).filter((a) => !a.includes('저장') && !a.includes('배정')), [
      '사전배치 실행', '점검 시작', '점검 완료', '확인 완료',
    ])
    assert.equal((await api('PUT', `/api/assignments/${code}/note`, qa1, { note: '수정' })).status, 409)
  })

  test('없는 배정은 404, 형식이 틀린 코드는 400', async () => {
    assert.equal((await api('GET', '/api/assignments/AS-9999', admin)).status, 404)
    assert.equal((await api('GET', '/api/assignments/xyz', admin)).status, 400)
  })
})

describe('파일 서빙', () => {
  test('로그인 없이는 401, 로그인하면 200', async () => {
    assert.equal((await app.inject({ url: '/files/originals/img_0001.svg' })).statusCode, 401)
    assert.equal((await app.inject({ url: '/files/originals/img_0001.svg', headers: admin })).statusCode, 200)
  })

  test('상위 폴더 접근은 막힌다', async () => {
    const r = await app.inject({ url: '/files/../../.env', headers: admin })
    assert.notEqual(r.statusCode, 200)
  })
})
