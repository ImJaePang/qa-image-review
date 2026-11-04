// 메뉴·권한 API.
//  - GET /menus/mine: 내 권한으로 볼 수 있는 메뉴 트리 (상단 → 중메뉴 → 소메뉴). 화면 메뉴는 이것을 그대로 그린다.
//  - 관리(관리자, 'menu.manage'): 권한 × 메뉴/기능 표 조회, 권한별로 한 번에 저장(PUT), 변경 이력.
//  - 판단의 근거는 role_permissions 하나이며 서버의 모든 권한 검사도 같은 표를 쓴다 (src/permissions.mjs).
import { pool } from '../db.mjs'
import { httpError } from '../errors.mjs'
import { LOCKED_ADMIN_PERMISSIONS, can, requirePermission } from '../permissions.mjs'
import { txWith } from '../tx.mjs'

export default async function permissionRoutes(app) {
  app.addHook('onRequest', app.authenticate)

  app.get('/menus/mine', async (req) => {
    const { rows } = await pool.query('SELECT path, top_key, top_label, group_label, label, permission_code FROM menus ORDER BY sort_order, path')
    const top = []
    for (const m of rows.filter((r) => can(req.user, r.permission_code))) {
      let t = top.find((x) => x.key === m.top_key)
      if (!t) top.push((t = { key: m.top_key, label: m.top_label, groups: [] }))
      let g = t.groups.find((x) => x.label === m.group_label)
      if (!g) t.groups.push((g = { label: m.group_label, items: [] }))
      g.items.push({ label: m.label, path: m.path })
    }
    return { menus: top }
  })

  app.register(async (admin) => {
    admin.addHook('onRequest', requirePermission('menu.manage'))

    // 표 전체: 권한 목록, 권한 코드(메뉴/기능), 권한별 부여 현황, 잠긴 항목
    admin.get('/admin/permissions', async () => {
      const [roles, perms, menus, grants] = await Promise.all([
        pool.query('SELECT code, label, is_system FROM roles ORDER BY sort_order, code'),
        pool.query('SELECT code, kind, label, description FROM permissions ORDER BY sort_order, code'),
        pool.query('SELECT path, top_label, group_label, label, permission_code FROM menus ORDER BY sort_order, path'),
        pool.query('SELECT role_code, permission_code FROM role_permissions'),
      ])
      const granted = Object.fromEntries(roles.rows.map((r) => [r.code, []]))
      for (const g of grants.rows) granted[g.role_code]?.push(g.permission_code)
      return {
        roles: roles.rows.map((r) => ({ code: r.code, label: r.label, system: r.is_system })),
        menus: menus.rows.map((m) => ({ path: m.path, topLabel: m.top_label, groupLabel: m.group_label, label: m.label, permission: m.permission_code })),
        functions: perms.rows.filter((p) => p.kind === 'FUNCTION').map((p) => ({ code: p.code, label: p.label, description: p.description })),
        granted,
        locked: { admin: LOCKED_ADMIN_PERMISSIONS },
      }
    })

    // 한 권한의 권한 코드 전체를 교체한다 (표에서 고친 것을 저장). 바뀐 항목만 이력에 남긴다.
    admin.put(
      '/admin/roles/:code/permissions',
      {
        preValidation: async (req) => {
          const extra = Object.keys(req.body ?? {}).filter((k) => k !== 'permissions')
          if (extra.length) throw httpError(400, `알 수 없는 항목: ${extra.join(', ')}`)
        },
        schema: {
          params: { type: 'object', required: ['code'], properties: { code: { type: 'string', maxLength: 50 } } },
          body: { type: 'object', required: ['permissions'], properties: { permissions: { type: 'array', uniqueItems: true, items: { type: 'string', maxLength: 80 } } } },
        },
      },
      async (req) => {
        const { code } = req.params
        const next = new Set(req.body.permissions)
        return txWith(pool, async (client) => {
          if (!(await client.query('SELECT 1 FROM roles WHERE code = $1', [code])).rowCount) throw httpError(404, '권한을 찾을 수 없습니다.')
          const known = new Set((await client.query('SELECT code FROM permissions')).rows.map((r) => r.code))
          const unknown = [...next].filter((c) => !known.has(c))
          if (unknown.length) throw httpError(400, `알 수 없는 권한 코드: ${unknown.join(', ')}`)
          // 관리자가 설정 화면에 못 들어가게 되는 저장은 막는다
          const missing = code === 'admin' ? LOCKED_ADMIN_PERMISSIONS.filter((c) => !next.has(c)) : []
          if (missing.length) throw httpError(409, `관리자는 ${missing.join(', ')} 권한을 뺄 수 없습니다.`)

          const cur = new Set((await client.query('SELECT permission_code FROM role_permissions WHERE role_code = $1', [code])).rows.map((r) => r.permission_code))
          const grant = [...next].filter((c) => !cur.has(c))
          const revoke = [...cur].filter((c) => !next.has(c))
          if (grant.length) await client.query('INSERT INTO role_permissions (role_code, permission_code) SELECT $1, unnest($2::text[])', [code, grant])
          if (revoke.length) await client.query('DELETE FROM role_permissions WHERE role_code = $1 AND permission_code = ANY($2::text[])', [code, revoke])
          const rows = [...grant.map((c) => ['GRANT', c]), ...revoke.map((c) => ['REVOKE', c])]
          if (rows.length)
            await client.query(
              `INSERT INTO permission_history (role_code, permission_code, action, created_by)
               SELECT $1, t.p, t.a, $4 FROM unnest($2::text[], $3::text[]) AS t(p, a)`,
              [code, rows.map((r) => r[1]), rows.map((r) => r[0]), req.user.sub],
            )
          return { role: code, granted: grant.sort(), revoked: revoke.sort() }
        })
      },
    )

    admin.get('/admin/permissions/history', async () => {
      const { rows } = await pool.query(
        `SELECT h.id, h.role_code, r.label AS role_label, h.permission_code, p.label AS permission_label, h.action, h.created_at, u.name AS actor
           FROM permission_history h
           JOIN roles r ON r.code = h.role_code
           JOIN permissions p ON p.code = h.permission_code
           LEFT JOIN users u ON u.id = h.created_by
          ORDER BY h.id DESC LIMIT 50`,
      )
      return {
        items: rows.map((r) => ({ id: String(r.id), role: r.role_code, roleLabel: r.role_label, permission: r.permission_code, permissionLabel: r.permission_label, action: r.action, at: r.created_at, actor: r.actor ?? '시스템' })),
      }
    })
  })
}
