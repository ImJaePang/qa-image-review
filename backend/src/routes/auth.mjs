import { pool } from '../db.mjs'
import { config } from '../config.mjs'
import { httpError } from '../errors.mjs'

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
        'SELECT id, name, email, role FROM users WHERE lower(email) = lower($1) AND password_hash = crypt($2, password_hash)',
        [email, password],
      )
      if (!rows.length) throw httpError(401, '이메일 또는 비밀번호가 올바르지 않습니다.')
      const user = toUser(rows[0])
      setToken(reply, user)
      return { user }
    },
  )

  // 가입은 항상 일반(qa) 역할. 관리자는 DB에서만 지정한다.
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
          },
        },
      },
    },
    async (req, reply) => {
      const { name, email, password } = req.body
      try {
        const { rows } = await pool.query(
          `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, crypt($3, gen_salt('bf')), 'qa')
           RETURNING id, name, email, role`,
          [name.trim(), email.trim(), password],
        )
        const user = toUser(rows[0])
        setToken(reply, user)
        return reply.code(201).send({ user })
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

  // 담당자 선택용 사용자 목록
  app.get('/users', { onRequest: app.authenticate }, async () => {
    const { rows } = await pool.query('SELECT id, name, email, role FROM users ORDER BY id')
    return { items: rows.map(toUser) }
  })
}
