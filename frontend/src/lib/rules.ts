// 규칙(임계값) 화면용 순수 함수 (화면과 분리해 단위 테스트한다)
import type { Verdict } from './types'

export const VERDICT_OF: Record<'NORMAL' | 'SUSPECT' | 'DEFECT', Verdict> = { NORMAL: '정상', SUSPECT: '의심', DEFECT: '불량' }

export interface RuleParams {
  normalMin: number
  suspectMin: number
}

/** 입력칸의 문자열을 0~1 숫자로. 비었거나 범위 밖이면 null */
export function parseThreshold(s: string): number | null {
  if (s.trim() === '') return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null
}

/** 저장·미리보기가 가능한 값인지. 가능하면 null, 아니면 이유 */
export function thresholdProblem(normal: number | null, suspect: number | null): string | null {
  if (normal === null || suspect === null) return '0~1 사이의 숫자를 입력하세요'
  if (!(suspect < normal)) return '의심 기준은 정상 기준보다 낮아야 합니다'
  return null
}

export const fmtThreshold = (n: number) => n.toFixed(2)
export const fmtParams = (p: RuleParams) => `정상 ≥ ${fmtThreshold(p.normalMin)} · 의심 ≥ ${fmtThreshold(p.suspectMin)}`

interface HistoryLike {
  action: 'CREATE' | 'ENABLE' | 'DISABLE' | 'REJUDGE'
  version: number
  detail: Record<string, any>
}

/** 이력 한 건을 사람이 읽는 한 줄로 */
export function describeRuleHistory(h: HistoryLike): string {
  switch (h.action) {
    case 'CREATE':
      return `v${h.version} 만듦 (${fmtParams(h.detail.params)})`
    case 'ENABLE':
      return `v${h.version} 켬`
    case 'DISABLE':
      return `v${h.version} 끔`
    case 'REJUDGE': {
      const scope = h.detail.scope === 'all' ? '배정된 이미지 포함' : '미배정만'
      return `v${h.version} 재판정 (${scope}): ${h.detail.rejudged}장 중 ${h.detail.changed}장 바뀜`
    }
  }
}
