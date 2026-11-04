// API 통합 테스트: 실제 Postgres(테스트 전용 DB)에 대해 app.inject로 호출한다.
// 실행: cd backend && npm test   (DB 컨테이너가 떠 있어야 함)
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
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

  test('가입은 승인 대기(PENDING)로 만들어지고 로그인되지 않는다 (role을 보내도 무시, 쿠키 없음)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { name: '신규', email: 'new@example.com', password: '1234', role: 'admin', requestedRole: 'researcher' } })
    assert.equal(res.statusCode, 201)
    assert.equal(JSON.parse(res.body).status, 'PENDING')
    assert.equal(res.cookies.length, 0)
    const row = (await pool.query(`SELECT role, status, requested_role FROM users WHERE email = 'new@example.com'`)).rows[0]
    assert.deepEqual(row, { role: 'qa', status: 'PENDING', requested_role: 'researcher' })
    const dup = await api('POST', '/api/auth/signup', null, { name: '신규', email: 'new@example.com', password: '1234' })
    assert.equal(dup.status, 409)
  })

  test('신청 권한은 연구원/QA만 가능하다 (관리자 신청은 400), 생략하면 QA', async () => {
    assert.equal((await api('POST', '/api/auth/signup', null, { name: 'x', email: 'x1@example.com', password: '1234', requestedRole: 'admin' })).status, 400)
    await api('POST', '/api/auth/signup', null, { name: 'x', email: 'x2@example.com', password: '1234' })
    assert.equal((await pool.query(`SELECT requested_role FROM users WHERE email = 'x2@example.com'`)).rows[0].requested_role, 'qa')
  })

  test('로그인 안내는 비밀번호가 맞을 때만 상태별로 다르다 (승인 대기/만료/비활성)', async () => {
    const wrong = await loginAs(app, 'new@example.com', 'wrong')
    assert.equal(wrong.res.statusCode, 401) // 틀리면 상태를 알려 주지 않는다
    const pending = await loginAs(app, 'new@example.com')
    assert.equal(pending.res.statusCode, 403)
    assert.equal(JSON.parse(pending.res.body).code, 'PENDING')
    assert.equal(pending.res.cookies.length, 0)

    await pool.query(`UPDATE users SET status = 'DISABLED' WHERE email = 'new@example.com'`)
    assert.equal(JSON.parse((await loginAs(app, 'new@example.com')).res.body).code, 'DISABLED')

    await pool.query(`UPDATE users SET status = 'ACTIVE', expires_at = now() - interval '1 day' WHERE email = 'new@example.com'`)
    const expired = await loginAs(app, 'new@example.com')
    assert.equal(expired.res.statusCode, 403)
    assert.equal(JSON.parse(expired.res.body).code, 'EXPIRED')
    assert.equal((await pool.query(`SELECT status FROM users WHERE email = 'new@example.com'`)).rows[0].status, 'EXPIRED') // 상태도 만료로 기록된다
  })

  test('로그인하면 사용기한이 로그인 시각 + 1년으로 갱신되고 마지막 로그인이 남는다', async () => {
    await pool.query(`UPDATE users SET expires_at = now() + interval '1 day', last_login_at = NULL WHERE email = 'qa3@example.com'`)
    assert.equal((await loginAs(app, 'qa3@example.com')).res.statusCode, 200)
    const r = (await pool.query(`SELECT last_login_at IS NOT NULL AS logged, expires_at - now() AS left FROM users WHERE email = 'qa3@example.com'`)).rows[0]
    assert.equal(r.logged, true)
    assert.ok(r.left.days >= 364, `사용기한 남은 일수: ${r.left.days}`)
  })

  test('이미 발급된 토큰도 계정이 비활성/만료되면 즉시 막힌다, 담당자 목록에도 안 나온다', async () => {
    const { headers } = await loginAs(app, 'qa2@example.com')
    assert.equal((await api('GET', '/api/assignments', headers)).status, 200)
    await pool.query(`UPDATE users SET status = 'DISABLED' WHERE email = 'qa2@example.com'`)
    assert.equal((await api('GET', '/api/assignments', headers)).status, 401)
    assert.ok(!(await api('GET', '/api/users', admin)).body.items.some((u) => u.email === 'qa2@example.com'))
    await pool.query(`UPDATE users SET status = 'ACTIVE' WHERE email = 'qa2@example.com'`)
    assert.equal((await api('GET', '/api/assignments', headers)).status, 200)
  })

  test('권한은 토큰이 아니라 DB의 현재 값을 따른다 (강등 즉시 반영)', async () => {
    await pool.query(`UPDATE users SET role = 'researcher' WHERE email = 'qa3@example.com'`)
    const { headers } = await loginAs(app, 'qa3@example.com')
    assert.equal((await api('GET', '/api/auth/me', headers)).body.user.role, 'researcher')
    await pool.query(`UPDATE users SET role = 'qa' WHERE email = 'qa3@example.com'`)
  })

  test('입력 검증: 너무 짧은 비밀번호는 400', async () => {
    const r = await api('POST', '/api/auth/signup', null, { name: 'a', email: 'a@example.com', password: '1' })
    assert.equal(r.status, 400)
  })
})

describe('배정 흐름 (생성 → 점검 → 완료 → 확인)', () => {
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

  test('단계를 건너뛸 수 없다 (409). 사전배치는 더 이상 없는 단계라 400', async () => {
    assert.equal((await api('POST', `/api/assignments/${code}/status`, admin, { to: 'REVIEWED' })).status, 409)
    assert.equal((await api('POST', `/api/assignments/${code}/status`, admin, { to: 'CONFIRMED' })).status, 409)
    assert.equal((await api('POST', `/api/assignments/${code}/status`, admin, { to: 'PRECHECKED' })).status, 400)
  })

  test('목록의 상태별 건수에 사전배치 항목이 없다', async () => {
    const list = await api('GET', '/api/assignments', admin)
    assert.deepEqual(Object.keys(list.body.statusCounts), ['ASSIGNED', 'IN_REVIEW', 'REVIEWED', 'CONFIRMED'])
    assert.equal((await api('GET', '/api/assignments?status=PRECHECKED', admin)).status, 400)
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

  test('목록 페이징 규칙: 기본 20건, 최대 1000건까지 고를 수 있다 (1001은 400)', async () => {
    const def = await api('GET', '/api/assignments', admin)
    assert.equal(def.body.pageSize, 20)
    assert.equal((await api('GET', '/api/assignments?pageSize=1000', admin)).body.pageSize, 1000)
    assert.equal((await api('GET', '/api/assignments?pageSize=1001', admin)).status, 400)
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
      '점검 시작', '점검 완료', '확인 완료',
    ])
    assert.equal((await api('PUT', `/api/assignments/${code}/note`, qa1, { note: '수정' })).status, 409)
  })

  test('없는 배정은 404, 형식이 틀린 코드는 400', async () => {
    assert.equal((await api('GET', '/api/assignments/AS-9999', admin)).status, 404)
    assert.equal((await api('GET', '/api/assignments/xyz', admin)).status, 400)
  })
})

describe('신규 배정은 수신·추론이 끝난(DONE) 이미지만 대상으로 한다', () => {
  test('DONE이 아닌 이미지는 미배정 집계와 신규 배정에서 제외된다', async () => {
    const { pool } = await import('../src/db.mjs')
    // 남은 미배정 정상 이미지 6장을 처리 중/실패로 바꾼다 (판정 데이터가 남아 있어도 제외되어야 한다)
    await pool.query("UPDATE images SET ingest_status = 'PROCESSING' WHERE image_key IN ('img_0001','img_0002','img_0003')")
    await pool.query("UPDATE images SET ingest_status = 'FAILED' WHERE image_key IN ('img_0004','img_0005','img_0006')")
    try {
      const counts = (await api('GET', '/api/unassigned-counts', admin)).body
      assert.equal(counts.NORMAL ?? 0, 0)
      const r = await api('POST', '/api/assignments', admin, {
        title: '수신 미완료', assigneeId: await qa1Id(), dueDate: '2026-12-31', verdicts: ['NORMAL'], count: 6,
      })
      assert.equal(r.status, 400)
      assert.equal((await api('GET', '/api/assignments', admin)).body.total, 1) // 빈 배정이 만들어지지 않았다
    } finally {
      await pool.query("UPDATE images SET ingest_status = 'DONE' WHERE image_key IN ('img_0001','img_0002','img_0003','img_0004','img_0005','img_0006')")
    }
    assert.equal((await api('GET', '/api/unassigned-counts', admin)).body.NORMAL, 6)
  })
})

describe('파일 API (/api/images/:imageKey/:kind)', () => {
  const get = (url, who) => app.inject({ url, headers: who ?? {} })
  // 배정 흐름 테스트에서 qa1에게 의심·불량 6장(img_0007~12)이 배정됨. 정상 이미지(img_0001)는 미배정.
  const ASSIGNED = 'img_0010'
  const UNASSIGNED = 'img_0001'

  test('로그인 없이는 401', async () => {
    assert.equal((await get(`/api/images/${UNASSIGNED}/original`)).statusCode, 401)
  })

  test('관리자는 모든 종류를 받는다 (사본이 없으면 원본으로 대신)', async () => {
    for (const kind of ['thumb', 'preview', 'original', 'heatmap']) {
      const r = await get(`/api/images/${UNASSIGNED}/${kind}`, admin)
      assert.equal(r.statusCode, 200, kind)
      assert.equal(r.headers['content-type'], 'image/svg+xml', kind)
    }
    assert.match((await get(`/api/images/${UNASSIGNED}/heatmap`, admin)).body, /heat/)
    assert.match((await get(`/api/images/${UNASSIGNED}/thumb`, admin)).body, /^<svg/)
  })

  test('QA는 자기 배정 이미지만, 남의 것·미배정은 403', async () => {
    assert.equal((await get(`/api/images/${ASSIGNED}/preview`, qa1)).statusCode, 200)
    assert.equal((await get(`/api/images/${UNASSIGNED}/preview`, qa1)).statusCode, 403)
    assert.equal((await get(`/api/images/${ASSIGNED}/preview`, qa2)).statusCode, 403)
  })

  test('보안·캐시 헤더, ETag로 재요청하면 304', async () => {
    const r = await get(`/api/images/${ASSIGNED}/original`, qa1)
    assert.match(r.headers['cache-control'], /^private/)
    assert.equal(r.headers['x-content-type-options'], 'nosniff')
    assert.equal(r.headers['content-security-policy'], 'sandbox')
    assert.ok(r.headers.etag)
    const again = await app.inject({ url: `/api/images/${ASSIGNED}/original`, headers: { ...qa1, 'if-none-match': r.headers.etag } })
    assert.equal(again.statusCode, 304)
  })

  test('없는 이미지·잘못된 종류·경로 문자는 거부된다', async () => {
    assert.equal((await get('/api/images/img_9999/original', admin)).statusCode, 404)
    assert.equal((await get(`/api/images/${UNASSIGNED}/secret`, admin)).statusCode, 400)
    assert.equal((await get('/api/images/..%2Fsecret.txt/original', admin)).statusCode, 400)
  })

  test('수신 완료(DONE)가 아닌 이미지는 관리자도 받을 수 없다', async () => {
    const { pool } = await import('../src/db.mjs')
    await pool.query("UPDATE images SET ingest_status = 'FAILED' WHERE image_key = $1", [UNASSIGNED])
    try {
      assert.equal((await get(`/api/images/${UNASSIGNED}/original`, admin)).statusCode, 404)
    } finally {
      await pool.query("UPDATE images SET ingest_status = 'DONE' WHERE image_key = $1", [UNASSIGNED])
    }
  })

  test('DB 경로가 서빙 폴더 밖을 가리켜도 내려주지 않는다', async () => {
    const { pool } = await import('../src/db.mjs')
    await pool.query("UPDATE images SET original_path = '../secret.txt' WHERE image_key = $1", [UNASSIGNED])
    try {
      assert.equal((await get(`/api/images/${UNASSIGNED}/original`, admin)).statusCode, 404)
    } finally {
      await pool.query("UPDATE images SET original_path = 'originals/img_0001.svg' WHERE image_key = $1", [UNASSIGNED])
    }
  })

  test('사본(thumb/preview)이 있으면 webp로 내려주고, original은 그대로다', async () => {
    const { pool } = await import('../src/db.mjs')
    const dir = join(process.env.FILES_DIR, 'derived', 'thumb')
    mkdirSync(dir, { recursive: true })
    await sharp({ create: { width: 64, height: 36, channels: 3, background: '#445566' } }).webp().toFile(join(dir, 'img_0002.webp'))
    await pool.query("UPDATE images SET thumb_path = 'derived/thumb/img_0002.webp' WHERE image_key = 'img_0002'")
    try {
      const t = await get('/api/images/img_0002/thumb', admin)
      assert.equal(t.statusCode, 200)
      assert.equal(t.headers['content-type'], 'image/webp')
      assert.equal(t.headers['content-security-policy'], undefined) // SVG가 아니므로 sandbox 헤더 불필요
      assert.equal((await get('/api/images/img_0002/original', admin)).headers['content-type'], 'image/svg+xml')
      assert.equal((await get('/api/images/img_0002/preview', admin)).headers['content-type'], 'image/svg+xml') // preview 없음 → 원본 대체
    } finally {
      await pool.query("UPDATE images SET thumb_path = NULL WHERE image_key = 'img_0002'")
    }
  })

  test('이미지 목록 응답의 URL은 새 API 주소다', async () => {
    const code = (await api('GET', '/api/assignments', qa1)).body.items[0].id
    const it = (await api('GET', `/api/assignments/${code}/images`, qa1)).body.items[0]
    assert.equal(it.previewUrl, `/api/images/${it.imageId}/preview`)
    assert.equal(it.thumbUrl, `/api/images/${it.imageId}/thumb`)
    assert.equal(it.heatmapUrl, `/api/images/${it.imageId}/heatmap`)
  })
})
