// 반려 사유 선택의 순수 규칙 (화면과 분리해 단위 테스트한다). 서버도 같은 규칙으로 다시 검사한다.
import type { ImageItem } from './types'

interface ReasonOption {
  code: string
  label: string
  requiresComment: boolean
}

/** 반려를 누른 이미지와 그 사유 선택 상태. 검수 화면과 크게 보기가 같은 값을 쓴다 */
export interface RejectDraft {
  imageId: string
  reasons: string[]
}

/** 반려를 시작할 때의 상태: 이미 반려한 이미지면 그 사유, 아니면 AI가 찾은 원인 */
export function startReject(img: Pick<ImageItem, 'imageId' | 'boxes' | 'review'>, options: ReasonOption[]): RejectDraft {
  return { imageId: img.imageId, reasons: initialRejectReasons(img, options.map((o) => o.code)) }
}

/**
 * 반려를 시작할 때 미리 골라 둘 사유.
 * 이미 반려한 이미지면 그때 고른 사유를, 아니면 AI가 찾은 이상 영역의 원인 코드를 쓴다.
 * 선택지에 없는 코드(UNKNOWN 등)는 뺀다. 순서는 선택지 순서.
 */
export function initialRejectReasons(img: Pick<ImageItem, 'boxes' | 'review'>, optionCodes: string[]): string[] {
  const prev = img.review.status === '반려' ? (img.review.reasons ?? []) : []
  const source = new Set(prev.length ? prev : img.boxes.map((b) => b.reasonCode))
  return optionCodes.filter((c) => source.has(c))
}

/** AI가 찾은 원인 중 선택지에 있는 코드 (칩의 'AI' 표시용) */
export function aiReasonCodes(img: Pick<ImageItem, 'boxes'>, optionCodes: string[]): string[] {
  const found = new Set<string>(img.boxes.map((b) => b.reasonCode))
  return optionCodes.filter((c) => found.has(c))
}

/** 코멘트가 필요한 사유를 골랐는데 코멘트가 비어 있으면 그 사유, 아니면 null */
export function missingCommentReason<T extends ReasonOption>(options: T[], reasons: string[], comment: string): T | null {
  if (comment.trim()) return null
  return options.find((o) => o.requiresComment && reasons.includes(o.code)) ?? null
}
