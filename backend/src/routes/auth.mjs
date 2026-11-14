import { pool } from '../db.mjs'
import { config } from '../config.mjs'
import { httpError } from '../errors.mjs'
import { BLOCKED_MESSAGE, DEFAULT_ROLE, EXPIRY_YEARS, PROFILE_FIELDS, assertRole, effectiveStatus, rejectUnknownProfile } from '../account.mjs'
import { txWith } from '../tx.mjs'
import { loadPermissions } from '../permissions.mjs'
import { assertNotLocked, clearFailures, recordFailure } from '../loginGuard.mjs'

// 비밀번호 변경 시 최소 길이 (가입 화면의 데모 계정 비밀번호는 기존 그대로 두고, 새로 정하는 비밀번호부터 적용)
export const MIN_PASSWORD = 8

const toUser = (r) => ({ id: String(r.id), name: r.name, email: r.email, role: r.role })

export default async function authRoutes(app) {
  const setToken = (reply, user) => {
    const token = app.jwt.sign({ sub: user.id, role: user.role, name: user.name })
    reply.setCookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: '/',
      maxAge: 12 * 3600,
    })
  }

  app.post(
    '/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: { email: { type: 'string', maxLength: 200 }, password: { type: 'string', maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      const { email, password } = req.body
      await assertNotLocked(pool, email, req.ip) // 잠겨 있으면 비밀번호를 검사하지 않는다
      const { rows } = await pool.query(
        'SELECT id, name, email, role, status, expires_at, must_change_password FROM users WHERE lower(email) = lower($1) AND password_hash = crypt($2, password_hash)',
        [email, password],
      )
      if (!rows.length) {
        await recordFailure(pool, email, req.ip)
        throw httpError(401, '이메일 또는 비밀번호가 올바르지 않습니다.')
      }
      await clearFailures(pool, email) // 비밀번호가 맞았으므로 (계정 상태와 무관하게) 실패 횟수를 지운다
      // 비밀번호가 맞은 뒤에만 상태를 알려 준다 (틀린 경우에 알려 주면 계정 존재 여부가 드러난다)
      const status = effectiveStatus(rows[0])
      if (status !== 'ACTIVE') {
        if (status === 'EXPIRED' && rows[0].status === 'ACTIVE') {
          await pool.query(`UPDATE users SET status = 'EXPIRED' WHERE id = $1`, [rows[0].id])
          await pool.query(`INSERT INTO user_history (user_id, action, detail) VALUES ($1, 'EXPIRE', $2)`, [rows[0].id, JSON.stringify({ expiresAt: rows[0].expires_at })])
        }
        throw httpError(403, BLOCKED_MESSAGE[status], status)
      }
      // 로그인할 때마다 사용기한을 로그인 시각 + 1년으로 밀어 준다 (장기 미사용 계정 차단용)
      await pool.query(`UPDATE users SET last_login_at = now(), expires_at = now() + make_interval(years => $2) WHERE id = $1`, [rows[0].id, EXPIRY_YEARS])
      const user = toUser(rows[0])
      setToken(reply, user)
      return { user: { ...user, mustChangePassword: rows[0].must_change_password, permissions: [...(await loadPermissions(pool, user.role))].sort() } }
    },
  )

  // 가입은 승인 신청이다: 승인 대기(PENDING)로 만들고 로그인시키지 않는다.
  // 실제 권한은 최소(qa)로 두고, 신청한 권한은 따로 기록해 관리자가 승인하면서 정한다. 관리자는 신청할 수 없다.
  app.post(
    '/auth/signup',
    {
      preValidation: async (req) => rejectUnknownProfile(req.body?.profile),
      schema: {
        body: {
          type: 'object',
          required: ['name', 'email', 'password'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 50 },
            email: { type: 'string', minLength: 3, maxLength: 200 },
            password: { type: 'string', minLength: 4, maxLength: 200 },
            requestedRole: { type: 'string', maxLength: 50 }, // 가입 신청 가능한 권한인지는 DB(roles.signup_selectable)로 검사
            // 소속·연락처는 모두 선택 항목
            profile: {
              type: 'object',
              additionalProperties: false,
              properties: Object.fromEntries(Object.keys(PROFILE_FIELDS).map((k) => [k, { type: 'string', maxLength: k === 'companyAddress' ? 300 : 100 }])),
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { name, email, password, requestedRole = DEFAULT_ROLE, profile = {} } = req.body
      await assertRole(pool, requestedRole, { signupOnly: true })
      try {
        await txWith(pool, async (client) => {
          const { rows } = await client.query(
            `INSERT INTO users (name, email, password_hash, role, status, requested_role) VALUES ($1, $2, crypt($3, gen_salt('bf')), $5, 'PENDING', $4) RETURNING id`,
            [name.trim(), email.trim(), password, requestedRole, DEFAULT_ROLE],
          )
          const cols = Object.values(PROFILE_FIELDS)
          await client.query(`INSERT INTO user_profiles (user_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`, [
            rows[0].id,
            ...Object.keys(PROFILE_FIELDS).map((k) => profile[k]?.trim() || null),
          ])
          await client.query(`INSERT INTO user_history (user_id, action, detail) VALUES ($1, 'SIGNUP', $2)`, [rows[0].id, JSON.stringify({ requestedRole })])
        })
        return reply.code(201).send({ status: 'PENDING', message: BLOCKED_MESSAGE.PENDING })
      } catch (err) {
        if (err.code === '23505') throw httpError(409, '이미 가입된 이메일입니다.')
        throw err
      }
    },
  )

  // 만료 해제 요청: 로그인할 수 없는 만료 사용자가 보낸다. 본인 확인을 위해 이메일·비밀번호를 다시 받는다.
  // 요청은 계정 상태를 바꾸는 것이 아니라 관리자에게 '요청했다'는 표시를 남기는 것이다 (해제는 관리자가 한다).
  app.post(
    '/auth/expiry-release-request',
    { schema: { body: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', maxLength: 200 }, password: { type: 'string', maxLength: 200 } } } } },
    async (req) => {
      const { email, password } = req.body
      await assertNotLocked(pool, email, req.ip)
      const { rows } = await pool.query(
        'SELECT id, status, expires_at FROM users WHERE lower(email) = lower($1) AND password_hash = crypt($2, password_hash)',
        [email, password],
      )
      if (!rows.length) {
        await recordFailure(pool, email, req.ip)
        throw httpError(401, '이메일 또는 비밀번호가 올바르지 않습니다.')
      }
      await clearFailures(pool, email)
      if (effectiveStatus(rows[0]) !== 'EXPIRED') throw httpError(409, '만료된 계정만 해제를 요청할 수 있습니다.')
      await txWith(pool, async (client) => {
        await client.query('UPDATE users SET expiry_release_requested_at = now() WHERE id = $1', [rows[0].id])
        await client.query(`INSERT INTO user_history (user_id, action) VALUES ($1, 'EXPIRY_REQUEST')`, [rows[0].id])
      })
      return { ok: true, message: '만료 해제를 요청했습니다. 관리자가 처리하면 로그인할 수 있습니다.' }
    },
  )

  // 가입 화면용(로그인 전): 신청할 수 있는 권한 목록
  app.get('/auth/signup-roles', async () => {
    const { rows } = await pool.query('SELECT code, label FROM roles WHERE signup_selectable AND is_active ORDER BY sort_order, code')
    return { roles: rows }
  })

  // 전체 권한 목록(로그인 후): 화면의 이름 표시·선택지에 쓴다
  app.get('/roles', { onRequest: app.authenticate }, async () => {
    const { rows } = await pool.query('SELECT code, label, is_system, signup_selectable, is_active FROM roles ORDER BY sort_order, code')
    return { roles: rows.map((r) => ({ code: r.code, label: r.label, system: r.is_system, signupSelectable: r.signup_selectable, active: r.is_active })) }
  })

  app.post('/auth/logout', async (req, reply) => {
    reply.clearCookie('token', { path: '/' })
    return { ok: true }
  })

  app.get('/auth/me', { onRequest: app.authenticate, config: { allowMustChange: true } }, async (req) => {
    const { rows } = await pool.query('SELECT id, name, email, role, must_change_password FROM users WHERE id = $1', [req.user.sub])
    if (!rows.length) throw httpError(401, '로그인이 필요합니다.')
    return { user: { ...toUser(rows[0]), mustChangePassword: rows[0].must_change_password, permissions: [...req.user.permissions].sort() } }
  })

  // 비밀번호 변경 (본인). 임시 비밀번호로 로그인한 직후에도 이 경로는 쓸 수 있다.
  //  - 현재 비밀번호를 다시 확인하며, 틀리면 로그인과 같은 횟수 제한에 센다. 틀린 경우 401이 아니라 400을 쓴다(401은 화면이 로그아웃 처리하는 신호).
  app.post(
    '/auth/change-password',
    {
      onRequest: app.authenticate,
      config: { allowMustChange: true },
      schema: {
        body: {
          type: 'object',
          required: ['currentPassword', 'newPassword'],
          properties: { currentPassword: { type: 'string', maxLength: 200 }, newPassword: { type: 'string', minLength: MIN_PASSWORD, maxLength: 200 } },
        },
      },
    },
    async (req) => {
      const { currentPassword, newPassword } = req.body
      const id = req.user.sub
      const { rows } = await pool.query('SELECT email FROM users WHERE id = $1', [id])
      await assertNotLocked(pool, rows[0].email, req.ip)
      const ok = await pool.query('SELECT 1 FROM users WHERE id = $1 AND password_hash = crypt($2, password_hash)', [id, currentPassword])
      if (!ok.rowCount) {
        await recordFailure(pool, rows[0].email, req.ip)
        throw httpError(400, '현재 비밀번호가 올바르지 않습니다.', 'WRONG_PASSWORD')
      }
      if (newPassword === currentPassword) throw httpError(400, '새 비밀번호는 현재 비밀번호와 달라야 합니다.', 'SAME_PASSWORD')
      await txWith(pool, async (client) => {
        await client.query(`UPDATE users SET password_hash = crypt($2, gen_salt('bf')), must_change_password = false WHERE id = $1`, [id, newPassword])
        await client.query(`INSERT INTO user_history (user_id, action) VALUES ($1, 'PASSWORD_CHANGE')`, [id])
      })
      await clearFailures(pool, rows[0].email)
      return { ok: true }
    },
  )

  // 담당자 선택용 사용자 목록 (사용 중인 계정만)
  app.get('/users', { onRequest: app.authenticate }, async () => {
    const { rows } = await pool.query(`SELECT id, name, email, role FROM users WHERE status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > now()) ORDER BY id`)
    return { items: rows.map(toUser) }
  })
}
