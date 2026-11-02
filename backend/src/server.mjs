import { buildApp } from './app.mjs'
import { config } from './config.mjs'

const app = await buildApp({ logger: true })
await app.listen({ port: config.port, host: '127.0.0.1' })
