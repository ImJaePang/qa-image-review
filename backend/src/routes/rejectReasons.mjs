// 반려 사유 관리 API ('reject_reason.manage')와 반려 사유 분석 통계 ('reject_stats.view').
//  관리: 사유를 만들고 이름·코멘트 필수 여부·순서를 고친다. 순서가 곧 검수 화면의 숫자키(1~9)다.
//   - 삭제 대신 '사용 안 함'이 기본: 반려 상자의 선택지에서만 빠지고, 저장된 반려 기록·통계는 그대로다.
//     진짜 삭제는 반려에 쓰인 적도, 만든 뒤 바꾼 이력도 없을 때만. 연쇄 삭제는 쓰지 않는다. 모든 변경은 reject_reason_history에.
//   - 코드는 만든 뒤 바꿀 수 없다(반려 기록에는 코드가 저장되므로). 이름을 바꾸면 지난 기록도 새 이름으로 보인다.
//  통계: 이미지마다 현재 결정이 반려인 것만(번복된 기록 제외), 반려 상자에 미리 골라 두는 AI 원인과 검수자가 고른 사유를 비교한다.
import { pool } from '../db.mjs'
import { httpError } from '../errors.mjs'
import { requirePermission } from '../permissions.mjs'
import { txWith } from '../tx.mjs'

const CODE_RE = '^[A-Z][A-Z0-9_]{1,39}$'
const codeParams = { type: 'object', required: ['code'], properties: { code: { type: 'string', maxLength: 40 } } }
const rejectUnknown = (allowed) => async (req) => {
  const extra = Object.keys(req.body ?? {}).filter((k) => !allowed.includes(k))
  if (extra.length) throw httpError(400, `알 수 없는 항목: ${extra.join(', ')}`)
}
const editable = {
  label: { type: 'string', minLength: 1, maxLength: 30 },
  requiresComment: { type: 'boolean' },
}

const SELECT = `
  SELECT r.code, r.label, r.sort_order, r.requires_comment, r.active, r.ai_reason, r.created_at,
         u.used_count, u.last_used_at,
         (SELECT count(*)::int FROM reject_reason_history h WHERE h.reason_code = r.code AND h.action <> 'CREATE') AS change_count
    FROM reject_reasons r
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS used_count, max(v.decided_at) AS last_used_at FROM reviews v WHERE r.code = ANY (v.reasons)
    ) u ON true`
const toDto = (r) => ({
  code: r.code,
  label: r.label,
  sortOrder: r.sort_order,
  requiresComment: r.requires_comment,
  active: r.active,
  aiReason: r.ai_reason,
  usedCount: r.used_count,
  lastUsedAt: r.last_used_at,
  createdAt: r.created_at,
  // 삭제 가능: 반려에 쓰인 적 없고 만든 뒤 바꾼 이력도 없을 때
  deletable: r.used_count === 0 && r.change_count === 0,
})
const history = (db, code, action, detail, actor) =>
  db.query('INSERT INTO reject_reason_history (reason_code, action, detail, created_by) VALUES ($1, $2, $3, $4)', [code, action, JSON.stringify(detail), actor])

async function loadOne(db, code, { lock = false } = {}) {
  const { rows } = await db.query(`${SELECT} WHERE r.code = $1${lock ? ' FOR UPDATE OF r' : ''}`, [code])
  if (!rows.length) throw httpError(404, '반려 사유를 찾을 수 없습니다.')
  return rows[0]
}
async function assertLabelFree(db, label, code = null) {
  const { rowCount } = await db.query('SELECT 1 FROM reject_reasons WHERE label = $1 AND code IS DISTINCT FROM $2', [label, code])
  if (rowCount) throw httpError(409, '이미 있는 사유 이름입니다.')
}

async function adminRoutes(app) {
  app.addHook('onRequest', app.authenticate)
  app.addHook('onRequest', requirePermission('reject_reason.manage'))

  // 전체 목록(사용 안 함 포함, 순서대로). 사유는 몇 개뿐이라 페이징하지 않는다.
  app.get('/admin/reject-reasons', async () => {
    const { rows } = await pool.query(`${SELECT} ORDER BY r.sort_order, r.code`)
    return { items: rows.map(toDto) }
  })

  // 수정 모달용: 사유 + 변경 이력
  app.get('/admin/reject-reasons/:code', { schema: { params: codeParams } }, async (req) => {
    const reason = toDto(await loadOne(pool, req.params.code))
    const { rows } = await pool.query(
      `SELECT h.id, h.action, h.detail, h.created_at, u.name AS actor FROM reject_reason_history h LEFT JOIN users u ON u.id = h.created_by
        WHERE h.reason_code = $1 ORDER BY h.id DESC LIMIT 50`,
      [req.params.code],
    )
    return { reason, history: rows.map((h) => ({ id: String(h.id), action: h.action, detail: h.detail, at: h.created_at, actor: h.actor ?? '시스템' })) }
  })

  app.post(
    '/admin/reject-reasons',
    {
      preValidation: rejectUnknown(['code', ...Object.keys(editable)]),
      schema: { body: { type: 'object', required: ['code', 'label'], properties: { code: { type: 'string', pattern: CODE_RE }, ...editable } } },
    },
    async (req, reply) => {
      const b = req.body
      const label = b.label.trim()
      if (!label) throw httpError(400, '이름을 입력하세요.')
      const reason = await txWith(pool, async (client) => {
        if ((await client.query('SELECT 1 FROM reject_reasons WHERE code = $1', [b.code])).rowCount) throw httpError(409, '이미 있는 사유 코드입니다.')
        await assertLabelFree(client, label)
        // 맨 뒤에 붙인다 (기존 사유의 숫자키가 바뀌지 않게)
        const { rows } = await client.query('SELECT coalesce(max(sort_order), 0) + 1 AS n FROM reject_reasons')
        await client.query('INSERT INTO reject_reasons (code, label, sort_order, requires_comment) VALUES ($1, $2, $3, $4)', [b.code, label, rows[0].n, b.requiresComment ?? false])
        await history(client, b.code, 'CREATE', { label, requiresComment: b.requiresComment ?? false }, req.user.sub)
        return loadOne(client, b.code)
      })
      return reply.code(201).send({ reason: toDto(reason) })
    },
  )

  app.patch(
    '/admin/reject-reasons/:code',
    { preValidation: rejectUnknown(Object.keys(editable)), schema: { params: codeParams, body: { type: 'object', properties: editable } } },
    async (req) => {
      const { code } = req.params
      const b = req.body
      return txWith(pool, async (client) => {
        const cur = await loadOne(client, code, { lock: true })
        const label = b.label?.trim()
        if (b.label !== undefined && !label) throw httpError(400, '이름을 입력하세요.')
        const changes = {}
        if (label !== undefined && label !== cur.label) {
          await assertLabelFree(client, label, code)
          changes.label = { from: cur.label, to: label }
        }
        if (b.requiresComment !== undefined && b.requiresComment !== cur.requires_comment) changes.requiresComment = { from: cur.requires_comment, to: b.requiresComment }
        if (Object.keys(changes).length) {
          await client.query('UPDATE reject_reasons SET label = $2, requires_comment = $3 WHERE code = $1', [code, changes.label?.to ?? cur.label, changes.requiresComment?.to ?? cur.requires_comment])
          await history(client, code, 'UPDATE', changes, req.user.sub)
        }
        return { reason: toDto(await loadOne(client, code)) }
      })
    },
  )

  // 순서 저장: 모든 사유 코드를 새 순서대로 받는다(사용 안 함 포함). 바뀐 사유만 이력에 남긴다.
  app.put(
    '/admin/reject-reasons/order',
    {
      preValidation: rejectUnknown(['codes']),
      schema: { body: { type: 'object', required: ['codes'], properties: { codes: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 200, uniqueItems: true } } } },
    },
    async (req) => {
      const { codes } = req.body
      return txWith(pool, async (client) => {
        const { rows } = await client.query('SELECT code, sort_order FROM reject_reasons FOR UPDATE')
        const cur = new Map(rows.map((r) => [r.code, r.sort_order]))
        if (codes.length !== cur.size || codes.some((c) => !cur.has(c))) throw httpError(409, '사유 목록이 바뀌었습니다. 새로 고친 뒤 다시 저장하세요.')
        for (const [i, code] of codes.entries()) {
          const to = i + 1
          if (cur.get(code) === to) continue
          await client.query('UPDATE reject_reasons SET sort_order = $2 WHERE code = $1', [code, to])
          await history(client, code, 'REORDER', { sortOrder: { from: cur.get(code), to } }, req.user.sub)
        }
        const list = await client.query(`${SELECT} ORDER BY r.sort_order, r.code`)
        return { items: list.rows.map(toDto) }
      })
    },
  )

  // 사용 안 함 ↔ 사용 중. 저장된 반려 기록은 건드리지 않는다.
  for (const [path, active, action] of [['deactivate', false, 'DEACTIVATE'], ['activate', true, 'ACTIVATE']]) {
    app.post(`/admin/reject-reasons/:code/${path}`, { schema: { params: codeParams } }, async (req) => {
      const { code } = req.params
      return txWith(pool, async (client) => {
        const cur = await loadOne(client, code, { lock: true })
        if (cur.active !== active) {
          if (!active) {
            const { rows } = await client.query('SELECT count(*)::int AS n FROM reject_reasons WHERE active AND code <> $1', [code])
            if (rows[0].n === 0) throw httpError(409, '사용 중인 사유가 하나는 있어야 반려할 수 있습니다.')
          }
          await client.query('UPDATE reject_reasons SET active = $2 WHERE code = $1', [code, active])
          await history(client, code, action, {}, req.user.sub)
        }
        return { reason: toDto(await loadOne(client, code)) }
      })
    })
  }

  // 진짜 삭제: 반려에 쓰인 적 없고 변경 이력도 없을 때만 (잘못 만든 사유 바로잡기용)
  app.delete('/admin/reject-reasons/:code', { schema: { params: codeParams } }, async (req) => {
    const { code } = req.params
    return txWith(pool, async (client) => {
      const cur = await loadOne(client, code, { lock: true })
      if (cur.used_count > 0) throw httpError(409, `반려 ${cur.used_count}건에 쓰인 사유라 삭제할 수 없습니다. 「사용 안 함」으로 바꾸세요.`)
      if (!toDto(cur).deletable) throw httpError(409, '변경 이력이 있어 삭제할 수 없습니다. 「사용 안 함」으로 바꾸세요.')
      if (cur.active) {
        const { rows } = await client.query('SELECT count(*)::int AS n FROM reject_reasons WHERE active AND code <> $1', [code])
        if (rows[0].n === 0) throw httpError(409, '사용 중인 사유가 하나는 있어야 반려할 수 있습니다.')
      }
      await client.query('DELETE FROM reject_reasons WHERE code = $1', [code])
      await history(client, code, 'DELETE', { label: cur.label }, req.user.sub)
      return { deleted: code }
    })
  })
}

// ── 통계 ──
// 반려 한 건마다: 검수자가 고른 사유(human)와, 반려 상자가 미리 골라 두는 AI 원인(ai) = 배정 때 쓴 모델 실행의 이상 영역 원인 중
// 사유 목록에 있는 코드(사용 안 함 포함 — 지난 반려를 그때 기준으로 본다). UNKNOWN처럼 사유에 없는 코드는 'AI 원인 없음'이 된다.
const REJECTS = `
  rj AS (
    SELECT rc.reviewer_id, rc.reasons AS human,
           coalesce((SELECT array_agg(DISTINCT d.reason_code ORDER BY d.reason_code)
                       FROM detections d JOIN reject_reasons r ON r.code = d.reason_code
                      WHERE d.run_id = ai.run_id), '{}') AS ai
      FROM review_current rc
      JOIN assignment_images ai ON ai.assignment_id = rc.assignment_id AND ai.image_id = rc.image_id
     WHERE rc.status = 'REJECTED' AND cardinality(rc.reasons) > 0
       AND ($1::int IS NULL OR rc.decided_at >= now() - make_interval(days => $1))
       AND ($2::bigint IS NULL OR rc.reviewer_id = $2)
  )`

async function statsRoutes(app) {
  app.addHook('onRequest', app.authenticate)
  app.addHook('onRequest', requirePermission('reject_stats.view'))

  app.get(
    '/stats/reject-reasons',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { days: { type: 'integer', enum: [7, 30] }, reviewerId: { type: 'string', pattern: '^[0-9]{1,18}$' } },
        },
      },
    },
    async (req) => {
      const params = [req.query.days ?? null, req.query.reviewerId ?? null]
      const [summary, perReason, swaps, reviewers] = await Promise.all([
        pool.query(
          `WITH ${REJECTS}
           SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE cardinality(ai) > 0 AND ai <@ human AND human <@ ai)::int AS kept,
                  count(*) FILTER (WHERE ai && human AND NOT (ai <@ human AND human <@ ai))::int AS partial,
                  count(*) FILTER (WHERE cardinality(ai) > 0 AND NOT ai && human)::int AS replaced,
                  count(*) FILTER (WHERE cardinality(ai) = 0)::int AS no_ai
             FROM rj`,
          params,
        ),
        pool.query(
          `WITH ${REJECTS}
           SELECT r.code, r.label, r.ai_reason, r.active,
                  count(*) FILTER (WHERE r.code = ANY (rj.ai))::int AS ai,
                  count(*) FILTER (WHERE r.code = ANY (rj.human))::int AS human,
                  count(*) FILTER (WHERE r.code = ANY (rj.ai) AND r.code = ANY (rj.human))::int AS both
             FROM reject_reasons r LEFT JOIN rj ON true
            GROUP BY r.code ORDER BY r.sort_order, r.code`,
          params,
        ),
        // AI가 제시했지만 검수자가 빼고, 대신 고른 사유 (한 반려에서 뺀 것 × 더한 것)
        pool.query(
          `WITH ${REJECTS}
           SELECT fa.label AS from_label, ta.label AS to_label, count(*)::int AS n
             FROM rj
             CROSS JOIN LATERAL unnest(rj.ai) f(code)
             CROSS JOIN LATERAL unnest(rj.human) t(code)
             JOIN reject_reasons fa ON fa.code = f.code
             JOIN reject_reasons ta ON ta.code = t.code
            WHERE NOT f.code = ANY (rj.human) AND NOT t.code = ANY (rj.ai)
            GROUP BY fa.label, ta.label ORDER BY n DESC, fa.label, ta.label LIMIT 5`,
          params,
        ),
        // 검수자 선택지: 기간 안에 반려한 적이 있는 사람 (검수자 필터는 빼고 센다)
        pool.query(
          `WITH ${REJECTS} SELECT u.id, u.name, count(*)::int AS n FROM rj JOIN users u ON u.id = rj.reviewer_id GROUP BY u.id, u.name ORDER BY u.name`,
          [params[0], null],
        ),
      ])
      const s = summary.rows[0]
      return {
        total: s.total,
        outcome: { kept: s.kept, partial: s.partial, replaced: s.replaced, noAi: s.no_ai },
        reasons: perReason.rows.map((r) => ({ code: r.code, label: r.label, aiReason: r.ai_reason, active: r.active, ai: r.ai, human: r.human, both: r.both })),
        swaps: swaps.rows.map((r) => ({ from: r.from_label, to: r.to_label, count: r.n })),
        reviewers: reviewers.rows.map((r) => ({ id: String(r.id), name: r.name, count: r.n })),
      }
    },
  )
}

export default async function rejectReasonRoutes(app) {
  await app.register(adminRoutes)
  await app.register(statsRoutes)
}
