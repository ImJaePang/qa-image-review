import { pool, tx } from '../db.mjs'
import { httpError } from '../errors.mjs'
import { LATEST_RUN, latestVerdict } from '../sql.mjs'

const STATUSES = ['ASSIGNED', 'PRECHECKED', 'IN_REVIEW', 'REVIEWED', 'CONFIRMED']
const VERDICTS = ['NORMAL', 'SUSPECT', 'DEFECT']

// 현재 상태 → 다음 상태. who: admin = 관리자만, assignee = 담당자 또는 관리자
const TRANSITIONS = {
  ASSIGNED: { to: 'PRECHECKED', who: 'admin', action: '사전배치 실행' },
  PRECHECKED: { to: 'IN_REVIEW', who: 'assignee', action: '점검 시작' },
  IN_REVIEW: { to: 'REVIEWED', who: 'assignee', action: '점검 완료' },
  REVIEWED: { to: 'CONFIRMED', who: 'admin', action: '확인 완료' },
}

const ASSIGNMENT_COLS = `
  s.id, s.code, s.title, s.status, s.due_date, s.created_at, s.assignee_name,
  s.total_images, s.normal_count, s.suspect_count, s.defect_count, s.reviewed_count`

const toListItem = (r) => ({
  id: r.code,
  title: r.title,
  status: r.status,
  assigneeName: r.assignee_name,
  createdAt: r.created_at,
  dueDate: r.due_date,
  counts: {
    total: r.total_images,
    normal: r.normal_count,
    suspect: r.suspect_count,
    defect: r.defect_count,
    reviewed: r.reviewed_count,
  },
})

export const isAdmin = (user) => user.role === 'admin'
export const canAct = (user, a) => isAdmin(user) || String(a.assignee_id) === String(user.sub)

export async function findAssignment(db, code, lock = false) {
  const { rows } = await db.query(
    `SELECT id, code, status, assignee_id FROM assignments WHERE code = $1 ${lock ? 'FOR UPDATE' : ''}`,
    [code],
  )
  if (!rows.length) throw httpError(404, '배정을 찾을 수 없습니다.')
  return rows[0]
}

export const codeParam = {
  type: 'object',
  properties: { code: { type: 'string', pattern: '^AS-\\d{4,}$' } },
  required: ['code'],
}

export default async function assignmentRoutes(app) {
  // 이 플러그인의 모든 라우트는 로그인 필요
  app.addHook('onRequest', app.authenticate)

  // 목록: 상태 필터·검색·페이지, 상태별 건수(요약 카드용)
  app.get(
    '/assignments',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: STATUSES },
            q: { type: 'string', maxLength: 100 },
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (req) => {
      const { status = null, q = null, page, pageSize } = req.query
      const like = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null
      const where = `($1::text IS NULL OR s.status = $1)
        AND ($2::text IS NULL OR s.title ILIKE $2 OR s.code ILIKE $2 OR s.assignee_name ILIKE $2)`
      const [list, total, counts] = await Promise.all([
        pool.query(
          `SELECT ${ASSIGNMENT_COLS} FROM assignment_summary s WHERE ${where} ORDER BY s.id DESC LIMIT $3 OFFSET $4`,
          [status, like, pageSize, (page - 1) * pageSize],
        ),
        pool.query(`SELECT count(*) AS n FROM assignment_summary s WHERE ${where}`, [status, like]),
        pool.query('SELECT status, count(*) AS n FROM assignments GROUP BY status'),
      ])
      const statusCounts = Object.fromEntries(STATUSES.map((s) => [s, 0]))
      counts.rows.forEach((r) => (statusCounts[r.status] = r.n))
      return { items: list.rows.map(toListItem), total: total.rows[0].n, page, pageSize, statusCounts }
    },
  )

  // 상세: 이미지 목록은 별도 API(/assignments/:code/images)로 페이지 조회
  app.get('/assignments/:code', { schema: { params: codeParam } }, async (req) => {
    const { rows } = await pool.query(
      `SELECT ${ASSIGNMENT_COLS}, a.assignee_id, a.inspection_note, cb.name AS created_by_name
       FROM assignment_summary s
       JOIN assignments a ON a.id = s.id
       JOIN users cb ON cb.id = a.created_by
       WHERE s.code = $1`,
      [req.params.code],
    )
    if (!rows.length) throw httpError(404, '배정을 찾을 수 없습니다.')
    const r = rows[0]
    const [rv, hist, mv] = await Promise.all([
      pool.query(`SELECT status, count(*) AS n FROM review_current WHERE assignment_id = $1 GROUP BY status`, [r.id]),
      pool.query(
        `SELECT h.at, h.action, COALESCE(u.name, '시스템') AS actor
         FROM assignment_history h LEFT JOIN users u ON u.id = h.actor_id
         WHERE h.assignment_id = $1 ORDER BY h.at, h.id`,
        [r.id],
      ),
      pool.query(
        `SELECT mr.model_version FROM assignment_images ai JOIN model_runs mr ON mr.id = ai.run_id
         WHERE ai.assignment_id = $1 GROUP BY mr.model_version ORDER BY count(*) DESC LIMIT 1`,
        [r.id],
      ),
    ])
    const by = Object.fromEntries(rv.rows.map((x) => [x.status, x.n]))
    const base = toListItem(r)
    return {
      ...base,
      assigneeId: String(r.assignee_id),
      createdBy: r.created_by_name,
      inspectionNote: r.inspection_note,
      modelVersion: mv.rows[0]?.model_version ?? null,
      counts: { ...base.counts, approved: by.APPROVED ?? 0, rejected: by.REJECTED ?? 0 },
      history: hist.rows,
    }
  })

  // 미배정 이미지 수 (판정별) — 신규 배정 모달용
  app.get('/unassigned-counts', async () => {
    const { rows } = await pool.query(
      `SELECT v.result, count(*) AS n
       FROM images i ${LATEST_RUN} ${latestVerdict('lr.id')}
       WHERE NOT EXISTS (SELECT 1 FROM assignment_images ai WHERE ai.image_id = i.id) AND v.result IS NOT NULL
       GROUP BY v.result`,
    )
    const counts = { NORMAL: 0, SUSPECT: 0, DEFECT: 0 }
    rows.forEach((r) => (counts[r.result] = r.n))
    return counts
  })

  // 신규 배정 (관리자): 조건에 맞는 미배정 이미지를 자동 선택, 검수 화면 순서는 점수 낮은 순
  app.post(
    '/assignments',
    {
      schema: {
        body: {
          type: 'object',
          required: ['title', 'assigneeId', 'dueDate', 'verdicts', 'count'],
          additionalProperties: false,
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 100 },
            assigneeId: { type: 'string', pattern: '^\\d+$' },
            dueDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            verdicts: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: VERDICTS } },
            count: { type: 'integer', minimum: 1, maximum: 5000 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!isAdmin(req.user)) throw httpError(403, '관리자만 배정할 수 있습니다.')
      const { title, assigneeId, dueDate, verdicts, count } = req.body
      if (!/^\d+$/.test(String(assigneeId))) throw httpError(400, '담당자가 올바르지 않습니다.')

      const created = await tx(async (db) => {
        const assignee = await db.query('SELECT id, name FROM users WHERE id = $1', [assigneeId])
        if (!assignee.rowCount) throw httpError(400, '담당자를 찾을 수 없습니다.')
        // 동시에 두 건이 같은 이미지를 집지 않도록 직렬화
        await db.query('SELECT pg_advisory_xact_lock(1001)')

        let a
        try {
          a = (
            await db.query(
              `INSERT INTO assignments (title, assignee_id, created_by, due_date) VALUES ($1, $2, $3, $4)
               RETURNING id, code`,
              [title.trim(), assigneeId, req.user.sub, dueDate],
            )
          ).rows[0]
        } catch (err) {
          if (err.code === '22008' || err.code === '22007') throw httpError(400, '마감일이 올바르지 않습니다.')
          throw err
        }

        const picked = await db.query(
          `INSERT INTO assignment_images (assignment_id, image_id, run_id, position)
           SELECT $1, p.image_id, p.run_id, row_number() OVER (ORDER BY p.overall_score, p.image_id)
           FROM (
             SELECT i.id AS image_id, lr.id AS run_id, lr.overall_score
             FROM images i ${LATEST_RUN} ${latestVerdict('lr.id')}
             WHERE NOT EXISTS (SELECT 1 FROM assignment_images ai WHERE ai.image_id = i.id)
               AND v.result = ANY($2::text[])
             ORDER BY i.id
             LIMIT $3
           ) p`,
          [a.id, verdicts, count],
        )
        if (!picked.rowCount) throw httpError(400, '조건에 맞는 미배정 이미지가 없습니다.')

        await db.query(
          `INSERT INTO assignment_history (assignment_id, from_status, to_status, action, actor_id)
           VALUES ($1, NULL, 'ASSIGNED', $2, $3)`,
          [a.id, `${assignee.rows[0].name}에게 배정 (${picked.rowCount}장)`, req.user.sub],
        )
        return { id: a.code, count: picked.rowCount }
      })
      return reply.code(201).send(created)
    },
  )

  // 상태 변경: 정해진 다음 단계로만, 권한과 조건을 서버에서 확인
  app.post(
    '/assignments/:code/status',
    {
      schema: {
        params: codeParam,
        body: { type: 'object', required: ['to'], properties: { to: { type: 'string', enum: STATUSES } } },
      },
    },
    async (req) => {
      return tx(async (db) => {
        const a = await findAssignment(db, req.params.code, true)
        const t = TRANSITIONS[a.status]
        if (!t || t.to !== req.body.to) throw httpError(409, '현재 상태에서 변경할 수 없는 단계입니다.')
        if (t.who === 'admin' ? !isAdmin(req.user) : !canAct(req.user, a))
          throw httpError(403, t.who === 'admin' ? '관리자만 할 수 있습니다.' : '담당자만 할 수 있습니다.')

        if (a.status === 'IN_REVIEW') {
          const { rows } = await db.query(
            `SELECT count(*) AS n FROM assignment_images ai
             WHERE ai.assignment_id = $1 AND NOT EXISTS (
               SELECT 1 FROM reviews r WHERE r.assignment_id = ai.assignment_id AND r.image_id = ai.image_id)`,
            [a.id],
          )
          if (rows[0].n > 0) throw httpError(409, `검토하지 않은 이미지가 ${rows[0].n}장 남아 있습니다.`)
        }

        if (a.status === 'ASSIGNED') {
          // 사전배치: 모델 결과는 이미 적재되어 있어 실제 추론은 하지 않고 실행 기록만 남긴다 (실제 모델 연동 시 교체).
          const run = await db.query(
            `SELECT mr.model_version, count(*) AS n
             FROM assignment_images ai JOIN model_runs mr ON mr.id = ai.run_id
             WHERE ai.assignment_id = $1 GROUP BY mr.model_version ORDER BY n DESC LIMIT 1`,
            [a.id],
          )
          const total = (await db.query('SELECT count(*) AS n FROM assignment_images WHERE assignment_id = $1', [a.id])).rows[0].n
          await db.query(
            `INSERT INTO batch_jobs (assignment_id, model_version, status, total_count, processed_count, started_at, finished_at)
             VALUES ($1, $2, 'SUCCEEDED', $3, $3, now(), now())`,
            [a.id, run.rows[0]?.model_version ?? 'unknown', total],
          )
        }

        await db.query('UPDATE assignments SET status = $2, updated_at = now() WHERE id = $1', [a.id, t.to])
        await db.query(
          `INSERT INTO assignment_history (assignment_id, from_status, to_status, action, actor_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [a.id, a.status, t.to, t.action, req.user.sub],
        )
        return { id: a.code, status: t.to }
      })
    },
  )

  // 점검 내용 저장
  app.put(
    '/assignments/:code/note',
    {
      schema: {
        params: codeParam,
        body: { type: 'object', required: ['note'], properties: { note: { type: 'string', maxLength: 5000 } } },
      },
    },
    async (req) => {
      return tx(async (db) => {
        const a = await findAssignment(db, req.params.code, true)
        if (!canAct(req.user, a)) throw httpError(403, '담당자만 저장할 수 있습니다.')
        if (a.status === 'CONFIRMED') throw httpError(409, '확인 완료된 배정은 수정할 수 없습니다.')
        await db.query('UPDATE assignments SET inspection_note = $2, updated_at = now() WHERE id = $1', [a.id, req.body.note])
        await db.query(
          `INSERT INTO assignment_history (assignment_id, action, actor_id) VALUES ($1, '점검 내용 저장', $2)`,
          [a.id, req.user.sub],
        )
        return { ok: true }
      })
    },
  )
}
