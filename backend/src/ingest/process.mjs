// processOne: 대기(PENDING) 이미지 1장을 꺼내 추론하고 결과를 저장한다 (워커의 타이머와 분리해 테스트 가능).
//  - 집을 때 FOR UPDATE SKIP LOCKED 로 PROCESSING 표시 → 워커가 둘이어도 같은 건을 집지 않는다.
//  - 성공: model_runs / detections / verdicts(규칙 버전 기록) 저장, 파일을 done으로 이동, DONE
//  - 실패(어댑터 예외, 계약 위반 등): 파일을 failed로 이동, FAILED + 사유. 한 건의 실패가 큐를 막지 않는다.
//  - 설정 오류(활성 규칙 없음, 연계 설정 불량)는 이미지 탓이 아니므로 예외로 올리고 이미지는 PENDING으로 남긴다.
import { access, constants } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { assertValidResult } from '../model/contract.mjs'
import { judge, reasonsOf } from '../rules.mjs'
import { txWith } from '../tx.mjs'
import { bumpBatch } from './batch.mjs'
import { resolveFolderConfig } from './folder-config.mjs'
import { moveFile, toStoredPath } from './fsutil.mjs'

export async function loadActiveRule(pool, ruleName) {
  const { rows } = await pool.query('SELECT id, version, params FROM rules WHERE name = $1 AND enabled ORDER BY version DESC LIMIT 1', [ruleName])
  if (!rows.length) throw new Error(`활성 규칙 없음: ${ruleName}`)
  return rows[0]
}

/** 워커가 죽어 PROCESSING에 멈춘 건을 PENDING으로 되돌린다 (워커 시작 시 1회). */
export async function recoverStuck(pool) {
  const r = await pool.query(`UPDATE images SET ingest_status = 'PENDING' WHERE ingest_status = 'PROCESSING'`)
  return r.rowCount
}

const exists = (p) => access(p, constants.F_OK).then(() => true, () => false)

async function claim(pool) {
  const { rows } = await pool.query(
    `UPDATE images SET ingest_status = 'PROCESSING', error = NULL
      WHERE id = (SELECT id FROM images WHERE ingest_status = 'PENDING' ORDER BY received_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id, image_key, source_name, source_path, batch_id`,
  )
  return rows[0] ?? null
}

async function folderConfigOf(pool, batchId, root) {
  const { rows } = await pool.query(
    'SELECT i.config FROM ingest_batches b JOIN integrations i ON i.id = b.integration_id WHERE b.id = $1',
    [batchId],
  )
  if (!rows.length) throw new Error('수신 배치/연계 정보를 찾을 수 없음')
  return resolveFolderConfig(rows[0].config, root)
}

async function fail(pool, img, cfg, filesDir, err) {
  const src = resolve(filesDir, img.source_path)
  const dest = join(cfg.failedDir, basename(src))
  const message = String(err?.message ?? err).slice(0, 500)
  await txWith(pool, async (client) => {
    const fileThere = await exists(src)
    const stored = fileThere ? toStoredPath(filesDir, dest) : img.source_path
    await client.query(`UPDATE images SET ingest_status = 'FAILED', error = $2, source_path = $3, original_path = $3 WHERE id = $1`, [
      img.id,
      message,
      stored,
    ])
    await bumpBatch(client, img.batch_id, { failed: true })
    if (fileThere) await moveFile(src, dest)
  })
}

async function succeed(pool, img, cfg, filesDir, rule, result) {
  const src = resolve(filesDir, img.source_path)
  const dest = join(cfg.doneDir, basename(src))
  const stored = toStoredPath(filesDir, dest)
  let moved = false
  try {
    await txWith(pool, async (client) => {
      await client.query(
        `UPDATE images SET ingest_status = 'DONE', error = NULL, width = $2, height = $3, source_path = $4, original_path = $4 WHERE id = $1`,
        [img.id, result.width, result.height, stored],
      )
      const run = await client.query(
        `INSERT INTO model_runs (image_id, model_version, overall_score, heatmap_path, duration_ms) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [img.id, result.modelVersion, result.overallScore, result.heatmapUrl, result.durationMs ?? null],
      )
      const runId = run.rows[0].id
      for (const b of result.boxes) {
        await client.query(
          `INSERT INTO detections (run_id, x, y, width, height, score, reason_code) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [runId, b.x, b.y, b.width, b.height, b.score, b.reasonCode],
        )
      }
      // 판정은 규칙 테이블의 임계값으로만 하고, 어떤 규칙 버전인지(rule_id)를 함께 기록한다
      await client.query(`INSERT INTO verdicts (run_id, rule_id, result, reasons) VALUES ($1, $2, $3, $4)`, [
        runId,
        rule.id,
        judge(result.overallScore, rule.params),
        JSON.stringify(reasonsOf(result.boxes)),
      ])
      await bumpBatch(client, img.batch_id, { failed: false })
      await moveFile(src, dest)
      moved = true
    })
  } catch (err) {
    if (moved) await moveFile(dest, src).catch(() => {})
    throw err
  }
}

/** @returns {status:'IDLE'} 대기 없음 | {status:'DONE'|'FAILED', imageKey, error?} */
export async function processOne({ pool, adapter, root, filesDir, ruleName = 'score-threshold' }) {
  const rule = await loadActiveRule(pool, ruleName)
  const img = await claim(pool)
  if (!img) return { status: 'IDLE' }

  let cfg
  try {
    cfg = await folderConfigOf(pool, img.batch_id, root)
  } catch (err) {
    await pool.query(`UPDATE images SET ingest_status = 'PENDING' WHERE id = $1`, [img.id])
    throw err
  }

  try {
    const started = Date.now()
    const result = assertValidResult(
      await adapter.infer({
        imageKey: img.image_key,
        fileName: img.source_name,
        filePath: resolve(filesDir, img.source_path),
        outputDir: filesDir,
      }),
    )
    if (result.imageId !== img.image_key) throw new Error(`모델 출력의 imageId(${result.imageId})가 요청(${img.image_key})과 다름`)
    result.durationMs ??= Date.now() - started
    await succeed(pool, img, cfg, filesDir, rule, result)
    return { status: 'DONE', imageKey: img.image_key }
  } catch (err) {
    await fail(pool, img, cfg, filesDir, err)
    return { status: 'FAILED', imageKey: img.image_key, error: String(err?.message ?? err) }
  }
}
