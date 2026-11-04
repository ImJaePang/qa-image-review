// 연계 관리 API (관리자 전용): 연계를 설정하고 추가한다. 진행 현황 상세는 모니터링의 몫이라 연계별 요약만 돌려준다.
//  - 삭제는 없다: 이미 받은 이미지가 연계(수신 배치)를 가리키므로 끄기(enabled=false)로 대신한다.
//  - 폴더는 모두 허용 루트(INGEST_ROOT) 하위의 상대 경로. 검증은 워커가 쓰는 resolveFolderConfig를 그대로 쓴다.
//  - 모든 변경은 integration_history에 누가·무엇을 남긴다.
import { config as appConfig } from '../config.mjs'
import { pool } from '../db.mjs'
import { httpError } from '../errors.mjs'
import { DEFAULT_FOLDER_CONFIG, resolveFolderConfig } from '../ingest/folder-config.mjs'
import { retryFailed } from '../ingest/retry.mjs'
import { txWith } from '../tx.mjs'
import { isAdmin } from './assignments.mjs'

const CONFIG_KEYS = Object.keys(DEFAULT_FOLDER_CONFIG)
const DIR_KEYS = ['watchDir', 'processingDir', 'doneDir', 'failedDir']

const configSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    watchDir: { type: 'string', maxLength: 200 },
    processingDir: { type: 'string', maxLength: 200 },
    doneDir: { type: 'string', maxLength: 200 },
    failedDir: { type: 'string', maxLength: 200 },
    extensions: { type: 'array', items: { type: 'string', maxLength: 16 }, minItems: 1, maxItems: 20 },
    maxFileMB: { type: 'number', exclusiveMinimum: 0, maximum: 1024 },
    scanIntervalSec: { type: 'number', minimum: 1, maximum: 86400 },
  },
}
const nameSchema = { type: 'string', minLength: 1, maxLength: 50 }

const pickConfig = (c) => Object.fromEntries(CONFIG_KEYS.map((k) => [k, c?.[k] ?? DEFAULT_FOLDER_CONFIG[k]]))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** 검증된 설정을 돌려준다. 잘못되면 400. 다른 연계와 폴더가 겹치면 409 (같은 폴더를 두 스캐너가 보면 같은 파일을 두 번 수신한다). */
async function validate(cfg, exceptId) {
  let resolved
  try {
    resolved = resolveFolderConfig(cfg, appConfig.ingestRoot)
  } catch (err) {
    throw httpError(400, err.message)
  }
  const mine = new Set(DIR_KEYS.map((k) => resolved[k]))
  const { rows } = await pool.query(`SELECT name, config FROM integrations WHERE kind = 'FOLDER' AND ($1::bigint IS NULL OR id <> $1)`, [exceptId ?? null])
  for (const o of rows) {
    let other
    try {
      other = resolveFolderConfig(o.config, appConfig.ingestRoot)
    } catch {
      continue // 이미 깨진 다른 연계의 설정은 겹침 판단에서 제외
    }
    if (DIR_KEYS.some((k) => mine.has(other[k]))) throw httpError(409, `다른 연계(${o.name})가 쓰는 폴더와 겹칩니다.`)
  }
}

const SUMMARY_SQL = `
  SELECT i.id, i.kind, i.name, i.config, i.enabled, i.created_at, i.updated_at,
         count(img.id) FILTER (WHERE img.ingest_status = 'PENDING')    AS pending,
         count(img.id) FILTER (WHERE img.ingest_status = 'PROCESSING') AS processing,
         count(img.id) FILTER (WHERE img.ingest_status = 'DONE')       AS done,
         count(img.id) FILTER (WHERE img.ingest_status = 'FAILED')     AS failed,
         max(img.received_at) AS last_received_at
    FROM integrations i
    LEFT JOIN ingest_batches b ON b.integration_id = i.id
    LEFT JOIN images img ON img.batch_id = b.id`

const toDto = (r) => ({
  id: String(r.id),
  kind: r.kind,
  name: r.name,
  enabled: r.enabled,
  config: pickConfig(r.config),
  counts: { pending: r.pending, processing: r.processing, done: r.done, failed: r.failed },
  lastReceivedAt: r.last_received_at,
  updatedAt: r.updated_at,
})

async function loadOne(id) {
  const { rows } = await pool.query(`${SUMMARY_SQL} WHERE i.id = $1 GROUP BY i.id`, [id])
  if (!rows.length) throw httpError(404, '연계를 찾을 수 없습니다.')
  return rows[0]
}

const history = (client, integrationId, action, changes, actorId) =>
  client.query('INSERT INTO integration_history (integration_id, action, changes, created_by) VALUES ($1, $2, $3, $4)', [
    integrationId,
    action,
    JSON.stringify(changes),
    actorId,
  ])

const idParams = { type: 'object', properties: { id: { type: 'integer', minimum: 1 } }, required: ['id'] }

export default async function integrationRoutes(app) {
  app.addHook('onRequest', app.authenticate)
  app.addHook('onRequest', async (req) => {
    if (!isAdmin(req.user)) throw httpError(403, '관리자만 사용할 수 있습니다.')
  })

  // Fastify의 스키마 검증은 모르는 항목을 조용히 지워 버린다. 설정 오타(예: scanInterval)가 저장된 것처럼 보이지 않도록 먼저 거부한다.
  app.addHook('preValidation', async (req) => {
    const c = req.body?.config
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      const unknown = Object.keys(c).filter((k) => !CONFIG_KEYS.includes(k))
      if (unknown.length) throw httpError(400, `알 수 없는 설정 항목: ${unknown.join(', ')}`)
    }
  })

  app.get('/integrations', async () => {
    const { rows } = await pool.query(`${SUMMARY_SQL} GROUP BY i.id ORDER BY i.id`)
    return { root: appConfig.ingestRoot, defaults: DEFAULT_FOLDER_CONFIG, items: rows.map(toDto) }
  })

  app.post(
    '/integrations',
    { schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: nameSchema, kind: { enum: ['FOLDER'] }, config: configSchema } } } },
    async (req, reply) => {
      const name = req.body.name.trim()
      if (!name) throw httpError(400, '이름이 필요합니다.')
      const cfg = pickConfig(req.body.config)
      await validate(cfg, null)
      let id
      try {
        id = await txWith(pool, async (client) => {
          const r = await client.query(`INSERT INTO integrations (kind, name, config, enabled, created_by, updated_by) VALUES ('FOLDER', $1, $2, true, $3, $3) RETURNING id`, [
            name,
            JSON.stringify(cfg),
            req.user.sub,
          ])
          await history(client, r.rows[0].id, 'CREATE', { name: { to: name }, config: { to: cfg } }, req.user.sub)
          return r.rows[0].id
        })
      } catch (err) {
        if (err.code === '23505') throw httpError(409, '같은 이름의 연계가 이미 있습니다.')
        throw err
      }
      reply.code(201)
      return toDto(await loadOne(id))
    },
  )

  app.patch(
    '/integrations/:id',
    {
      schema: {
        params: idParams,
        body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { name: nameSchema, enabled: { type: 'boolean' }, config: configSchema } },
      },
    },
    async (req) => {
      const { id } = req.params
      const cur = await loadOne(id)
      const changes = {}
      const next = { name: cur.name, enabled: cur.enabled, config: pickConfig(cur.config) }

      if (req.body.name !== undefined) {
        const name = req.body.name.trim()
        if (!name) throw httpError(400, '이름이 필요합니다.')
        if (name !== cur.name) (changes.name = { from: cur.name, to: name }), (next.name = name)
      }
      if (req.body.config !== undefined) {
        const merged = pickConfig({ ...next.config, ...req.body.config })
        for (const k of CONFIG_KEYS) if (!same(merged[k], next.config[k])) (changes.config ??= {})[k] = { from: next.config[k], to: merged[k] }
        if (changes.config) {
          await validate(merged, id)
          next.config = merged
        }
      }
      let enabledChanged = false
      if (req.body.enabled !== undefined && req.body.enabled !== cur.enabled) {
        enabledChanged = true
        next.enabled = req.body.enabled
      }

      const nameOrConfig = changes.name || changes.config
      if (!nameOrConfig && !enabledChanged) return toDto(cur) // 바뀐 것이 없으면 이력도 남기지 않는다
      try {
        await txWith(pool, async (client) => {
          await client.query('UPDATE integrations SET name = $2, enabled = $3, config = $4, updated_by = $5 WHERE id = $1', [
            id,
            next.name,
            next.enabled,
            JSON.stringify(next.config),
            req.user.sub,
          ])
          if (nameOrConfig) await history(client, id, 'UPDATE', changes, req.user.sub)
          if (enabledChanged) await history(client, id, next.enabled ? 'ENABLE' : 'DISABLE', {}, req.user.sub)
        })
      } catch (err) {
        if (err.code === '23505') throw httpError(409, '같은 이름의 연계가 이미 있습니다.')
        throw err
      }
      return toDto(await loadOne(id))
    },
  )

  app.get('/integrations/:id/history', { schema: { params: idParams } }, async (req) => {
    const { id } = req.params
    await loadOne(id)
    const { rows } = await pool.query(
      `SELECT h.id, h.action, h.changes, h.created_at, u.name AS actor
         FROM integration_history h LEFT JOIN users u ON u.id = h.created_by
        WHERE h.integration_id = $1 ORDER BY h.id DESC LIMIT 30`,
      [id],
    )
    return {
      items: rows.map((r) => ({ id: String(r.id), action: r.action, changes: r.changes, at: r.created_at, actor: r.actor ?? '시스템' })),
    }
  })

  app.get('/integrations/:id/failed', { schema: { params: idParams } }, async (req) => {
    const { id } = req.params
    await loadOne(id)
    const { rows } = await pool.query(
      `SELECT img.image_key, img.source_name, img.error, img.received_at
         FROM images img JOIN ingest_batches b ON b.id = img.batch_id
        WHERE b.integration_id = $1 AND img.ingest_status = 'FAILED'
        ORDER BY img.id DESC LIMIT 50`,
      [id],
    )
    return { items: rows.map((r) => ({ imageKey: r.image_key, sourceName: r.source_name, error: r.error, receivedAt: r.received_at })) }
  })

  app.post('/integrations/:id/retry', { schema: { params: idParams } }, async (req) => {
    const { id } = req.params
    const cur = await loadOne(id)
    const r = await retryFailed({ pool, integration: { id, config: cur.config }, root: appConfig.ingestRoot, filesDir: appConfig.filesDir, actorId: req.user.sub })
    if (r.retried) await history(pool, id, 'RETRY', { retried: r.retried, batchId: r.batchId }, req.user.sub)
    return r
  })
}
