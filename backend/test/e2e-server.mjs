// 화면 자동 테스트(Playwright)용 API 서버: 테스트 전용 DB(qa_review_test)를 새로 만들고 그 위에서 API를 띄운다. 개발 DB는 건드리지 않는다.
// 실행: node --env-file=../.env test/e2e-server.mjs   (포트는 E2E_API_PORT, 기본 3201)
import { resetTestDb } from './helpers.mjs'

await resetTestDb()
const { buildApp } = await import('../src/app.mjs')
const app = await buildApp({ logger: false })
await app.listen({ port: Number(process.env.E2E_API_PORT ?? 3201), host: '127.0.0.1' })
console.log('e2e api ready')
