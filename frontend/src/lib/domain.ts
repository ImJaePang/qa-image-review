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

/** 이상 영역 호버 카드에 보여 주는 한 줄 설명. 이름(REASON_LABELS)과 같은 키. 값이 아니라 문구라서 화면 파일에 둔다 */
export const REASON_DESCRIPTIONS: Record<ReasonCode, string> = {
  COMPOSITE_EDGE: '합성한 부분의 경계가 부자연스럽게 보입니다. 윤곽이 번지거나 배경과 이어지지 않을 수 있습니다.',
  SHAPE_DISTORTION: '형태나 구조가 일그러져 보입니다. 곧아야 할 부분이 휘었거나 모양이 비정상일 수 있습니다.',
  LIGHTING_MISMATCH: '이 부분의 빛 방향이나 그림자가 주변과 맞지 않습니다.',
  TEXTURE_ANOMALY: '표면 질감이 주변과 다르게 보입니다. 뭉개졌거나 같은 무늬가 반복될 수 있습니다.',
  SCALE_ANOMALY: '주변 물체에 비해 크기나 비율이 어색해 보입니다.',
  PART_COUNT_MISMATCH: '같은 종류의 장비와 비교해 바퀴나 포신 같은 부품 수가 맞지 않을 수 있습니다.',
  UNKNOWN: 'AI가 이상 가능성은 찾았지만 원인을 분류하지 못했습니다. 직접 확인이 필요합니다.',
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
