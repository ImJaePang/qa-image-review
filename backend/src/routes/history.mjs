// 점검 이력: 검수(승인/반려) 기록 목록. reviews는 쌓기만 하는 기록이라 번복도 한 줄씩 남아 있다.
//  - 기본은 내 기록. scope=all은 배정 관리 권한(assignment.manage)이 있어야 한다.
//  - isCurrent: 같은 배정·이미지의 가장 최근 결정이면 true, 이후에 번복되었으면 false.
import { pool } from '../db.mjs'
import { httpError } from '../errors.mjs'
import { pagingQuery } from '../paging.mjs'
import { canManage } from './assignments.mjs'
import { latestVerdict } from '../sql.mjs'
import { requirePermission } from '../permissions.mjs'

const fileUrl = (key, kind) => `/api/images/${key}/${kind}`

export default async function historyRoutes(app) {
  app.addHook('onRequest', app.authenticate)
  app.addHook('onRequest', requirePermission('history.view'))

  app.get(
    '/review-history',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            scope: { type: 'string', enum: ['mine', 'all'], default: 'mine' },
            status: { type: 'string', enum: ['APPROVED', 'REJECTED'] },
            q: { type: 'string', maxLength: 100 },
            ...pagingQuery,
          },
        },
      },
    },
    async (req) => {
      const { scope, status = null, q = null, page, pageSize } = req.query
      if (scope === 'all' && !canManage(req.user)) throw httpError(403, '전체 점검 이력을 볼 권한이 없습니다.')
      const reviewerId = scope === 'all' ? null : req.user.sub
      const like = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null

      const from = `
        FROM reviews r
        JOIN assignments a ON a.id = r.assignment_id
        JOIN images i ON i.id = r.image_id
        JOIN users u ON u.id = r.reviewer_id
        JOIN assignment_images ai ON ai.assignment_id = r.assignment_id AND ai.image_id = r.image_id
        JOIN model_runs mr ON mr.id = ai.run_id
        ${latestVerdict('ai.run_id')}
        WHERE ($1::bigint IS NULL OR r.reviewer_id = $1)
          AND ($2::text IS NULL OR r.status = $2)
          AND ($3::text IS NULL OR i.file_name ILIKE $3 OR a.title ILIKE $3 OR a.code ILIKE $3 OR r.comment ILIKE $3)`
      const [list, total, counts] = await Promise.all([
        pool.query(
          `SELECT r.id, r.status, r.comment, r.decided_at, u.name AS reviewer_name,
                  (SELECT COALESCE(json_agg(json_build_object('code', rr.code, 'label', rr.label) ORDER BY rr.sort_order), '[]'::json)
                   FROM reject_reasons rr WHERE rr.code = ANY(r.reasons)) AS reasons,
                  a.code AS assignment_code, a.title AS assignment_title,
                  i.image_key, i.file_name, mr.overall_score, v.result AS verdict,
                  NOT EXISTS (SELECT 1 FROM reviews r2 WHERE r2.assignment_id = r.assignment_id AND r2.image_id = r.image_id
                                AND (r2.decided_at, r2.id) > (r.decided_at, r.id)) AS is_current
           ${from} ORDER BY r.decided_at DESC, r.id DESC LIMIT $4 OFFSET $5`,
          [reviewerId, status, like, pageSize, (page - 1) * pageSize],
        ),
        pool.query(`SELECT count(*) AS n ${from}`, [reviewerId, status, like]),
        // 상태 칩의 건수는 범위(내 것/전체)만 반영한다
        pool.query('SELECT status, count(*) AS n FROM reviews r WHERE ($1::bigint IS NULL OR r.reviewer_id = $1) GROUP BY status', [reviewerId]),
      ])
      const statusCounts = { APPROVED: 0, REJECTED: 0 }
      counts.rows.forEach((c) => (statusCounts[c.status] = c.n))
      return {
        items: list.rows.map((r) => ({
          id: String(r.id),
          status: r.status,
          comment: r.comment,
          reasons: r.reasons, // [{ code, label }] 반려 사유 (사용 안 함이 된 사유도 이름을 보여 준다)
          decidedAt: r.decided_at,
          reviewerName: r.reviewer_name,
          assignmentId: r.assignment_code,
          assignmentTitle: r.assignment_title,
          imageKey: r.image_key,
          fileName: r.file_name,
          overallScore: r.overall_score,
          verdict: r.verdict,
          thumbUrl: fileUrl(r.image_key, 'thumb'),
          isCurrent: r.is_current,
        })),
        total: total.rows[0].n,
        page,
        pageSize,
        statusCounts,
      }
    },
  )
}
