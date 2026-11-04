import { pool } from '../db.mjs'
import { config } from '../config.mjs'
import { httpError } from '../errors.mjs'
import { BLOCKED_MESSAGE, EXPIRY_YEARS, SIGNUP_ROLES, effectiveStatus } from '../account.mjs'

const toUser = (r) => ({ id: String(r.id), name: r.name, email: r.email, role: r.role })

export default async function authRoutes(app) {
  const setToken = (reply, user) => {
    const token = app.jwt.sign({ sub: user.id, role: user.role, name: user.name })
    reply.setCookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
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
      const { rows } = await pool.query(
        'SELECT id, name, email, role, status, expires_at FROM users WHERE lower(email) = lower($1) AND password_hash = crypt($2, password_hash)',
        [email, password],
      )
      if (!rows.length) throw httpError(401, '이메일 또는 비밀번호가 올바르지 않습니다.')
      // 비밀번호가 맞은 뒤에만 상태를 알려 준다 (틀린 경우에 알려 주면 계정 존재 여부가 드러난다)
      const status = effectiveStatus(rows[0])
      if (status !== 'ACTIVE') {
        if (status === 'EXPIRED' && rows[0].status === 'ACTIVE') await pool.query(`UPDATE users SET status = 'EXPIRED' WHERE id = $1`, [rows[0].id])
        throw httpError(403, BLOCKED_MESSAGE[status], status)
      }
      // 로그인할 때마다 사용기한을 로그인 시각 + 1년으로 밀어 준다 (장기 미사용 계정 차단용)
      await pool.query(`UPDATE users SET last_login_at = now(), expires_at = now() + make_interval(years => $2) WHERE id = $1`, [rows[0].id, EXPIRY_YEARS])
      const user = toUser(rows[0])
      setToken(reply, user)
      return { user }
    },
  )

  // 가입은 승인 신청이다: 승인 대기(PENDING)로 만들고 로그인시키지 않는다.
  // 실제 권한은 최소(qa)로 두고, 신청한 권한은 따로 기록해 관리자가 승인하면서 정한다. 관리자는 신청할 수 없다.
  app.post(
    '/auth/signup',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'email', 'password'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 50 },
            email: { type: 'string', minLength: 3, maxLength: 200 },
            password: { type: 'string', minLength: 4, maxLength: 200 },
            requestedRole: { enum: SIGNUP_ROLES },
          },
        },
      },
    },
    async (req, reply) => {
      const { name, email, password, requestedRole = 'qa' } = req.body
      try {
        await pool.query(
          `INSERT INTO users (name, email, password_hash, role, status, requested_role) VALUES ($1, $2, crypt($3, gen_salt('bf')), 'qa', 'PENDING', $4)`,
          [name.trim(), email.trim(), password, requestedRole],
        )
        return reply.code(201).send({ status: 'PENDING', message: BLOCKED_MESSAGE.PENDING })
      } catch (err) {
        if (err.code === '23505') throw httpError(409, '이미 가입된 이메일입니다.')
        throw err
      }
    },
  )

  app.post('/auth/logout', async (req, reply) => {
    reply.clearCookie('token', { path: '/' })
    return { ok: true }
  })

  app.get('/auth/me', { onRequest: app.authenticate }, async (req) => {
    const { rows } = await pool.query('SELECT id, name, email, role FROM users WHERE id = $1', [req.user.sub])
    if (!rows.length) throw httpError(401, '로그인이 필요합니다.')
    return { user: toUser(rows[0]) }
  })

  // 담당자 선택용 사용자 목록 (사용 중인 계정만)
  app.get('/users', { onRequest: app.authenticate }, async () => {
    const { rows } = await pool.query(`SELECT id, name, email, role FROM users WHERE status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > now()) ORDER BY id`)
    return { items: rows.map(toUser) }
  })
}
