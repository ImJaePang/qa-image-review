// 권한(역할) 관리 API (관리자, 'role.manage'): 권한 종류를 만들고 이름·설명을 고친다.
//  - 무엇을 쓸 수 있는지는 permissions 라우트(권한별 메뉴)가 정한다. 여기서는 종류 자체만 다룬다.
//  - 삭제 대신 '사용 안 함'이 기본: 새 가입·승인·권한 변경에서 빠지고 기존 사용자는 그대로 쓴다.
//    진짜 삭제는 사용자 0명 + 변경 이력이 없는 권한만. 연쇄 삭제(cascade)는 쓰지 않는다.
//  - 시스템 권한(관리자)은 사용 안 함·삭제·신청 가능 여부 변경 불가. 모든 변경은 role_history에 남긴다.
import { pool } from '../db.mjs'
import { httpError } from '../errors.mjs'
import { pagingQuery } from '../paging.mjs'
import { requirePermission } from '../permissions.mjs'
import { txWith } from '../tx.mjs'

const CODE_RE = '^[a-z][a-z0-9_]{1,29}$'
const SORT_STEP = 10

const FIELD = { label: 'label', description: 'description', signupSelectable: 'signup_selectable', sortOrder: 'sort_order' }
const codeParams = { type: 'object', required: ['code'], properties: { code: { type: 'string', maxLength: 50 } } }
const rejectUnknown = (allowed) => async (req) => {
  const extra = Object.keys(req.body ?? {}).filter((k) => !allowed.includes(k))
  if (extra.length) throw httpError(400, `알 수 없는 항목: ${extra.join(', ')}`)
}
const editable = {
  label: { type: 'string', minLength: 1, maxLength: 30 },
  description: { type: ['string', 'null'], maxLength: 300 },
  signupSelectable: { type: 'boolean' },
  sortOrder: { type: 'integer', minimum: 0, maximum: 9999 },
}

const SELECT = `
  SELECT r.code, r.label, r.description, r.is_system, r.signup_selectable, r.is_active, r.sort_order, r.created_at,
         (SELECT count(*)::int FROM users u WHERE u.role = r.code) AS user_count,
         (SELECT count(*)::int FROM role_history h WHERE h.role_code = r.code AND h.action <> 'CREATE') AS change_count,
         (SELECT count(*)::int FROM permission_history h WHERE h.role_code = r.code) AS grant_count
    FROM roles r`
const toDto = (r) => ({
  code: r.code,
  label: r.label,
  description: r.description,
  system: r.is_system,
  signupSelectable: r.signup_selectable,
  active: r.is_active,
  sortOrder: r.sort_order,
  userCount: r.user_count,
  createdAt: r.created_at,
  // 삭제 가능: 시스템 권한이 아니고 사용자·변경 이력이 없을 때
  deletable: !r.is_system && r.user_count === 0 && r.change_count === 0 && r.grant_count === 0,
})
const history = (db, code, action, detail, actor) =>
  db.query('INSERT INTO role_history (role_code, action, detail, created_by) VALUES ($1, $2, $3, $4)', [code, action, JSON.stringify(detail), actor])

async function loadOne(db, code, { lock = false } = {}) {
  const { rows } = await db.query(`${SELECT} WHERE r.code = $1${lock ? ' FOR UPDATE OF r' : ''}`, [code])
  if (!rows.length) throw httpError(404, '권한을 찾을 수 없습니다.')
  return rows[0]
}

export default async function roleAdminRoutes(app) {
  app.addHook('onRequest', app.authenticate)
  app.addHook('onRequest', requirePermission('role.manage'))

  app.get(
    '/admin/roles',
    {
      schema: {
        querystring: { type: 'object', properties: { status: { enum: ['ACTIVE', 'INACTIVE'] }, q: { type: 'string', maxLength: 100 }, ...pagingQuery } },
      },
    },
    async (req) => {
      const { status = null, q = null, page, pageSize } = req.query
      const like = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null
      const where = `($1::text IS NULL OR r.is_active = ($1 = 'ACTIVE'))
        AND ($2::text IS NULL OR r.label ILIKE $2 OR r.code ILIKE $2 OR r.description ILIKE $2)`
      const [list, total, counts] = await Promise.all([
        pool.query(`${SELECT} WHERE ${where} ORDER BY r.sort_order, r.code LIMIT $3 OFFSET $4`, [status, like, pageSize, (page - 1) * pageSize]),
        pool.query(`SELECT count(*)::int AS n FROM roles r WHERE ${where}`, [status, like]),
        pool.query('SELECT is_active, count(*)::int AS n FROM roles GROUP BY 1'),
      ])
      const statusCounts = { ACTIVE: 0, INACTIVE: 0 }
      counts.rows.forEach((r) => (statusCounts[r.is_active ? 'ACTIVE' : 'INACTIVE'] = r.n))
      return { items: list.rows.map(toDto), total: total.rows[0].n, page, pageSize, statusCounts }
    },
  )

  // 수정 모달용: 권한 + 변경 이력
  app.get('/admin/roles/:code', { schema: { params: codeParams } }, async (req) => {
    const role = toDto(await loadOne(pool, req.params.code))
    const { rows } = await pool.query(
      `SELECT h.id, h.action, h.detail, h.created_at, u.name AS actor FROM role_history h LEFT JOIN users u ON u.id = h.created_by
        WHERE h.role_code = $1 ORDER BY h.id DESC LIMIT 50`,
      [req.params.code],
    )
    return { role, history: rows.map((h) => ({ id: String(h.id), action: h.action, detail: h.detail, at: h.created_at, actor: h.actor ?? '시스템' })) }
  })

  app.post(
    '/admin/roles',
    {
      preValidation: rejectUnknown(['code', ...Object.keys(editable)]),
      schema: { body: { type: 'object', required: ['code', 'label'], properties: { code: { type: 'string', pattern: CODE_RE }, ...editable } } },
    },
    async (req, reply) => {
      const b = req.body
      const label = b.label.trim()
      if (!label) throw httpError(400, '이름을 입력하세요.')
      const description = b.description?.trim() || null
      const role = await txWith(pool, async (client) => {
        if ((await client.query('SELECT 1 FROM roles WHERE code = $1', [b.code])).rowCount) throw httpError(409, '이미 있는 권한 코드입니다.')
        if ((await client.query('SELECT 1 FROM roles WHERE label = $1', [label])).rowCount) throw httpError(409, '이미 있는 권한 이름입니다.')
        const sortOrder = b.sortOrder ?? (await client.query('SELECT coalesce(max(sort_order), 0) + $1 AS n FROM roles', [SORT_STEP])).rows[0].n
        await client.query('INSERT INTO roles (code, label, description, signup_selectable, sort_order) VALUES ($1, $2, $3, $4, $5)', [b.code, label, description, b.signupSelectable ?? false, sortOrder])
        await history(client, b.code, 'CREATE', { label, description }, req.user.sub)
        return loadOne(client, b.code)
      })
      return reply.code(201).send({ role: toDto(role) })
    },
  )

  app.patch(
    '/admin/roles/:code',
    {
      preValidation: rejectUnknown(Object.keys(editable)),
      schema: { params: codeParams, body: { type: 'object', properties: editable } },
    },
    async (req) => {
      const { code } = req.params
      const b = req.body
      return txWith(pool, async (client) => {
        const cur = await loadOne(client, code, { lock: true })
        const next = {
          label: b.label?.trim(),
          description: b.description === undefined ? undefined : b.description?.trim() || null,
          signupSelectable: b.signupSelectable,
          sortOrder: b.sortOrder,
        }
        if (b.label !== undefined && !next.label) throw httpError(400, '이름을 입력하세요.')
        if (cur.is_system && next.signupSelectable !== undefined && next.signupSelectable !== cur.signup_selectable) throw httpError(409, '시스템 권한의 가입 신청 가능 여부는 바꿀 수 없습니다.')
        if (next.label && next.label !== cur.label && (await client.query('SELECT 1 FROM roles WHERE label = $1 AND code <> $2', [next.label, code])).rowCount) throw httpError(409, '이미 있는 권한 이름입니다.')

        const current = { label: cur.label, description: cur.description, signupSelectable: cur.signup_selectable, sortOrder: cur.sort_order }
        const changes = {}
        const sets = []
        const vals = [code]
        for (const [key, col] of Object.entries(FIELD)) {
          if (next[key] === undefined || next[key] === current[key]) continue
          changes[key] = { from: current[key], to: next[key] }
          vals.push(next[key])
          sets.push(`${col} = $${vals.length}`)
        }
        if (sets.length) {
          await client.query(`UPDATE roles SET ${sets.join(', ')} WHERE code = $1`, vals)
          await history(client, code, 'UPDATE', changes, req.user.sub)
        }
        return { role: toDto(await loadOne(client, code)) }
      })
    },
  )

  // 사용 안 함 ↔ 사용 중. 사용자는 건드리지 않는다.
  for (const [path, active, action] of [['deactivate', false, 'DEACTIVATE'], ['activate', true, 'ACTIVATE']]) {
    app.post(`/admin/roles/:code/${path}`, { schema: { params: codeParams } }, async (req) => {
      const { code } = req.params
      return txWith(pool, async (client) => {
        const cur = await loadOne(client, code, { lock: true })
        if (cur.is_system && !active) throw httpError(409, '시스템 권한은 사용 안 함으로 바꿀 수 없습니다.')
        if (cur.is_active !== active) {
          await client.query('UPDATE roles SET is_active = $2 WHERE code = $1', [code, active])
          await history(client, code, action, {}, req.user.sub)
        }
        return { role: toDto(await loadOne(client, code)) }
      })
    })
  }

  // 진짜 삭제: 사용자 0명 + 변경 이력(메뉴 허용 변경 포함)이 없을 때만. 연쇄 삭제는 하지 않는다.
  app.delete('/admin/roles/:code', { schema: { params: codeParams } }, async (req) => {
    const { code } = req.params
    return txWith(pool, async (client) => {
      const cur = await loadOne(client, code, { lock: true })
      if (cur.is_system) throw httpError(409, '시스템 권한은 삭제할 수 없습니다.')
      if (cur.user_count > 0) throw httpError(409, `이 권한을 가진 사용자가 ${cur.user_count}명 있어 삭제할 수 없습니다. 「사용 안 함」으로 바꾸세요.`)
      if (!toDto(cur).deletable) throw httpError(409, '변경 이력이 있어 삭제할 수 없습니다. 「사용 안 함」으로 바꾸세요.')
      await client.query('DELETE FROM role_permissions WHERE role_code = $1', [code]) // 이력이 없으므로 허용을 바꾼 적 없는 초기 상태뿐
      await client.query('DELETE FROM roles WHERE code = $1', [code])
      await history(client, code, 'DELETE', { label: cur.label }, req.user.sub)
      return { deleted: code }
    })
  })
}
