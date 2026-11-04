// 이미지 업로드 API 테스트: 배치·파일 기록, 검사(확장자·내용·크기), 수신 폴더 반입, 스캔 후 처리 현황 연결, 권한.
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { call, loginAs, resetTestDb, startApp } from './helpers.mjs'

let app, admin, qa1, researcher, pool, config, root, scanOnce, inbox
const api = (method, url, who, body) => call(app, method, url, who, body)
const png = (n = 1) => sharp({ create: { width: 64 + n, height: 48, channels: 3, background: { r: 30, g: 120, b: 40 } } }).png().toBuffer()

/** 파일 1장 올리기 (본문 = 원본 바이트) */
const put = async (who, batchId, name, buf) => {
  const res = await app.inject({
    method: 'PUT',
    url: `/api/uploads/${batchId}/files?name=${encodeURIComponent(name)}`,
    headers: { ...who, 'content-type': 'application/octet-stream' },
    payload: buf,
  })
  return { status: res.statusCode, body: JSON.parse(res.body) }
}
const start = async (who, n) => (await api('POST', '/api/uploads', who, { expectedCount: n })).body.batch.id

before(async () => {
  await resetTestDb()
  app = await startApp()
  ;({ pool } = await import('../src/db.mjs'))
  ;({ config } = await import('../src/config.mjs'))
  ;({ scanOnce } = await import('../src/ingest/scan.mjs'))
  root = config.ingestRoot
  inbox = join(root, 'inbox')
  await pool.query(`INSERT INTO integrations (kind, name, config) VALUES ('FOLDER', '업로드 테스트', '{}')`)
  await pool.query(`UPDATE users SET role = 'researcher' WHERE email = 'qa3@example.com'`)
  admin = (await loginAs(app, 'admin@example.com')).headers
  qa1 = (await loginAs(app, 'qa1@example.com')).headers
  researcher = (await loginAs(app, 'qa3@example.com')).headers
})
after(async () => app?.close())

describe('이미지 업로드', () => {
  test('image.upload 권한이 없으면(QA) 모두 403, 연구원·관리자는 가능', async () => {
    assert.equal((await api('POST', '/api/uploads', qa1, { expectedCount: 1 })).status, 403)
    assert.equal((await api('GET', '/api/uploads', qa1)).status, 403)
    assert.equal((await api('POST', '/api/uploads', researcher, { expectedCount: 1 })).status, 201)
    assert.equal((await api('POST', '/api/uploads', admin, { expectedCount: 1 })).status, 201)
  })

  test('메뉴: 데이터 > 이미지 아래에 이미지 업로드가 연구원·관리자에게만 보인다', async () => {
    const paths = (r) => r.body.menus.flatMap((t) => t.groups.flatMap((g) => g.items.map((i) => i.path)))
    assert.ok(paths(await api('GET', '/api/menus/mine', researcher)).includes('/data/upload'))
    assert.ok(!paths(await api('GET', '/api/menus/mine', qa1)).includes('/data/upload'))
  })

  test('배치 만들기: 장수 검증(0장·상한 초과 거부), 수천 장도 선언할 수 있다', async () => {
    assert.equal((await api('POST', '/api/uploads', researcher, { expectedCount: 0 })).status, 400)
    assert.equal((await api('POST', '/api/uploads', researcher, { expectedCount: config.uploadMaxBatchFiles + 1 })).status, 400)
    const ok = await api('POST', '/api/uploads', researcher, { expectedCount: 3000, memo: '대량 시험' })
    assert.equal(ok.status, 201)
    assert.equal(ok.body.limits.maxBatchFiles, config.uploadMaxBatchFiles)
    assert.ok(ok.body.limits.extensions.includes('.png'))
  })

  test('파일 올리기: 수신 폴더에 안전한 이름으로 들어가고 기록된다, 같은 이름도 충돌하지 않는다', async () => {
    const id = await start(researcher, 3)
    const a = await put(researcher, id, '탱크 사진 (1).png', await png(1))
    const b = await put(researcher, id, '탱크 사진 (1).png', await png(2)) // 같은 이름
    assert.equal(a.body.file.status, 'RECEIVED')
    assert.equal(b.body.file.status, 'RECEIVED')
    const rows = (await pool.query(`SELECT original_name, stored_name, size_bytes, sha256 FROM upload_files WHERE batch_id = $1 ORDER BY id`, [id])).rows
    assert.equal(rows.length, 2)
    assert.notEqual(rows[0].stored_name, rows[1].stored_name)
    assert.match(rows[0].stored_name, /^up\d+__[^/\\]+\.png$/)
    assert.equal(rows[0].original_name, '탱크 사진 (1).png') // 화면 표시용 원래 이름은 그대로
    assert.ok(existsSync(join(inbox, rows[0].stored_name)))
    assert.equal(rows[0].sha256.length, 64)
    assert.ok(!readdirSync(inbox).some((n) => n.endsWith('.part'))) // 임시 파일이 남지 않는다
  })

  test('경로를 이용한 이름(../)이나 특수문자는 수신 폴더 밖으로 나가지 못한다', async () => {
    const id = await start(researcher, 1)
    await put(researcher, id, '../../evil.png', await png(3))
    const { stored_name } = (await pool.query(`SELECT stored_name FROM upload_files WHERE batch_id = $1`, [id])).rows[0]
    assert.ok(!stored_name.includes('/') && !stored_name.includes('..') && !stored_name.includes('\\'))
    assert.ok(existsSync(join(inbox, stored_name)))
  })

  test('이미지가 아니거나(내용), 확장자가 다르거나, 비어 있으면 REJECTED로 기록하고 폴더에는 두지 않는다', async () => {
    const id = await start(researcher, 4)
    const count = readdirSync(inbox).length
    const fake = await put(researcher, id, 'fake.png', Buffer.from('이건 이미지가 아님'))
    const exe = await put(researcher, id, 'run.exe', await png(4))
    const empty = await put(researcher, id, 'empty.png', Buffer.alloc(0))
    assert.deepEqual([fake, exe, empty].map((r) => r.body.file.status), ['REJECTED', 'REJECTED', 'REJECTED'])
    assert.match(fake.body.file.reason, /이미지 형식/)
    assert.match(exe.body.file.reason, /확장자/)
    assert.match(empty.body.file.reason, /빈 파일/)
    assert.equal(readdirSync(inbox).length, count)
    const d = (await api('GET', `/api/uploads/${id}`, researcher)).body
    assert.equal(d.batch.rejected, 3)
    assert.equal(d.files.length, 3)
    assert.equal(d.files[0].state, 'REJECTED')
  })

  test('크기 상한을 넘는 파일은 거절한다 (연계의 maxFileMB 기준)', async () => {
    await pool.query(`UPDATE integrations SET config = '{"maxFileMB": 0.00005}'`) // 약 50바이트
    try {
      const id = await start(researcher, 1)
      const r = await put(researcher, id, 'big.png', await png(5))
      assert.equal(r.body.file.status, 'REJECTED')
      assert.match(r.body.file.reason, /너무 큼/)
    } finally {
      await pool.query(`UPDATE integrations SET config = '{}'`)
    }
  })

  test('선언한 장수를 넘거나 끝난 배치에 올리면 409, 남의 배치는 403', async () => {
    const id = await start(researcher, 1)
    assert.equal((await put(researcher, id, 'a.png', await png(6))).status, 200)
    assert.equal((await put(researcher, id, 'b.png', await png(7))).status, 409) // 1장만 선언
    assert.equal((await put(admin, id, 'c.png', await png(8))).status, 403) // 남의 배치에 더하기
    const done = await api('POST', `/api/uploads/${id}/complete`, researcher, {})
    assert.equal(done.body.batch.status, 'DONE')
    assert.equal((await put(researcher, id, 'd.png', await png(9))).status, 409)
  })

  test('본문 없이 보내면 400', async () => {
    const id = await start(researcher, 1)
    const res = await app.inject({ method: 'PUT', url: `/api/uploads/${id}/files?name=x.png`, headers: researcher })
    assert.equal(res.statusCode, 400)
  })

  test('스캔이 수신하면 upload_files.image_id가 이어지고 처리 현황(수신 대기 → 검사 중)이 바뀐다', async () => {
    const id = await start(researcher, 2)
    await put(researcher, id, 's1.png', await png(10))
    await put(researcher, id, 's2.png', await png(11))
    let d = (await api('GET', `/api/uploads/${id}`, researcher)).body.batch
    assert.deepEqual([d.uploaded, d.waiting, d.processing], [2, 2, 0]) // 아직 폴더에만 있다
    const integ = (await pool.query(`SELECT id, config FROM integrations ORDER BY id LIMIT 1`)).rows[0]
    const ctx = { pool, integration: { id: integ.id, config: integ.config }, root, filesDir: config.filesDir, seen: new Map() }
    await scanOnce(ctx) // 첫 스캔은 기억만
    await scanOnce(ctx) // 둘째 스캔에서 수신
    d = (await api('GET', `/api/uploads/${id}`, researcher)).body.batch
    assert.deepEqual([d.waiting, d.processing], [0, 2])
    const linked = (await pool.query(`SELECT count(*)::int AS n FROM upload_files WHERE batch_id = $1 AND image_id IS NOT NULL`, [id])).rows[0].n
    assert.equal(linked, 2)
    const files = (await api('GET', `/api/uploads/${id}?state=PROCESSING`, researcher)).body
    assert.equal(files.total, 2)
    assert.match(files.files[0].imageKey, /^rcv_/)
  })

  test('이력: 연구원은 내 것만, 모든 업로드 이력 보기 권한(관리자)은 전체. 페이징, 남의 상세는 403', async () => {
    const mine = (await api('GET', '/api/uploads', researcher)).body
    assert.equal(new Set(mine.items.map((b) => b.createdBy)).size, 1)
    assert.equal(mine.canSeeAll, false)
    const all = (await api('GET', '/api/uploads', admin)).body
    assert.equal(all.canSeeAll, true)
    assert.ok(new Set(all.items.map((b) => b.createdBy)).size >= 2)
    const onlyMine = (await api('GET', '/api/uploads?mine=true', admin)).body
    assert.equal(new Set(onlyMine.items.map((b) => b.createdBy)).size, 1)
    const page = (await api('GET', '/api/uploads?pageSize=2&page=1', admin)).body
    assert.equal(page.items.length, 2)
    assert.ok(page.total > 2)
    const others = all.items.find((b) => b.createdBy !== mine.items[0].createdBy)
    assert.equal((await api('GET', `/api/uploads/${others.id}`, researcher)).status, 403)
  })

  test('한도 조회: 이 연계의 파일 크기 상한과 허용 확장자', async () => {
    const r = await api('GET', '/api/uploads/limits', researcher)
    assert.equal(r.status, 200)
    assert.ok(r.body.limits.maxFileBytes > 0 && r.body.limits.extensions.includes('.jpg'))
  })
})
