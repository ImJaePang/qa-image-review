import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import { config } from './config.mjs'
import { pool } from './db.mjs'
import { httpError } from './errors.mjs'
import { isUsable } from './account.mjs'
import { loadPermissions } from './permissions.mjs'
import permissionRoutes from './routes/permissions.mjs'
import authRoutes from './routes/auth.mjs'
import assignmentRoutes from './routes/assignments.mjs'
import imageRoutes from './routes/images.mjs'
import fileRoutes from './routes/files.mjs'
import monitoringRoutes from './routes/monitoring.mjs'
import integrationRoutes from './routes/integrations.mjs'
import ruleRoutes from './routes/rules.mjs'
import userAdminRoutes from './routes/users.mjs'

export async function buildApp(opts = {}) {
  const app = Fastify({ logger: opts.logger ?? false })

  await app.register(cookie)
  // 토큰은 httpOnly 쿠키로 전달 (<img> 요청에도 자동으로 따라가도록). Authorization: Bearer 도 허용.
  await app.register(jwt, {
    secret: config.jwtSecret,
    cookie: { cookieName: 'token', signed: false },
    sign: { expiresIn: '12h' },
  })

  // 토큰이 유효해도 계정이 지금도 쓸 수 있는 상태인지 확인한다 (비활성·만료·삭제된 계정의 기존 토큰을 막는다).
  // 권한(role)도 토큰이 아니라 DB의 현재 값을 따른다.
  app.decorate('authenticate', async (request) => {
    try {
      await request.jwtVerify()
    } catch {
      throw httpError(401, '로그인이 필요합니다.')
    }
    const { rows } = await pool.query('SELECT role, name, status, expires_at FROM users WHERE id = $1', [request.user.sub])
    if (!rows.length || !isUsable(rows[0])) throw httpError(401, '로그인이 필요합니다.')
    request.user.role = rows[0].role
    request.user.name = rows[0].name
    request.user.permissions = await loadPermissions(pool, rows[0].role) // 권한 코드는 DB의 현재 값
  })

  // 에러 응답은 항상 { message } 형태
  app.setErrorHandler((err, request, reply) => {
    if (err.validation) return reply.code(400).send({ message: '요청 값이 올바르지 않습니다.', detail: err.message })
    const status = err.statusCode ?? 500
    if (status >= 500) request.log.error(err)
    reply.code(status).send({ message: status >= 500 ? '서버 오류가 발생했습니다.' : err.message, ...(err.appCode ? { code: err.appCode } : {}) })
  })

  app.get('/api/health', async () => {
    await pool.query('SELECT 1')
    return { ok: true }
  })

  await app.register(authRoutes, { prefix: '/api' })
  await app.register(assignmentRoutes, { prefix: '/api' })
  await app.register(imageRoutes, { prefix: '/api' })
  await app.register(monitoringRoutes, { prefix: '/api' })
  await app.register(integrationRoutes, { prefix: '/api' })
  await app.register(ruleRoutes, { prefix: '/api' })
  await app.register(userAdminRoutes, { prefix: '/api' })
  await app.register(permissionRoutes, { prefix: '/api' })
  await app.register(fileRoutes, { prefix: '/api' })

  app.addHook('onClose', async () => {
    await pool.end()
  })
  return app
}
