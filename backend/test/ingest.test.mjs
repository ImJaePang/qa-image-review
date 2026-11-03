// 파일 수신(scanOnce) → 추론(processOne) → 워커 한 주기(runCycle) 검증
// 임시 폴더 + 테스트 DB + 목/가짜 어댑터만 쓴다. 실제 모델·타이머는 필요 없다.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { resetTestDb } from './helpers.mjs'
import { scanOnce } from '../src/ingest/scan.mjs'
import { processOne, recoverStuck } from '../src/ingest/process.mjs'
import { runCycle } from '../src/ingest/cycle.mjs'
import { resolveFolderConfig } from '../src/ingest/folder-config.mjs'
import { detectImageType } from '../src/ingest/sniff.mjs'
import { createMockAdapter } from '../src/model/mock.mjs'
import sharp from 'sharp'
import { makeDerivatives } from '../src/ingest/derive.mjs'

pg.types.setTypeParser(20, Number)
pg.types.setTypeParser(1700, Number)

const FILES_DIR = process.env.FILES_DIR
let pool

before(async () => {
  await resetTestDb()
  pool = new pg.Pool({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  })
})
after(async () => pool.end())

// 테스트마다 수신 데이터와 규칙 변경을 비워 서로 영향을 주지 않게 한다
beforeEach(async () => {
  await pool.query(`DELETE FROM images WHERE batch_id IS NOT NULL`)
  await pool.query(`DELETE FROM ingest_batches`)
  await pool.query(`DELETE FROM integrations`)
  await pool.query(`DELETE FROM rules WHERE version > 1`)
  await pool.query(`UPDATE rules SET enabled = true`)
})

// ───────────── 도우미 ─────────────
const svg = (label) => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><text>${label}</text></svg>`

async function setup(configOverride = {}) {
  const root = mkdtempSync(join(FILES_DIR, 'ingest-'))
  const config = { ...configOverride }
  const integ = (await pool.query(`INSERT INTO integrations (kind, name, config) VALUES ('FOLDER', $1, $2) RETURNING id, config`, [`t-${Date.now()}-${Math.random()}`, config])).rows[0]
  const cfg = resolveFolderConfig(config, root)
  mkdirSync(cfg.watchDir, { recursive: true })
  const seen = new Map()
  const ctx = { pool, integration: { id: integ.id, config }, root, filesDir: FILES_DIR, seen }
  return {
    root,
    cfg,
    ctx,
    integ,
    drop: (name, content = svg(name)) => writeFileSync(join(cfg.watchDir, name), content),
    list: (dir) => (existsSync(dir) ? readdirSync(dir).sort() : []),
    /** 안정 판정 때문에 스캔은 두 번 필요하다: 첫 스캔은 기억만, 둘째 스캔에서 수신 */
    scan: async () => {
      await scanOnce(ctx)
      return scanOnce(ctx)
    },
    process: (adapter = createMockAdapter()) => processOne({ pool, adapter, root, filesDir: FILES_DIR }),
  }
}

/** 점수·박스를 지정하는 가짜 어댑터. scores를 호출 순서대로 하나씩 쓴다. */
function fixedAdapter(scores, { boxes = [], delayMs = 0 } = {}) {
  let i = 0
  return {
    modelVersion: 'fixed-v1',
    async infer({ imageKey, fileName }) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
      return { imageId: imageKey, fileName, width: 640, height: 480, modelVersion: 'fixed-v1', overallScore: scores[i++], heatmapUrl: `/heatmaps/${imageKey}.svg`, boxes, durationMs: 7 }
    },
  }
}

const img = async (key) => (await pool.query(`SELECT * FROM images WHERE image_key = $1`, [key])).rows[0]
const allImages = async () => (await pool.query(`SELECT * FROM images WHERE batch_id IS NOT NULL ORDER BY id`)).rows
const batchOf = async (id) => (await pool.query(`SELECT * FROM ingest_batches WHERE id = $1`, [id])).rows[0]

// ───────────── 설정 검증 / 매직바이트 ─────────────
test('연계 폴더 설정: 허용 루트 밖·절대 경로·중복 폴더는 거부한다', () => {
  const root = mkdtempSync(join(FILES_DIR, 'cfg-'))
  assert.throws(() => resolveFolderConfig({ watchDir: '../outside' }, root), /허용 루트 밖/)
  assert.throws(() => resolveFolderConfig({ watchDir: 'a/../../x' }, root), /허용 루트 밖/)
  assert.throws(() => resolveFolderConfig({ watchDir: '.' }, root), /허용 루트 밖|루트 자체/)
  assert.throws(() => resolveFolderConfig({ doneDir: root }, root), /절대 경로/)
  assert.throws(() => resolveFolderConfig({ doneDir: 'inbox' }, root), /서로 달라야/)
  assert.throws(() => resolveFolderConfig({ scanIntervalSec: 0 }, root), /scanIntervalSec/)
  assert.throws(() => resolveFolderConfig({ extensions: ['png'] }, root), /extensions/)
  assert.ok(resolveFolderConfig({}, root).watchDir.startsWith(root)) // 기본값은 통과
})

test('매직바이트: 확장자가 아니라 내용으로 이미지를 판별한다', () => {
  assert.equal(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'png')
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpeg')
  assert.equal(detectImageType(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1')), 'webp')
  assert.equal(detectImageType(Buffer.from(svg('x'))), 'svg')
  assert.equal(detectImageType(Buffer.from('<?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="x"/>')), 'svg')
  assert.equal(detectImageType(Buffer.from('hello world')), null)
  assert.equal(detectImageType(Buffer.from('<html><svg/></html>')), null) // svg가 문서 맨 앞이 아님
  assert.equal(detectImageType(Buffer.alloc(0)), null)
})

// ───────────── scanOnce ─────────────
test('scanOnce: 처음 본 파일은 수신하지 않고, 변하지 않은 채 다시 보이면 수신한다', async () => {
  const t = await setup()
  t.drop('a.svg')
  const first = await scanOnce(t.ctx)
  assert.equal(first.found, 0)
  assert.equal((await allImages()).length, 0)
  assert.deepEqual(t.list(t.cfg.watchDir), ['a.svg']) // 아직 안 옮김

  const second = await scanOnce(t.ctx)
  assert.equal(second.received, 1)
  const [row] = await allImages()
  assert.equal(row.ingest_status, 'PENDING')
  assert.equal(row.source_name, 'a.svg')
  assert.match(row.image_key, /^rcv_\d{6}$/)
  assert.match(row.sha256, /^[0-9a-f]{64}$/)
  assert.equal(row.origin_image_id, null)
  assert.equal(row.width, null) // 추론 전이라 크기 모름
  // 파일은 inbox → processing 으로 이동하고 이름은 image_key
  assert.deepEqual(t.list(t.cfg.watchDir), [])
  assert.deepEqual(t.list(t.cfg.processingDir), [`${row.image_key}.svg`])
  assert.ok(existsSync(join(FILES_DIR, row.original_path)))
  assert.equal(row.original_path, row.source_path)
})

test('scanOnce: 복사 중(크기가 계속 변하는) 파일은 멈출 때까지 수신하지 않는다', async () => {
  const t = await setup()
  t.drop('grow.svg', svg('v1'))
  await scanOnce(t.ctx)
  appendFileSync(join(t.cfg.watchDir, 'grow.svg'), ' ') // 스캔 사이에 크기가 변함
  assert.equal((await scanOnce(t.ctx)).found, 0)
  assert.equal((await allImages()).length, 0)
  assert.equal((await scanOnce(t.ctx)).received, 1) // 이제 안정
})

test('scanOnce: 확장자가 다른 파일, 하위 폴더, 심볼릭 링크는 무시한다', async () => {
  const t = await setup()
  t.drop('note.txt', 'hello')
  mkdirSync(join(t.cfg.watchDir, 'sub.svg')) // 폴더 이름이 확장자와 같아도 파일이 아님
  writeFileSync(join(t.root, 'real.svg'), svg('real'))
  let linked = true
  try {
    symlinkSync(join(t.root, 'real.svg'), join(t.cfg.watchDir, 'link.svg'))
  } catch {
    linked = false // Windows에서 권한이 없으면 링크를 만들 수 없다 (그 부분만 건너뜀)
  }
  const r = await t.scan()
  assert.equal(r.found, 0)
  assert.equal((await allImages()).length, 0)
  assert.ok(t.list(t.cfg.watchDir).includes('note.txt'))
  if (linked) assert.ok(existsSync(join(t.root, 'real.svg'))) // 링크를 따라가 원본을 옮기지 않음
})

test('scanOnce: 확장자만 이미지인 가짜 파일, 빈 파일, 크기 상한 초과는 failed로 보내고 FAILED로 기록한다', async () => {
  const t = await setup({ maxFileMB: 0.001 }) // 약 1KB
  t.drop('fake.png', 'this is not an image')
  t.drop('empty.png', '')
  t.drop('big.svg', svg('x'.repeat(2000)))
  t.drop('ok.svg', svg('ok'))
  const r = await t.scan()
  assert.deepEqual([r.received, r.failed], [1, 3])
  const rows = await allImages()
  const by = Object.fromEntries(rows.map((x) => [x.source_name, x]))
  assert.equal(by['fake.png'].ingest_status, 'FAILED')
  assert.match(by['fake.png'].error, /이미지 형식이 아님/)
  assert.match(by['empty.png'].error, /빈 파일/)
  assert.match(by['big.svg'].error, /너무 큼/)
  assert.equal(by['ok.svg'].ingest_status, 'PENDING')
  assert.equal(t.list(t.cfg.failedDir).length, 3)
  assert.equal(t.list(t.cfg.processingDir).length, 1)
  assert.deepEqual(t.list(t.cfg.watchDir), [])
  // 배치: 4건 중 3건이 이미 끝(실패), 1건이 추론 대기
  const b = await batchOf(r.batchId)
  assert.deepEqual([b.total_count, b.processed_count, b.failed_count, b.finished_at], [4, 3, 3, null])
})

test('scanOnce: 같은 이름의 다른 파일이 연달아 들어와도 덮어쓰지 않는다', async () => {
  const t = await setup()
  t.drop('same.svg', svg('first'))
  await t.scan()
  t.drop('same.svg', svg('second'))
  await t.scan()
  const rows = await allImages()
  assert.equal(rows.length, 2)
  assert.equal(new Set(rows.map((r) => r.image_key)).size, 2)
  assert.equal(t.list(t.cfg.processingDir).length, 2)
  assert.deepEqual(rows.map((r) => r.source_name), ['same.svg', 'same.svg']) // 원래 이름은 보존
  assert.equal(rows[1].origin_image_id, null) // 내용이 다르면 재수신이 아님
})

test('scanOnce: 같은 내용이 다시 들어오면 막지 않고 새 행으로 쌓되 처음 수신 행을 가리킨다 (이름이 달라도)', async () => {
  const t = await setup()
  t.drop('a.svg', svg('dup'))
  await t.scan()
  t.drop('renamed.svg', svg('dup'))
  await t.scan()
  t.drop('a.svg', svg('dup'))
  await t.scan()
  const [r1, r2, r3] = await allImages()
  assert.equal(r1.origin_image_id, null)
  assert.equal(r2.origin_image_id, r1.id)
  assert.equal(r3.origin_image_id, r1.id) // 사슬이 아니라 항상 처음 행
  assert.equal(r1.sha256, r2.sha256)
  assert.equal(t.list(t.cfg.processingDir).length, 3)
})

test('scanOnce: 한 번의 스캔에서 발견된 같은 내용 둘도 서로 연결된다', async () => {
  const t = await setup()
  t.drop('x1.svg', svg('same'))
  t.drop('x2.svg', svg('same'))
  const r = await t.scan()
  assert.equal(r.received, 2)
  const [a, b] = await allImages()
  assert.equal(b.origin_image_id, a.id)
})

test('scanOnce: 수신 배치는 스캔 1회의 파일 묶음이다 (파일이 없으면 만들지 않는다)', async () => {
  const t = await setup()
  await t.scan()
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM ingest_batches')).rows[0].n, 0)
  t.drop('a.svg')
  t.drop('b.svg')
  const r = await t.scan()
  const b = await batchOf(r.batchId)
  assert.deepEqual([b.total_count, b.processed_count, b.integration_id], [2, 0, t.integ.id])
  assert.equal((await allImages()).every((x) => x.batch_id === r.batchId), true)
})

// ───────────── processOne ─────────────
test('processOne: 대기가 없으면 IDLE', async () => {
  const t = await setup()
  assert.deepEqual(await t.process(), { status: 'IDLE' })
})

test('processOne: 성공하면 결과·판정(규칙 버전)·모델 버전을 저장하고 파일을 done으로 옮긴다', async () => {
  const t = await setup()
  t.drop('a.svg')
  const scanned = await t.scan()
  const boxes = [{ x: 10, y: 20, width: 100, height: 50, score: 0.3, reasonCode: 'TEXTURE_ANOMALY' }]
  const r = await t.process(fixedAdapter([0.3], { boxes }))
  assert.equal(r.status, 'DONE')

  const row = await img(r.imageKey)
  assert.equal(row.ingest_status, 'DONE')
  assert.deepEqual([row.width, row.height], [640, 480])
  assert.match(row.source_path, /done\/rcv_\d+\.svg$/)
  assert.equal(row.original_path, row.source_path)
  assert.ok(existsSync(join(FILES_DIR, row.original_path)))
  assert.deepEqual(t.list(t.cfg.processingDir), [])

  const run = (await pool.query(`SELECT * FROM model_runs WHERE image_id = $1`, [row.id])).rows[0]
  assert.deepEqual([run.model_version, run.overall_score, run.duration_ms], ['fixed-v1', 0.3, 7])
  const det = (await pool.query(`SELECT x, y, width, height, reason_code FROM detections WHERE run_id = $1`, [run.id])).rows
  assert.deepEqual(det, [{ x: 10, y: 20, width: 100, height: 50, reason_code: 'TEXTURE_ANOMALY' }])
  const v = (await pool.query(`SELECT v.result, v.reasons, r.version FROM verdicts v JOIN rules r ON r.id = v.rule_id WHERE v.run_id = $1`, [run.id])).rows[0]
  assert.deepEqual([v.result, v.reasons, v.version], ['DEFECT', ['TEXTURE_ANOMALY'], 1])

  // 마지막 한 건이 끝났으므로 배치도 끝난다
  const b = await batchOf(scanned.batchId)
  assert.deepEqual([b.processed_count, b.failed_count], [1, 0])
  assert.ok(b.finished_at)
})

test('processOne: 판정 경계값은 rules 테이블 임계값(0.9 / 0.5)을 따른다', async () => {
  const t = await setup()
  const cases = [[0.9, 'NORMAL'], [0.89, 'SUSPECT'], [0.5, 'SUSPECT'], [0.49, 'DEFECT']]
  cases.forEach(([s]) => t.drop(`s${s}.svg`, svg(`score ${s}`)))
  await t.scan()
  const adapter = fixedAdapter(cases.map(([s]) => s))
  for (const [score, expected] of cases) {
    const r = await t.process(adapter)
    const row = (await pool.query(
      `SELECT v.result FROM verdicts v JOIN model_runs m ON m.id = v.run_id JOIN images i ON i.id = m.image_id WHERE i.image_key = $1`, [r.imageKey])).rows[0]
    assert.equal(row.result, expected, `score ${score}`)
  }
})

test('processOne: 규칙 임계값을 바꾸면 코드 수정 없이 판정이 바뀌고, 새 규칙 버전이 기록된다', async () => {
  const t = await setup()
  await pool.query(`INSERT INTO rules (name, version, params) VALUES ('score-threshold', 2, '{"normalMin": 0.95, "suspectMin": 0.6}')`)
  t.drop('a.svg')
  await t.scan()
  const r = await t.process(fixedAdapter([0.92]))
  const v = (await pool.query(
    `SELECT v.result, r.version FROM verdicts v JOIN rules r ON r.id = v.rule_id JOIN model_runs m ON m.id = v.run_id JOIN images i ON i.id = m.image_id WHERE i.image_key = $1`, [r.imageKey])).rows[0]
  assert.deepEqual([v.result, v.version], ['SUSPECT', 2]) // v1이었다면 0.92는 NORMAL
})

test('processOne: 활성 규칙이 없으면 예외를 올리고 이미지는 대기로 남는다', async () => {
  const t = await setup()
  t.drop('a.svg')
  await t.scan()
  await pool.query(`UPDATE rules SET enabled = false`)
  await assert.rejects(t.process(), /활성 규칙 없음/)
  const [row] = await allImages()
  assert.equal(row.ingest_status, 'PENDING')
  assert.equal(t.list(t.cfg.processingDir).length, 1)
})

test('processOne: 어댑터 예외는 그 이미지만 FAILED로 만들고, 다음 이미지는 정상 처리한다', async () => {
  const t = await setup()
  t.drop('a.svg', svg('a'))
  t.drop('b.svg', svg('b'))
  const scanned = await t.scan()
  const flaky = {
    modelVersion: 'flaky',
    async infer(input) {
      if (input.fileName === 'a.svg') throw new Error('GPU out of memory')
      return fixedAdapter([0.95]).infer(input)
    },
  }
  const r1 = await t.process(flaky)
  const r2 = await t.process(flaky)
  assert.deepEqual([r1.status, r2.status], ['FAILED', 'DONE'])
  assert.match(r1.error, /GPU out of memory/)
  const a = await img(r1.imageKey)
  assert.equal(a.ingest_status, 'FAILED')
  assert.match(a.error, /GPU out of memory/)
  assert.match(a.source_path, /failed\/rcv_\d+\.svg$/)
  assert.ok(existsSync(join(FILES_DIR, a.source_path)))
  // 실패한 이미지는 추론 결과를 남기지 않는다
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM model_runs WHERE image_id = $1`, [a.id])).rows[0].n, 0)
  const b = await batchOf(scanned.batchId)
  assert.deepEqual([b.total_count, b.processed_count, b.failed_count], [2, 2, 1])
  assert.ok(b.finished_at)
})

test('processOne: 계약을 어긴 모델 출력은 저장하지 않고 FAILED 처리한다', async () => {
  const t = await setup()
  t.drop('a.svg')
  await t.scan()
  const bad = fixedAdapter([0.4], { boxes: [{ x: 600, y: 0, width: 100, height: 10, score: 0.4, reasonCode: 'TEXTURE_ANOMALY' }] }) // 640 폭 밖
  const r = await t.process(bad)
  assert.equal(r.status, 'FAILED')
  assert.match(r.error, /계약/)
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM model_runs`)).rows[0].n, 12) // 픽스처 12건뿐
})

test('processOne: 모델이 엉뚱한 imageId를 돌려주면 FAILED 처리한다', async () => {
  const t = await setup()
  t.drop('a.svg')
  await t.scan()
  const wrong = { modelVersion: 'x', infer: async (i) => ({ ...(await fixedAdapter([0.9]).infer(i)), imageId: 'other' }) }
  const r = await t.process(wrong)
  assert.equal(r.status, 'FAILED')
  assert.match(r.error, /imageId/)
})

test('processOne: 처리 중 파일이 사라져도 FAILED로 기록되고 큐가 멈추지 않는다', async () => {
  const t = await setup()
  t.drop('a.svg')
  await t.scan()
  const [row] = await allImages()
  const { rmSync } = await import('node:fs')
  rmSync(join(FILES_DIR, row.source_path))
  const r = await t.process() // 목 어댑터가 파일을 못 읽음
  assert.equal(r.status, 'FAILED')
  assert.match(r.error, /ENOENT/)
  assert.equal((await img(row.image_key)).ingest_status, 'FAILED')
})

test('processOne: 수신이 오래된 순서로 처리한다', async () => {
  const t = await setup()
  for (const n of ['c', 'a', 'b']) {
    t.drop(`${n}.svg`, svg(n))
    await t.scan() // 한 장씩 수신해 순서를 만든다
  }
  const order = []
  for (let i = 0; i < 3; i++) order.push((await img((await t.process(fixedAdapter([0.95, 0.95, 0.95]))).imageKey)).source_name)
  assert.deepEqual(order, ['c.svg', 'a.svg', 'b.svg'])
})

test('processOne: 동시에 두 번 불러도 같은 이미지를 두 번 처리하지 않는다', async () => {
  const t = await setup()
  t.drop('a.svg')
  await t.scan()
  const slow = fixedAdapter([0.95, 0.95], { delayMs: 50 })
  const results = await Promise.all([t.process(slow), t.process(slow)])
  assert.deepEqual(results.map((r) => r.status).sort(), ['DONE', 'IDLE'])
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM model_runs mr JOIN images i ON i.id = mr.image_id WHERE i.batch_id IS NOT NULL`)).rows[0].n, 1)
})

test('recoverStuck: 처리 중에 멈춘 건을 대기로 되돌리고, 다시 처리할 수 있다', async () => {
  const t = await setup()
  t.drop('a.svg')
  await t.scan()
  await pool.query(`UPDATE images SET ingest_status = 'PROCESSING' WHERE batch_id IS NOT NULL`) // 워커가 죽은 상황
  assert.deepEqual(await t.process(), { status: 'IDLE' }) // 처리 중으로 보이므로 집지 않는다
  assert.equal(await recoverStuck(pool), 1)
  assert.equal((await t.process(fixedAdapter([0.95]))).status, 'DONE')
  assert.equal(await recoverStuck(pool), 0)
})

// ───────────── runCycle (워커 한 주기) ─────────────
test('runCycle: 스캔 주기를 지키고, 수신된 이미지를 목 어댑터로 끝까지 처리한다', async () => {
  const t = await setup({ scanIntervalSec: 5 })
  for (const n of ['a', 'b', 'c']) t.drop(`${n}.svg`, svg(n))
  const state = { seen: new Map(), lastScan: new Map() }
  const base = { pool, adapter: createMockAdapter(), root: t.root, filesDir: FILES_DIR, state }

  const c1 = await runCycle({ ...base, now: 1_000_000 }) // 처음 본다
  assert.deepEqual([c1.scanned, c1.received, c1.done], [1, 0, 0])
  const c2 = await runCycle({ ...base, now: 1_002_000 }) // 2초 뒤: 주기(5초) 전이라 스캔 안 함
  assert.deepEqual([c2.scanned, c2.received, c2.done], [0, 0, 0])
  const c3 = await runCycle({ ...base, now: 1_005_000 }) // 5초 뒤: 스캔 → 수신 → 추론
  assert.deepEqual([c3.scanned, c3.received, c3.done, c3.failed], [1, 3, 3, 0])

  const rows = await allImages()
  assert.ok(rows.every((r) => r.ingest_status === 'DONE' && r.width === 640))
  for (const r of rows) assert.ok(existsSync(join(FILES_DIR, 'heatmaps', `${r.image_key}.svg`)))
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM verdicts v JOIN model_runs m ON m.id = v.run_id JOIN images i ON i.id = m.image_id WHERE i.batch_id IS NOT NULL`)).rows[0].n, 3)
})

test('runCycle: maxPerCycle만큼만 처리하고 나머지는 다음 주기로 넘긴다', async () => {
  const t = await setup()
  for (const n of ['a', 'b', 'c']) t.drop(`${n}.svg`, svg(n))
  await t.scan()
  const base = { pool, adapter: createMockAdapter(), root: t.root, filesDir: FILES_DIR, state: { seen: new Map(), lastScan: new Map() }, maxPerCycle: 2, now: 5_000_000 }
  assert.equal((await runCycle(base)).done, 2)
  assert.equal((await runCycle({ ...base, now: 5_000_100 })).done, 1)
})

test('runCycle: 꺼진 연계는 스캔하지 않고, 설정이 잘못된 연계는 오류로 기록할 뿐 다른 연계를 막지 않는다', async () => {
  const good = await setup()
  const off = await setup()
  const bad = await setup()
  await pool.query(`UPDATE integrations SET enabled = false WHERE id = $1`, [off.integ.id])
  await pool.query(`UPDATE integrations SET config = '{"watchDir":"../escape"}' WHERE id = $1`, [bad.integ.id])
  good.drop('g.svg')
  off.drop('o.svg')
  const state = { seen: new Map(), lastScan: new Map() }
  const base = { pool, adapter: createMockAdapter(), root: good.root, filesDir: FILES_DIR, state }
  await runCycle({ ...base, now: 1_000_000 })
  // good.root 기준으로 해석되므로 good의 폴더만 실제 스캔 대상이다 (각 연계의 root가 다르면 폴더가 없어 아무것도 못 찾음)
  const s = await runCycle({ ...base, now: 1_010_000 })
  assert.ok(s.errors.some((e) => /허용 루트 밖/.test(e)))
  assert.equal(s.received, 1)
  assert.deepEqual(off.list(off.cfg.watchDir), ['o.svg']) // 꺼진 연계의 파일은 그대로
})

// ───────────── 썸네일·미리보기 사본 (④) ─────────────
const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: '#6a7b5c' } }).png().toBuffer()

test('사본 생성: 비율을 유지해 줄이고, 작은 이미지는 키우지 않는다', async () => {
  const dir = mkdtempSync(join(FILES_DIR, 'derive-'))
  const big = join(dir, 'big.png')
  const small = join(dir, 'small.png')
  writeFileSync(big, await png(4000, 2000))
  writeFileSync(small, await png(100, 50))

  const b = await makeDerivatives({ srcAbs: big, filesDir: FILES_DIR, imageKey: 'dv_big' })
  const bp = await sharp(join(FILES_DIR, b.previewPath)).metadata()
  const bt = await sharp(join(FILES_DIR, b.thumbPath)).metadata()
  assert.deepEqual([bp.format, bp.width, bp.height], ['webp', 2560, 1280])
  assert.deepEqual([bt.width, bt.height], [320, 160]) // 2:1 비율 유지 (박스 오버레이가 어긋나지 않게)

  const s = await makeDerivatives({ srcAbs: small, filesDir: FILES_DIR, imageKey: 'dv_small' })
  const sp = await sharp(join(FILES_DIR, s.previewPath)).metadata()
  assert.deepEqual([sp.width, sp.height], [100, 50])
})

test('사본 생성: 디코딩할 수 없는 파일은 null을 돌려주고 흔적을 남기지 않는다', async () => {
  const dir = mkdtempSync(join(FILES_DIR, 'derive-'))
  const bad = join(dir, 'bad.png')
  writeFileSync(bad, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('garbage')]))
  assert.equal(await makeDerivatives({ srcAbs: bad, filesDir: FILES_DIR, imageKey: 'dv_bad' }), null)
  assert.equal(existsSync(join(FILES_DIR, 'derived', 'thumb', 'dv_bad.webp')), false)
  assert.equal(existsSync(join(FILES_DIR, 'derived', 'preview', 'dv_bad.webp')), false)
})

test('processOne: 수신 완료 시 thumb_path/preview_path가 채워지고 원본은 그대로다', async () => {
  const t = await setup()
  const content = await png(1600, 900)
  t.drop('a.png', content)
  await t.scan()
  const r = await t.process(fixedAdapter([0.95]))
  assert.equal(r.status, 'DONE')
  assert.equal(r.derived, true)
  const row = (await allImages())[0]
  assert.match(row.thumb_path, /^derived\/thumb\/.+\.webp$/)
  assert.match(row.preview_path, /^derived\/preview\/.+\.webp$/)
  assert.ok(existsSync(join(FILES_DIR, row.thumb_path)) && existsSync(join(FILES_DIR, row.preview_path)))
  assert.deepEqual(await sharp(join(FILES_DIR, row.original_path)).metadata().then((m) => [m.width, m.height]), [1600, 900])
})

test('processOne: 사본 생성이 실패해도 수신은 성공하고 경로는 비워 둔다 (원본으로 대체 서빙)', async () => {
  const t = await setup()
  t.drop('b.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('garbage-bytes')]))
  await t.scan()
  const r = await t.process(fixedAdapter([0.95]))
  assert.equal(r.status, 'DONE')
  assert.equal(r.derived, false)
  const row = (await allImages())[0]
  assert.equal(row.ingest_status, 'DONE')
  assert.equal(row.thumb_path, null)
  assert.equal(row.preview_path, null)
})
