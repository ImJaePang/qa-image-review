// 연계 관리 API 테스트: 접근 제어, 설정 검증(허용 루트·폴더 겹침), 변경 이력, 요약 건수, 실패 건 재시도.
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { call, loginAs, resetTestDb, startApp } from './helpers.mjs'

let app, admin, qa1, pool, config
const api = (method, url, who, body) => call(app, method, url, who, body)
const cfgOf = (base, extra = {}) => ({ watchDir: `${base}/inbox`, processingDir: `${base}/processing`, doneDir: `${base}/done`, failedDir: `${base}/failed`, ...extra })

before(async () => {
  await resetTestDb()
  app = await startApp()
  ;({ pool } = await import('../src/db.mjs'))
  ;({ config } = await import('../src/config.mjs'))
  admin = (await loginAs(app, 'admin@example.com')).headers
  qa1 = (await loginAs(app, 'qa1@example.com')).headers
})
after(async () => {
  await app?.close()
})

describe('접근 제어', () => {
  test('로그인 없이 401, QA는 403, 관리자는 200', async () => {
    assert.equal((await api('GET', '/api/integrations')).status, 401)
    assert.equal((await api('GET', '/api/integrations', qa1)).status, 403)
    assert.equal((await api('POST', '/api/integrations', qa1, { name: 'x' })).status, 403)
    assert.equal((await api('POST', '/api/integrations', qa1, {})).status, 403) // 잘못된 본문이어도 권한이 먼저 (400이 아님)
    assert.equal((await api('PATCH', '/api/integrations/1', qa1, { enabled: false })).status, 403)
    assert.equal((await api('POST', '/api/integrations/1/retry', qa1)).status, 403)
    const r = await api('GET', '/api/integrations', admin)
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.items, [])
    assert.equal(r.body.root, config.ingestRoot)
    assert.equal(r.body.defaults.scanIntervalSec, 5)
  })
})

describe('추가와 설정 검증', () => {
  test('이름만 주면 기본 설정으로 만들어지고 이력에 CREATE가 남는다', async () => {
    const r = await api('POST', '/api/integrations', admin, { name: '기본', config: cfgOf('a') })
    assert.equal(r.status, 201)
    assert.equal(r.body.enabled, true)
    assert.equal(r.body.config.watchDir, 'a/inbox')
    assert.equal(r.body.config.maxFileMB, 50) // 안 준 항목은 기본값
    assert.deepEqual(r.body.counts, { pending: 0, processing: 0, done: 0, failed: 0 })
    assert.equal(r.body.lastReceivedAt, null)
    const h = (await api('GET', `/api/integrations/${r.body.id}/history`, admin)).body.items
    assert.deepEqual(h.map((x) => [x.action, x.actor]), [['CREATE', '관리자']])
  })

  test('같은 이름은 409', async () => {
    const r = await api('POST', '/api/integrations', admin, { name: '기본', config: cfgOf('b') })
    assert.equal(r.status, 409)
  })

  test('허용 루트 밖(.. / 절대 경로 / 루트 자체)과 잘못된 값은 400', async () => {
    const bad = (config) => api('POST', '/api/integrations', admin, { name: `bad-${Math.random()}`, config })
    assert.equal((await bad(cfgOf('c', { watchDir: '../escape' }))).status, 400)
    assert.equal((await bad(cfgOf('c', { watchDir: process.platform === 'win32' ? 'C:\\Windows' : '/etc' }))).status, 400)
    assert.equal((await bad(cfgOf('c', { watchDir: '.' }))).status, 400)
    assert.equal((await bad(cfgOf('c', { doneDir: 'c/inbox' }))).status, 400) // 한 연계 안에서 폴더가 같음
    assert.equal((await bad(cfgOf('c', { extensions: ['png'] }))).status, 400) // 점이 없음
    assert.equal((await bad(cfgOf('c', { scanIntervalSec: 0 }))).status, 400)
    assert.equal((await bad(cfgOf('c', { maxFileMB: -1 }))).status, 400)
    assert.equal((await bad({ ...cfgOf('c'), unknownKey: 1 })).status, 400) // 모르는 설정 항목
    assert.equal((await api('POST', '/api/integrations', admin, { name: '   ', config: cfgOf('c') })).status, 400)
    assert.equal((await api('POST', '/api/integrations', admin, { name: 'k', kind: 'DB' })).status, 400)
  })

  test('다른 연계가 쓰는 폴더와 겹치면 409', async () => {
    // 'a/done'을 내 감시 폴더로 쓰려는 시도 (기본 연계의 완료 폴더)
    const r = await api('POST', '/api/integrations', admin, { name: '겹침', config: cfgOf('d', { watchDir: 'a/done' }) })
    assert.equal(r.status, 409)
    assert.match(r.body.message, /기본/)
  })
})

describe('수정과 이력', () => {
  let id

  before(async () => {
    id = (await api('POST', '/api/integrations', admin, { name: '수정 대상', config: cfgOf('e') })).body.id
  })
  const history = async () => (await api('GET', `/api/integrations/${id}/history`, admin)).body.items

  test('바뀐 항목만 이력에 남는다 (이전 값 → 바뀐 값, 누가)', async () => {
    const r = await api('PATCH', `/api/integrations/${id}`, admin, { config: { scanIntervalSec: 30, extensions: ['.png'] } })
    assert.equal(r.status, 200)
    assert.equal(r.body.config.scanIntervalSec, 30)
    assert.equal(r.body.config.watchDir, 'e/inbox') // 보내지 않은 항목은 유지
    const top = (await history())[0]
    assert.equal(top.action, 'UPDATE')
    assert.deepEqual(top.changes.config.scanIntervalSec, { from: 5, to: 30 })
    assert.deepEqual(top.changes.config.extensions.to, ['.png'])
    assert.equal(top.changes.config.watchDir, undefined)
  })

  test('바뀐 것이 없으면 이력을 남기지 않는다', async () => {
    const before = (await history()).length
    const r = await api('PATCH', `/api/integrations/${id}`, admin, { name: '수정 대상', config: { scanIntervalSec: 30 } })
    assert.equal(r.status, 200)
    assert.equal((await history()).length, before)
  })

  test('끄기/켜기는 DISABLE/ENABLE로 남고, 꺼진 연계는 워커 주기에서 스캔하지 않는다', async () => {
    await api('PATCH', `/api/integrations/${id}`, admin, { enabled: false })
    assert.equal((await history())[0].action, 'DISABLE')

    const { runCycle } = await import('../src/ingest/cycle.mjs')
    const ctx = { pool, adapter: null, root: config.ingestRoot, filesDir: config.filesDir, state: { seen: new Map(), lastScan: new Map() } }
    // 이 시점에 켜진 연계는 '기본'뿐이다
    const off = await runCycle({ ...ctx, now: 1_000_000 })
    assert.equal(off.scanned, 1)
    await api('PATCH', `/api/integrations/${id}`, admin, { enabled: true })
    assert.equal((await history())[0].action, 'ENABLE')
    const on = await runCycle({ ...ctx, now: 2_000_000 })
    assert.equal(on.scanned, 2)
    assert.equal(existsSync(join(config.ingestRoot, 'e/inbox')), true) // 켜지면 폴더가 만들어진다
  })

  test('이름 중복 409, 폴더 겹침 409, 잘못된 값 400, 없는 연계 404, 빈 본문 400', async () => {
    assert.equal((await api('PATCH', `/api/integrations/${id}`, admin, { name: '기본' })).status, 409)
    assert.equal((await api('PATCH', `/api/integrations/${id}`, admin, { config: { watchDir: 'a/failed' } })).status, 409)
    assert.equal((await api('PATCH', `/api/integrations/${id}`, admin, { config: { watchDir: '../x' } })).status, 400)
    assert.equal((await api('PATCH', '/api/integrations/9999', admin, { enabled: false })).status, 404)
    assert.equal((await api('PATCH', `/api/integrations/${id}`, admin, {})).status, 400)
    // 실패한 변경은 값도 이력도 바꾸지 않는다
    const cur = (await api('GET', '/api/integrations', admin)).body.items.find((x) => x.id === id)
    assert.equal(cur.config.watchDir, 'e/inbox')
  })

  test('자기 자신의 폴더는 그대로 두고 다른 항목만 바꿔도 겹침으로 보지 않는다', async () => {
    const r = await api('PATCH', `/api/integrations/${id}`, admin, { config: { maxFileMB: 10 } })
    assert.equal(r.status, 200)
  })
})

describe('요약 건수와 실패 건 재시도', () => {
  let id, batchOld
  const failedDir = () => join(config.ingestRoot, 'f/failed')
  const processingDir = () => join(config.ingestRoot, 'f/processing')

  async function addImage({ key, status, withFile, sourcePath, error = null }) {
    const rel = sourcePath ?? `ingest/f/failed/${key}.png`
    if (withFile) writeFileSync(join(config.filesDir, rel), 'not-really-a-png')
    await pool.query(
      `INSERT INTO images (image_key, file_name, source_name, original_path, source_path, ingest_status, error, batch_id, width, height)
       VALUES ($1, $1 || '.png', $1 || '.png', $2, $2, $3, $4, $5, CASE WHEN $3 = 'DONE' THEN 100 END, CASE WHEN $3 = 'DONE' THEN 100 END)`,
      [key, rel, status, error, batchOld],
    )
  }

  before(async () => {
    id = (await api('POST', '/api/integrations', admin, { name: '재시도 연계', config: cfgOf('f') })).body.id
    mkdirSync(failedDir(), { recursive: true })
    batchOld = (await pool.query('INSERT INTO ingest_batches (integration_id, total_count, processed_count, failed_count, finished_at) VALUES ($1, 5, 5, 3, now()) RETURNING id', [id])).rows[0].id
    await addImage({ key: 'rf_ok', status: 'FAILED', withFile: true, error: '모델 오류' })
    await addImage({ key: 'rf_nofile', status: 'FAILED', withFile: false, error: '파일 없음 케이스' })
    // 실패 폴더 밖을 가리키는 행: 재시도가 엉뚱한 파일을 옮기면 안 된다
    await addImage({ key: 'rf_escape', status: 'FAILED', withFile: false, sourcePath: 'secret.txt', error: '이상한 경로' })
    await addImage({ key: 'rf_done', status: 'DONE', withFile: false, sourcePath: 'ingest/f/done/x.png' })
    await addImage({ key: 'rf_pending', status: 'PENDING', withFile: false, sourcePath: 'ingest/f/processing/y.png' })
  })

  test('연계별 건수와 마지막 수신 시각', async () => {
    const it = (await api('GET', '/api/integrations', admin)).body.items.find((x) => x.id === id)
    assert.deepEqual(it.counts, { pending: 1, processing: 0, done: 1, failed: 3 })
    assert.ok(it.lastReceivedAt)
  })

  test('실패 목록은 이 연계의 FAILED만 사유와 함께', async () => {
    const r = (await api('GET', `/api/integrations/${id}/failed`, admin)).body.items
    assert.deepEqual(r.map((x) => x.imageKey).sort(), ['rf_escape', 'rf_nofile', 'rf_ok'])
    assert.equal(r.find((x) => x.imageKey === 'rf_ok').error, '모델 오류')
  })

  test('재시도: 파일이 실패 폴더에 있는 건만 대기로 되돌리고 새 배치로 묶는다. 나머지는 사유와 함께 건너뛴다', async () => {
    const r = await api('POST', `/api/integrations/${id}/retry`, admin)
    assert.equal(r.status, 200)
    assert.equal(r.body.retried, 1)
    assert.deepEqual(r.body.skipped.map((s) => s.imageKey).sort(), ['rf_escape', 'rf_nofile'])

    const row = (await pool.query(`SELECT ingest_status, error, source_path, batch_id FROM images WHERE image_key = 'rf_ok'`)).rows[0]
    assert.equal(row.ingest_status, 'PENDING')
    assert.equal(row.error, null)
    assert.equal(row.source_path, 'ingest/f/processing/rf_ok.png')
    assert.notEqual(row.batch_id, batchOld)
    assert.equal(existsSync(join(processingDir(), 'rf_ok.png')), true)
    assert.equal(existsSync(join(failedDir(), 'rf_ok.png')), false)
    assert.equal(existsSync(join(config.filesDir, 'secret.txt')), true) // 폴더 밖 파일은 그대로

    const nb = (await pool.query('SELECT total_count, processed_count FROM ingest_batches WHERE id = $1', [row.batch_id])).rows[0]
    assert.deepEqual(nb, { total_count: 1, processed_count: 0 })
    const old = (await pool.query('SELECT failed_count FROM ingest_batches WHERE id = $1', [batchOld])).rows[0]
    assert.equal(old.failed_count, 3) // 옛 실패 기록은 그대로
    assert.equal((await api('GET', `/api/integrations/${id}/history`, admin)).body.items[0].action, 'RETRY')
  })

  test('다시 재시도하면 건너뛰는 것만 남고 새 배치는 만들지 않는다', async () => {
    const batches = (await pool.query('SELECT count(*)::int AS n FROM ingest_batches WHERE integration_id = $1', [id])).rows[0].n
    const r = await api('POST', `/api/integrations/${id}/retry`, admin)
    assert.equal(r.body.retried, 0)
    assert.equal(r.body.batchId, null)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM ingest_batches WHERE integration_id = $1', [id])).rows[0].n, batches)
  })
})
