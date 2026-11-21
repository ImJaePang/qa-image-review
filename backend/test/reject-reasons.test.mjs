// 반려 사유 관리(만들기·수정·순서·사용 안 함·삭제 정책·이력·권한)와 반려 사유 분석 통계.
// 픽스처: 의심·불량 이미지에는 모두 AI 원인 '질감 이상(TEXTURE_ANOMALY)' 박스가 하나씩 있다.
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, loginAs, resetTestDb, startApp } from './helpers.mjs'

let app, admin, qa1, pool, code, imgs
const api = (method, url, who, body) => call(app, method, url, who, body)
const review = (img, status, reasons = [], comment = '') => api('PUT', `/api/assignments/${code}/images/${img.imageId}/review`, qa1, { status, comment, reasons })

before(async () => {
  await resetTestDb()
  app = await startApp()
  ;({ pool } = await import('../src/db.mjs'))
  admin = (await loginAs(app, 'admin@example.com')).headers
  qa1 = (await loginAs(app, 'qa1@example.com')).headers
  const users = (await api('GET', '/api/users', admin)).body.items
  const qaId = users.find((u) => u.email === 'qa1@example.com').id
  code = (await api('POST', '/api/assignments', admin, { title: '사유 시험', assigneeId: qaId, dueDate: '2030-01-01', verdicts: ['SUSPECT', 'DEFECT'], count: 5 })).body.id
  await api('POST', `/api/assignments/${code}/status`, qa1, { to: 'IN_REVIEW' })
  imgs = (await api('GET', `/api/assignments/${code}/images`, qa1)).body.items
  // 다섯째 이미지는 AI 원인이 없게 만든다 (박스 제거)
  await pool.query(
    `DELETE FROM detections WHERE run_id = (SELECT run_id FROM assignment_images ai JOIN images i ON i.id = ai.image_id WHERE i.image_key = $1 AND ai.assignment_id = (SELECT id FROM assignments WHERE code = $2))`,
    [imgs[4].imageId, code],
  )
  assert.equal((await review(imgs[0], 'REJECTED', ['TEXTURE_ANOMALY'])).status, 200) // 그대로 확정
  await review(imgs[1], 'REJECTED', ['TEXTURE_ANOMALY', 'LIGHTING_MISMATCH']) // 일부 고침
  await review(imgs[2], 'APPROVED')
  await review(imgs[2], 'REJECTED', ['SHAPE_DISTORTION']) // 번복 후 전부 바꿈
  await review(imgs[3], 'APPROVED') // 통계에서 빠진다
  await review(imgs[4], 'REJECTED', ['OTHER'], '바퀴 수가 다름') // AI 원인 없음
})
after(async () => app?.close())

describe('반려 사유 분석 통계', () => {
  test('권한이 없으면 403 (QA), 메뉴도 관리자에게만 보인다', async () => {
    assert.equal((await api('GET', '/api/stats/reject-reasons', qa1)).status, 403)
    const mine = (who) => api('GET', '/api/menus/mine', who).then((r) => JSON.stringify(r.body))
    const a = await mine(admin)
    assert.ok(a.includes('/monitoring/reject-reasons') && a.includes('/settings/reject-reasons'))
    const q = await mine(qa1)
    assert.ok(!q.includes('/monitoring/reject-reasons') && !q.includes('/settings/reject-reasons'))
  })

  test('현재 결정이 반려인 것만, AI 원인을 그대로/일부/전부 바꿈/없음으로 나눈다', async () => {
    const r = await api('GET', '/api/stats/reject-reasons', admin)
    assert.equal(r.status, 200)
    assert.equal(r.body.total, 4)
    assert.deepEqual(r.body.outcome, { kept: 1, partial: 1, replaced: 1, noAi: 1 })
    const by = Object.fromEntries(r.body.reasons.map((x) => [x.code, [x.ai, x.human, x.both]]))
    assert.deepEqual(by.TEXTURE_ANOMALY, [3, 2, 2])
    assert.deepEqual(by.SHAPE_DISTORTION, [0, 1, 0])
    assert.deepEqual(by.LIGHTING_MISMATCH, [0, 1, 0])
    assert.deepEqual(by.OTHER, [0, 1, 0])
    assert.deepEqual(r.body.swaps, [{ from: '질감 이상', to: '형태/구조 왜곡', count: 1 }])
    assert.deepEqual(r.body.reviewers.map((x) => [x.name, x.count]), [['김검수', 4]])
  })

  test('기간·검수자로 거른다, 잘못된 값은 400', async () => {
    assert.equal((await api('GET', '/api/stats/reject-reasons?days=7', admin)).body.total, 4)
    const someone = (await api('GET', '/api/users', admin)).body.items.find((u) => u.email === 'qa2@example.com').id
    assert.equal((await api('GET', `/api/stats/reject-reasons?reviewerId=${someone}`, admin)).body.total, 0)
    assert.equal((await api('GET', '/api/stats/reject-reasons?days=3', admin)).status, 400)
  })
})

describe('반려 사유 관리 API', () => {
  test('reject_reason.manage 권한이 없으면 403 (QA)', async () => {
    assert.equal((await api('GET', '/api/admin/reject-reasons', qa1)).status, 403)
    assert.equal((await api('POST', '/api/admin/reject-reasons', qa1, { code: 'ZZ', label: 'x' })).status, 403)
  })

  test('목록: 순서대로, AI 원인 연결·쓰인 건수·삭제 가능 여부', async () => {
    const items = (await api('GET', '/api/admin/reject-reasons', admin)).body.items
    assert.equal(items.length, 7)
    assert.deepEqual(items.map((x) => x.sortOrder), [1, 2, 3, 4, 5, 6, 7])
    const tex = items.find((x) => x.code === 'TEXTURE_ANOMALY')
    assert.ok(tex.aiReason && tex.usedCount === 2 && !tex.deletable && tex.lastUsedAt)
    const other = items.find((x) => x.code === 'OTHER')
    assert.ok(!other.aiReason && other.requiresComment)
    assert.equal(items.find((x) => x.code === 'SCALE_ANOMALY').deletable, true)
  })

  test('만들기: 맨 뒤에 붙고 AI 원인과는 연결되지 않는다, 코드·이름 중복·형식 오류', async () => {
    const r = await api('POST', '/api/admin/reject-reasons', admin, { code: 'COLOR_SHIFT', label: '색 틀어짐' })
    assert.equal(r.status, 201)
    assert.deepEqual([r.body.reason.sortOrder, r.body.reason.aiReason, r.body.reason.active, r.body.reason.deletable], [8, false, true, true])
    const opts = (await api('GET', '/api/reject-reasons', qa1)).body.items
    assert.equal(opts.at(-1).code, 'COLOR_SHIFT')
    assert.equal((await api('POST', '/api/admin/reject-reasons', admin, { code: 'COLOR_SHIFT', label: '다른' })).status, 409)
    assert.equal((await api('POST', '/api/admin/reject-reasons', admin, { code: 'NEW_ONE', label: '질감 이상' })).status, 409)
    assert.equal((await api('POST', '/api/admin/reject-reasons', admin, { code: 'bad code', label: 'x' })).status, 400)
    assert.equal((await api('POST', '/api/admin/reject-reasons', admin, { code: 'NO_LABEL', label: '  ' })).status, 400)
    assert.equal((await api('POST', '/api/admin/reject-reasons', admin, { code: 'EXTRA', label: 'x', active: false })).status, 400)
  })

  test('수정: 이름·코멘트 필수만 바뀌고 바뀐 항목만 이력에 남는다, 지난 기록도 새 이름으로 보인다', async () => {
    const r = await api('PATCH', '/api/admin/reject-reasons/LIGHTING_MISMATCH', admin, { label: '조명 불일치', requiresComment: true })
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.reason.label, r.body.reason.requiresComment], ['조명 불일치', true])
    await api('PATCH', '/api/admin/reject-reasons/LIGHTING_MISMATCH', admin, { label: '조명 불일치' }) // 같은 값 → 이력 없음
    const h = (await api('GET', '/api/admin/reject-reasons/LIGHTING_MISMATCH', admin)).body.history
    assert.equal(h.length, 1)
    assert.deepEqual(h[0].detail, { label: { from: '조명·음영 불일치', to: '조명 불일치' }, requiresComment: { from: false, to: true } })
    const hist = (await api('GET', '/api/review-history?scope=all', admin)).body.items
    assert.ok(hist.some((x) => x.reasons.some((y) => y.label === '조명 불일치')))
    // 코멘트 필수가 된 사유는 코멘트 없이 반려할 수 없다
    assert.equal((await review(imgs[3], 'REJECTED', ['LIGHTING_MISMATCH'])).status, 400)
    assert.equal((await api('PATCH', '/api/admin/reject-reasons/OTHER', admin, { label: '질감 이상' })).status, 409)
    assert.equal((await api('PATCH', '/api/admin/reject-reasons/NOPE', admin, { label: 'x' })).status, 404)
  })

  test('순서: 전체 코드를 새 순서로 받고 바뀐 것만 이력, 목록이 다르면 409', async () => {
    const codes = (await api('GET', '/api/admin/reject-reasons', admin)).body.items.map((x) => x.code)
    const swapped = [...codes]
    ;[swapped[2], swapped[3]] = [swapped[3], swapped[2]]
    const r = await api('PUT', '/api/admin/reject-reasons/order', admin, { codes: swapped })
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.items.map((x) => x.code), swapped)
    const opts = (await api('GET', '/api/reject-reasons', qa1)).body.items.map((x) => x.code)
    assert.deepEqual(opts.slice(2, 4), [codes[3], codes[2]])
    const h = (await api('GET', `/api/admin/reject-reasons/${codes[2]}`, admin)).body.history
    assert.equal(h[0].action, 'REORDER')
    assert.equal((await api('PUT', '/api/admin/reject-reasons/order', admin, { codes: swapped.slice(1) })).status, 409)
    assert.equal((await api('PUT', '/api/admin/reject-reasons/order', admin, { codes: [...swapped.slice(1), 'NOPE'] })).status, 409)
  })

  test('사용 안 함: 선택지와 반려 저장에서 빠지고 지난 기록·통계는 남는다, 다시 켤 수 있다', async () => {
    assert.equal((await api('POST', '/api/admin/reject-reasons/SHAPE_DISTORTION/deactivate', admin)).status, 200)
    const opts = (await api('GET', '/api/reject-reasons', qa1)).body.items.map((x) => x.code)
    assert.ok(!opts.includes('SHAPE_DISTORTION'))
    assert.equal((await review(imgs[3], 'REJECTED', ['SHAPE_DISTORTION'])).status, 400)
    const stats = (await api('GET', '/api/stats/reject-reasons', admin)).body
    assert.equal(stats.reasons.find((x) => x.code === 'SHAPE_DISTORTION').human, 1)
    assert.equal((await api('POST', '/api/admin/reject-reasons/SHAPE_DISTORTION/activate', admin)).body.reason.active, true)
    const h = (await api('GET', '/api/admin/reject-reasons/SHAPE_DISTORTION', admin)).body.history.map((x) => x.action)
    assert.deepEqual(h, ['ACTIVATE', 'DEACTIVATE'])
  })

  test('삭제: 쓰인 사유·이력이 있는 사유는 409, 아무 데도 안 쓴 새 사유만 지워진다', async () => {
    assert.equal((await api('DELETE', '/api/admin/reject-reasons/TEXTURE_ANOMALY', admin)).status, 409)
    assert.equal((await api('DELETE', '/api/admin/reject-reasons/LIGHTING_MISMATCH', admin)).status, 409) // 수정 이력
    const r = await api('DELETE', '/api/admin/reject-reasons/COLOR_SHIFT', admin)
    assert.equal(r.status, 200)
    assert.equal((await api('GET', '/api/admin/reject-reasons/COLOR_SHIFT', admin)).status, 404)
    const { rows } = await pool.query(`SELECT action FROM reject_reason_history WHERE reason_code = 'COLOR_SHIFT' ORDER BY id`)
    assert.deepEqual(rows.map((x) => x.action), ['CREATE', 'DELETE'])
  })

  test('사용 중인 사유가 하나도 남지 않게는 할 수 없다', async () => {
    const items = (await api('GET', '/api/admin/reject-reasons', admin)).body.items
    const codes = items.map((x) => x.code)
    for (const c of codes.slice(1)) assert.equal((await api('POST', `/api/admin/reject-reasons/${c}/deactivate`, admin)).status, 200)
    assert.equal((await api('POST', `/api/admin/reject-reasons/${codes[0]}/deactivate`, admin)).status, 409)
    for (const c of codes.slice(1)) await api('POST', `/api/admin/reject-reasons/${c}/activate`, admin)
  })
})
