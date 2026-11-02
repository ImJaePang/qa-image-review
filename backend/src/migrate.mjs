// 마이그레이션 적용기: db/migrations/*.sql 을 파일명 순서대로, 아직 적용하지 않은 것만 실행한다.
// 적용 이력은 schema_migrations 테이블에 남긴다. 파일 하나 = 트랜잭션 하나 (실패하면 그 파일만 롤백).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const MIGRATIONS_DIR = join(import.meta.dirname, '../../db/migrations')

/** @param client 연결된 pg.Client  @returns 이번에 새로 적용한 파일명 배열 */
export async function applyMigrations(client, dir = MIGRATIONS_DIR) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`)
  const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name))
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()

  const applied = []
  for (const f of files) {
    if (done.has(f)) continue
    try {
      await client.query('BEGIN')
      await client.query(readFileSync(join(dir, f), 'utf8'))
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw new Error(`마이그레이션 실패 (${f}): ${err.message}`)
    }
    applied.push(f)
  }
  return applied
}
