// retryFailed: 연계의 실패(FAILED) 이미지를 대기(PENDING)로 되돌려 워커가 다시 처리하게 한다.
//  - 파일이 failed 폴더에 있어야 한다 (없거나 폴더 밖이면 건너뛰고 사유를 알린다).
//  - 재시도분은 새 수신 배치로 묶는다: 옛 배치의 실패 기록은 그때 있었던 사실이라 그대로 두고,
//    소요 시간 분석이 재시도 때의 시간을 따로 잴 수 있다.
//  - 순서는 scan과 같다: DB 쓰기 → 파일 이동 → COMMIT (이동 실패 시 행도 롤백).
import { access, constants } from 'node:fs/promises'
import { basename, join, relative, resolve, isAbsolute } from 'node:path'
import { txWith } from '../tx.mjs'
import { resolveFolderConfig } from './folder-config.mjs'
import { moveFile, toStoredPath } from './fsutil.mjs'

const exists = (p) => access(p, constants.F_OK).then(() => true, () => false)
const inside = (dir, p) => {
  const rel = relative(dir, p)
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

/** @returns {{ retried: number, batchId: string|null, skipped: {imageKey: string, reason: string}[] }} */
export async function retryFailed({ pool, integration, root, filesDir, actorId = null, limit = 500 }) {
  const cfg = resolveFolderConfig(integration.config, root)
  const { rows } = await pool.query(
    `SELECT img.id, img.image_key, img.source_path
       FROM images img JOIN ingest_batches b ON b.id = img.batch_id
      WHERE b.integration_id = $1 AND img.ingest_status = 'FAILED'
      ORDER BY img.id LIMIT $2`,
    [integration.id, limit],
  )

  const skipped = []
  const todo = []
  for (const r of rows) {
    const src = resolve(filesDir, r.source_path ?? '')
    if (!r.source_path || !inside(cfg.failedDir, src)) skipped.push({ imageKey: r.image_key, reason: '파일이 실패 폴더에 없음' })
    else if (!(await exists(src))) skipped.push({ imageKey: r.image_key, reason: '파일이 없음' })
    else todo.push({ ...r, src })
  }
  if (!todo.length) return { retried: 0, batchId: null, skipped }

  const batch = await pool.query('INSERT INTO ingest_batches (integration_id, total_count, created_by) VALUES ($1, $2, $3) RETURNING id', [
    integration.id,
    todo.length,
    actorId,
  ])
  const batchId = batch.rows[0].id

  let retried = 0
  for (const t of todo) {
    const dest = join(cfg.processingDir, basename(t.src))
    const stored = toStoredPath(filesDir, dest)
    try {
      await txWith(pool, async (client) => {
        await client.query(
          `UPDATE images SET ingest_status = 'PENDING', error = NULL, batch_id = $2, source_path = $3, original_path = $3, updated_by = $4
            WHERE id = $1 AND ingest_status = 'FAILED'`,
          [t.id, batchId, stored, actorId],
        )
        await moveFile(t.src, dest)
      })
      retried++
    } catch (err) {
      skipped.push({ imageKey: t.image_key, reason: `이동 실패: ${err.message}` })
    }
  }
  // 이동에 실패한 건은 이 배치에서 빠진다 (전부 끝났을 때 배치가 닫히도록 총 건수를 맞춘다)
  if (retried !== todo.length) {
    await pool.query(
      `UPDATE ingest_batches SET total_count = $2, finished_at = CASE WHEN processed_count >= $2 THEN now() ELSE finished_at END WHERE id = $1`,
      [batchId, retried],
    )
  }
  return { retried, batchId: String(batchId), skipped }
}
