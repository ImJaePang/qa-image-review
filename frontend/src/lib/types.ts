// 기획서 5장 데이터 계약 + 배정/검수 도메인 타입
// 서버는 영문 코드로 주고받고, 여기 타입은 화면용 한글 값이다 (변환은 src/api/mappers.ts).

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
  previewUrl: string
  /** 히트맵이 없으면 빈 문자열 */
  heatmapUrl: string
}

export type ReviewStatus = '미검토' | '승인' | '반려'

export interface ImageReview {
  status: ReviewStatus
  comment: string
  reviewedAt?: string | null
  /** 마지막으로 검수한 사람 (미검토면 없음) */
  reviewerName?: string | null
}

/** 배정 안의 이미지 한 장: 모델 결과 + 판정 + 현재 검수 상태 */
export interface ImageItem extends ImageResult {
  thumbUrl: string
  /** 원본 파일 (정밀 확인용, 판정은 항상 원본 기준) */
  originalUrl: string
  verdict: Verdict
  review: ImageReview
}

// 사전배치 단계는 없다: 이미지는 수신 시점에 이미 추론·판정되어 있다 (db/migrations/002)
export type AssignmentStatus = '배정' | '점검중' | '점검완료' | '확인완료'
export const ASSIGNMENT_STATUSES: AssignmentStatus[] = ['배정', '점검중', '점검완료', '확인완료']

export interface HistoryEntry {
  at: string
  actor: string
  action: string
}

export interface AssignmentCounts {
  total: number
  normal: number
  suspect: number
  defect: number
  /** 검수 완료(승인+반려) 장수 */
  reviewed: number
}

export interface AssignmentListItem {
  id: string
  title: string
  status: AssignmentStatus
  assigneeName: string
  createdAt: string
  dueDate: string
  counts: AssignmentCounts
}

/** 상세: 이미지 목록은 포함하지 않는다 (별도 페이지 조회) */
export interface Assignment extends AssignmentListItem {
  assigneeId: string
  createdBy: string
  inspectionNote: string
  modelVersion: string | null
  counts: AssignmentCounts & { approved: number; rejected: number }
  history: HistoryEntry[]
}

export type Role = 'admin' | 'researcher' | 'qa'
/** 가입할 때 신청할 수 있는 권한 (관리자는 신청 불가) */
export type SignupRole = Exclude<Role, 'admin'>

export const ROLE_LABEL: Record<Role, string> = { admin: '관리자', researcher: '연구원', qa: 'QA' }

export interface User {
  id: string
  name: string
  email: string
  role: Role
}
