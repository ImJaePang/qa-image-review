// 판정 규칙 관리 API (관리자 전용). 임계값을 바꾸고, 저장된 모델 점수에 새 규칙을 적용(재판정)한다.
//  - 규칙은 수정하지 않고 새 버전을 쌓는다 (판정마다 규칙 버전을 기록하는 원칙). 활성 규칙 = 켜진 것 중 가장 높은 버전
//    (워커의 loadActiveRule과 같은 기준). 새 버전을 끄면 이전 버전이 다시 활성이 된다.
//  - 재판정은 모델을 다시 돌리지 않는다: 이미지의 가장 최근 실행(run)의 점수에 judge()를 적용해 verdicts 행을 추가한다.
//    판정 로직은 src/rules.mjs의 judge() 하나만 쓴다 (SQL에 임계값/비교를 복제하지 않는다).
//  - 기본은 '미배정'만 재판정한다. 검수자가 보고 있는 AI 판정이 갑자기 바뀌지 않게 하기 위해서이고, 배정된 이미지까지는 scope=all로 명시할 때만.
import { config as appConfig } from '../config.mjs'
import { pool } from '../db.mjs'
import { httpError } from '../errors.mjs'
import { judge } from '../rules.mjs'
import { txWith } from '../tx.mjs'
import { requirePermission } from '../permissions.mjs'

const emptyCounts = () => ({ NORMAL: 0, SUSPECT: 0, DEFECT: 0 })

const paramsSchema = {
  type: 'object',
  required: ['normalMin', 'suspectMin'],
  additionalProperties: false,
  properties: {
    normalMin: { type: 'number', minimum: 0, maximum: 1 },
    suspectMin: { type: 'number', minimum: 0, maximum: 1 },
  },
}
// Fastify의 스키마 검증은 모르는 항목을 조용히 지워 버린다(저장된 것처럼 보임). 본문에 모르는 키가 있으면 먼저 400으로 막는다.
const strictKeys = (allowed) => async (req) => {
  const extra = Object.keys(req.body ?? {}).filter((k) => !allowed.includes(k))
  if (extra.length) throw httpError(400, `알 수 없는 항목: ${extra.join(', ')}`)
}

const idParams = { type: 'object', properties: { id: { type: 'integer', minimum: 1 } }, required: ['id'] }

function checkParams(p) {
  if (!(p.suspectMin < p.normalMin)) throw httpError(400, '의심 기준은 정상 기준보다 낮아야 합니다.')
}

const toDto = (r, activeId) => ({
  id: String(r.id),
  name: r.name,
  version: r.version,
  params: r.params,
  enabled: r.enabled,
  active: String(r.id) === String(activeId),
  createdAt: r.created_at,
  createdBy: r.created_by_name ?? '시스템',
  verdictCount: r.verdict_count ?? 0,
})

async function loadVersions(db = pool) {
  const { rows } = await db.query(
    `SELECT r.id, r.name, r.version, r.params, r.enabled, r.created_at, u.name AS created_by_name,
            (SELECT count(*)::int FROM verdicts v WHERE v.rule_id = r.id) AS verdict_count
       FROM rules r LEFT JOIN users u ON u.id = r.created_by
      WHERE r.name = $1 ORDER BY r.version DESC`,
    [appConfig.ruleName],
  )
  return { rows, active: rows.find((r) => r.enabled) ?? null }
}

/** 판정 대상: 수신·추론이 끝난 이미지의 가장 최근 실행 + 그 실행의 가장 최근 판정 */
async function candidates(db) {
  const { rows } = await db.query(
    `SELECT lr.id AS run_id, lr.score, v.rule_id, v.result, v.reasons,
            EXISTS (SELECT 1 FROM assignment_images ai WHERE ai.image_id = i.id) AS assigned
       FROM images i
       JOIN LATERAL (SELECT id, overall_score::float8 AS score FROM model_runs WHERE image_id = i.id ORDER BY created_at DESC, id DESC LIMIT 1) lr ON true
       LEFT JOIN LATERAL (SELECT rule_id, result, reasons FROM verdicts WHERE run_id = lr.id ORDER BY created_at DESC, id DESC LIMIT 1) v ON true
      WHERE i.ingest_status = 'DONE'`,
  )
  return rows
}

const history = (client, ruleId, action, detail, actorId) =>
  client.query('INSERT INTO rule_history (rule_id, action, detail, created_by) VALUES ($1, $2, $3, $4)', [ruleId, action, JSON.stringify(detail), actorId])

export default async function ruleRoutes(app) {
  app.addHook('onRequest', app.authenticate)
  app.addHook('onRequest', requirePermission('rule.manage'))

  // 규칙 버전 목록 + 활성 규칙 기준으로 다시 판정이 필요한 이미지 수
  app.get('/rules', async () => {
    const { rows, active } = await loadVersions()
    const stale = { unassigned: 0, assigned: 0 }
    if (active) for (const c of await candidates(pool)) if (String(c.rule_id) !== String(active.id)) stale[c.assigned ? 'assigned' : 'unassigned']++
    return { name: appConfig.ruleName, activeId: active ? String(active.id) : null, items: rows.map((r) => toDto(r, active?.id)), stale }
  })

  // 미리보기: 이 임계값을 적용하면 현재 판정이 어떻게 바뀌는지 (저장하지 않는다)
  app.get('/rules/preview', { schema: { querystring: paramsSchema } }, async (req) => {
    const p = { normalMin: req.query.normalMin, suspectMin: req.query.suspectMin }
    checkParams(p)
    const out = { total: 0, current: emptyCounts(), proposed: emptyCounts(), changed: { unassigned: 0, assigned: 0 } }
    for (const c of await candidates(pool)) {
      const next = judge(c.score, p)
      out.total++
      if (c.result) out.current[c.result]++
      out.proposed[next]++
      if (c.result !== next) out.changed[c.assigned ? 'assigned' : 'unassigned']++
    }
    return out
  })

  // 새 버전 만들기: 새로 수신하는 이미지부터 바로 이 규칙으로 판정된다. 이미 판정된 이미지는 재판정을 눌러야 바뀐다.
  app.post('/rules', { schema: { body: paramsSchema }, preValidation: strictKeys(['normalMin', 'suspectMin']) }, async (req, reply) => {
    const p = req.body
    checkParams(p)
    const { rows, active } = await loadVersions()
    if (active && active.params.normalMin === p.normalMin && active.params.suspectMin === p.suspectMin)
      throw httpError(409, `현재 활성 규칙(v${active.version})과 같은 값입니다.`)
    const version = (rows[0]?.version ?? 0) + 1
    let id
    try {
      id = await txWith(pool, async (client) => {
        const r = await client.query(`INSERT INTO rules (name, version, params, enabled, created_by, updated_by) VALUES ($1, $2, $3, true, $4, $4) RETURNING id`, [
          appConfig.ruleName,
          version,
          JSON.stringify({ normalMin: p.normalMin, suspectMin: p.suspectMin }),
          req.user.sub,
        ])
        await history(client, r.rows[0].id, 'CREATE', { version, params: p }, req.user.sub)
        return r.rows[0].id
      })
    } catch (err) {
      if (err.code === '23505') throw httpError(409, '같은 시각에 다른 관리자가 새 버전을 만들었습니다. 다시 시도해 주세요.')
      throw err
    }
    const after = await loadVersions()
    reply.code(201)
    return toDto(after.rows.find((r) => String(r.id) === String(id)), after.active?.id)
  })

  // 켜기/끄기: 새 버전을 끄면 이전 버전이 활성이 된다(되돌리기). 켜진 규칙이 하나도 없으면 워커가 멈추므로 막는다.
  app.patch('/rules/:id', { preValidation: strictKeys(['enabled']), schema: { params: idParams, body: { type: 'object', required: ['enabled'], additionalProperties: false, properties: { enabled: { type: 'boolean' } } } } }, async (req) => {
    const { id } = req.params
    const { rows } = await loadVersions()
    const target = rows.find((r) => Number(r.id) === id)
    if (!target) throw httpError(404, '규칙을 찾을 수 없습니다.')
    const { enabled } = req.body
    if (target.enabled !== enabled) {
      if (!enabled && rows.filter((r) => r.enabled).length <= 1) throw httpError(409, '켜진 규칙이 하나는 있어야 합니다.')
      await txWith(pool, async (client) => {
        await client.query('UPDATE rules SET enabled = $2, updated_by = $3 WHERE id = $1', [id, enabled, req.user.sub])
        await history(client, id, enabled ? 'ENABLE' : 'DISABLE', {}, req.user.sub)
      })
    }
    const after = await loadVersions()
    return toDto(after.rows.find((r) => Number(r.id) === id), after.active?.id)
  })

  // 재판정: 활성 규칙으로만 가능하다 (옛 버전으로 덮어쓰는 실수 방지).
  //  이미 같은 규칙의 판정이 있으면 새로 찍어(시각 갱신) 다시 '최신'이 되게 한다 → 되돌리기(롤백) 후 재판정이 동작한다.
  app.post(
    '/rules/:id/rejudge',
    { preValidation: strictKeys(['scope']), schema: { params: idParams, body: { type: 'object', additionalProperties: false, properties: { scope: { enum: ['unassigned', 'all'] } } } } },
    async (req) => {
      const { id } = req.params
      const scope = req.body?.scope ?? 'unassigned'
      return txWith(pool, async (client) => {
        const { rows, active } = await loadVersions(client)
        const rule = rows.find((r) => Number(r.id) === id)
        if (!rule) throw httpError(404, '규칙을 찾을 수 없습니다.')
        if (!active || Number(active.id) !== id) throw httpError(409, '활성 규칙으로만 재판정할 수 있습니다.')

        const todo = (await candidates(client)).filter((c) => (scope === 'all' || !c.assigned) && String(c.rule_id) !== String(rule.id))
        const next = todo.map((c) => ({ ...c, nextResult: judge(c.score, rule.params) }))
        for (let i = 0; i < next.length; i += 1000) {
          const chunk = next.slice(i, i + 1000)
          await client.query(
            `INSERT INTO verdicts (run_id, rule_id, result, reasons)
             SELECT t.run_id, $1, t.result, t.reasons::jsonb FROM unnest($2::bigint[], $3::text[], $4::text[]) AS t(run_id, result, reasons)
             ON CONFLICT (run_id, rule_id) DO UPDATE SET result = EXCLUDED.result, reasons = EXCLUDED.reasons, created_at = now()`,
            [rule.id, chunk.map((c) => c.run_id), chunk.map((c) => c.nextResult), chunk.map((c) => JSON.stringify(c.reasons ?? []))],
          )
        }
        const changed = next.filter((c) => c.result !== c.nextResult).length
        await history(client, rule.id, 'REJUDGE', { scope, rejudged: next.length, changed }, req.user.sub)
        return { ruleVersion: rule.version, scope, rejudged: next.length, changed }
      })
    },
  )

  app.get('/rules/history', async () => {
    const { rows } = await pool.query(
      `SELECT h.id, h.action, h.detail, h.created_at, r.version, u.name AS actor
         FROM rule_history h JOIN rules r ON r.id = h.rule_id LEFT JOIN users u ON u.id = h.created_by
        WHERE r.name = $1 ORDER BY h.id DESC LIMIT 30`,
      [appConfig.ruleName],
    )
    return { items: rows.map((r) => ({ id: String(r.id), action: r.action, version: r.version, detail: r.detail, at: r.created_at, actor: r.actor ?? '시스템' })) }
  })
}

