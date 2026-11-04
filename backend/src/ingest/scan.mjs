// scanOnce: 감시 폴더를 한 번 훑어 새 파일을 수신한다 (타이머와 분리해 테스트 가능).
//  1) 확장자가 맞는 일반 파일만 후보 (심볼릭 링크·하위 폴더 무시)
//  2) 크기·수정시각이 직전 스캔과 같은 파일만 수신 (복사 중인 파일 보호). 직전 관찰값은 호출자가 가진 seen(Map)
//  3) 이미지 확인(매직바이트)·크기 상한 → 통과: processing으로 이동 + images PENDING / 불합격: failed로 이동 + images FAILED
// 같은 내용(sha256)이 다시 들어와도 막지 않고 새 행으로 쌓되 origin_image_id로 처음 수신 행을 가리킨다.
// 한 연계(폴더)는 스캐너 하나만 돌린다고 가정한다 (origin 조회에 락이 없음).
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, open, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { txWith } from '../tx.mjs'
import { bumpBatch } from './batch.mjs'
import { moveFile, toStoredPath } from './fsutil.mjs'
import { resolveFolderConfig } from './folder-config.mjs'
import { detectImageType } from './sniff.mjs'

function sha256Of(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

async function readHead(path) {
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(1024)
    const { bytesRead } = await fh.read(buf, 0, 1024, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

/** 한 파일을 검사한다. 통과하면 { sha256 }, 아니면 { error } */
async function inspect(file, cfg) {
  if (file.size > cfg.maxBytes) return { error: `파일이 너무 큼 (${file.size}B > 상한 ${cfg.maxBytes}B)` }
  if (file.size === 0) return { error: '빈 파일' }
  if (!detectImageType(await readHead(file.full))) return { error: '이미지 형식이 아님 (파일 내용 확인 실패)' }
  return { sha256: await sha256Of(file.full) }
}

/** images 행을 만들고 파일을 옮긴다. DB 쓰기 → 파일 이동 → COMMIT 순서 (이동 실패 시 행도 롤백). */
async function register(pool, { cfg, filesDir, batchId, file, status, error, sha256 }) {
  const destDir = status === 'PENDING' ? cfg.processingDir : cfg.failedDir
  const ext = extname(file.name).toLowerCase()
  let moved = null
  try {
    return await txWith(pool, async (client) => {
      const origin = sha256
        ? (await client.query('SELECT id FROM images WHERE sha256 = $1 ORDER BY id LIMIT 1', [sha256])).rows[0]
        : null
      // 키는 id로 정하므로 임시 키로 넣은 뒤 바꾼다 (이동 후 파일명은 키라서 같은 이름의 파일끼리 충돌하지 않는다)
      const ins = await client.query(
        `INSERT INTO images (image_key, file_name, source_name, original_path, ingest_status, error, sha256, origin_image_id, batch_id)
         VALUES ('tmp-' || gen_random_uuid(), $1, $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [file.name, toStoredPath(filesDir, file.full), status, error ?? null, sha256 ?? null, origin?.id ?? null, batchId],
      )
      const id = ins.rows[0].id
      const key = `rcv_${String(id).padStart(6, '0')}`
      const dest = join(destDir, `${key}${ext}`)
      const stored = toStoredPath(filesDir, dest)
      await client.query('UPDATE images SET image_key = $2, original_path = $3, source_path = $3 WHERE id = $1', [id, key, stored])
      // 화면에서 올린 파일이면(수신 폴더 이름 up<id>__…) 업로드 기록에 images 행을 이어 둔다
      await client.query('UPDATE upload_files SET image_id = $1 WHERE stored_name = $2 AND image_id IS NULL', [id, file.name])
      if (status === 'FAILED') await bumpBatch(client, batchId, { failed: true })
      await moveFile(file.full, dest)
      moved = dest
      return { id, key, status, originId: origin?.id ?? null }
    })
  } catch (err) {
    // COMMIT 등이 실패했는데 파일은 이미 옮겨졌다면 되돌려 둔다 (다음 스캔에서 다시 수신)
    if (moved) await moveFile(moved, file.full).catch(() => {})
    throw err
  }
}

/**
 * @param ctx.pool pg Pool  ctx.integration {id, config}  ctx.root 허용 루트(절대)  ctx.filesDir 파일 서빙 기준 폴더
 * @param ctx.seen Map  스캔 사이에 유지되는 직전 관찰값 (연계마다 하나)
 */
export async function scanOnce({ pool, integration, root, filesDir, seen }) {
  const cfg = resolveFolderConfig(integration.config, root)
  for (const d of [cfg.watchDir, cfg.processingDir, cfg.doneDir, cfg.failedDir]) await mkdir(d, { recursive: true })

  const stable = []
  const unstable = new Map()
  for (const name of (await readdir(cfg.watchDir)).sort()) {
    const full = join(cfg.watchDir, name)
    const st = await lstat(full).catch(() => null)
    if (!st || !st.isFile()) continue // lstat이라 심볼릭 링크는 isFile()이 false
    if (!cfg.extensions.has(extname(name).toLowerCase())) continue
    const sig = `${st.size}:${st.mtimeMs}`
    if (seen.get(full) === sig) stable.push({ full, name, size: st.size })
    else unstable.set(full, sig)
  }
  // 이번에 처음 보거나 변한 파일만 기억해 다음 스캔과 비교한다 (사라진 파일·수신한 파일은 자연히 빠진다)
  seen.clear()
  for (const [k, v] of unstable) seen.set(k, v)

  const out = { found: stable.length, received: 0, failed: 0, batchId: null, files: [] }
  if (!stable.length) return out

  const batch = await pool.query('INSERT INTO ingest_batches (integration_id, total_count) VALUES ($1, $2) RETURNING id', [integration.id, stable.length])
  out.batchId = batch.rows[0].id

  for (const file of stable) {
    let verdict
    try {
      verdict = await inspect(file, cfg)
    } catch (err) {
      verdict = { error: `파일을 읽을 수 없음: ${err.message}` }
    }
    const status = verdict.error ? 'FAILED' : 'PENDING'
    const r = await register(pool, { cfg, filesDir, batchId: out.batchId, file, status, error: verdict.error, sha256: verdict.sha256 })
    out[status === 'PENDING' ? 'received' : 'failed']++
    out.files.push(r)
  }
  return out
}
