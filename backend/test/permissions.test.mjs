// 권한·메뉴 API 테스트: 권한 코드가 화면 메뉴와 서버 검사에 똑같이 적용되는지, 표 저장·이력·잠금.
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { call, loginAs, resetTestDb, startApp } from './helpers.mjs'

let app, admin, qa1, researcher, pool
const api = (method, url, who, body) => call(app, method, url, who, body)
const put = (role, permissions) => api('PUT', `/api/admin/roles/${role}/permissions`, admin, { permissions })
const granted = async (role) => (await api('GET', '/api/admin/permissions', admin)).body.granted[role].sort()
const paths = (menus) => menus.flatMap((t) => t.groups.flatMap((g) => g.items.map((i) => i.path)))

before(async () => {
  await resetTestDb()
  app = await startApp()
  ;({ pool } = await import('../src/db.mjs'))
  await pool.query(`UPDATE users SET role = 'researcher' WHERE email = 'qa3@example.com'`)
  admin = (await loginAs(app, 'admin@example.com')).headers
  qa1 = (await loginAs(app, 'qa1@example.com')).headers
  researcher = (await loginAs(app, 'qa3@example.com')).headers
})
after(async () => app?.close())

describe('내 메뉴와 권한 코드', () => {
  test('내 정보에 권한 코드가 들어 있다 (관리자는 전부, QA는 설정 권한 없음)', async () => {
    const a = (await api('GET', '/api/auth/me', admin)).body.user
    const q = (await api('GET', '/api/auth/me', qa1)).body.user
    assert.ok(a.permissions.includes('menu.manage') && a.permissions.includes('assignment.manage'))
    assert.ok(q.permissions.includes('assignment.view'))
    assert.ok(!q.permissions.includes('rule.manage') && !q.permissions.includes('assignment.manage'))
  })

  test('메뉴 트리는 권한에 따라 다르다 (QA는 설정 메뉴가 없다, 관리자는 권한별 메뉴까지)', async () => {
    const q = paths((await api('GET', '/api/menus/mine', qa1)).body.menus)
    assert.ok(q.includes('/review/assignments') && !q.some((p) => p.startsWith('/settings')))
    const a = (await api('GET', '/api/menus/mine', admin)).body.menus
    assert.ok(paths(a).includes('/settings/menus'))
    assert.deepEqual(a.map((t) => t.key), ['home', 'review', 'data', 'monitoring', 'settings']) // 순서 보존
    assert.deepEqual(a.find((t) => t.key === 'settings').groups.map((g) => g.label), ['판정', '연계', '사용자'])
  })

  test('연구원 기본 권한: 모델 실행 이력 메뉴와 이미지 업로드가 있고 설정은 없다', async () => {
    const m = paths((await api('GET', '/api/menus/mine', researcher)).body.menus)
    assert.ok(m.includes('/data/model-runs') && !m.includes('/settings/users'))
    assert.ok((await api('GET', '/api/auth/me', researcher)).body.user.permissions.includes('image.upload'))
  })
})

describe('표 조회와 저장', () => {
  test('관리자만 표를 볼 수 있다 (403), 로그인 없으면 401', async () => {
    assert.equal((await api('GET', '/api/admin/permissions', qa1)).status, 403)
    assert.equal((await api('PUT', '/api/admin/roles/qa/permissions', qa1, { permissions: [] })).status, 403)
    assert.equal((await api('GET', '/api/admin/permissions')).status, 401)
  })

  test('표에는 권한 3종, 메뉴, 기능 권한, 잠긴 항목이 있다', async () => {
    const r = (await api('GET', '/api/admin/permissions', admin)).body
    assert.deepEqual(r.roles.map((x) => x.code), ['admin', 'researcher', 'qa'])
    assert.equal(r.menus.length, 12)
    assert.deepEqual(r.functions.map((f) => f.code), ['assignment.manage', 'image.view_all', 'image.upload'])
    assert.deepEqual(r.locked.admin, ['user.manage', 'role.manage', 'menu.manage'])
  })

  test('저장하면 로그인 중인 사용자에게도 바로 적용된다 (메뉴 + API), 바뀐 것만 이력에 남는다', async () => {
    const before = await granted('qa')
    // QA에게 규칙 관리를 열어 주고 이미지 목록은 닫는다
    const next = [...before.filter((c) => c !== 'image_list.view'), 'rule.manage']
    const r = await put('qa', next)
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.granted, r.body.revoked], [['rule.manage'], ['image_list.view']])
    assert.equal((await api('GET', '/api/rules', qa1)).status, 200) // 같은 로그인 토큰으로 바로 API 사용 가능
    const m = paths((await api('GET', '/api/menus/mine', qa1)).body.menus)
    assert.ok(m.includes('/settings/rules') && !m.includes('/data/images'))
    const h = (await api('GET', '/api/admin/permissions/history', admin)).body.items
    assert.deepEqual(h.slice(0, 2).map((x) => [x.role, x.permission, x.action]).sort(), [['qa', 'image_list.view', 'REVOKE'], ['qa', 'rule.manage', 'GRANT']])
    assert.equal(h[0].actor, '관리자')

    // 같은 내용을 다시 저장하면 이력이 늘지 않는다
    const n = h.length
    await put('qa', next)
    assert.equal((await api('GET', '/api/admin/permissions/history', admin)).body.items.length, n)
    await put('qa', before) // 원복
    assert.equal((await api('GET', '/api/rules', qa1)).status, 403)
  })

  test('잘못된 저장: 모르는 코드 400, 없는 권한 404, 모르는 항목 400, 관리자의 잠긴 코드는 뺄 수 없다 409', async () => {
    assert.equal((await put('qa', ['nope.code'])).status, 400)
    assert.equal((await put('boss', [])).status, 404)
    assert.equal((await api('PUT', '/api/admin/roles/qa/permissions', admin, { permissions: [], extra: 1 })).status, 400)
    const all = await granted('admin')
    assert.equal((await put('admin', all.filter((c) => c !== 'menu.manage'))).status, 409)
    assert.equal((await put('admin', all.filter((c) => c !== 'user.manage'))).status, 409)
    assert.deepEqual(await granted('admin'), all) // 거부되면 변경 없음
    assert.equal((await put('admin', all.filter((c) => c !== 'monitoring.view'))).status, 200) // 잠기지 않은 코드는 가능
    await put('admin', all)
  })

  test('권한(role)은 roles 테이블에 있는 값만 쓸 수 있다 (DB 제약)', async () => {
    await assert.rejects(pool.query(`UPDATE users SET role = 'boss' WHERE email = 'qa1@example.com'`), /users_role_fkey/)
  })
})

describe('서버 검사가 같은 표를 쓴다', () => {
  test('배정 화면 권한(assignment.view, my_assignment.view)이 둘 다 없으면 배정 API가 403', async () => {
    const before = await granted('qa')
    await put('qa', before.filter((c) => !['assignment.view', 'my_assignment.view'].includes(c)))
    assert.equal((await api('GET', '/api/assignments', qa1)).status, 403)
    await put('qa', before)
    assert.equal((await api('GET', '/api/assignments', qa1)).status, 200)
  })

  test('배정 만들기(assignment.manage): 연구원에게 주면 만들 수 있고, 회수하면 다시 403', async () => {
    const body = { title: '연구원 배정', assigneeId: String((await pool.query(`SELECT id FROM users WHERE email='qa1@example.com'`)).rows[0].id), dueDate: '2030-01-01', verdicts: ['NORMAL'], count: 1 }
    assert.equal((await api('POST', '/api/assignments', researcher, body)).status, 403)
    const base = await granted('researcher')
    await put('researcher', [...base, 'assignment.manage'])
    assert.equal((await api('POST', '/api/assignments', researcher, body)).status, 201)
    await put('researcher', base)
    assert.equal((await api('POST', '/api/assignments', researcher, body)).status, 403)
  })

  test('모든 이미지 열람(image.view_all): 연구원은 배정 밖 이미지도 보고, QA는 못 본다', async () => {
    assert.equal((await api('GET', '/api/images/img_0012/original', researcher)).status, 200)
    assert.equal((await api('GET', '/api/images/img_0012/original', qa1)).status, 403)
  })

  test('관리 화면 API: 규칙·연계·사용자·모니터링은 각각의 권한 코드로 막힌다', async () => {
    for (const url of ['/api/rules', '/api/integrations', '/api/admin/users', '/api/monitoring/time']) assert.equal((await api('GET', url, researcher)).status, 403, url)
    const base = await granted('researcher')
    await put('researcher', [...base, 'monitoring.view'])
    assert.equal((await api('GET', '/api/monitoring/time', researcher)).status, 200)
    assert.equal((await api('GET', '/api/rules', researcher)).status, 403) // 다른 코드는 그대로
    await put('researcher', base)
  })
})

describe('권한 종류는 roles 테이블이 정한다 (코드에 고정 목록 없음)', () => {
  test('가입 화면용 목록(로그인 전)은 신청 가능한 권한만, 전체 목록(로그인 후)은 시스템 여부까지', async () => {
    const s = (await api('GET', '/api/auth/signup-roles')).body.roles
    assert.deepEqual(s.map((r) => r.code), ['researcher', 'qa']) // 관리자는 신청 불가
    assert.equal((await api('GET', '/api/roles')).status, 401)
    const all = (await api('GET', '/api/roles', qa1)).body.roles
    assert.deepEqual(all.map((r) => [r.code, r.label, r.system, r.signupSelectable]), [['admin', '관리자', true, false], ['researcher', '연구원', false, true], ['qa', 'QA', false, true]])
  })

  test('roles에 한 줄 추가하면 코드 변경 없이 표·가입·승인·수정·필터에 쓸 수 있다', async () => {
    await pool.query(`INSERT INTO roles (code, label, sort_order, signup_selectable) VALUES ('auditor', '감사', 4, true)`)
    // 권한 표에 새 열이 생기고 권한 코드를 줄 수 있다
    assert.deepEqual((await api('GET', '/api/admin/permissions', admin)).body.roles.map((r) => r.code), ['admin', 'researcher', 'qa', 'auditor'])
    assert.equal((await put('auditor', ['dashboard.view'])).status, 200)
    // 가입 신청 → 승인 → 로그인 → 메뉴
    assert.equal((await api('POST', '/api/auth/signup', null, { name: '감사원', email: 'aud@example.com', password: '1234', requestedRole: 'auditor' })).status, 201)
    const id = Number((await pool.query(`SELECT id FROM users WHERE email = 'aud@example.com'`)).rows[0].id)
    assert.equal((await api('POST', '/api/admin/users/bulk', admin, { action: 'APPROVE', ids: [id] })).body.processed, 1)
    const { headers } = await loginAs(app, 'aud@example.com')
    assert.deepEqual(paths((await api('GET', '/api/menus/mine', headers)).body.menus), ['/home/dashboard'])
    // 목록 필터와 수정
    assert.equal((await api('GET', '/api/admin/users?role=auditor', admin)).body.total, 1)
    assert.equal((await api('PATCH', `/api/admin/users/${id}`, admin, { role: 'qa' })).body.role, 'qa')
  })

  test('없는 권한·신청 불가 권한은 400 (가입·승인·수정)', async () => {
    const signup = (requestedRole) => api('POST', '/api/auth/signup', null, { name: 'x', email: `${requestedRole}@example.com`, password: '1234', requestedRole })
    assert.equal((await signup('boss')).status, 400)
    assert.equal((await signup('admin')).status, 400)
    await pool.query(`UPDATE roles SET signup_selectable = false WHERE code = 'auditor'`)
    assert.equal((await signup('auditor')).status, 400) // 플래그를 끄면 가입 신청에서 빠진다
    const id = (await pool.query(`SELECT id FROM users WHERE email = 'qa1@example.com'`)).rows[0].id
    assert.equal((await api('PATCH', `/api/admin/users/${id}`, admin, { role: 'boss' })).status, 400)
    assert.equal((await api('POST', '/api/admin/users/bulk', admin, { action: 'APPROVE', ids: [Number(id)], role: 'boss' })).status, 400)
  })
})
