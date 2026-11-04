// 권한(역할) 관리 API 테스트: 만들기·수정·사용 안 함·삭제 정책(연쇄 삭제 없음), 이력, 권한 가드.
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, loginAs, resetTestDb, startApp } from './helpers.mjs'

let app, admin, qa1, pool
const api = (method, url, who, body) => call(app, method, url, who, body)
const create = (body) => api('POST', '/api/admin/roles', admin, body)

before(async () => {
  await resetTestDb()
  app = await startApp()
  ;({ pool } = await import('../src/db.mjs'))
  admin = (await loginAs(app, 'admin@example.com')).headers
  qa1 = (await loginAs(app, 'qa1@example.com')).headers
})
after(async () => app?.close())

describe('권한 관리 API', () => {
  test('role.manage 권한이 없으면 모두 403 (QA)', async () => {
    assert.equal((await api('GET', '/api/admin/roles', qa1)).status, 403)
    assert.equal((await api('POST', '/api/admin/roles', qa1, { code: 'zz', label: 'x' })).status, 403)
  })

  test('목록: 사용자 수·상태 건수·삭제 가능 여부, 시스템 권한 표시', async () => {
    const r = (await api('GET', '/api/admin/roles', admin)).body
    assert.equal(r.total, 3)
    assert.deepEqual(r.statusCounts, { ACTIVE: 3, INACTIVE: 0 })
    const a = r.items.find((x) => x.code === 'admin')
    assert.ok(a.system && !a.deletable && a.userCount >= 1)
    assert.equal(r.items.find((x) => x.code === 'qa').userCount, 3)
  })

  test('만들기: 메뉴 접근 없이 생기고 설명은 선택, 코드·이름 중복·형식 오류', async () => {
    const r = await create({ code: 'auditor', label: '감사', description: '  외부 감사  ' })
    assert.equal(r.status, 201)
    assert.equal(r.body.role.description, '외부 감사')
    assert.equal(r.body.role.signupSelectable, false)
    assert.ok(r.body.role.active && r.body.role.deletable)
    const g = (await api('GET', '/api/admin/permissions', admin)).body
    assert.deepEqual(g.granted.auditor, []) // 접근 없음
    assert.ok(g.roles.some((x) => x.code === 'auditor'))
    assert.equal((await create({ code: 'auditor', label: '다른' })).status, 409)
    assert.equal((await create({ code: 'other', label: '감사' })).status, 409)
    assert.equal((await create({ code: 'Bad Code', label: 'x' })).status, 400)
    assert.equal((await create({ code: 'nolabel', label: '   ' })).status, 400)
    assert.equal((await create({ code: 'extra', label: 'x', foo: 1 })).status, 400)
    const empty = await create({ code: 'nodesc', label: '설명없음' })
    assert.equal(empty.body.role.description, null)
  })

  test('수정: 바뀐 항목만 이력에 남고 설명은 비울 수 있다 (코드는 못 바꾼다)', async () => {
    const r = await api('PATCH', '/api/admin/roles/auditor', admin, { label: '감사원', description: null, signupSelectable: true })
    assert.equal(r.status, 200)
    assert.equal(r.body.role.label, '감사원')
    assert.equal(r.body.role.description, null)
    const h = (await api('GET', '/api/admin/roles/auditor', admin)).body.history
    assert.equal(h[0].action, 'UPDATE')
    assert.deepEqual(Object.keys(h[0].detail).sort(), ['description', 'label', 'signupSelectable'])
    const same = await api('PATCH', '/api/admin/roles/auditor', admin, { label: '감사원' })
    assert.equal((await api('GET', '/api/admin/roles/auditor', admin)).body.history.length, h.length) // 변화 없음 → 이력 없음
    assert.equal(same.status, 200)
    assert.equal((await api('PATCH', '/api/admin/roles/auditor', admin, { code: 'x' })).status, 400)
    assert.equal((await api('PATCH', '/api/admin/roles/auditor', admin, { label: 'QA' })).status, 409)
    assert.equal((await api('PATCH', '/api/admin/roles/nope', admin, { label: 'x' })).status, 404)
  })

  test('시스템 권한: 사용 안 함·삭제·가입 신청 가능 여부 변경 불가 (이름·설명은 가능)', async () => {
    assert.equal((await api('POST', '/api/admin/roles/admin/deactivate', admin)).status, 409)
    assert.equal((await api('DELETE', '/api/admin/roles/admin', admin)).status, 409)
    assert.equal((await api('PATCH', '/api/admin/roles/admin', admin, { signupSelectable: true })).status, 409)
    assert.equal((await api('PATCH', '/api/admin/roles/admin', admin, { description: '전체 관리' })).status, 200)
  })

  test('사용 안 함: 가입 선택지·권한 부여에서 빠지고 기존 사용자는 그대로, 다시 켜기', async () => {
    assert.equal((await api('POST', '/api/admin/roles/auditor/deactivate', admin)).body.role.active, false)
    const signup = (await app.inject({ method: 'GET', url: '/api/auth/signup-roles' })).json().roles.map((x) => x.code)
    assert.ok(!signup.includes('auditor') && signup.includes('qa'))
    const reg = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { name: '가입', email: 'aud@example.com', password: 'password1', requestedRole: 'auditor' } })
    assert.equal(reg.statusCode, 400)
    // 새로 부여 불가
    const qa = (await api('GET', '/api/admin/users?status=ACTIVE&role=qa', admin)).body.items[0]
    assert.equal((await api('PATCH', `/api/admin/users/${qa.id}`, admin, { role: 'auditor' })).status, 400)
    // /roles 는 비활성도 내려주되 active 표시 (이미 가진 사용자의 이름 표시용)
    const all = (await api('GET', '/api/roles', admin)).body.roles
    assert.equal(all.find((x) => x.code === 'auditor').active, false)
    // 기존 사용자는 그대로: 사용 안 함 상태에서 현재 권한 유지 저장은 허용
    await pool.query(`UPDATE users SET role = 'auditor' WHERE id = $1`, [qa.id])
    assert.equal((await api('PATCH', `/api/admin/users/${qa.id}`, admin, { role: 'auditor', name: '이름변경' })).status, 200)
    const u = (await api('GET', `/api/admin/users/${qa.id}`, admin)).body.user ?? (await api('GET', `/api/admin/users/${qa.id}`, admin)).body
    assert.equal((u.user ?? u).role, 'auditor')
    await pool.query(`UPDATE users SET role = 'qa' WHERE id = $1`, [qa.id])
    assert.equal((await api('POST', '/api/admin/roles/auditor/activate', admin)).body.role.active, true)
    const hist = (await api('GET', '/api/admin/roles/auditor', admin)).body.history.map((x) => x.action)
    assert.deepEqual(hist.slice(0, 2), ['ACTIVATE', 'DEACTIVATE'])
  })

  test('삭제: 사용자가 있거나 변경 이력이 있으면 409, 아무 일도 없었던 권한만 삭제 (연쇄 삭제 없음)', async () => {
    assert.equal((await api('DELETE', '/api/admin/roles/qa', admin)).status, 409) // 사용자 있음
    assert.equal((await api('DELETE', '/api/admin/roles/auditor', admin)).status, 409) // 변경 이력 있음
    const before = (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n
    assert.equal((await api('DELETE', '/api/admin/roles/nodesc', admin)).status, 200)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n, before) // 사용자는 그대로
    assert.equal((await api('GET', '/api/admin/roles/nodesc', admin)).status, 404)
    const h = await pool.query(`SELECT action FROM role_history WHERE role_code = 'nodesc' ORDER BY id`)
    assert.deepEqual(h.rows.map((x) => x.action), ['CREATE', 'DELETE']) // 이력은 남는다
  })

  test('권한별 메뉴에서 허용을 바꾼 권한도 삭제할 수 없다 (이력 보존)', async () => {
    await create({ code: 'temp1', label: '임시1' })
    await api('PUT', '/api/admin/roles/temp1/permissions', admin, { permissions: ['dashboard.view'] })
    assert.equal((await api('DELETE', '/api/admin/roles/temp1', admin)).status, 409)
  })

  test('목록 필터·검색·페이징', async () => {
    await api('POST', '/api/admin/roles/temp1/deactivate', admin)
    const off = (await api('GET', '/api/admin/roles?status=INACTIVE', admin)).body
    assert.deepEqual(off.items.map((x) => x.code), ['temp1'])
    const q = (await api('GET', '/api/admin/roles?q=' + encodeURIComponent('감사'), admin)).body
    assert.deepEqual(q.items.map((x) => x.code), ['auditor'])
    const p = (await api('GET', '/api/admin/roles?pageSize=2&page=2', admin)).body
    assert.equal(p.items.length, 2)
    assert.ok(p.total >= 4)
  })

  test('설정 > 사용자 메뉴에 권한 관리가 사용자 관리 다음에 나온다', async () => {
    const m = (await api('GET', '/api/menus/mine', admin)).body.menus.find((t) => t.key === 'settings')
    const items = m.groups.find((g) => g.label === '사용자').items.map((i) => i.path)
    assert.deepEqual(items, ['/settings/users', '/settings/roles', '/settings/menus'])
  })
})
