// 마이그레이션 적용: npm run migrate   (루트 .env의 POSTGRES_* 사용, DB 컨테이너가 떠 있어야 함)
// 새 환경이면 docker compose up -d 로 init SQL이 먼저 적용된 뒤 이 명령을 실행한다.
import pg from 'pg'
import { applyMigrations } from '../src/migrate.mjs'

const e = process.env
const client = new pg.Client({
  host: e.POSTGRES_HOST ?? 'localhost',
  port: Number(e.POSTGRES_PORT ?? 5432),
  user: e.POSTGRES_USER,
  password: e.POSTGRES_PASSWORD,
  database: e.POSTGRES_DB,
})

await client.connect()
try {
  const applied = await applyMigrations(client)
  console.log(applied.length ? `적용: ${applied.join(', ')}` : '적용할 마이그레이션 없음')
} catch (err) {
  console.error(err.message)
  process.exitCode = 1
} finally {
  await client.end()
}
