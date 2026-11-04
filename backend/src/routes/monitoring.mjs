// 소요 시간 분석. 클라이언트가 측정한 값은 쓰지 않고, 서버가 저장한 시각만으로 계산한다.
//  - 이미지별 작업 속도: 같은 담당자·같은 배정에서 연속된 검수(reviews.decided_at) 사이의 간격.
//    gapMinutes보다 길게 벌어진 구간은 자리를 비운 것으로 보고 평균에서 제외한다.
//  - 배정 단위: 점검 시작(IN_REVIEW) ~ 점검 완료(REVIEWED) 시각 차이(assignment_history) ÷ 검수한 이미지 수.
//  - 모델: model_runs.duration_ms, 수신 배치: ingest_batches 시작/종료 시각. (과거 batch_jobs=사전배치 기록은 더 이상 쓰지 않는다)
import { pool } from '../db.mjs'
import { httpError } from '../errors.mjs'
import { can } from '../permissions.mjs'

// 검수 행마다 직전 검수와의 간격(초). 번복(같은 이미지 재검수)도 하나의 작업으로 본다.
const GAPS = `
  gaps AS (
    SELECT id, reviewer_id, assignment_id, image_id, decided_at,
           extract(epoch FROM decided_at - lag(decided_at) OVER (
             PARTITION BY reviewer_id, assignment_id ORDER BY decided_at, id)) AS gap
    FROM reviews
  )`

const round = (v, d = 1) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d)

export default async function monitoringRoutes(app) {
  app.addHook('onRequest', app.authenticate)

  app.get(
    '/monitoring/time',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { gapMinutes: { type: 'integer', minimum: 1, maximum: 120, default: 5 } },
        },
      },
    },
    async (req) => {
      if (!can(req.user, 'monitoring.view')) throw httpError(403, '권한이 없습니다.')
      const { gapMinutes } = req.query
      const limit = gapMinutes * 60

      const [reviewers, assignments, models, batches] = await Promise.all([
        pool.query(
          `WITH ${GAPS}
           SELECT u.id, u.name,
                  count(*) AS decisions,
                  count(DISTINCT g.assignment_id::text || ':' || g.image_id::text) AS images,
                  count(*) FILTER (WHERE g.gap <= $1) AS timed,
                  count(*) FILTER (WHERE g.gap > $1) AS idle_gaps,
                  coalesce(sum(g.gap) FILTER (WHERE g.gap <= $1), 0) AS active_seconds,
                  avg(g.gap) FILTER (WHERE g.gap <= $1) AS avg_seconds,
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY g.gap) FILTER (WHERE g.gap <= $1) AS median_seconds
           FROM gaps g JOIN users u ON u.id = g.reviewer_id
           GROUP BY u.id, u.name ORDER BY u.name`,
          [limit],
        ),
        pool.query(
          `WITH ${GAPS},
           act AS (
             SELECT assignment_id,
                    count(DISTINCT image_id) AS reviewed,
                    coalesce(sum(gap) FILTER (WHERE gap <= $1), 0) AS active_seconds
             FROM gaps GROUP BY assignment_id
           ),
           h AS (
             SELECT assignment_id,
                    min(at) FILTER (WHERE to_status = 'ASSIGNED')   AS assigned_at,
                    max(at) FILTER (WHERE to_status = 'IN_REVIEW')  AS started_at,
                    max(at) FILTER (WHERE to_status = 'REVIEWED')   AS finished_at,
                    max(at) FILTER (WHERE to_status = 'CONFIRMED')  AS confirmed_at
             FROM assignment_history GROUP BY assignment_id
           )
           SELECT a.code, a.title, a.status, u.name AS assignee,
                  (SELECT count(*) FROM assignment_images WHERE assignment_id = a.id) AS total_images,
                  coalesce(act.reviewed, 0) AS reviewed,
                  coalesce(act.active_seconds, 0) AS active_seconds,
                  extract(epoch FROM h.finished_at - h.started_at) AS review_seconds,
                  extract(epoch FROM h.confirmed_at - h.assigned_at) AS lead_seconds
           FROM assignments a
           JOIN users u ON u.id = a.assignee_id
           LEFT JOIN act ON act.assignment_id = a.id
           LEFT JOIN h ON h.assignment_id = a.id
           ORDER BY a.id DESC`,
          [limit],
        ),
        pool.query(
          `SELECT model_version, count(*) AS runs, avg(duration_ms) AS avg_ms,
                  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms, max(duration_ms) AS max_ms
           FROM model_runs WHERE duration_ms IS NOT NULL GROUP BY model_version ORDER BY model_version`,
        ),
        pool.query(
          `SELECT b.id, i.name AS integration, b.total_count, b.processed_count, b.failed_count, b.started_at,
                  extract(epoch FROM b.finished_at - b.started_at) AS seconds
           FROM ingest_batches b JOIN integrations i ON i.id = b.integration_id
           ORDER BY b.id DESC LIMIT 50`,
        ),
      ])

      return {
        gapMinutes,
        reviewers: reviewers.rows.map((r) => ({
          id: String(r.id),
          name: r.name,
          decisions: r.decisions,
          images: r.images,
          overturned: r.decisions - r.images, // 같은 이미지를 다시 판정한 횟수
          timedDecisions: r.timed,
          idleGaps: r.idle_gaps,
          activeSeconds: round(r.active_seconds),
          avgSecondsPerImage: round(r.avg_seconds),
          medianSecondsPerImage: round(r.median_seconds),
        })),
        assignments: assignments.rows.map((r) => ({
          id: r.code,
          title: r.title,
          status: r.status,
          assignee: r.assignee,
          totalImages: r.total_images,
          reviewed: r.reviewed,
          reviewSeconds: round(r.review_seconds), // 점검 시작 ~ 점검 완료 (아직 끝나지 않았으면 null)
          activeSeconds: round(r.active_seconds), // 자리 비움 제외한 실작업 시간
          avgSecondsPerImage: r.review_seconds !== null && r.reviewed > 0 ? round(r.review_seconds / r.reviewed) : null,
          avgActiveSecondsPerImage: r.reviewed > 0 ? round(r.active_seconds / r.reviewed) : null,
          leadSeconds: round(r.lead_seconds), // 배정 ~ 확인 완료
        })),
        models: models.rows.map((r) => ({
          modelVersion: r.model_version,
          runs: r.runs,
          avgMs: round(r.avg_ms),
          p95Ms: round(r.p95_ms),
          maxMs: r.max_ms,
        })),
        // 수신 배치(스캔 1회에 발견된 파일 묶음): 끝나지 않은 배치는 seconds가 null
        ingestBatches: batches.rows.map((r) => ({
          id: String(r.id),
          integration: r.integration,
          startedAt: r.started_at,
          total: r.total_count,
          processed: r.processed_count,
          failed: r.failed_count,
          seconds: round(r.seconds),
          secondsPerImage: r.seconds !== null && r.processed_count > 0 ? round(r.seconds / r.processed_count, 3) : null,
        })),
      }
    },
  )
}
