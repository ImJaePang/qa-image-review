import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { pool } from '../db.mjs'
import { config } from '../config.mjs'
import { httpError } from '../errors.mjs'
import { LATEST_RUN } from '../sql.mjs'
import { can } from '../permissions.mjs'

// 이미지 ID 기반 파일 API (design.md 9장 ②). URL에는 디스크 경로가 나오지 않고,
// 서버가 DB에서 파일 위치를 찾아 내려준다.
const TYPES = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

// 사본(thumb/preview)이 아직 없으면 있는 것 중 가장 가까운 것으로 대신한다.
const PICK = {
  thumb: (r) => r.thumb_path ?? r.preview_path ?? r.original_path,
  preview: (r) => r.preview_path ?? r.original_path,
  original: (r) => r.original_path,
  heatmap: (r) => r.heatmap_path,
}

/** DB의 상대 경로 → filesDir 안의 절대 경로. 밖으로 나가면 null */
export function safeResolve(root, stored) {
  if (!stored) return null
  const abs = resolve(root, stored.replace(/^[/\\]+/, ''))
  return abs.startsWith(root + sep) ? abs : null
}

export default async function fileRoutes(app) {
  app.addHook('onRequest', app.authenticate)

  app.get(
    '/images/:imageKey/:kind',
    {
      schema: {
        params: {
          type: 'object',
          required: ['imageKey', 'kind'],
          properties: {
            imageKey: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,50}$' },
            kind: { type: 'string', enum: Object.keys(PICK) },
          },
        },
      },
    },
    async (req, reply) => {
      const { imageKey, kind } = req.params
      const { rows } = await pool.query(
        `SELECT i.id, i.original_path, i.preview_path, i.thumb_path, i.ingest_status, mr.heatmap_path
         FROM images i ${LATEST_RUN}
         LEFT JOIN model_runs mr ON mr.id = lr.id
         WHERE i.image_key = $1`,
        [imageKey],
      )
      const img = rows[0]
      if (!img || img.ingest_status !== 'DONE') throw httpError(404, '이미지를 찾을 수 없습니다.')

      // 'image.view_all' 권한자는 전부, 그 외는 자기에게 배정된 이미지만
      if (!can(req.user, 'image.view_all')) {
        const own = await pool.query(
          `SELECT 1 FROM assignment_images ai JOIN assignments a ON a.id = ai.assignment_id
           WHERE ai.image_id = $1 AND a.assignee_id = $2 LIMIT 1`,
          [img.id, req.user.sub],
        )
        if (!own.rowCount) throw httpError(403, '권한이 없습니다.')
      }

      const abs = safeResolve(config.filesDir, PICK[kind](img))
      const info = abs && (await stat(abs).catch(() => null))
      if (!info?.isFile()) throw httpError(404, '파일을 찾을 수 없습니다.')

      const ext = extname(abs).toLowerCase()
      const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`
      reply
        .header('Cache-Control', 'private, max-age=300')
        .header('ETag', etag)
        .header('Last-Modified', info.mtime.toUTCString())
        .header('X-Content-Type-Options', 'nosniff')
      if (ext === '.svg') reply.header('Content-Security-Policy', 'sandbox')
      if (req.headers['if-none-match'] === etag) return reply.code(304).send()

      return reply
        .type(TYPES[ext] ?? 'application/octet-stream')
        .header('Content-Length', info.size)
        .send(createReadStream(abs))
    },
  )
}
