// 워커 단일 실행 잠금과 시작 시 정리(고아 파일 복구, PROCESSING 되돌리기) 검증
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import pg from 'pg'
import { resetTestDb } from './helpers.mjs'
import { acquireWorkerLock } from '../src/ingest/lock.mjs'
import { recoverOnStart } from '../src/ingest/recover.mjs'
import { scanOnce } from '../src/ingest/scan.mjs'
import { processOne } from '../src/ingest/process.mjs'
import { resolveFolderConfig } from '../src/ingest/folder-config.mjs'
import { createMockAdapter } from '../src/model/mock.mjs'

pg.types.setTypeParser(20, Number)

const FILES_DIR = process.env.FILES_DIR
const dbConf = () => ({
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
})
let pool

before(async () => {
  await resetTestDb()
  pool = new pg.Pool(dbConf())
})
after(async () => pool.end())
beforeEach(async () => {
  await pool.query(`DELETE FROM images WHERE batch_id IS NOT NULL OR image_key LIKE 'rcv_%'`)
  await pool.query(`DELETE FROM ingest_batches`)
  await pool.query(`DELETE FROM integrations`)
})

const svg = (label) => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><text>${label}</text></svg>`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ───────────── 단일 워커 잠금 ─────────────
test('잠금: 첫 워커만 얻고, 둘째는 얻지 못한다', async () => {
  const poolA = new pg.Pool(dbConf())
  const poolB = new pg.Pool(dbConf())
  try {
    const a = await acquireWorkerLock(poolA)
    const b = await acquireWorkerLock(poolB)
    assert.equal(a.acquired, true)
    assert.equal(b.acquired, false)
    await a.release()
  } finally {
    await poolA.end()
    await poolB.end()
  }
})

test('잠금: 첫 워커가 정상 종료(release)하면 다른 워커가 얻을 수 있고, 다시 하나만 유지된다', async () => {
  const poolA = new pg.Pool(dbConf())
  const poolB = new pg.Pool(dbConf())
  const poolC = new pg.Pool(dbConf())
  try {
    const a = await acquireWorkerLock(poolA)
    await a.release()
    const b = await acquireWorkerLock(poolB)
    assert.equal(b.acquired, true)
    assert.equal((await acquireWorkerLock(poolC)).acquired, false)
    await b.release()
  } finally {
    await Promise.all([poolA.end(), poolB.end(), poolC.end()])
  }
})

test('잠금: 워커 연결이 끊기면(프로세스 사망) DB가 잠금을 풀고, 잠금을 잃었다고 알려 준다', async () => {
  const poolA = new pg.Pool(dbConf())
  const poolB = new pg.Pool(dbConf())
  try {
    let lostWith = null
    const a = await acquireWorkerLock(poolA, { onLost: (e) => (lostWith = e) })
    assert.equal(a.acquired, true)
    // 서버 쪽에서 그 연결을 강제로 끊는다 (워커가 죽은 상황)
    const { rows } = await pool.query(
      `SELECT pg_terminate_backend(l.pid) FROM pg_locks l
        WHERE l.locktype = 'advisory' AND l.granted AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())`, // 이 테스트 DB의 연결만
    )
    assert.ok(rows.length >= 1)
    await sleep(300)
    assert.ok(lostWith, '잠금을 잃었다는 알림이 와야 함')
    const b = await acquireWorkerLock(poolB)
    assert.equal(b.acquired, true) // 죽은 워커의 잠금이 남아 있지 않다
    await b.release()
  } finally {
    await Promise.all([poolA.end().catch(() => {}), poolB.end()])
  }
})

test('워커 프로세스: 두 번째로 띄운 워커는 안내를 남기고 종료 코드 1로 끝난다', async () => {
  const env = { ...process.env, MODEL_ADAPTER: 'mock', INGEST_ROOT: mkdtempSync(join(FILES_DIR, 'wk-')) }
  const run = () => spawn(process.execPath, ['src/worker.mjs'], { cwd: resolve(import.meta.dirname, '..'), env })
  const first = run()
  let out1 = ''
  first.stdout.on('data', (d) => (out1 += d))
  first.stderr.on('data', (d) => (out1 += d))
  try {
    for (let i = 0; i < 100 && !out1.includes('워커 시작'); i++) await sleep(100)
    assert.match(out1, /워커 시작/)

    const second = run()
    let out2 = ''
    second.stdout.on('data', (d) => (out2 += d))
    second.stderr.on('data', (d) => (out2 += d))
    // 잠금이 깨져 있으면 두 번째 워커가 계속 살아 있으므로, 기다리다 실패로 끝나게 한다 (테스트가 멈추지 않도록)
    const code = await Promise.race([
      new Promise((res) => second.on('exit', res)),
      sleep(8000).then(() => (second.kill(), 'TIMEOUT')),
    ])
    assert.equal(code, 1, '두 번째 워커가 종료하지 않음')
    assert.match(out2, /이미 다른 워커가 실행 중/)
    assert.doesNotMatch(out1, /이미 다른 워커/) // 첫 워커는 영향 없음
    assert.equal(first.exitCode, null) // 첫 워커는 계속 실행 중
  } finally {
    first.kill()
    await new Promise((res) => (first.exitCode !== null ? res() : first.on('exit', res)))
  }
})

// ───────────── 시작 시 정리 ─────────────
async function setup(config = {}) {
  const root = mkdtempSync(join(FILES_DIR, 'rec-'))
  const integ = (await pool.query(`INSERT INTO integrations (kind, name, config) VALUES ('FOLDER', $1, $2) RETURNING id`, [`r-${Math.random()}`, config])).rows[0]
  const cfg = resolveFolderConfig(config, root)
  for (const d of [cfg.watchDir, cfg.processingDir, cfg.doneDir, cfg.failedDir]) mkdirSync(d, { recursive: true })
  return { root, cfg, integ, list: (d) => readdirSync(d).sort() }
}

test('정리: processing에 있는데 DB에 행이 없는 파일(고아)만 감시 폴더로 되돌린다', async () => {
  const t = await setup()
  // 정상 수신된 파일 1개 (행 있음)
  writeFileSync(join(t.cfg.watchDir, 'a.svg'), svg('a'))
  const ctx = { pool, integration: { id: t.integ.id, config: {} }, root: t.root, filesDir: FILES_DIR, seen: new Map() }
  await scanOnce(ctx)
  await scanOnce(ctx)
  const [known] = t.list(t.cfg.processingDir)
  // 수신 직후 COMMIT 전에 죽은 상황: 파일은 processing에 있으나 행은 없음
  writeFileSync(join(t.cfg.processingDir, 'rcv_999991.png'), 'orphan-1')
  writeFileSync(join(t.cfg.processingDir, 'rcv_999992.svg'), svg('orphan-2'))
  mkdirSync(join(t.cfg.processingDir, 'subdir')) // 폴더는 건드리지 않음

  const r = await recoverOnStart({ pool, root: t.root })
  assert.equal(r.orphans.length, 2)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(t.list(t.cfg.watchDir), ['rcv_999991.png', 'rcv_999992.svg'])
  assert.deepEqual(t.list(t.cfg.processingDir).filter((n) => n !== 'subdir'), [known]) // 행 있는 파일은 그대로
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM images WHERE batch_id IS NOT NULL`)).rows[0].n, 1)
})

test('정리: 되돌린 고아 파일은 다음 스캔에서 다시 수신되어 끝까지 처리된다', async () => {
  const t = await setup()
  writeFileSync(join(t.cfg.processingDir, 'rcv_999993.svg'), svg('lost'))
  await recoverOnStart({ pool, root: t.root })
  const ctx = { pool, integration: { id: t.integ.id, config: {} }, root: t.root, filesDir: FILES_DIR, seen: new Map() }
  await scanOnce(ctx)
  const scanned = await scanOnce(ctx)
  assert.equal(scanned.received, 1)
  const r = await processOne({ pool, adapter: createMockAdapter(), root: t.root, filesDir: FILES_DIR })
  assert.equal(r.status, 'DONE')
})

test('정리: 감시 폴더에 같은 이름이 이미 있으면 덮어쓰지 않고 이름을 바꿔 둔다', async () => {
  const t = await setup()
  writeFileSync(join(t.cfg.watchDir, 'rcv_999994.svg'), svg('existing'))
  writeFileSync(join(t.cfg.processingDir, 'rcv_999994.svg'), svg('orphan'))
  const r = await recoverOnStart({ pool, root: t.root })
  assert.equal(r.orphans.length, 1)
  assert.deepEqual(t.list(t.cfg.watchDir), ['rcv_999994-2.svg', 'rcv_999994.svg'])
  assert.match(readFileSync(join(t.cfg.watchDir, 'rcv_999994.svg'), 'utf8'), /existing/)
})

test('정리: PROCESSING에 멈춘 이미지는 PENDING으로 되돌아가고, 이미 끝난 이미지는 그대로다', async () => {
  const t = await setup()
  for (const n of ['a', 'b']) writeFileSync(join(t.cfg.watchDir, `${n}.svg`), svg(n))
  const ctx = { pool, integration: { id: t.integ.id, config: {} }, root: t.root, filesDir: FILES_DIR, seen: new Map() }
  await scanOnce(ctx)
  await scanOnce(ctx)
  await processOne({ pool, adapter: createMockAdapter(), root: t.root, filesDir: FILES_DIR }) // 한 장은 DONE
  await pool.query(`UPDATE images SET ingest_status = 'PROCESSING' WHERE ingest_status = 'PENDING' AND batch_id IS NOT NULL`)
  const r = await recoverOnStart({ pool, root: t.root })
  assert.equal(r.resetToPending, 1)
  const states = (await pool.query(`SELECT ingest_status FROM images WHERE batch_id IS NOT NULL ORDER BY id`)).rows.map((x) => x.ingest_status)
  assert.deepEqual(states, ['DONE', 'PENDING'])
})

test('정리: 폴더가 아직 없거나 설정이 잘못된 연계가 있어도 다른 연계는 정리한다', async () => {
  const good = await setup()
  const noDirs = await setup()
  const bad = await setup()
  rmSync(noDirs.cfg.processingDir, { recursive: true }) // 한 번도 스캔 전이라 폴더가 없는 상황
  await pool.query(`UPDATE integrations SET config = '{"processingDir":"../escape"}' WHERE id = $1`, [bad.integ.id])
  writeFileSync(join(good.cfg.processingDir, 'rcv_999995.svg'), svg('o'))
  const r = await recoverOnStart({ pool, root: good.root })
  assert.equal(r.orphans.length, 1)
  assert.equal(r.errors.length, 1)
  assert.match(r.errors[0], /허용 루트 밖/)
})

test('정리: 수천 장이 있어도 행이 있는 파일은 건드리지 않고 고아만 정확히 찾는다 (쿼리 1회)', async () => {
  const t = await setup()
  const N = 3000
  await pool.query(
    `INSERT INTO images (image_key, file_name, original_path, source_name, ingest_status, batch_id)
     SELECT 'rcv_' || lpad(g::text, 6, '0'), 'f.svg', 'x', 'f.svg', 'PENDING', NULL FROM generate_series(100000, 100000 + $1 - 1) g`,
    [N],
  )
  for (let g = 100000; g < 100000 + N; g++) writeFileSync(join(t.cfg.processingDir, `rcv_${g}.svg`), 'x')
  for (const g of [1, 2, 3]) writeFileSync(join(t.cfg.processingDir, `rcv_90000${g}.svg`), 'x')
  const started = Date.now()
  const r = await recoverOnStart({ pool, root: t.root })
  assert.equal(r.orphans.length, 3)
  assert.equal(t.list(t.cfg.processingDir).length, N)
  assert.ok(Date.now() - started < 5000, `너무 느림: ${Date.now() - started}ms`)
})
