import { pool, tx } from '../db.mjs'
import { httpError } from '../errors.mjs'
import { currentReview, latestVerdict, RULE_OF_VERDICT } from '../sql.mjs'
import { VIEW_ORDERS, boundaryExpr, orderBySql } from '../imageOrder.mjs'
import { requireAnyPermission } from '../permissions.mjs'
import { canAct, codeParam, findAssignment } from './assignments.mjs'

const FILTERS = {
  all: 'true',
  unreviewed: 'rc.status IS NULL',
  approved: "rc.status = 'APPROVED'",
  rejected: "rc.status = 'REJECTED'",
}

// 배정 안의 이미지 목록 공통: 목록·건수·다음 미검토가 같은 조건과 정렬을 쓴다
const FROM = `
  FROM assignment_images ai
  JOIN images i ON i.id = ai.image_id
  JOIN model_runs mr ON mr.id = ai.run_id
  ${latestVerdict('ai.run_id')}
  ${RULE_OF_VERDICT}
  ${currentReview('ai.assignment_id', 'ai.image_id')}`
const WHERE = (filter) => `WHERE ai.assignment_id = $1 AND ${FILTERS[filter]} AND ($2::text IS NULL OR v.result = $2)`
const viewOrder = (sort) =>
  `${
    sort === 'position'
      ? 'ai.position'
      : orderBySql(sort, {
          score: 'mr.overall_score',
          boundary: boundaryExpr('mr.overall_score', 'ru.params'),
          boxes: '(SELECT count(*) FROM detections d WHERE d.run_id = ai.run_id)',
          newest: 'i.id',
        })
  }, ai.position`
const QUERY_FILTERS = {
  filter: { type: 'string', enum: Object.keys(FILTERS), default: 'all' },
  verdict: { type: 'string', enum: ['NORMAL', 'SUSPECT', 'DEFECT'] },
  sort: { type: 'string', enum: VIEW_ORDERS, default: 'position' },
}

// 파일은 이미지 ID로 요청한다 (routes/files.mjs). 디스크 경로는 URL에 나오지 않는다.
const fileUrl = (key, kind) => `/api/images/${key}/${kind}`

const toItem = (r) => ({
  imageId: r.image_key,
  fileName: r.file_name,
  width: r.width,
  height: r.height,
  modelVersion: r.model_version,
  overallScore: r.overall_score,
  verdict: r.verdict,
  reasons: r.reasons ?? [],
  boxes: r.boxes,
  thumbUrl: fileUrl(r.image_key, 'thumb'),
  previewUrl: fileUrl(r.image_key, 'preview'),
  originalUrl: fileUrl(r.image_key, 'original'),
  heatmapUrl: r.heatmap_path ? fileUrl(r.image_key, 'heatmap') : null,
  review: {
    status: r.review_status ?? 'NONE', // NONE = 미검토
    comment: r.review_comment ?? '',
    reviewedAt: r.decided_at ?? null,
    reviewerName: r.reviewer_name ?? null,
  },
})

export default async function imageRoutes(app) {
  app.addHook('onRequest', app.authenticate)
  app.addHook('onRequest', requireAnyPermission(['assignment.view', 'my_assignment.view']))

  // 배정의 이미지 페이지 조회 (검수 화면 정렬 순서 = position)
  app.get(
    '/assignments/:code/images',
    {
      schema: {
        params: codeParam,
        querystring: {
          type: 'object',
          properties: {
            ...QUERY_FILTERS,
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          },
        },
      },
    },
    async (req) => {
      const { filter, verdict = null, sort, page, pageSize } = req.query
      const a = await findAssignment(pool, req.params.code)
      const from = `${FROM} ${WHERE(filter)}`
      const [list, total] = await Promise.all([
        pool.query(
          `SELECT i.image_key, i.file_name, i.width, i.height, i.original_path, i.preview_path, i.thumb_path,
                  mr.model_version, mr.overall_score, mr.heatmap_path,
                  v.result AS verdict, v.reasons,
                  rc.status AS review_status, rc.comment AS review_comment, rc.decided_at,
                  (SELECT name FROM users WHERE id = rc.reviewer_id) AS reviewer_name,
                  COALESCE((SELECT json_agg(json_build_object('x', d.x, 'y', d.y, 'width', d.width, 'height', d.height,
                                                              'score', d.score, 'reasonCode', d.reason_code) ORDER BY d.score, d.id)
                            FROM detections d WHERE d.run_id = ai.run_id), '[]'::json) AS boxes
           ${from} ORDER BY ${viewOrder(sort)} LIMIT $3 OFFSET $4`,
          [a.id, verdict, pageSize, (page - 1) * pageSize],
        ),
        pool.query(`SELECT count(*) AS n ${from}`, [a.id, verdict]),
      ])
      return { items: list.rows.map(toItem), total: total.rows[0].n, page, pageSize }
    },
  )

  // 결과 칩의 건수: 판정 필터만 반영하고 결과(전체·미검토·승인·반려)는 각각 센다
  app.get(
    '/assignments/:code/image-counts',
    { schema: { params: codeParam, querystring: { type: 'object', properties: { verdict: QUERY_FILTERS.verdict } } } },
    async (req) => {
      const a = await findAssignment(pool, req.params.code)
      const { rows } = await pool.query(
        `SELECT count(*)::int AS "all",
                count(*) FILTER (WHERE rc.status IS NULL)::int AS unreviewed,
                count(*) FILTER (WHERE rc.status = 'APPROVED')::int AS approved,
                count(*) FILTER (WHERE rc.status = 'REJECTED')::int AS rejected
         ${FROM} ${WHERE('all')}`,
        [a.id, req.query.verdict ?? null],
      )
      return rows[0]
    },
  )

  // 다음 미검토 이미지 위치(1부터). 지금 보는 목록(결과 필터·판정·정렬)을 기준으로 한 위치이고,
  // after 뒤에서 찾고 없으면 처음부터 다시 찾는다. 기본값(필터 없음, 배정 순서)은 예전과 같은 위치(position)다.
  app.get(
    '/assignments/:code/next-unreviewed',
    {
      schema: {
        params: codeParam,
        querystring: { type: 'object', properties: { after: { type: 'integer', minimum: 0, default: 0 }, ...QUERY_FILTERS } },
      },
    },
    async (req) => {
      const { filter, verdict = null, sort } = req.query
      const a = await findAssignment(pool, req.params.code)
      const find = (after) =>
        pool.query(
          `WITH ordered AS (
             SELECT row_number() OVER (ORDER BY ${viewOrder(sort)}) AS pos, (rc.status IS NULL) AS unreviewed
             ${FROM} ${WHERE(filter)})
           SELECT pos::int AS pos FROM ordered WHERE unreviewed AND pos > $3 ORDER BY pos LIMIT 1`,
          [a.id, verdict, after],
        )
      let r = await find(req.query.after)
      if (!r.rowCount && req.query.after > 0) r = await find(0)
      return { position: r.rows[0]?.pos ?? null }
    },
  )

  // 검수 저장 (승인/반려). 판정을 바꾸면 행이 추가되고 최신 행이 현재 상태가 된다.
  app.put(
    '/assignments/:code/images/:imageKey/review',
    {
      schema: {
        params: {
          type: 'object',
          required: ['code', 'imageKey'],
          properties: { code: { type: 'string', pattern: '^AS-\\d{4,}$' }, imageKey: { type: 'string', maxLength: 50 } },
        },
        body: {
          type: 'object',
          required: ['status'],
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: ['APPROVED', 'REJECTED'] },
            comment: { type: 'string', maxLength: 1000, default: '' },
          },
        },
      },
    },
    async (req) => {
      const { status, comment } = req.body
      return tx(async (db) => {
        const a = await findAssignment(db, req.params.code, true)
        if (!canAct(req.user, a)) throw httpError(403, '담당자만 검수할 수 있습니다.')
        if (a.status !== 'IN_REVIEW') throw httpError(409, '점검중 상태에서만 검수할 수 있습니다.')

        const img = await db.query(
          `SELECT i.id FROM assignment_images ai JOIN images i ON i.id = ai.image_id
           WHERE ai.assignment_id = $1 AND i.image_key = $2`,
          [a.id, req.params.imageKey],
        )
        if (!img.rowCount) throw httpError(404, '배정에 없는 이미지입니다.')
        const imageId = img.rows[0].id

        // 직전과 같은 내용이면 행을 늘리지 않는다 (소요 시간 분석에 노이즈가 되므로)
        const last = await db.query(
          `SELECT status, comment FROM reviews WHERE assignment_id = $1 AND image_id = $2
           ORDER BY decided_at DESC, id DESC LIMIT 1`,
          [a.id, imageId],
        )
        const same = last.rowCount && last.rows[0].status === status && last.rows[0].comment === comment
        if (!same) {
          await db.query(
            `INSERT INTO reviews (assignment_id, image_id, reviewer_id, status, comment) VALUES ($1, $2, $3, $4, $5)`,
            [a.id, imageId, req.user.sub, status, comment],
          )
        }
        const prog = await db.query(
          `SELECT count(*) AS reviewed,
                  count(*) FILTER (WHERE status = 'APPROVED') AS approved,
                  count(*) FILTER (WHERE status = 'REJECTED') AS rejected
           FROM review_current WHERE assignment_id = $1`,
          [a.id],
        )
        return { imageId: req.params.imageKey, status, comment, progress: prog.rows[0] }
      })
    },
  )
}
