// 사용자 관리 API (관리자 전용): 조회, 수정, 일괄 처리(승인·반려·비활성·재활성·만료 해제), 임시 비밀번호.
//  - 가입 승인과 만료 해제는 같은 목록에서 상태 필터로 구분한다. 처리는 일괄 API 하나(/admin/users/bulk)로 한다 (한 명이면 ids 1개).
//  - 일괄 처리는 대상이 아닌 사용자는 건너뛰고 사유를 돌려준다 (이미 승인된 사람, 본인 등). 한 번에 최대 100명 (서버 보호용).
//  - 관리자가 한 명도 남지 않게 되는 처리는 통째로 취소한다 (409).
//  - 모든 변경은 user_history에 누가·무엇을 남긴다.
import { randomInt } from 'node:crypto'
import { DEFAULT_ROLE, EFFECTIVE_STATUS_SQL, EXPIRY_YEARS, PROFILE_FIELDS, STATUSES, assertRole, rejectUnknownProfile } from '../account.mjs'
import { pool } from '../db.mjs'
import { httpError } from '../errors.mjs'
import { pagingQuery } from '../paging.mjs'
import { txWith } from '../tx.mjs'
import { requirePermission } from '../permissions.mjs'

export const BULK_MAX = 100
const EFF = EFFECTIVE_STATUS_SQL('u')

// Fastify의 스키마 검증은 모르는 항목을 조용히 지워 버린다. 오타가 저장된 것처럼 보이지 않도록 먼저 거부한다.
const strictKeys = (allowed) => async (req) => {
  const extra = Object.keys(req.body ?? {}).filter((k) => !allowed.includes(k))
  if (extra.length) throw httpError(400, `알 수 없는 항목: ${extra.join(', ')}`)
  rejectUnknownProfile(req.body?.profile)
}

const idParams = { type: 'object', properties: { id: { type: 'integer', minimum: 1 } }, required: ['id'] }

const profileSchema = {
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(Object.keys(PROFILE_FIELDS).map((k) => [k, { type: 'string', maxLength: k === 'companyAddress' ? 300 : 100 }])),
}

const SELECT_USER = `
  SELECT u.id, u.name, u.email, u.role, u.requested_role, u.expires_at, u.last_login_at, u.expiry_release_requested_at, u.created_at,
         ${EFF} AS eff_status,
         p.company, p.department, p.job_title, p.phone, p.company_address
    FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id`

const toDto = (r) => ({
  id: String(r.id),
  name: r.name,
  email: r.email,
  role: r.role,
  status: r.eff_status,
  requestedRole: r.requested_role,
  expiresAt: r.expires_at,
  lastLoginAt: r.last_login_at,
  expiryReleaseRequestedAt: r.expiry_release_requested_at,
  createdAt: r.created_at,
  profile: { company: r.company ?? '', department: r.department ?? '', jobTitle: r.job_title ?? '', phone: r.phone ?? '', companyAddress: r.company_address ?? '' },
})

const history = (db, userId, action, detail, actorId) =>
  db.query('INSERT INTO user_history (user_id, action, detail, created_by) VALUES ($1, $2, $3, $4)', [userId, action, JSON.stringify(detail), actorId])

/** 관리자가 한 명도 안 남는 처리는 취소한다: 사용 가능한(ACTIVE이고 기한 안 지난) 관리자가 1명 이상이어야 한다 */
async function assertAdminRemains(client) {
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM users u WHERE u.role = 'admin' AND ${EFF} = 'ACTIVE'`)
  if (rows[0].n < 1) throw httpError(409, '사용 가능한 관리자가 한 명은 있어야 합니다.')
}

/** 일괄 처리별 규칙: 어떤 상태에서만 가능한지, 처리 후 상태 */
const BULK = {
  APPROVE: { from: ['PENDING'], to: 'ACTIVE', history: 'APPROVE' },
  REJECT: { from: ['PENDING'], to: 'DISABLED', history: 'REJECT' },
  DISABLE: { from: ['ACTIVE', 'EXPIRED'], to: 'DISABLED', history: 'DISABLE' },
  ENABLE: { from: ['DISABLED'], to: 'ACTIVE', history: 'ENABLE' },
  RELEASE_EXPIRY: { from: ['EXPIRED'], to: 'ACTIVE', history: 'EXPIRY_RELEASE' },
}
const STATUS_LABEL = { PENDING: '승인 대기', ACTIVE: '사용 중', EXPIRED: '만료', DISABLED: '비활성' }

async function loadOne(db, id) {
  const { rows } = await db.query(`${SELECT_USER} WHERE u.id = $1`, [id])
  if (!rows.length) throw httpError(404, '사용자를 찾을 수 없습니다.')
  return rows[0]
}

export default async function userAdminRoutes(app) {
  app.addHook('onRequest', app.authenticate)
  app.addHook('onRequest', requirePermission('user.manage'))

  // 목록 + 상태별 건수(전체 사용자 기준, 필터 칩의 숫자용)
  app.get(
    '/admin/users',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { status: { enum: STATUSES }, role: { type: 'string', maxLength: 50 }, q: { type: 'string', maxLength: 100 }, ...pagingQuery },
        },
      },
    },
    async (req) => {
      const { status = null, role = null, q = null, page, pageSize } = req.query
      const like = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null
      const where = `($1::text IS NULL OR ${EFF} = $1) AND ($2::text IS NULL OR u.role = $2)
        AND ($3::text IS NULL OR u.name ILIKE $3 OR u.email ILIKE $3 OR p.company ILIKE $3 OR p.department ILIKE $3)`
      const args = [status, role, like]
      const [list, total, counts] = await Promise.all([
        // 승인 대기는 신청 순서대로(오래된 것 먼저), 그 외는 최근 가입 순
        pool.query(`${SELECT_USER} WHERE ${where} ORDER BY (CASE WHEN $1::text = 'PENDING' THEN u.id END) ASC, u.id DESC LIMIT $4 OFFSET $5`, [...args, pageSize, (page - 1) * pageSize]),
        pool.query(`SELECT count(*)::int AS n FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE ${where}`, args),
        pool.query(`SELECT ${EFF} AS s, count(*)::int AS n FROM users u GROUP BY 1`),
      ])
      const statusCounts = Object.fromEntries(STATUSES.map((s) => [s, 0]))
      counts.rows.forEach((r) => (statusCounts[r.s] = r.n))
      return { items: list.rows.map(toDto), total: total.rows[0].n, page, pageSize, statusCounts, bulkMax: BULK_MAX }
    },
  )

  app.get('/admin/users/:id', { schema: { params: idParams } }, async (req) => {
    const r = await loadOne(pool, req.params.id)
    const h = await pool.query(
      `SELECT h.id, h.action, h.detail, h.created_at, a.name AS actor
         FROM user_history h LEFT JOIN users a ON a.id = h.created_by WHERE h.user_id = $1 ORDER BY h.id DESC LIMIT 30`,
      [req.params.id],
    )
    return { ...toDto(r), history: h.rows.map((x) => ({ id: String(x.id), action: x.action, detail: x.detail, at: x.created_at, actor: x.actor })) }
  })

  // 수정: 이름·권한·사용기한·프로필. 만료된 사용자의 기한을 미래로 바꾸면 만료가 해제된다.
  app.patch(
    '/admin/users/:id',
    {
      preValidation: strictKeys(['name', 'role', 'expiresAt', 'profile']),
      schema: {
        params: idParams,
        body: {
          type: 'object',
          minProperties: 1,
          properties: { name: { type: 'string', minLength: 1, maxLength: 50 }, role: { type: 'string', maxLength: 50 }, expiresAt: { type: 'string', maxLength: 40 }, profile: profileSchema },
        },
      },
    },
    async (req) => {
      const { id } = req.params
      const b = req.body
      if (b.role !== undefined) await assertRole(pool, b.role)
      let newExpires
      if (b.expiresAt !== undefined) {
        newExpires = new Date(b.expiresAt)
        if (Number.isNaN(newExpires.getTime())) throw httpError(400, '사용기한 형식이 올바르지 않습니다.')
      }
      await txWith(pool, async (client) => {
        const { rows } = await client.query(`${SELECT_USER} WHERE u.id = $1 FOR UPDATE OF u`, [id])
        if (!rows.length) throw httpError(404, '사용자를 찾을 수 없습니다.')
        const cur = rows[0]
        const actor = req.user.sub

        if (b.name !== undefined && b.name.trim() && b.name.trim() !== cur.name) {
          await client.query('UPDATE users SET name = $2 WHERE id = $1', [id, b.name.trim()])
          await history(client, id, 'PROFILE', { name: { from: cur.name, to: b.name.trim() } }, actor)
        }
        if (b.role !== undefined && b.role !== cur.role) {
          if (cur.eff_status === 'PENDING') throw httpError(409, '승인 대기 중인 사용자의 권한은 승인할 때 정합니다.')
          await client.query('UPDATE users SET role = $2 WHERE id = $1', [id, b.role])
          await history(client, id, 'ROLE', { from: cur.role, to: b.role }, actor)
        }
        if (newExpires) {
          if (cur.eff_status === 'PENDING' || cur.eff_status === 'DISABLED') throw httpError(409, '승인 대기·비활성 사용자의 사용기한은 바꿀 수 없습니다.')
          const release = cur.eff_status === 'EXPIRED' && newExpires > new Date()
          await client.query(
            `UPDATE users SET expires_at = $2, status = CASE WHEN $3 THEN 'ACTIVE' ELSE status END,
                    expiry_release_requested_at = CASE WHEN $3 THEN NULL ELSE expiry_release_requested_at END WHERE id = $1`,
            [id, newExpires, release],
          )
          await history(client, id, release ? 'EXPIRY_RELEASE' : 'EXPIRES', { from: cur.expires_at, to: newExpires }, actor)
        }
        if (b.profile) {
          const changes = {}
          const sets = []
          const vals = [id, actor]
          for (const [key, col] of Object.entries(PROFILE_FIELDS)) {
            if (b.profile[key] === undefined) continue
            const next = b.profile[key].trim()
            const prev = cur[col] ?? ''
            if (next === prev) continue
            changes[key] = { from: prev, to: next }
            vals.push(next || null)
            sets.push(`${col} = $${vals.length}`)
          }
          if (sets.length) {
            await client.query('INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [id])
            await client.query(`UPDATE user_profiles SET ${sets.join(', ')}, updated_by = $2, updated_at = now() WHERE user_id = $1`, vals)
            await history(client, id, 'PROFILE', changes, actor)
          }
        }
        await assertAdminRemains(client)
      })
      return toDto(await loadOne(pool, id))
    },
  )

  // 일괄 처리: 대상이 아닌 사용자는 건너뛰고 사유를 알려 준다. 관리자가 0명이 되면 전체 취소.
  app.post(
    '/admin/users/bulk',
    {
      preValidation: strictKeys(['action', 'ids', 'role']),
      schema: {
        body: {
          type: 'object',
          required: ['action', 'ids'],
          properties: {
            action: { enum: Object.keys(BULK) },
            ids: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1, maxItems: BULK_MAX, uniqueItems: true },
            role: { type: 'string', maxLength: 50 },
          },
        },
      },
    },
    async (req) => {
      const { action, ids, role } = req.body
      if (role && action !== 'APPROVE') throw httpError(400, '권한 지정은 승인에만 쓸 수 있습니다.')
      if (role) await assertRole(pool, role)
      const rule = BULK[action]
      const actor = req.user.sub
      return txWith(pool, async (client) => {
        const { rows } = await client.query(`${SELECT_USER} WHERE u.id = ANY($1::bigint[]) ORDER BY u.id FOR UPDATE OF u`, [ids])
        const byId = new Map(rows.map((r) => [Number(r.id), r]))
        let processed = 0
        const skipped = []
        for (const id of ids) {
          const u = byId.get(id)
          if (!u) {
            skipped.push({ id: String(id), name: null, reason: '사용자를 찾을 수 없습니다.' })
            continue
          }
          if (String(u.id) === String(actor) && ['DISABLE', 'REJECT'].includes(action)) {
            skipped.push({ id: String(id), name: u.name, reason: '본인 계정은 처리할 수 없습니다.' })
            continue
          }
          if (!rule.from.includes(u.eff_status)) {
            skipped.push({ id: String(id), name: u.name, reason: `${STATUS_LABEL[u.eff_status]} 상태에서는 할 수 없습니다.` })
            continue
          }
          const newRole = action === 'APPROVE' ? (role ?? u.requested_role ?? DEFAULT_ROLE) : u.role
          const activating = rule.to === 'ACTIVE'
          // 활성화(승인·재활성·만료 해제)는 사용기한을 오늘 + 1년으로 새로 잡는다
          await client.query(
            `UPDATE users SET status = $2, role = $3,
                    expires_at = CASE WHEN $4 THEN now() + make_interval(years => $5) ELSE expires_at END,
                    expiry_release_requested_at = CASE WHEN $4 THEN NULL ELSE expiry_release_requested_at END
              WHERE id = $1`,
            [id, rule.to, newRole, activating, EXPIRY_YEARS],
          )
          await history(client, id, rule.history, action === 'APPROVE' ? { role: newRole, requestedRole: u.requested_role } : {}, actor)
          processed++
        }
        await assertAdminRemains(client)
        return { action, processed, skipped }
      })
    },
  )

  // 임시 비밀번호: 새로 만들어 한 번만 돌려준다 (화면에서 복사해 전달). 이메일 발송은 추후 과제.
  app.post('/admin/users/:id/reset-password', { schema: { params: idParams } }, async (req) => {
    const { id } = req.params
    await loadOne(pool, id)
    const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 헷갈리는 글자(l, I, 0, O, 1) 제외
    const temp = Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join('')
    await txWith(pool, async (client) => {
      await client.query(`UPDATE users SET password_hash = crypt($2, gen_salt('bf')) WHERE id = $1`, [id, temp])
      await history(client, id, 'PASSWORD_RESET', {}, req.user.sub)
    })
    return { tempPassword: temp }
  })
}
