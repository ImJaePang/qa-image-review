// 이미지 업로드 API ('image.upload' 권한). 올린 파일은 수신 폴더(연계의 감시 폴더)에 두고, 이후 처리는 기존 수신·추론 흐름이 한다.
//  - 한 번의 업로드 = 배치. 수천 장도 배치 하나로 묶고, 파일은 한 장씩 나눠 보낸다(화면이 몇 장씩 동시에 전송).
//      POST /uploads                  배치 시작 (장수 선언)           → { batch, limits }
//      PUT  /uploads/:id/files?name=  파일 1장 (본문 = 파일 원본)       → { file }  (이미지가 아니거나 크면 REJECTED로 기록)
//      POST /uploads/:id/complete     배치 끝내기 (또는 {cancel:true})
//      GET  /uploads, GET /uploads/:id  이력과 처리 현황 (남의 것은 'upload.view_all'이 있어야 보인다)
//  - 파일은 임시 이름(.part)으로 받아 검사(크기·매직바이트)한 뒤 수신 폴더로 옮긴다: 스캐너가 덜 받은 파일을 집지 않는다.
//  - 수신 폴더의 파일 이름은 up<파일id>__<안전한 이름>. 스캐너가 images로 등록할 때 이 이름으로 upload_files.image_id를 채운다.
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { config } from '../config.mjs'
import { pool } from '../db.mjs'
import { httpError } from '../errors.mjs'
import { resolveFolderConfig } from '../ingest/folder-config.mjs'
import { detectImageType } from '../ingest/sniff.mjs'
import { pagingQuery } from '../paging.mjs'
import { can, requirePermission } from '../permissions.mjs'

const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^\\d+$' } } }

/** 수신 폴더에 둘 안전한 이름: 경로·특수문자 제거, 길이 제한, 소문자 확장자 */
export function safeName(original) {
  const ext = extname(original).toLowerCase()
  const base = original.slice(0, original.length - ext.length).normalize('NFC').replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^[._]+/, '').slice(0, 80)
  return `${base || 'file'}${ext}`
}

/** 업로드가 들어갈 수신 연계: 켜져 있는 폴더 연계 중 가장 먼저 만든 것 */
async function targetIntegration(db) {
  const { rows } = await db.query(`SELECT id, config FROM integrations WHERE kind = 'FOLDER' AND enabled ORDER BY id LIMIT 1`)
  if (!rows.length) throw httpError(409, '수신 폴더 연계가 없어 업로드할 수 없습니다. 설정 > 연계 관리에서 먼저 만드세요.')
  return rows[0]
}

const canSeeAll = (user) => can(user, 'upload.view_all')

async function loadBatch(req, id) {
  const { rows } = await pool.query('SELECT * FROM upload_batches WHERE id = $1', [id])
  if (!rows.length) throw httpError(404, '업로드를 찾을 수 없습니다.')
  const b = rows[0]
  if (String(b.created_by) !== String(req.user.sub) && !canSeeAll(req.user)) throw httpError(403, '다른 사람의 업로드입니다.')
  return b
}

// 처리 현황: 수신 대기(아직 images로 등록 전) / 검사 중 / 완료 / 검사 실패 / 업로드 실패(거절)
const COUNTS_SQL = `
  count(*) FILTER (WHERE f.status = 'RECEIVED')::int AS uploaded,
  count(*) FILTER (WHERE f.status = 'REJECTED')::int AS rejected,
  count(*) FILTER (WHERE f.status = 'RECEIVED' AND f.image_id IS NULL)::int AS waiting,
  count(*) FILTER (WHERE i.ingest_status IN ('PENDING', 'PROCESSING'))::int AS processing,
  count(*) FILTER (WHERE i.ingest_status = 'DONE')::int AS done,
  count(*) FILTER (WHERE i.ingest_status = 'FAILED')::int AS failed`

const toBatch = (r) => ({
  id: String(r.id),
  createdBy: String(r.created_by),
  createdByName: r.created_by_name,
  expectedCount: r.expected_count,
  memo: r.memo,
  status: r.status,
  createdAt: r.created_at,
  finishedAt: r.finished_at,
  uploaded: r.uploaded ?? 0,
  rejected: r.rejected ?? 0,
  waiting: r.waiting ?? 0,
  processing: r.processing ?? 0,
  done: r.done ?? 0,
  failed: r.failed ?? 0,
})

export default async function uploadRoutes(app) {
  app.addHook('onRequest', app.authenticate)
  app.addHook('onRequest', requirePermission('image.upload', '이미지를 올릴 권한이 없습니다.'))

  // 파일 원본을 그대로 받는다 (multipart 대신): 한 장씩 스트림으로 디스크에 쓰므로 큰 파일도 메모리를 쓰지 않는다
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload))

  app.get('/uploads/limits', async () => {
    const integ = await targetIntegration(pool)
    const cfg = resolveFolderConfig(integ.config, config.ingestRoot)
    return { limits: { maxFileBytes: cfg.maxBytes, maxBatchFiles: config.uploadMaxBatchFiles, extensions: [...cfg.extensions] } }
  })

  app.post(
    '/uploads',
    {
      schema: {
        body: {
          type: 'object',
          required: ['expectedCount'],
          additionalProperties: false,
          properties: { expectedCount: { type: 'integer', minimum: 1 }, memo: { type: 'string', maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      const { expectedCount, memo } = req.body
      if (expectedCount > config.uploadMaxBatchFiles) throw httpError(400, `한 번에 최대 ${config.uploadMaxBatchFiles}장까지 올릴 수 있습니다. 나눠서 올려 주세요.`)
      const integ = await targetIntegration(pool)
      const cfg = resolveFolderConfig(integ.config, config.ingestRoot)
      const { rows } = await pool.query(
        'INSERT INTO upload_batches (integration_id, created_by, expected_count, memo) VALUES ($1, $2, $3, $4) RETURNING *',
        [integ.id, req.user.sub, expectedCount, memo?.trim() || null],
      )
      return reply.code(201).send({
        batch: toBatch({ ...rows[0], created_by_name: req.user.name }),
        limits: { maxFileBytes: cfg.maxBytes, maxBatchFiles: config.uploadMaxBatchFiles, extensions: [...cfg.extensions] },
      })
    },
  )

  app.put(
    '/uploads/:id/files',
    { schema: { params: idParams, querystring: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 255 } } } } },
    async (req) => {
      const batch = await loadBatch(req, req.params.id)
      if (String(batch.created_by) !== String(req.user.sub)) throw httpError(403, '다른 사람의 업로드에는 파일을 더할 수 없습니다.')
      if (batch.status !== 'OPEN') throw httpError(409, '이미 끝난 업로드입니다.')
      if (!req.body || typeof req.body.pipe !== 'function') throw httpError(400, '파일 내용이 없습니다. Content-Type: application/octet-stream 으로 보내세요.')
      const used = (await pool.query('SELECT count(*)::int AS n FROM upload_files WHERE batch_id = $1', [batch.id])).rows[0].n
      if (used >= batch.expected_count) throw httpError(409, '선언한 장수를 넘었습니다.')

      const integ = (await pool.query('SELECT id, config FROM integrations WHERE id = $1', [batch.integration_id])).rows[0]
      const cfg = resolveFolderConfig(integ.config, config.ingestRoot)
      const original = req.query.name.normalize('NFC')
      const reject = async (reason) => {
        const { rows } = await pool.query(`INSERT INTO upload_files (batch_id, original_name, status, reason) VALUES ($1, $2, 'REJECTED', $3) RETURNING id`, [batch.id, original, reason])
        return { file: { id: String(rows[0].id), name: original, status: 'REJECTED', reason } }
      }

      // 1) 임시 파일로 받으면서 크기·해시 계산. 상한을 넘으면 쓰기를 멈추고 나머지 본문은 읽어서 버린다
      //    (요청 스트림을 중간에 끊으면 연결이 끊겨 화면이 "너무 큼" 응답을 받지 못하기 때문)
      await mkdir(cfg.watchDir, { recursive: true })
      const tmp = join(cfg.watchDir, `.upload-${randomUUID()}.part`)
      const hash = createHash('sha256')
      let size = 0
      let tooBig = false
      const meter = new Transform({
        transform(chunk, _enc, cb) {
          size += chunk.length
          if (size > cfg.maxBytes) tooBig = true
          if (tooBig) return cb() // 버린다
          hash.update(chunk)
          cb(null, chunk)
        },
      })
      try {
        await pipeline(req.body, meter, createWriteStream(tmp))
      } catch (err) {
        await unlink(tmp).catch(() => {})
        throw httpError(400, '파일을 받는 중 오류가 났습니다. 다시 시도하세요.')
      }
      if (tooBig) {
        await unlink(tmp).catch(() => {})
        return reject(`파일이 너무 큼 (상한 ${Math.floor(cfg.maxBytes / 1024 / 1024)}MB)`)
      }

      // 2) 검사: 확장자, 비어 있지 않음, 내용(매직바이트)
      const ext = extname(original).toLowerCase()
      if (!cfg.extensions.has(ext)) {
        await unlink(tmp).catch(() => {})
        return reject(`허용하지 않는 확장자 (${ext || '없음'})`)
      }
      if (size === 0) {
        await unlink(tmp).catch(() => {})
        return reject('빈 파일')
      }
      const fh = await open(tmp, 'r')
      let head
      try {
        const buf = Buffer.alloc(1024)
        const { bytesRead } = await fh.read(buf, 0, 1024, 0)
        head = buf.subarray(0, bytesRead)
      } finally {
        await fh.close()
      }
      if (!detectImageType(head)) {
        await unlink(tmp).catch(() => {})
        return reject('이미지 형식이 아님 (파일 내용 확인 실패)')
      }

      // 3) 기록 후 수신 폴더로 이동. 이동에 실패하면 기록도 되돌린다.
      const ins = await pool.query(`INSERT INTO upload_files (batch_id, original_name, size_bytes, sha256, status) VALUES ($1, $2, $3, $4, 'RECEIVED') RETURNING id`, [batch.id, original, size, hash.digest('hex')])
      const id = ins.rows[0].id
      const stored = `up${id}__${safeName(original)}`
      try {
        await pool.query('UPDATE upload_files SET stored_name = $2 WHERE id = $1', [id, stored])
        await rename(tmp, join(cfg.watchDir, stored))
      } catch (err) {
        await unlink(tmp).catch(() => {})
        await pool.query('DELETE FROM upload_files WHERE id = $1', [id])
        throw httpError(500, '수신 폴더에 저장하지 못했습니다.')
      }
      return { file: { id: String(id), name: original, status: 'RECEIVED', size } }
    },
  )

  app.post(
    '/uploads/:id/complete',
    { schema: { params: idParams, body: { type: 'object', additionalProperties: false, properties: { cancel: { type: 'boolean' } } } } },
    async (req) => {
      const batch = await loadBatch(req, req.params.id)
      if (String(batch.created_by) !== String(req.user.sub)) throw httpError(403, '다른 사람의 업로드입니다.')
      if (batch.status === 'OPEN') {
        await pool.query(`UPDATE upload_batches SET status = $2, finished_at = now() WHERE id = $1`, [batch.id, req.body?.cancel ? 'CANCELED' : 'DONE'])
      }
      return detail(req.params.id)
    },
  )

  const detail = async (id) => {
    const { rows } = await pool.query(
      `SELECT b.*, u.name AS created_by_name, ${COUNTS_SQL}
         FROM upload_batches b JOIN users u ON u.id = b.created_by
         LEFT JOIN upload_files f ON f.batch_id = b.id LEFT JOIN images i ON i.id = f.image_id
        WHERE b.id = $1 GROUP BY b.id, u.name`,
      [id],
    )
    return { batch: toBatch(rows[0]) }
  }

  app.get(
    '/uploads',
    { schema: { querystring: { type: 'object', properties: { mine: { type: 'boolean' }, q: { type: 'string', maxLength: 100 }, ...pagingQuery } } } },
    async (req) => {
      const { mine = false, q = null, page, pageSize } = req.query
      const onlyMine = mine || !canSeeAll(req.user) // 모든 업로드 이력 보기 권한이 없으면 내 것만
      const like = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null
      const where = `($1::bigint IS NULL OR b.created_by = $1) AND ($2::text IS NULL OR u.name ILIKE $2 OR b.memo ILIKE $2)`
      const args = [onlyMine ? req.user.sub : null, like]
      const [list, total, counts] = await Promise.all([
        pool.query(
          `SELECT b.*, u.name AS created_by_name, ${COUNTS_SQL}
             FROM upload_batches b JOIN users u ON u.id = b.created_by
             LEFT JOIN upload_files f ON f.batch_id = b.id LEFT JOIN images i ON i.id = f.image_id
            WHERE ${where} GROUP BY b.id, u.name ORDER BY b.id DESC LIMIT $3 OFFSET $4`,
          [...args, pageSize, (page - 1) * pageSize],
        ),
        pool.query(`SELECT count(*)::int AS n FROM upload_batches b JOIN users u ON u.id = b.created_by WHERE ${where}`, args),
        pool.query(
          `SELECT count(*)::int AS total, count(*) FILTER (WHERE created_by = $1)::int AS mine FROM upload_batches`,
          [req.user.sub],
        ),
      ])
      return { items: list.rows.map(toBatch), total: total.rows[0].n, page, pageSize, canSeeAll: canSeeAll(req.user), counts: counts.rows[0] }
    },
  )

  app.get(
    '/uploads/:id',
    { schema: { params: idParams, querystring: { type: 'object', properties: { state: { enum: ['REJECTED', 'WAITING', 'PROCESSING', 'DONE', 'FAILED'] }, ...pagingQuery } } } },
    async (req) => {
      await loadBatch(req, req.params.id)
      const { state = null, page, pageSize } = req.query
      const where = `f.batch_id = $1 AND ($2::text IS NULL OR CASE $2
          WHEN 'REJECTED' THEN f.status = 'REJECTED'
          WHEN 'WAITING' THEN f.status = 'RECEIVED' AND f.image_id IS NULL
          WHEN 'PROCESSING' THEN i.ingest_status IN ('PENDING', 'PROCESSING')
          WHEN 'DONE' THEN i.ingest_status = 'DONE'
          WHEN 'FAILED' THEN i.ingest_status = 'FAILED' END)`
      const [files, total, d] = await Promise.all([
        pool.query(
          `SELECT f.id, f.original_name, f.size_bytes, f.status, f.reason, i.image_key, i.ingest_status, i.error
             FROM upload_files f LEFT JOIN images i ON i.id = f.image_id WHERE ${where} ORDER BY f.id LIMIT $3 OFFSET $4`,
          [req.params.id, state, pageSize, (page - 1) * pageSize],
        ),
        pool.query(`SELECT count(*)::int AS n FROM upload_files f LEFT JOIN images i ON i.id = f.image_id WHERE ${where}`, [req.params.id, state]),
        detail(req.params.id),
      ])
      return {
        ...d,
        files: files.rows.map((r) => ({
          id: String(r.id),
          name: r.original_name,
          size: Number(r.size_bytes),
          // 한 파일의 상태: 업로드 실패 / 수신 대기 / 검사 중 / 완료 / 검사 실패
          state: r.status === 'REJECTED' ? 'REJECTED' : !r.ingest_status ? 'WAITING' : r.ingest_status === 'DONE' ? 'DONE' : r.ingest_status === 'FAILED' ? 'FAILED' : 'PROCESSING',
          reason: r.reason ?? r.error ?? null,
          imageKey: r.image_key,
        })),
        total: total.rows[0].n,
        page,
        pageSize,
      }
    },
  )
}
