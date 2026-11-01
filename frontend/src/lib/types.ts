// 기획서 5장 데이터 계약 + 배정/검수 도메인 타입

export type ReasonCode =
  | 'COMPOSITE_EDGE'
  | 'SHAPE_DISTORTION'
  | 'LIGHTING_MISMATCH'
  | 'TEXTURE_ANOMALY'
  | 'SCALE_ANOMALY'
  | 'PART_COUNT_MISMATCH'

export type Verdict = '정상' | '의심' | '불량'

export interface Detection {
  x: number
  y: number
  width: number
  height: number
  score: number
  reasonCode: ReasonCode
}

/** 모델 출력 (좌표는 원본 픽셀 기준) */
export interface ImageResult {
  imageId: string
  fileName: string
  width: number
  height: number
  modelVersion: string
  overallScore: number
  boxes: Detection[]
  /** 목 데이터용: 화면에 쓸 이미지 URL (실서비스에서는 서버 경로) */
  previewUrl: string
  heatmapUrl: string
}

export type ReviewStatus = '미검토' | '승인' | '반려'

export interface ImageReview {
  status: ReviewStatus
  comment: string
  reviewedAt?: string
}

export type AssignmentStatus = '배정' | '사전배치' | '점검중' | '점검완료' | '확인완료'
export const ASSIGNMENT_STATUSES: AssignmentStatus[] = ['배정', '사전배치', '점검중', '점검완료', '확인완료']

export interface HistoryEntry {
  at: string
  actor: string
  action: string
}

export interface Assignment {
  id: string
  title: string
  status: AssignmentStatus
  assigneeId: string
  assigneeName: string
  createdBy: string
  createdAt: string
  dueDate: string
  imageIds: string[]
  reviews: Record<string, ImageReview>
  inspectionNote: string
  history: HistoryEntry[]
}

export type Role = 'admin' | 'qa'

export interface User {
  id: string
  name: string
  email: string
  password: string
  role: Role
}
