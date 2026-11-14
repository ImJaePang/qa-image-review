// 이미지 정렬 방식 (배정할 때의 검수 순서와 검수 화면의 정렬이 같은 목록을 쓴다).
//  score_asc    점수 낮은 순: 문제 가능성이 높은 것부터
//  score_desc   점수 높은 순
//  boundary     경계에 가까운 순: 정상/의심(normalMin), 의심/불량(suspectMin) 기준점에 점수가 가까운, AI도 헷갈린 것부터
//  boxes_desc   이상 영역(박스)이 많은 순
//  newest       최신 수신순
// 검수 화면에서는 이 5개에 더해 'position'(배정할 때 정한 순서)이 있다.
// 경계 기준은 그 판정을 내린 규칙(verdict의 rule)의 값을 쓴다 — 규칙을 새 버전으로 바꾸면 새 판정부터 새 기준을 따른다.

export const ORDERS = ['score_asc', 'score_desc', 'boundary', 'boxes_desc', 'newest']
export const VIEW_ORDERS = ['position', ...ORDERS]
export const ORDER_LABEL = { score_asc: '점수 낮은 순', score_desc: '점수 높은 순', boundary: '경계에 가까운 순', boxes_desc: '이상 영역 많은 순', newest: '최신 수신순' }

/** 점수에서 가장 가까운 기준점까지의 거리 (params = rules.params jsonb 식) */
export const boundaryExpr = (score, params) =>
  `LEAST(ABS(${score} - (${params}->>'normalMin')::float8), ABS(${score} - (${params}->>'suspectMin')::float8))`

/**
 * ORDER BY 식. cols = 각 정렬 기준의 SQL 식 { score, boundary, boxes, newest }.
 * 같은 값끼리는 호출하는 쪽이 붙이는 보조 기준(번호)으로 정해진다.
 */
export function orderBySql(order, cols) {
  switch (order) {
    case 'score_desc':
      return `${cols.score} DESC`
    case 'boundary':
      return `${cols.boundary} ASC, ${cols.score} ASC`
    case 'boxes_desc':
      return `${cols.boxes} DESC, ${cols.score} ASC`
    case 'newest':
      return `${cols.newest} DESC`
    default:
      return `${cols.score} ASC`
  }
}

/** 정상 표본 장수: 비율(%)만큼, 100이면 전부, 후보가 있으면 최소 1장 */
export function sampleSize(available, percent) {
  if (available <= 0 || percent <= 0) return 0
  if (percent >= 100) return available
  return Math.max(1, Math.round((available * percent) / 100))
}
