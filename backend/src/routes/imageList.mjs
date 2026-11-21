// 이미지 목록: 수신 완료된 이미지를 판정·배정 여부·검색으로 찾아본다 (데이터 > 이미지 > 이미지 목록).
//  - 범위: 'image.view_all' 권한자는 전부, 그 외는 자기에게 배정된 이미지만 (파일 API와 같은 기준).
//  - 수신·추론이 끝난(DONE) 이미지만 나온다. 실패·대기 건은 연계 관리에서 본다.
//  - 상세(/image-list/:imageKey)는 확대 보기에 필요한 박스·히트맵을 준다. 검수 정보는 배정 안에서만 의미가 있어 항상 '미검토'로 둔다.
import { pool } from '../db.mjs'
import { httpError } from '../errors.mjs'
import { pagingQuery } from '../paging.mjs'
import { LATEST_RUN, latestVerdict } from '../sql.mjs'
import { can, requirePermission } from '../permissions.mjs'

const fileUrl = (key, kind) => `/api/images/${key}/${kind}`
const SORTS = {
  newest: 'i.id DESC',
  score_asc: 'lr.overall_score ASC, i.id DESC',
  score_desc: 'lr.overall_score DESC, i.id DESC',
}

// $1 = 전부 볼 수 있는가, $2 = 사용자 id, $3 = 판정, $4 = 배정 여부, $5 = 검색어
const FROM = `
  FROM images i ${LATEST_RUN}
  ${latestVerdict('lr.id')}
  LEFT JOIN LATERAL (
    SELECT a.code, a.status FROM assignment_images ai JOIN assignments a ON a.id = ai.assignment_id
    WHERE ai.image_id = i.id ORDER BY ai.assignment_id DESC LIMIT 1
  ) asg ON true
  WHERE i.ingest_status = 'DONE' AND lr.id IS NOT NULL
    AND ($1::boolean OR EXISTS (SELECT 1 FROM assignment_images ai JOIN assignments a ON a.id = ai.assignment_id WHERE ai.image_id = i.id AND a.assignee_id = $2))
    AND ($3::text IS NULL OR v.result = $3)
    AND ($4::text = 'all' OR ($4 = 'unassigned' AND asg.code IS NULL) OR ($4 = 'assigned' AND asg.code IS NOT NULL))
    AND ($5::text IS NULL OR i.file_name ILIKE $5 OR i.image_key ILIKE $5)`

export default async function imageListRoutes(app) {
  app.addHook('onRequest', app.authenticate)
  app.addHook('onRequest', requirePermission('image_list.view'))

  app.get(
    '/image-list',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            verdict: { type: 'string', enum: ['NORMAL', 'SUSPECT', 'DEFECT'] },
            assigned: { type: 'string', enum: ['all', 'unassigned', 'assigned'], default: 'all' },
            q: { type: 'string', maxLength: 100 },
            sort: { type: 'string', enum: Object.keys(SORTS), default: 'newest' },
            ...pagingQuery,
          },
        },
      },
    },
    async (req) => {
      const { verdict = null, assigned, q = null, sort, page, pageSize } = req.query
      const like = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null
      const scope = [can(req.user, 'image.view_all'), req.user.sub]
      const [list, total, counts] = await Promise.all([
        pool.query(
          `SELECT i.image_key, i.file_name, i.width, i.height, i.created_at, lr.overall_score, v.result AS verdict,
                  asg.code AS assignment_code, asg.status AS assignment_status
           ${FROM} ORDER BY ${SORTS[sort]} LIMIT $6 OFFSET $7`,
          [...scope, verdict, assigned, like, pageSize, (page - 1) * pageSize],
        ),
        pool.query(`SELECT count(*) AS n ${FROM}`, [...scope, verdict, assigned, like]),
        // 판정 칩의 건수: 판정 필터만 빼고 같은 조건
        pool.query(`SELECT v.result, count(*) AS n ${FROM} GROUP BY v.result`, [...scope, null, assigned, like]),
      ])
      const verdictCounts = { NORMAL: 0, SUSPECT: 0, DEFECT: 0 }
      counts.rows.forEach((r) => (verdictCounts[r.result] = r.n))
      return {
        items: list.rows.map((r) => ({
          imageKey: r.image_key,
          fileName: r.file_name,
          width: r.width,
          height: r.height,
          receivedAt: r.created_at,
          overallScore: r.overall_score,
          verdict: r.verdict,
          assignmentId: r.assignment_code,
          assignmentStatus: r.assignment_status,
          thumbUrl: fileUrl(r.image_key, 'thumb'),
        })),
        total: total.rows[0].n,
        page,
        pageSize,
        verdictCounts,
      }
    },
  )

  // 한 장의 상세 (확대 보기용). 목록과 같은 범위 규칙을 적용한다.
  app.get(
    '/image-list/:imageKey',
    { schema: { params: { type: 'object', required: ['imageKey'], properties: { imageKey: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,50}$' } } } } },
    async (req) => {
      const { rows } = await pool.query(
        `SELECT i.id, i.image_key, i.file_name, i.width, i.height, i.ingest_status, mr.model_version, mr.overall_score, mr.heatmap_path,
                v.result AS verdict, v.reasons,
                COALESCE((SELECT json_agg(json_build_object('x', d.x, 'y', d.y, 'width', d.width, 'height', d.height,
                                                            'score', d.score, 'reasonCode', d.reason_code) ORDER BY d.score, d.id)
                          FROM detections d WHERE d.run_id = lr.id), '[]'::json) AS boxes
         FROM images i ${LATEST_RUN}
         LEFT JOIN model_runs mr ON mr.id = lr.id
         ${latestVerdict('lr.id')}
         WHERE i.image_key = $1`,
        [req.params.imageKey],
      )
      const r = rows[0]
      if (!r || r.ingest_status !== 'DONE') throw httpError(404, '이미지를 찾을 수 없습니다.')
      if (!can(req.user, 'image.view_all')) {
        const own = await pool.query(
          `SELECT 1 FROM assignment_images ai JOIN assignments a ON a.id = ai.assignment_id WHERE ai.image_id = $1 AND a.assignee_id = $2 LIMIT 1`,
          [r.id, req.user.sub],
        )
        if (!own.rowCount) throw httpError(403, '권한이 없습니다.')
      }
      return {
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
        review: { status: 'NONE', comment: '', reasons: [], reviewedAt: null, reviewerName: null }, // 검수는 배정 안에서만 한다
      }
    },
  )
}
