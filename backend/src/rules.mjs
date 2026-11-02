// 규칙 층: 임계값은 코드에 두지 않고 rules 테이블의 params에서 받는다.
export function judge(score, params) {
  if (score >= params.normalMin) return 'NORMAL'
  if (score >= params.suspectMin) return 'SUSPECT'
  return 'DEFECT'
}

// 판정 사유: 박스의 사유 코드를 점수 낮은 순으로 중복 없이 모은다.
export function reasonsOf(boxes) {
  return [...boxes].sort((a, b) => a.score - b.score).map((b) => b.reasonCode).filter((c, i, arr) => arr.indexOf(c) === i)
}
