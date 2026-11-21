// 여러 라우트가 같이 쓰는 SQL 조각

/** 이미지의 가장 최근 모델 실행 (i = images 별칭 필요) */
export const LATEST_RUN = `
  LEFT JOIN LATERAL (
    SELECT id, overall_score FROM model_runs WHERE image_id = i.id ORDER BY created_at DESC, id DESC LIMIT 1
  ) lr ON true`

/** 실행(run)의 가장 최근 판정. 규칙을 바꿔 재판정하면 최신 행이 쓰인다 (runIdExpr = run id 식) */
export const latestVerdict = (runIdExpr) => `
  LEFT JOIN LATERAL (
    SELECT result, reasons, rule_id FROM verdicts WHERE run_id = ${runIdExpr} ORDER BY created_at DESC, id DESC LIMIT 1
  ) v ON true`

/** latestVerdict 뒤에 붙여 그 판정을 내린 규칙(ru.params: normalMin·suspectMin)을 쓴다 */
export const RULE_OF_VERDICT = 'LEFT JOIN rules ru ON ru.id = v.rule_id'

/** 배정 안에서 이미지의 현재 검수 상태 (reviews 쌓기 방식 → 최신 한 행) */
export const currentReview = (assignmentIdExpr, imageIdExpr) => `
  LEFT JOIN LATERAL (
    SELECT reviewer_id, status, comment, reasons, decided_at FROM reviews
    WHERE assignment_id = ${assignmentIdExpr} AND image_id = ${imageIdExpr}
    ORDER BY decided_at DESC, id DESC LIMIT 1
  ) rc ON true`
