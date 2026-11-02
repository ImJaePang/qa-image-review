// 마이그레이션 001 검증: 기존 데이터 보존, 새 제약, 수정일시 트리거, 재실행 안전성
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { resetTestDb } from './helpers.mjs'
import { applyMigrations } from '../src/migrate.mjs'

let db

before(async () => {
  await resetTestDb()
  db = new pg.Client({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  })
  await db.connect()
})
after(async () => db.end())

const rejects = async (sql, params, pattern) => {
  await assert.rejects(db.query(sql, params), pattern)
}

test('이미 적용된 마이그레이션은 다시 실행되지 않는다', async () => {
  assert.deepEqual(await applyMigrations(db), [])
  const { rows } = await db.query('SELECT name FROM schema_migrations ORDER BY name')
  assert.deepEqual(rows.map((r) => r.name), ['001_ingest_foundation.sql'])
})

test('기존 이미지는 수신 완료(DONE)이고 원래 파일명이 보존된다', async () => {
  const { rows } = await db.query(`SELECT ingest_status, source_name = file_name AS same_name FROM images`)
  assert.ok(rows.length > 0)
  assert.ok(rows.every((r) => r.ingest_status === 'DONE' && r.same_name))
})

test('새로 넣는 이미지의 기본 상태는 대기(PENDING)이고 크기 없이도 들어간다', async () => {
  const { rows } = await db.query(
    `INSERT INTO images (image_key, file_name, original_path) VALUES ('mig_1', 'a.png', 'inbox/a.png') RETURNING ingest_status, width`,
  )
  assert.equal(rows[0].ingest_status, 'PENDING')
  assert.equal(rows[0].width, null)
})

test('DONE 이미지는 크기가 있어야 한다', async () => {
  await rejects(
    `INSERT INTO images (image_key, file_name, original_path, ingest_status) VALUES ('mig_2', 'b.png', 'done/b.png', 'DONE')`,
    [],
    /images_done_has_size/,
  )
})

test('알 수 없는 수신 상태와 자기 자신을 원본으로 가리키는 행은 거부된다', async () => {
  await rejects(`INSERT INTO images (image_key, file_name, original_path, ingest_status) VALUES ('mig_3', 'c.png', 'x', 'WAIT')`, [], /images_ingest_status_check/)
  await rejects(`UPDATE images SET origin_image_id = id WHERE image_key = 'mig_1'`, [], /images_origin_not_self/)
})

test('재수신 행은 origin_image_id로 처음 수신 행을 가리키고 각자 행을 가진다', async () => {
  const first = (await db.query(`SELECT id FROM images WHERE image_key = 'mig_1'`)).rows[0].id
  await db.query(`UPDATE images SET sha256 = 'abc' WHERE id = $1`, [first])
  await db.query(
    `INSERT INTO images (image_key, file_name, original_path, sha256, origin_image_id) VALUES ('mig_4', 'a.png', 'inbox/a2.png', 'abc', $1)`,
    [first],
  )
  const { rows } = await db.query(`SELECT image_key FROM images WHERE sha256 = 'abc' ORDER BY id`)
  assert.deepEqual(rows.map((r) => r.image_key), ['mig_1', 'mig_4'])
})

test('수정일시는 UPDATE 때 자동 갱신된다 (수정 컬럼이 있는 테이블)', async () => {
  for (const [table, set, where] of [
    ['users', `name = name || ''`, `email = 'admin@example.com'`],
    ['images', `error = 'x'`, `image_key = 'mig_1'`],
    ['rules', `enabled = enabled`, `name = 'score-threshold'`],
  ]) {
    await db.query(`UPDATE ${table} SET updated_at = now() - interval '1 day' WHERE ${where}`)
    // updated_at을 직접 과거로 돌려도 트리거가 now()로 덮어쓰므로, 한 번 더 수정해 확인
    const { rows } = await db.query(`UPDATE ${table} SET ${set} WHERE ${where} RETURNING now() - updated_at < interval '1 minute' AS fresh`)
    assert.equal(rows[0].fresh, true, table)
  }
})

test('integrations / ingest_batches: 종류·중복 이름 제약과 배치 연결', async () => {
  const integ = (
    await db.query(`INSERT INTO integrations (kind, name, config) VALUES ('FOLDER', '테스트 폴더', '{"watchDir":"inbox"}') RETURNING id, enabled`)
  ).rows[0]
  assert.equal(integ.enabled, true)
  await rejects(`INSERT INTO integrations (kind, name) VALUES ('FTP', 'x')`, [], /integrations_kind_check/)
  await rejects(`INSERT INTO integrations (kind, name) VALUES ('FOLDER', '테스트 폴더')`, [], /unique/)

  const batch = (await db.query(`INSERT INTO ingest_batches (integration_id, total_count) VALUES ($1, 3) RETURNING id, started_at`, [integ.id])).rows[0]
  assert.ok(batch.started_at)
  await db.query(`UPDATE images SET batch_id = $1 WHERE image_key = 'mig_1'`, [batch.id])
  await rejects(`INSERT INTO ingest_batches (integration_id, failed_count) VALUES ($1, -1)`, [integ.id], /check/)
})
