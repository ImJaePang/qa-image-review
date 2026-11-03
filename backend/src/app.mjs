import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import { config } from './config.mjs'
import { pool } from './db.mjs'
import authRoutes from './routes/auth.mjs'
import assignmentRoutes from './routes/assignments.mjs'
import imageRoutes from './routes/images.mjs'
import fileRoutes from './routes/files.mjs'
import monitoringRoutes from './routes/monitoring.mjs'

export async function buildApp(opts = {}) {
  const app = Fastify({ logger: opts.logger ?? false })

  await app.register(cookie)
  // 토큰은 httpOnly 쿠키로 전달 (<img> 요청에도 자동으로 따라가도록). Authorization: Bearer 도 허용.
  await app.register(jwt, {
    secret: config.jwtSecret,
    cookie: { cookieName: 'token', signed: false },
    sign: { expiresIn: '12h' },
  })

  app.decorate('authenticate', async (request) => {
    try {
      await request.jwtVerify()
    } catch {
      const err = new Error('로그인이 필요합니다.')
      err.statusCode = 401
      throw err
    }
  })

  // 에러 응답은 항상 { message } 형태
  app.setErrorHandler((err, request, reply) => {
    if (err.validation) return reply.code(400).send({ message: '요청 값이 올바르지 않습니다.', detail: err.message })
    const status = err.statusCode ?? 500
    if (status >= 500) request.log.error(err)
    reply.code(status).send({ message: status >= 500 ? '서버 오류가 발생했습니다.' : err.message })
  })

  app.get('/api/health', async () => {
    await pool.query('SELECT 1')
    return { ok: true }
  })

  await app.register(authRoutes, { prefix: '/api' })
  await app.register(assignmentRoutes, { prefix: '/api' })
  await app.register(imageRoutes, { prefix: '/api' })
  await app.register(monitoringRoutes, { prefix: '/api' })
  await app.register(fileRoutes, { prefix: '/api' })

  app.addHook('onClose', async () => {
    await pool.end()
  })
  return app
}
