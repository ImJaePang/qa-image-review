import type { ReasonCode, Verdict } from './types'

/** 판정 임계값 — 하드코딩 금지. 판정은 서버가 rules 테이블 기준으로 내려주므로 이 코드는 참고/미리보기용이다. */
export interface RuleConfig {
  normalMin: number // 이상이면 정상
  suspectMin: number // 이상이면 의심, 미만이면 불량
}
export const defaultRules: RuleConfig = { normalMin: 0.9, suspectMin: 0.5 }

export function judge(score: number, rules: RuleConfig = defaultRules): Verdict {
  if (score >= rules.normalMin) return '정상'
  if (score >= rules.suspectMin) return '의심'
  return '불량'
}

export const REASON_LABELS: Record<ReasonCode, string> = {
  COMPOSITE_EDGE: '합성 경계 이상',
  SHAPE_DISTORTION: '형태/구조 왜곡',
  LIGHTING_MISMATCH: '조명·음영 불일치',
  TEXTURE_ANOMALY: '질감 이상',
  SCALE_ANOMALY: '비율/스케일 이상',
  PART_COUNT_MISMATCH: '부품 개수 불일치',
  UNKNOWN: '원인 미분류',
}

export function fmtDate(iso: string) {
  return iso.slice(0, 10)
}
/** 서버 시각(UTC ISO)을 보는 사람의 현지 시간으로 표시한다 (YYYY-MM-DD HH:mm). 해석할 수 없으면 원문 그대로 */
export function fmtDateTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
