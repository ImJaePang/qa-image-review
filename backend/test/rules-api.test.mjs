// 규칙 관리 API 테스트: 새 버전 쌓기, 미리보기, 재판정(기본은 미배정만), 되돌리기, 이력.
// 픽스처 점수(12장): 0.95 0.93 0.92 0.91 0.99 0.97 | 0.8 0.7 0.6 | 0.4 0.3 0.2  (규칙 v1: 정상≥0.9, 의심≥0.5)
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, loginAs, resetTestDb, startApp } from './helpers.mjs'

let app, admin, qa1, pool
const api = (method, url, who, body) => call(app, method, url, who, body)
const V2 = { normalMin: 0.8, suspectMin: 0.4 } // img_0007(0.8)은 의심→정상, img_0010(0.4)은 불량→의심으로 바뀐다

/** 이미지의 현재(가장 최근) 판정 */
const verdictOf = async (key) =>
  (
    await pool.query(
      `SELECT v.result FROM images i
         JOIN LATERAL (SELECT id FROM model_runs WHERE image_id = i.id ORDER BY created_at DESC, id DESC LIMIT 1) lr ON true
         JOIN LATERAL (SELECT result FROM verdicts WHERE run_id = lr.id ORDER BY created_at DESC, id DESC LIMIT 1) v ON true
        WHERE i.image_key = $1`,
      [key],
    )
  ).rows[0].result
const unassigned = async () => (await api('GET', '/api/unassigned-counts', admin)).body

before(async () => {
  await resetTestDb()
  app = await startApp()
  ;({ pool } = await import('../src/db.mjs'))
  admin = (await loginAs(app, 'admin@example.com')).headers
  qa1 = (await loginAs(app, 'qa1@example.com')).headers
  // img_0007(점수 0.8)을 배정에 넣는다: 검수자가 보고 있는 이미지
  const a = await pool.query(`INSERT INTO assignments (title, assignee_id, created_by, due_date, status) VALUES ('규칙 테스트', 2, 1, '2026-12-31', 'IN_REVIEW') RETURNING id`)
  await pool.query(
    `INSERT INTO assignment_images (assignment_id, image_id, run_id, position)
     SELECT $1, i.id, (SELECT id FROM model_runs WHERE image_id = i.id ORDER BY id DESC LIMIT 1), 1 FROM images i WHERE i.image_key = 'img_0007'`,
    [a.rows[0].id],
  )
})
after(async () => {
  await app?.close()
})

describe('접근 제어와 현재 상태', () => {
  test('로그인 없이 401, QA는 403', async () => {
    assert.equal((await api('GET', '/api/rules')).status, 401)
    for (const [m, u] of [['GET', '/api/rules'], ['GET', '/api/rules/preview?normalMin=0.8&suspectMin=0.4'], ['POST', '/api/rules'], ['PATCH', '/api/rules/1'], ['POST', '/api/rules/1/rejudge'], ['GET', '/api/rules/history']])
      assert.equal((await api(m, u, qa1, m === 'GET' ? undefined : {})).status, 403, `${m} ${u}`)
  })

  test('시드 규칙 v1이 활성이고 다시 판정할 이미지는 없다', async () => {
    const r = (await api('GET', '/api/rules', admin)).body
    assert.equal(r.items.length, 1)
    assert.deepEqual([r.items[0].version, r.items[0].active, r.items[0].params], [1, true, { normalMin: 0.9, suspectMin: 0.5 }])
    assert.equal(r.items[0].verdictCount, 12)
    assert.deepEqual(r.stale, { unassigned: 0, assigned: 0 })
  })
})

describe('미리보기 (저장하지 않음)', () => {
  test('현재 분포, 적용 후 분포, 바뀌는 장수(배정된 것과 미배정 구분)', async () => {
    const r = (await api('GET', '/api/rules/preview?normalMin=0.8&suspectMin=0.4', admin)).body
    assert.equal(r.total, 12)
    assert.deepEqual(r.current, { NORMAL: 6, SUSPECT: 3, DEFECT: 3 })
    assert.deepEqual(r.proposed, { NORMAL: 7, SUSPECT: 3, DEFECT: 2 })
    assert.deepEqual(r.changed, { unassigned: 1, assigned: 1 }) // 0.4는 미배정, 0.8은 배정된 이미지
    assert.equal((await api('GET', '/api/rules', admin)).body.items.length, 1) // 아무것도 저장되지 않았다
  })

  test('잘못된 값은 400 (범위 밖, 의심 ≥ 정상, 값 없음)', async () => {
    for (const q of ['normalMin=1.5&suspectMin=0.4', 'normalMin=0.5&suspectMin=0.5', 'normalMin=0.4&suspectMin=0.8', 'normalMin=0.8', 'normalMin=abc&suspectMin=0.4'])
      assert.equal((await api('GET', `/api/rules/preview?${q}`, admin)).status, 400, q)
  })
})

describe('새 버전 만들기', () => {
  test('잘못된 값은 400, 활성 규칙과 같으면 409', async () => {
    for (const b of [{ normalMin: 0.5, suspectMin: 0.5 }, { normalMin: 0.4, suspectMin: 0.8 }, { normalMin: 2, suspectMin: 0.4 }, { normalMin: 0.8 }, { normalMin: 0.8, suspectMin: 0.4, extra: 1 }])
      assert.equal((await api('POST', '/api/rules', admin, b)).status, 400, JSON.stringify(b))
    assert.equal((await api('POST', '/api/rules', admin, { normalMin: 0.9, suspectMin: 0.5 })).status, 409)
  })

  test('새 버전은 바로 활성이 되지만 이미 판정된 이미지는 그대로다', async () => {
    const r = await api('POST', '/api/rules', admin, V2)
    assert.equal(r.status, 201)
    assert.deepEqual([r.body.version, r.body.active, r.body.enabled, r.body.createdBy], [2, true, true, '관리자'])
    const list = (await api('GET', '/api/rules', admin)).body
    assert.deepEqual(list.items.map((x) => [x.version, x.active]), [[2, true], [1, false]])
    assert.deepEqual(list.stale, { unassigned: 11, assigned: 1 }) // 12장 모두 아직 v1로 판정된 상태
    assert.equal(await verdictOf('img_0010'), 'DEFECT')
  })
})

describe('재판정', () => {
  test('활성이 아닌 버전으로는 재판정할 수 없다 (409), 없는 규칙은 404', async () => {
    const v1 = (await api('GET', '/api/rules', admin)).body.items.find((x) => x.version === 1)
    assert.equal((await api('POST', `/api/rules/${v1.id}/rejudge`, admin, {})).status, 409)
    assert.equal((await api('POST', '/api/rules/9999/rejudge', admin, {})).status, 404)
  })

  test('기본(미배정만): 배정된 이미지의 판정은 그대로, 나머지는 새 규칙으로 바뀐다', async () => {
    const v2 = (await api('GET', '/api/rules', admin)).body.items.find((x) => x.version === 2)
    const r = await api('POST', `/api/rules/${v2.id}/rejudge`, admin, {})
    assert.equal(r.status, 200)
    assert.deepEqual(r.body, { ruleVersion: 2, scope: 'unassigned', rejudged: 11, changed: 1 })
    assert.equal(await verdictOf('img_0010'), 'SUSPECT') // 0.4: 불량 → 의심
    assert.equal(await verdictOf('img_0007'), 'SUSPECT') // 0.8: 배정된 이미지라 그대로
    const free = await unassigned()
    assert.deepEqual([free.NORMAL, free.SUSPECT, free.DEFECT], [6, 3, 2]) // 미배정 11장: 정상 6, 의심 3(0.7·0.6·0.4), 불량 2
    assert.deepEqual((await api('GET', '/api/rules', admin)).body.stale, { unassigned: 0, assigned: 1 })
  })

  test('같은 재판정을 다시 해도 건수는 0 (이미 최신)', async () => {
    const v2 = (await api('GET', '/api/rules', admin)).body.items.find((x) => x.version === 2)
    const r = await api('POST', `/api/rules/${v2.id}/rejudge`, admin, {})
    assert.deepEqual([r.body.rejudged, r.body.changed], [0, 0])
  })

  test('scope=all이면 배정된 이미지도 바뀐다', async () => {
    const v2 = (await api('GET', '/api/rules', admin)).body.items.find((x) => x.version === 2)
    const r = await api('POST', `/api/rules/${v2.id}/rejudge`, admin, { scope: 'all' })
    assert.deepEqual([r.body.rejudged, r.body.changed], [1, 1])
    assert.equal(await verdictOf('img_0007'), 'NORMAL')
    assert.equal((await api('POST', `/api/rules/${v2.id}/rejudge`, admin, { scope: 'bogus' })).status, 400)
  })

  test('판정 이력은 쌓이고 사유(reasons)는 유지된다', async () => {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM verdicts WHERE rule_id = (SELECT id FROM rules WHERE version = 2)`)
    assert.equal(rows[0].n, 12) // v2 판정 12건이 추가됐고 v1 판정 12건도 그대로 남아 있다
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM verdicts WHERE rule_id = (SELECT id FROM rules WHERE version = 1)`)).rows[0].n, 12)
    const reasons = (await pool.query(`SELECT v.reasons FROM verdicts v JOIN model_runs r ON r.id = v.run_id JOIN images i ON i.id = r.image_id WHERE i.image_key = 'img_0010' AND v.rule_id = (SELECT id FROM rules WHERE version = 2)`)).rows[0].reasons
    assert.deepEqual(reasons, (await pool.query(`SELECT v.reasons FROM verdicts v JOIN model_runs r ON r.id = v.run_id JOIN images i ON i.id = r.image_id WHERE i.image_key = 'img_0010' AND v.rule_id = (SELECT id FROM rules WHERE version = 1)`)).rows[0].reasons)
  })
})

describe('되돌리기와 켜기/끄기', () => {
  let v1, v2
  before(async () => {
    const items = (await api('GET', '/api/rules', admin)).body.items
    v1 = items.find((x) => x.version === 1)
    v2 = items.find((x) => x.version === 2)
  })

  test('새 버전을 끄면 이전 버전이 활성이 된다', async () => {
    const r = await api('PATCH', `/api/rules/${v2.id}`, admin, { enabled: false })
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.enabled, r.body.active], [false, false])
    const list = (await api('GET', '/api/rules', admin)).body
    assert.equal(list.activeId, v1.id)
    assert.deepEqual(list.stale, { unassigned: 11, assigned: 1 }) // 판정은 아직 v2 기준이라 다시 판정이 필요하다고 알린다
  })

  test('되돌린 뒤 재판정하면 v1 판정이 다시 최신이 된다 (이미 있던 v1 행을 최신으로 갱신)', async () => {
    const r = await api('POST', `/api/rules/${v1.id}/rejudge`, admin, { scope: 'all' })
    assert.deepEqual([r.body.ruleVersion, r.body.rejudged, r.body.changed], [1, 12, 2])
    assert.equal(await verdictOf('img_0010'), 'DEFECT')
    assert.equal(await verdictOf('img_0007'), 'SUSPECT')
    assert.deepEqual(await unassigned(), { NORMAL: 6, SUSPECT: 2, DEFECT: 3 }) // 미배정 11장(img_0007은 배정됨): v1 기준으로 복원
  })

  test('켜진 규칙이 하나뿐이면 끌 수 없다 (409), 없는 규칙은 404', async () => {
    assert.equal((await api('PATCH', `/api/rules/${v1.id}`, admin, { enabled: false })).status, 409)
    assert.equal((await api('PATCH', '/api/rules/9999', admin, { enabled: false })).status, 404)
    assert.equal((await api('PATCH', `/api/rules/${v1.id}`, admin, {})).status, 400)
  })

  test('다시 켜면 v2가 활성이 되고, 바뀐 것이 없는 요청은 이력을 남기지 않는다', async () => {
    const before = (await api('GET', '/api/rules/history', admin)).body.items.length
    await api('PATCH', `/api/rules/${v1.id}`, admin, { enabled: true }) // 이미 켜져 있음: 변화 없음
    assert.equal((await api('GET', '/api/rules/history', admin)).body.items.length, before)
    await api('PATCH', `/api/rules/${v2.id}`, admin, { enabled: true })
    assert.equal((await api('GET', '/api/rules', admin)).body.activeId, v2.id)
  })

  test('이력: 누가·무엇을 (최신순)', async () => {
    const h = (await api('GET', '/api/rules/history', admin)).body.items
    assert.deepEqual(
      h.map((x) => [x.action, x.version]),
      [['ENABLE', 2], ['REJUDGE', 1], ['DISABLE', 2], ['REJUDGE', 2], ['REJUDGE', 2], ['REJUDGE', 2], ['CREATE', 2]],
    )
    assert.ok(h.every((x) => x.actor === '관리자'))
    assert.deepEqual(h.find((x) => x.action === 'CREATE').detail.params, V2)
    assert.deepEqual(h.find((x) => x.action === 'REJUDGE' && x.version === 1).detail, { scope: 'all', rejudged: 12, changed: 2 })
  })
})
