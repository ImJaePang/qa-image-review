// 검수 순서(정렬)와 정상 표본: 서버(backend/src/imageOrder.mjs)와 같은 기준이다. 화면은 선택지와 미리보기 계산만 한다.
import type { Verdict } from './types'

/** 배정할 때 고르는 검수 순서 (무작위는 두지 않는다: 편향을 없애려면 정상 표본을 쓴다) */
export type ImageOrder = 'score_asc' | 'score_desc' | 'boundary' | 'boxes_desc' | 'newest'
/** 검수 화면의 정렬: 배정 시 정한 순서 + 위 5개 */
export type ViewOrder = 'position' | ImageOrder

export const IMAGE_ORDERS: ImageOrder[] = ['score_asc', 'score_desc', 'boundary', 'boxes_desc', 'newest']
export const VIEW_ORDERS: ViewOrder[] = ['position', ...IMAGE_ORDERS]

export const ORDER_LABEL: Record<ImageOrder, string> = {
  score_asc: '점수 낮은 순',
  score_desc: '점수 높은 순',
  boundary: '경계에 가까운 순',
  boxes_desc: '이상 영역 많은 순',
  newest: '최신 수신순',
}
export const ORDER_DESC: Record<ImageOrder, string> = {
  score_asc: '문제 가능성이 높은 이미지부터 (기본)',
  score_desc: '거의 정상인 이미지부터',
  boundary: '정상/의심(0.90), 의심/불량(0.50) 기준점에 점수가 가까운, AI도 헷갈린 이미지부터',
  boxes_desc: '이상 영역(박스)이 많이 찍힌 이미지부터',
  newest: '가장 최근에 수신된 이미지부터',
}
export const VIEW_ORDER_LABEL: Record<ViewOrder, string> = { position: '배정 순서', ...ORDER_LABEL }

export const DEFAULT_NORMAL_PERCENT = 5

/** 정상 표본 장수: 비율(%)만큼, 100이면 전부, 후보가 있으면 최소 1장 (서버 sampleSize와 같다) */
export function sampleSize(available: number, percent: number) {
  if (available <= 0 || percent <= 0) return 0
  if (percent >= 100) return available
  return Math.max(1, Math.round((available * percent) / 100))
}

/**
 * 신규 배정 미리보기: 고른 판정의 미배정 장수에서 정상은 표본만 세고, 이미지 수 상한을 적용한다.
 * 의심·불량은 항상 전부 대상이다.
 */
export function assignmentPreview(free: Record<Verdict, number>, verdicts: Verdict[], normalPercent: number, count: number) {
  const normal = verdicts.includes('정상') ? sampleSize(free['정상'], normalPercent) : 0
  const others = (verdicts.includes('의심') ? free['의심'] : 0) + (verdicts.includes('불량') ? free['불량'] : 0)
  const candidates = normal + others
  return { normal, others, candidates, total: Math.min(candidates, Math.max(count, 0)) }
}
