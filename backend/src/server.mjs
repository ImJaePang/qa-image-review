import { buildApp } from './app.mjs'
import { config } from './config.mjs'
import { pool } from './db.mjs'
import { purgeOldFailures } from './loginGuard.mjs'

await purgeOldFailures(pool) // 오래된 로그인 실패 기록 정리
const app = await buildApp({ logger: true })
await app.listen({ port: config.port, host: config.host })
