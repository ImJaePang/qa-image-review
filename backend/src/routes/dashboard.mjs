// 대시보드(홈): 지금 해야 할 일과 현황을 한 번에. 범위는 사람마다 다르다.
//  - 이미지 분포: 'image.view_all' 권한자는 전체, 그 외는 내게 배정된 이미지만 (이미지 목록·파일 API와 같은 기준)
//  - 배정·검수 진행·최근 7일 검수: 'assignment.manage' 권한자는 전체, 그 외는 내 것만
//  - 아직 배정되지 않은 검수 대상(의심·불량): 배정 관리 권한자에게만 (신규 배정이 필요한지 알려 준다)
//  - 날짜는 브라우저의 시간대(tz)로 나눠 센다. 기본 UTC.
import { pool } from '../db.mjs'
import { httpError } from '../errors.mjs'
import { LATEST_RUN, latestVerdict } from '../sql.mjs'
import { can, requirePermission } from '../permissions.mjs'

const TZ_PATTERN = '^[A-Za-z0-9_+/-]{1,40}$'

export default async function dashboardRoutes(app) {
  app.addHook('onRequest', app.authenticate)
  app.addHook('onRequest', requirePermission('dashboard.view'))

  app.get(
    '/dashboard',
    { schema: { querystring: { type: 'object', properties: { tz: { type: 'string', pattern: TZ_PATTERN, default: 'UTC' } } } } },
    async (req) => {
      const { tz } = req.query
      try {
        await pool.query('SELECT now() AT TIME ZONE $1', [tz])
      } catch {
        throw httpError(400, '시간대가 올바르지 않습니다.')
      }
      const uid = req.user.sub
      const manage = can(req.user, 'assignment.manage')
      const viewAll = can(req.user, 'image.view_all')

      const [images, targets, assignments, review, daily, mine] = await Promise.all([
        pool.query(
          `SELECT v.result, count(*)::int AS n
           FROM images i ${LATEST_RUN} ${latestVerdict('lr.id')}
           WHERE i.ingest_status = 'DONE' AND lr.id IS NOT NULL
             AND ($1::boolean OR EXISTS (SELECT 1 FROM assignment_images ai JOIN assignments a ON a.id = ai.assignment_id WHERE ai.image_id = i.id AND a.assignee_id = $2))
           GROUP BY v.result`,
          [viewAll, uid],
        ),
        manage
          ? pool.query(
              `SELECT v.result, count(*)::int AS n
               FROM images i ${LATEST_RUN} ${latestVerdict('lr.id')}
               WHERE i.ingest_status = 'DONE' AND lr.id IS NOT NULL AND v.result IN ('SUSPECT', 'DEFECT')
                 AND NOT EXISTS (SELECT 1 FROM assignment_images ai WHERE ai.image_id = i.id)
               GROUP BY v.result`,
            )
          : null,
        pool.query(`SELECT a.status, count(*)::int AS n FROM assignments a WHERE ($1::boolean OR a.assignee_id = $2) GROUP BY a.status`, [manage, uid]),
        pool.query(
          `SELECT count(*)::int AS total, count(rc.status)::int AS reviewed,
                  count(*) FILTER (WHERE rc.status = 'APPROVED')::int AS approved,
                  count(*) FILTER (WHERE rc.status = 'REJECTED')::int AS rejected
           FROM assignment_images ai JOIN assignments a ON a.id = ai.assignment_id
           LEFT JOIN review_current rc ON rc.assignment_id = ai.assignment_id AND rc.image_id = ai.image_id
           WHERE ($1::boolean OR a.assignee_id = $2)`,
          [manage, uid],
        ),
        pool.query(
          `WITH days AS (SELECT (now() AT TIME ZONE $1)::date - g AS d FROM generate_series(6, 0, -1) g)
           SELECT to_char(days.d, 'YYYY-MM-DD') AS date, count(r.id)::int AS n
           FROM days LEFT JOIN reviews r ON (r.decided_at AT TIME ZONE $1)::date = days.d AND ($2::boolean OR r.reviewer_id = $3)
           GROUP BY days.d ORDER BY days.d`,
          [tz, manage, uid],
        ),
        pool.query(
          `SELECT count(DISTINCT a.id)::int AS open_assignments, count(*) FILTER (WHERE rc.status IS NULL)::int AS unreviewed
           FROM assignments a JOIN assignment_images ai ON ai.assignment_id = a.id
           LEFT JOIN review_current rc ON rc.assignment_id = ai.assignment_id AND rc.image_id = ai.image_id
           WHERE a.assignee_id = $1 AND a.status IN ('ASSIGNED', 'IN_REVIEW')`,
          [uid],
        ),
      ])

      const dist = (rows, keys) => Object.fromEntries(keys.map((k) => [k, rows.find((r) => r.result === k || r.status === k)?.n ?? 0]))
      return {
        scope: { images: viewAll ? 'all' : 'mine', work: manage ? 'all' : 'mine' },
        images: dist(images.rows, ['NORMAL', 'SUSPECT', 'DEFECT']),
        unassignedTargets: targets ? dist(targets.rows, ['SUSPECT', 'DEFECT']) : null,
        assignments: dist(assignments.rows, ['ASSIGNED', 'IN_REVIEW', 'REVIEWED', 'CONFIRMED']),
        review: review.rows[0],
        daily: daily.rows.map((r) => ({ date: r.date, count: r.n })),
        mine: { openAssignments: mine.rows[0].open_assignments, unreviewed: mine.rows[0].unreviewed },
      }
    },
  )
}
