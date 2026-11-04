// 사용자 관리 API 테스트: 목록·필터, 일괄 승인/반려/비활성/만료 해제, 수정, 이력, 임시 비밀번호, 만료 해제 요청.
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, loginAs, resetTestDb, startApp } from './helpers.mjs'

let app, admin, qa1, pool
const api = (method, url, who, body) => call(app, method, url, who, body)
const signup = (email, extra = {}) => api('POST', '/api/auth/signup', null, { name: email.split('@')[0], email, password: '1234', ...extra })
const idOf = async (email) => String((await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id)
const row = async (email) => (await pool.query('SELECT status, role, expires_at, expiry_release_requested_at FROM users WHERE email = $1', [email])).rows[0]
const bulk = (action, ids, role) => api('POST', '/api/admin/users/bulk', admin, { action, ids, ...(role ? { role } : {}) })

before(async () => {
  await resetTestDb()
  app = await startApp()
  ;({ pool } = await import('../src/db.mjs'))
  admin = (await loginAs(app, 'admin@example.com')).headers
  qa1 = (await loginAs(app, 'qa1@example.com')).headers
})
after(async () => app?.close())

describe('권한과 목록', () => {
  test('관리자만 쓸 수 있다 (QA는 403, 로그인 없으면 401)', async () => {
    assert.equal((await api('GET', '/api/admin/users', qa1)).status, 403)
    assert.equal((await api('POST', '/api/admin/users/bulk', qa1, { action: 'APPROVE', ids: [1] })).status, 403) // 검증(400)보다 권한(403)이 먼저
    assert.equal((await api('GET', '/api/admin/users')).status, 401)
  })

  test('가입하면 승인 대기로 목록에 나오고 프로필(업체·부서 등)과 가입 이력이 남는다', async () => {
    const r = await signup('choi@example.com', { requestedRole: 'researcher', profile: { company: '한빛테크', department: '품질팀', jobTitle: '선임', phone: '010-1', companyAddress: '서울' } })
    assert.equal(r.status, 201)
    await signup('jung@example.com')
    await signup('han@example.com')
    const list = await api('GET', '/api/admin/users?status=PENDING', admin)
    assert.equal(list.body.total, 3)
    assert.deepEqual(list.body.items.map((u) => u.email), ['choi@example.com', 'jung@example.com', 'han@example.com']) // 신청 순서(오래된 것 먼저)
    const choi = list.body.items[0]
    assert.equal(choi.requestedRole, 'researcher')
    assert.deepEqual(choi.profile, { company: '한빛테크', department: '품질팀', jobTitle: '선임', phone: '010-1', companyAddress: '서울' })
    const detail = await api('GET', `/api/admin/users/${choi.id}`, admin)
    assert.deepEqual(detail.body.history.map((h) => h.action), ['SIGNUP'])
  })

  test('가입 때 모르는 프로필 항목은 400', async () => {
    assert.equal((await signup('bad@example.com', { profile: { foo: 'x' } })).status, 400)
  })

  test('상태별 건수와 필터(권한·검색어·업체)', async () => {
    const all = await api('GET', '/api/admin/users', admin)
    assert.deepEqual(all.body.statusCounts, { PENDING: 3, ACTIVE: 4, EXPIRED: 0, DISABLED: 0 })
    assert.equal((await api('GET', '/api/admin/users?role=admin', admin)).body.total, 1)
    assert.equal((await api('GET', '/api/admin/users?q=한빛', admin)).body.items[0].email, 'choi@example.com') // 업체명으로도 검색
    assert.equal((await api('GET', '/api/admin/users?q=qa1', admin)).body.total, 1)
    assert.equal((await api('GET', '/api/admin/users?pageSize=1000', admin)).status, 200)
    assert.equal((await api('GET', '/api/admin/users?pageSize=2&page=2', admin)).body.items.length, 2)
  })
})

describe('일괄 처리', () => {
  test('신청 권한대로 일괄 승인: 연구원/QA 각자 신청대로, 사용기한은 1년 뒤, 이력', async () => {
    const ids = [await idOf('choi@example.com'), await idOf('jung@example.com')].map(Number)
    const r = await bulk('APPROVE', ids)
    assert.deepEqual([r.status, r.body.processed, r.body.skipped.length], [200, 2, 0])
    assert.equal((await row('choi@example.com')).role, 'researcher')
    assert.equal((await row('jung@example.com')).role, 'qa')
    const left = (await pool.query(`SELECT expires_at - now() AS d FROM users WHERE email = 'choi@example.com'`)).rows[0].d
    assert.ok(left.days >= 364)
    assert.equal((await loginAs(app, 'choi@example.com')).res.statusCode, 200) // 승인되면 로그인된다
    const hist = (await api('GET', `/api/admin/users/${ids[0]}`, admin)).body.history
    assert.equal(hist[0].action, 'APPROVE')
    assert.equal(hist[0].actor, '관리자')
  })

  test('권한을 지정해 승인하면 신청 권한과 상관없이 그 권한이 된다', async () => {
    const r = await bulk('APPROVE', [Number(await idOf('han@example.com'))], 'researcher')
    assert.equal(r.body.processed, 1)
    assert.equal((await row('han@example.com')).role, 'researcher')
  })

  test('이미 처리된 사용자·없는 사용자는 건너뛰고 사유를 알려 준다 (나머지는 처리)', async () => {
    await signup('new1@example.com')
    const ids = [Number(await idOf('new1@example.com')), Number(await idOf('choi@example.com')), 99999]
    const r = await bulk('APPROVE', ids)
    assert.equal(r.body.processed, 1)
    assert.equal(r.body.skipped.length, 2)
    assert.match(r.body.skipped.find((s) => s.name === 'choi').reason, /사용 중/)
    assert.match(r.body.skipped.find((s) => s.id === '99999').reason, /찾을 수 없/)
  })

  test('일괄 반려는 비활성으로 두고 로그인 안내도 그렇게 나온다', async () => {
    await signup('rej@example.com')
    assert.equal((await bulk('REJECT', [Number(await idOf('rej@example.com'))])).body.processed, 1)
    const l = await loginAs(app, 'rej@example.com')
    assert.equal(JSON.parse(l.res.body).code, 'DISABLED')
  })

  test('입력 검증: 101명·빈 목록·중복·모르는 동작·모르는 항목은 400, 권한 지정은 승인에만', async () => {
    assert.equal((await bulk('APPROVE', Array.from({ length: 101 }, (_, i) => i + 1))).status, 400)
    assert.equal((await bulk('APPROVE', [])).status, 400)
    assert.equal((await bulk('APPROVE', [5, 5])).status, 400)
    assert.equal((await bulk('DELETE', [5])).status, 400)
    assert.equal((await api('POST', '/api/admin/users/bulk', admin, { action: 'APPROVE', ids: [5], extra: 1 })).status, 400)
    assert.equal((await bulk('DISABLE', [5], 'qa')).status, 400)
  })

  test('비활성화/재활성화, 본인 계정은 건너뛴다', async () => {
    const me = Number(await idOf('admin@example.com'))
    const qa2 = Number(await idOf('qa2@example.com'))
    const r = await bulk('DISABLE', [me, qa2])
    assert.equal(r.body.processed, 1)
    assert.match(r.body.skipped[0].reason, /본인/)
    assert.equal((await row('qa2@example.com')).status, 'DISABLED')
    assert.equal((await loginAs(app, 'qa2@example.com')).res.statusCode, 403)
    assert.equal((await bulk('ENABLE', [qa2])).body.processed, 1)
    assert.equal((await loginAs(app, 'qa2@example.com')).res.statusCode, 200)
  })
})

describe('만료와 해제 요청', () => {
  test('만료된 사용자가 해제를 요청하면 목록에 요청 시각이 나온다 (비밀번호 틀리면 401, 만료 아니면 409)', async () => {
    await pool.query(`UPDATE users SET expires_at = now() - interval '1 day' WHERE email = 'qa3@example.com'`)
    const req = (email, password = '1234') => api('POST', '/api/auth/expiry-release-request', null, { email, password })
    assert.equal((await req('qa3@example.com', 'wrong')).status, 401)
    assert.equal((await req('qa1@example.com')).status, 409)
    assert.equal((await req('qa3@example.com')).status, 200)
    const u = (await api('GET', '/api/admin/users?status=EXPIRED', admin)).body.items.find((x) => x.email === 'qa3@example.com')
    assert.ok(u.expiryReleaseRequestedAt)
    assert.equal((await api('GET', '/api/admin/users', admin)).body.statusCounts.EXPIRED, 1)
  })

  test('일괄 만료 해제: 기한 +1년, 요청 표시 삭제, 다시 로그인 가능', async () => {
    const id = Number(await idOf('qa3@example.com'))
    assert.equal((await bulk('RELEASE_EXPIRY', [id])).body.processed, 1)
    const r = await row('qa3@example.com')
    assert.equal(r.status, 'ACTIVE')
    assert.equal(r.expiry_release_requested_at, null)
    assert.equal((await loginAs(app, 'qa3@example.com')).res.statusCode, 200)
    const actions = (await api('GET', `/api/admin/users/${id}`, admin)).body.history.map((h) => h.action)
    assert.deepEqual(actions.slice(0, 2), ['EXPIRY_RELEASE', 'EXPIRY_REQUEST'])
  })

  test('수정으로 만료된 사용자의 기한을 미래로 바꾸면 해제된다', async () => {
    await pool.query(`UPDATE users SET expires_at = now() - interval '1 day' WHERE email = 'qa3@example.com'`)
    const id = await idOf('qa3@example.com')
    const future = new Date(Date.now() + 30 * 86400_000).toISOString()
    const r = await api('PATCH', `/api/admin/users/${id}`, admin, { expiresAt: future })
    assert.equal(r.body.status, 'ACTIVE')
  })
})

describe('수정', () => {
  test('이름·권한·프로필을 수정하면 바뀐 것만 이력에 남는다, 같은 값이면 이력 없음', async () => {
    const id = await idOf('qa1@example.com')
    const r = await api('PATCH', `/api/admin/users/${id}`, admin, { role: 'researcher', profile: { company: '한빛테크', department: '' } })
    assert.equal(r.status, 200)
    assert.equal(r.body.role, 'researcher')
    assert.equal(r.body.profile.company, '한빛테크')
    const before = (await api('GET', `/api/admin/users/${id}`, admin)).body.history.length
    await api('PATCH', `/api/admin/users/${id}`, admin, { role: 'researcher', profile: { company: '한빛테크' } })
    assert.equal((await api('GET', `/api/admin/users/${id}`, admin)).body.history.length, before)
    const h = (await api('GET', `/api/admin/users/${id}`, admin)).body.history
    assert.deepEqual(h.map((x) => x.action), ['PROFILE', 'ROLE'])
    assert.deepEqual(h[1].detail, { from: 'qa', to: 'researcher' })
    await api('PATCH', `/api/admin/users/${id}`, admin, { role: 'qa' })
  })

  test('잘못된 수정: 모르는 항목·모르는 권한 400, 없는 사용자 404, 승인 대기의 권한 변경 409', async () => {
    const id = await idOf('qa1@example.com')
    assert.equal((await api('PATCH', `/api/admin/users/${id}`, admin, { status: 'ACTIVE' })).status, 400)
    assert.equal((await api('PATCH', `/api/admin/users/${id}`, admin, { role: 'boss' })).status, 400)
    assert.equal((await api('PATCH', `/api/admin/users/${id}`, admin, { profile: { foo: 'x' } })).status, 400)
    assert.equal((await api('PATCH', `/api/admin/users/${id}`, admin, { expiresAt: 'nope' })).status, 400)
    assert.equal((await api('PATCH', '/api/admin/users/99999', admin, { role: 'qa' })).status, 404)
    await signup('wait@example.com')
    assert.equal((await api('PATCH', `/api/admin/users/${await idOf('wait@example.com')}`, admin, { role: 'researcher' })).status, 409)
  })

  test('마지막 관리자는 강등·비활성할 수 없다 (409, 변경 취소)', async () => {
    const id = await idOf('admin@example.com')
    assert.equal((await api('PATCH', `/api/admin/users/${id}`, admin, { role: 'qa' })).status, 409)
    assert.equal((await row('admin@example.com')).role, 'admin')
    await pool.query(`UPDATE users SET role = 'admin' WHERE email = 'qa2@example.com'`) // 관리자가 둘이면 가능
    assert.equal((await api('PATCH', `/api/admin/users/${id}`, admin, { role: 'qa' })).status, 200)
    await pool.query(`UPDATE users SET role = 'admin' WHERE email = 'admin@example.com'`)
    await pool.query(`UPDATE users SET role = 'qa' WHERE email = 'qa2@example.com'`)
  })
})

describe('임시 비밀번호', () => {
  test('초기화하면 새 비밀번호로만 로그인되고 이력에 남는다 (비밀번호 자체는 이력에 없음)', async () => {
    const id = await idOf('qa2@example.com')
    const r = await api('POST', `/api/admin/users/${id}/reset-password`, admin)
    assert.equal(r.status, 200)
    assert.match(r.body.tempPassword, /^[A-Za-z0-9]{10}$/)
    assert.equal((await loginAs(app, 'qa2@example.com', '1234')).res.statusCode, 401)
    assert.equal((await loginAs(app, 'qa2@example.com', r.body.tempPassword)).res.statusCode, 200)
    const h = (await api('GET', `/api/admin/users/${id}`, admin)).body.history[0]
    assert.equal(h.action, 'PASSWORD_RESET')
    assert.equal(JSON.stringify(h).includes(r.body.tempPassword), false)
    assert.equal((await api('POST', '/api/admin/users/99999/reset-password', admin)).status, 404)
  })
})
