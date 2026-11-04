// 서버의 영문 코드 ↔ 화면용 한글 값 변환 (DB/API는 영문, 한글은 화면에서만)
import type {
  Assignment,
  AssignmentListItem,
  AssignmentStatus,
  ImageItem,
  ReviewStatus,
  Verdict,
} from '@/lib/types'

export const STATUS_KO = {
  ASSIGNED: '배정',
  PRECHECKED: '사전배치',
  IN_REVIEW: '점검중',
  REVIEWED: '점검완료',
  CONFIRMED: '확인완료',
} as const satisfies Record<string, AssignmentStatus>
export type StatusCode = keyof typeof STATUS_KO

export const STATUS_CODE = Object.fromEntries(Object.entries(STATUS_KO).map(([k, v]) => [v, k])) as Record<
  AssignmentStatus,
  StatusCode
>

export const VERDICT_KO = { NORMAL: '정상', SUSPECT: '의심', DEFECT: '불량' } as const satisfies Record<string, Verdict>
export type VerdictCode = keyof typeof VERDICT_KO
export const VERDICT_CODE = { 정상: 'NORMAL', 의심: 'SUSPECT', 불량: 'DEFECT' } as const satisfies Record<Verdict, VerdictCode>

export const REVIEW_KO = { NONE: '미검토', APPROVED: '승인', REJECTED: '반려' } as const satisfies Record<string, ReviewStatus>
export const REVIEW_CODE = { 승인: 'APPROVED', 반려: 'REJECTED' } as const

// ── 서버 응답 모양 ──
export interface ApiListItem extends Omit<AssignmentListItem, 'status'> {
  status: StatusCode
}
export interface ApiAssignment extends Omit<Assignment, 'status'> {
  status: StatusCode
}
export interface ApiImageItem extends Omit<ImageItem, 'verdict' | 'review' | 'heatmapUrl'> {
  verdict: VerdictCode
  heatmapUrl: string | null
  review: { status: keyof typeof REVIEW_KO; comment: string; reviewedAt: string | null; reviewerName: string | null }
}

export const toListItem = (a: ApiListItem): AssignmentListItem => ({ ...a, status: STATUS_KO[a.status] })
export const toAssignment = (a: ApiAssignment): Assignment => ({ ...a, status: STATUS_KO[a.status] })
export const toImageItem = (i: ApiImageItem): ImageItem => ({
  ...i,
  heatmapUrl: i.heatmapUrl ?? '',
  verdict: VERDICT_KO[i.verdict],
  review: { ...i.review, status: REVIEW_KO[i.review.status] },
})
