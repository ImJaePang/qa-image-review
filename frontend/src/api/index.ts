// 백엔드 API 호출. 화면 코드는 한글 값만 다루고, 변환은 mappers에서 한다.
import type { AssignmentListItem, AssignmentStatus, ImageItem, ImageListItem, ReviewHistoryItem, Role, SignupRole, User, Verdict } from '@/lib/types'
import type { TopMenu } from '@/config/menu'
import type { BulkAction, BulkResult, UserProfile, UserStatus } from '@/lib/users'
import { ApiError, del, get, patch, post, put } from './client'
import type { ImageOrder, ViewOrder } from '@/lib/imageSort'
import type { UploadFileState, UploadLimits } from '@/lib/upload'
import {
  REVIEW_CODE,
  STATUS_CODE,
  STATUS_KO,
  VERDICT_CODE,
  VERDICT_KO,
  toAssignment,
  toImageItem,
  toListItem,
  type ApiAssignment,
  type ApiImageItem,
  type ApiListItem,
  type StatusCode,
  type VerdictCode,
} from './mappers'

/** 반려 사유 선택지 한 개 (DB reject_reasons). requiresComment: 고르면 코멘트 필수(기타) */
export interface RejectReason {
  code: string
  label: string
  requiresComment: boolean
}

/** 대시보드(홈). 판정·상태 키는 서버의 영문 코드 그대로 두고 한글은 화면에서 붙인다 */
export interface Dashboard {
  /** 이미지 분포는 전체/내 것, 배정·검수 진행·최근 7일은 전체/내 것 (권한에 따라 다르다) */
  scope: { images: 'all' | 'mine'; work: 'all' | 'mine' }
  images: Record<VerdictCode, number>
  /** 아직 어느 배정에도 없는 의심·불량. 배정 관리 권한이 없으면 null */
  unassignedTargets: { SUSPECT: number; DEFECT: number } | null
  assignments: Record<StatusCode, number>
  review: { total: number; reviewed: number; approved: number; rejected: number }
  daily: { date: string; count: number }[]
  mine: { openAssignments: number; unreviewed: number }
}

export interface TimeAnalysis {
  gapMinutes: number
  reviewers: {
    id: string
    name: string
    decisions: number
    images: number
    overturned: number
    timedDecisions: number
    idleGaps: number
    activeSeconds: number
    avgSecondsPerImage: number | null
    medianSecondsPerImage: number | null
  }[]
  assignments: {
    id: string
    title: string
    status: AssignmentStatus
    assignee: string
    totalImages: number
    reviewed: number
    reviewSeconds: number | null
    activeSeconds: number
    avgSecondsPerImage: number | null
    avgActiveSecondsPerImage: number | null
    leadSeconds: number | null
  }[]
  models: { modelVersion: string; runs: number; avgMs: number; p95Ms: number; maxMs: number }[]
  /** 수신 배치(스캔 1회에 발견된 파일 묶음). 끝나지 않은 배치는 seconds가 null */
  ingestBatches: {
    id: string
    integration: string
    startedAt: string
    total: number
    processed: number
    failed: number
    seconds: number | null
    secondsPerImage: number | null
  }[]
}

// ── 연계 관리 (관리자) ──
export interface FolderConfig {
  watchDir: string
  processingDir: string
  doneDir: string
  failedDir: string
  extensions: string[]
  maxFileMB: number
  scanIntervalSec: number
}
export interface Integration {
  id: string
  kind: 'FOLDER'
  name: string
  enabled: boolean
  config: FolderConfig
  counts: { pending: number; processing: number; done: number; failed: number }
  lastReceivedAt: string | null
  updatedAt: string
}
export interface IntegrationList {
  /** 서버가 허용하는 루트 폴더. 연계의 폴더는 모두 이 아래의 상대 경로 */
  root: string
  defaults: FolderConfig
  items: Integration[]
}
export interface IntegrationHistoryItem {
  id: string
  action: 'CREATE' | 'UPDATE' | 'ENABLE' | 'DISABLE' | 'RETRY'
  changes: Record<string, any>
  at: string
  actor: string
}
export interface FailedImage {
  imageKey: string
  sourceName: string
  error: string | null
  receivedAt: string
}
export interface RetryResult {
  retried: number
  batchId: string | null
  skipped: { imageKey: string; reason: string }[]
}

// ── 판정 규칙 (관리자) ──
export interface Rule {
  id: string
  name: string
  version: number
  params: { normalMin: number; suspectMin: number }
  enabled: boolean
  /** 켜진 것 중 가장 높은 버전 = 지금 판정에 쓰는 규칙 */
  active: boolean
  createdAt: string
  createdBy: string
  verdictCount: number
}
export interface RuleList {
  name: string
  activeId: string | null
  items: Rule[]
  /** 활성 규칙이 아닌 규칙으로 판정되어 있어 재판정이 필요한 이미지 수 */
  stale: { unassigned: number; assigned: number }
}
export type VerdictCounts = { NORMAL: number; SUSPECT: number; DEFECT: number }
export interface RulePreview {
  total: number
  current: VerdictCounts
  proposed: VerdictCounts
  changed: { unassigned: number; assigned: number }
}
export interface RuleHistoryItem {
  id: string
  action: 'CREATE' | 'ENABLE' | 'DISABLE' | 'REJUDGE'
  version: number
  detail: Record<string, any>
  at: string
  actor: string
}
export interface RejudgeResult {
  ruleVersion: number
  scope: 'unassigned' | 'all'
  rejudged: number
  changed: number
}

export interface RoleInfo {
  code: string
  label: string
  system: boolean
  signupSelectable: boolean
  /** false = 사용 안 함: 새로 고르는 목록에서는 빠지고, 이미 가진 사용자의 이름 표시에는 계속 쓴다 */
  active: boolean
}

// ── 이미지 업로드 ──
export interface UploadBatch {
  id: string
  createdBy: string
  createdByName: string
  expectedCount: number
  memo: string | null
  status: 'OPEN' | 'DONE' | 'CANCELED'
  createdAt: string
  finishedAt: string | null
  uploaded: number // 서버가 받은 장수
  rejected: number // 업로드 실패(이미지가 아님·크기 등)
  waiting: number // 수신 폴더에서 대기 (아직 images로 등록 전)
  processing: number
  done: number
  failed: number // 검사 실패
}
export type { UploadFileState }
export interface UploadFileItem {
  id: string
  name: string
  size: number
  state: UploadFileState
  reason: string | null
  imageKey: string | null
}

// ── 권한 관리 (관리자) ──
export interface AdminRole {
  code: string
  label: string
  description: string | null
  system: boolean
  signupSelectable: boolean
  active: boolean
  sortOrder: number
  userCount: number
  createdAt: string
  /** 사용자·변경 이력이 없어 진짜 삭제가 가능한가 */
  deletable: boolean
}
export interface RoleHistoryItem {
  id: string
  action: 'CREATE' | 'UPDATE' | 'DEACTIVATE' | 'ACTIVATE' | 'DELETE'
  detail: Record<string, any>
  at: string
  actor: string
}
export interface AdminRoleList {
  items: AdminRole[]
  total: number
  page: number
  pageSize: number
  statusCounts: { ACTIVE: number; INACTIVE: number }
}
export interface RoleInput {
  label?: string
  description?: string | null
  signupSelectable?: boolean
  sortOrder?: number
}

// ── 권한별 메뉴 (관리자) ──
export interface PermissionTable {
  roles: { code: string; label: string; system: boolean; description: string | null }[]
  menus: { path: string; topLabel: string; groupLabel: string; label: string; permission: string }[]
  functions: { code: string; label: string; description: string | null }[]
  /** 권한 코드(role) → 부여된 권한 코드 목록 */
  granted: Record<string, string[]>
  /** 권한(role)별로 뺄 수 없는 코드 */
  locked: Record<string, string[]>
}
export interface PermissionHistoryItem {
  id: string
  role: string
  roleLabel: string
  permission: string
  permissionLabel: string
  action: 'GRANT' | 'REVOKE'
  at: string
  actor: string
}

// ── 사용자 관리 (관리자) ──
export interface AdminUser {
  id: string
  name: string
  email: string
  role: Role
  status: UserStatus
  requestedRole: SignupRole | null
  expiresAt: string | null
  lastLoginAt: string | null
  expiryReleaseRequestedAt: string | null
  createdAt: string
  profile: UserProfile
}
export interface UserHistoryItem {
  id: string
  action: string
  detail: Record<string, any>
  at: string
  actor: string | null
}
export interface AdminUserList extends Page<AdminUser> {
  statusCounts: Record<UserStatus, number>
  bulkMax: number
}
export interface UserQuery {
  status?: UserStatus
  role?: Role
  q?: string
  page: number
  pageSize: number
}

export type ImageFilter = 'all' | 'unreviewed' | 'approved' | 'rejected'

export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export const api = {
  // ── 인증 ──
  /** 로그인 전에 읽는 서버 설정. demoMode=false(공개 서버)면 로그인 화면에 데모 계정 안내·기본 입력값을 숨긴다 */
  publicConfig: () => get<{ demoMode: boolean }>('/config'),
  me: () => get<{ user: User }>('/auth/me').then((r) => r.user),
  login: (email: string, password: string) => post<{ user: User }>('/auth/login', { email, password }).then((r) => r.user),
  // 가입은 승인 신청이다: 로그인되지 않고 승인 대기 안내만 돌려받는다
  signup: (name: string, email: string, password: string, requestedRole: SignupRole, profile: Partial<UserProfile>) =>
    post<{ status: 'PENDING'; message: string }>('/auth/signup', { name, email, password, requestedRole, profile }),
  /** 만료된 사용자가 로그인 없이 해제를 요청한다 (본인 확인용으로 이메일·비밀번호를 다시 보낸다) */
  requestExpiryRelease: (email: string, password: string) => post<{ ok: true; message: string }>('/auth/expiry-release-request', { email, password }),
  logout: () => post<{ ok: true }>('/auth/logout'),
  /** 본인 비밀번호 변경. 현재 비밀번호가 틀리면 400(WRONG_PASSWORD) */
  changePassword: (currentPassword: string, newPassword: string) => post<{ ok: true }>('/auth/change-password', { currentPassword, newPassword }),
  /** 가입 화면용(로그인 전): 신청할 수 있는 권한 */
  signupRoles: () => get<{ roles: { code: string; label: string }[] }>('/auth/signup-roles').then((r) => r.roles),
  listRoles: () => get<{ roles: RoleInfo[] }>('/roles').then((r) => r.roles),
  myMenus: () => get<{ menus: TopMenu[] }>('/menus/mine').then((r) => r.menus),
  getPermissions: () => get<PermissionTable>('/admin/permissions'),
  saveRolePermissions: (role: string, permissions: string[]) => put<{ role: string; granted: string[]; revoked: string[] }>(`/admin/roles/${role}/permissions`, { permissions }),
  permissionHistory: () => get<{ items: PermissionHistoryItem[] }>('/admin/permissions/history').then((r) => r.items),
  /** 신규 배정의 담당자 후보 (권한에 '배정받기'가 있는 사용 중 계정) */
  listAssignees: () => get<{ items: User[] }>('/assignees').then((r) => r.items),

  // ── 대시보드 ──
  /** tz: 날짜를 나누는 기준 시간대(보는 사람의 브라우저 시간대) */
  dashboard: (tz: string) => get<Dashboard>(`/dashboard?tz=${encodeURIComponent(tz)}`),

  // ── 배정 ──
  async listAssignments(p: { status?: AssignmentStatus; q?: string; mine?: boolean; page: number; pageSize: number }) {
    const qs = new URLSearchParams({ page: String(p.page), pageSize: String(p.pageSize) })
    if (p.mine) qs.set('mine', 'true')
    if (p.status) qs.set('status', STATUS_CODE[p.status])
    if (p.q) qs.set('q', p.q)
    const r = await get<Page<ApiListItem> & { statusCounts: Record<StatusCode, number> }>(
      `/assignments?${qs}`,
    )
    const statusCounts = Object.fromEntries(
      Object.entries(STATUS_CODE).map(([ko, code]) => [ko, r.statusCounts[code] ?? 0]),
    ) as Record<AssignmentStatus, number>
    return { ...r, items: r.items.map(toListItem) as AssignmentListItem[], statusCounts }
  },
  getAssignment: (id: string) => get<ApiAssignment>(`/assignments/${id}`).then(toAssignment),

  async unassignedCounts() {
    const r = await get<Record<VerdictCode, number>>('/unassigned-counts')
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [VERDICT_KO[k as VerdictCode], v])) as Record<Verdict, number>
  },

  createAssignment: (input: { title: string; assigneeId: string; dueDate: string; verdicts: Verdict[]; count: number; order: ImageOrder; normalPercent: number }) =>
    post<{ id: string; count: number }>('/assignments', { ...input, verdicts: input.verdicts.map((v) => VERDICT_CODE[v]) }),

  setStatus: (id: string, to: AssignmentStatus) => post<{ id: string }>(`/assignments/${id}/status`, { to: STATUS_CODE[to] }),
  saveNote: (id: string, note: string) => put<{ ok: true }>(`/assignments/${id}/note`, { note }),

  // ── 이미지 (서버 페이지네이션) ──
  async listImages(id: string, p: { page: number; pageSize: number; filter?: ImageFilter; verdict?: Verdict; sort?: ViewOrder }) {
    const qs = new URLSearchParams({ page: String(p.page), pageSize: String(p.pageSize), filter: p.filter ?? 'all', sort: p.sort ?? 'position' })
    if (p.verdict) qs.set('verdict', VERDICT_CODE[p.verdict])
    const r = await get<Page<ApiImageItem>>(`/assignments/${id}/images?${qs}`)
    return { ...r, items: r.items.map(toImageItem) as ImageItem[] }
  },
  /** 결과 칩의 건수(전체·미검토·승인·반려). 판정 필터만 반영한다 */
  imageCounts: (id: string, verdict?: Verdict) =>
    get<{ all: number; unreviewed: number; approved: number; rejected: number }>(`/assignments/${id}/image-counts${verdict ? `?verdict=${VERDICT_CODE[verdict]}` : ''}`),
  /** afterPosition(1부터) 다음의 첫 미검토 이미지 위치. 지금 보는 목록(필터·판정·정렬) 기준이고, 없으면 처음부터 다시 찾고, 전부 검토했으면 null */
  nextUnreviewed: (id: string, afterPosition: number, view?: { filter?: ImageFilter; verdict?: Verdict; sort?: ViewOrder }) => {
    const qs = new URLSearchParams({ after: String(afterPosition), filter: view?.filter ?? 'all', sort: view?.sort ?? 'position' })
    if (view?.verdict) qs.set('verdict', VERDICT_CODE[view.verdict])
    return get<{ position: number | null }>(`/assignments/${id}/next-unreviewed?${qs}`).then((r) => r.position)
  },
  // ── 모니터링 (관리자) ──
  async timeAnalysis(gapMinutes: number) {
    const r = await get<Omit<TimeAnalysis, 'assignments'> & { assignments: (Omit<TimeAnalysis['assignments'][number], 'status'> & { status: StatusCode })[] }>(
      `/monitoring/time?gapMinutes=${gapMinutes}`,
    )
    return { ...r, assignments: r.assignments.map((a) => ({ ...a, status: STATUS_KO[a.status] })) } as TimeAnalysis
  },
  // ── 연계 관리 (관리자) ──
  listIntegrations: () => get<IntegrationList>('/integrations'),
  createIntegration: (input: { name: string; config: Partial<FolderConfig> }) => post<Integration>('/integrations', input),
  updateIntegration: (id: string, input: { name?: string; enabled?: boolean; config?: Partial<FolderConfig> }) =>
    patch<Integration>(`/integrations/${id}`, input),
  integrationHistory: (id: string) => get<{ items: IntegrationHistoryItem[] }>(`/integrations/${id}/history`).then((r) => r.items),
  integrationFailed: (id: string) => get<{ items: FailedImage[] }>(`/integrations/${id}/failed`).then((r) => r.items),
  retryIntegration: (id: string) => post<RetryResult>(`/integrations/${id}/retry`),

  // ── 사용자 관리 (관리자) ──
  listAdminUsers: (p: UserQuery) => {
    const qs = new URLSearchParams({ page: String(p.page), pageSize: String(p.pageSize) })
    if (p.status) qs.set('status', p.status)
    if (p.role) qs.set('role', p.role)
    if (p.q) qs.set('q', p.q)
    return get<AdminUserList>(`/admin/users?${qs}`)
  },
  getAdminUser: (id: string) => get<AdminUser & { history: UserHistoryItem[] }>(`/admin/users/${id}`),
  updateAdminUser: (id: string, input: { name?: string; role?: Role; expiresAt?: string; profile?: Partial<UserProfile> }) => patch<AdminUser>(`/admin/users/${id}`, input),
  bulkUsers: (action: BulkAction, ids: string[], role?: Role) =>
    post<BulkResult & { action: BulkAction }>('/admin/users/bulk', { action, ids: ids.map(Number), ...(role ? { role } : {}) }),
  /** 메일이 켜져 있으면 사용자 메일로만 보내고 { sent, to(가린 주소) }, 꺼져 있으면 { tempPassword }를 한 번 돌려준다 */
  resetPassword: (id: string) => post<{ sent: true; to: string } | { sent?: undefined; tempPassword: string }>(`/admin/users/${id}/reset-password`),

  // ── 이미지 업로드 ──
  uploadLimits: () => get<{ limits: UploadLimits }>('/uploads/limits').then((r) => r.limits),
  createUpload: (expectedCount: number, memo?: string) => post<{ batch: UploadBatch; limits: UploadLimits }>('/uploads', { expectedCount, ...(memo ? { memo } : {}) }),
  /** 파일 1장 전송 (본문 = 원본 바이트). 서버가 이미지가 아니라고 하면 status가 REJECTED로 돌아온다 */
  uploadFile: async (batchId: string, file: File): Promise<{ id: string; status: 'RECEIVED' | 'REJECTED'; reason?: string }> => {
    let res: Response
    try {
      res = await fetch(`/api/uploads/${batchId}/files?name=${encodeURIComponent(file.name)}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: file })
    } catch {
      throw new ApiError(0, '서버에 연결할 수 없습니다.') // 네트워크 오류는 다시 시도해 볼 만하다
    }
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      // 권한·배치 상태 문제(4xx)는 다시 시도해도 같으므로 재시도하지 않게 표시한다
      throw Object.assign(new ApiError(res.status, data?.message ?? '업로드에 실패했습니다.'), { retryable: res.status >= 500 })
    }
    return data.file
  },
  completeUpload: (batchId: string, cancel = false) => post<{ batch: UploadBatch }>(`/uploads/${batchId}/complete`, cancel ? { cancel: true } : {}),
  listUploads: (p: { mine?: boolean; q?: string; page: number; pageSize: number }) => {
    const qs = new URLSearchParams({ page: String(p.page), pageSize: String(p.pageSize) })
    if (p.mine) qs.set('mine', 'true')
    if (p.q) qs.set('q', p.q)
    return get<{ items: UploadBatch[]; total: number; page: number; pageSize: number; canSeeAll: boolean; counts: { total: number; mine: number } }>(`/uploads?${qs}`)
  },
  getUpload: (id: string, p: { state?: UploadFileState; page: number; pageSize: number }) => {
    const qs = new URLSearchParams({ page: String(p.page), pageSize: String(p.pageSize) })
    if (p.state) qs.set('state', p.state)
    return get<{ batch: UploadBatch; files: UploadFileItem[]; total: number; page: number; pageSize: number }>(`/uploads/${id}?${qs}`)
  },

  // ── 권한 관리 (관리자) ──
  listAdminRoles: (p: { status?: 'ACTIVE' | 'INACTIVE'; q?: string; page: number; pageSize: number }) => {
    const qs = new URLSearchParams({ page: String(p.page), pageSize: String(p.pageSize) })
    if (p.status) qs.set('status', p.status)
    if (p.q) qs.set('q', p.q)
    return get<AdminRoleList>(`/admin/roles?${qs}`)
  },
  getAdminRole: (code: string) => get<{ role: AdminRole; history: RoleHistoryItem[] }>(`/admin/roles/${code}`),
  createRole: (input: RoleInput & { code: string; label: string }) => post<{ role: AdminRole }>('/admin/roles', input),
  updateRole: (code: string, input: RoleInput) => patch<{ role: AdminRole }>(`/admin/roles/${code}`, input),
  setRoleActive: (code: string, active: boolean) => post<{ role: AdminRole }>(`/admin/roles/${code}/${active ? 'activate' : 'deactivate'}`),
  deleteRole: (code: string) => del<{ deleted: string }>(`/admin/roles/${code}`),

  // ── 판정 규칙 (관리자) ──
  listRules: () => get<RuleList>('/rules'),
  previewRule: (p: { normalMin: number; suspectMin: number }) => get<RulePreview>(`/rules/preview?normalMin=${p.normalMin}&suspectMin=${p.suspectMin}`),
  createRule: (p: { normalMin: number; suspectMin: number }) => post<Rule>('/rules', p),
  setRuleEnabled: (id: string, enabled: boolean) => patch<Rule>(`/rules/${id}`, { enabled }),
  rejudge: (id: string, scope: 'unassigned' | 'all') => post<RejudgeResult>(`/rules/${id}/rejudge`, { scope }),
  ruleHistory: () => get<{ items: RuleHistoryItem[] }>('/rules/history').then((r) => r.items),

  /** 이미지 목록: 수신 완료된 이미지를 판정·배정 여부·검색·정렬로 찾는다 */
  async listImageCatalog(p: { verdict?: Verdict; assigned: 'all' | 'unassigned' | 'assigned'; q?: string; sort: 'newest' | 'score_asc' | 'score_desc'; page: number; pageSize: number }) {
    const qs = new URLSearchParams({ assigned: p.assigned, sort: p.sort, page: String(p.page), pageSize: String(p.pageSize) })
    if (p.verdict) qs.set('verdict', VERDICT_CODE[p.verdict])
    if (p.q) qs.set('q', p.q)
    const r = await get<{
      items: (Omit<ImageListItem, 'verdict' | 'assignmentStatus'> & { verdict: VerdictCode; assignmentStatus: StatusCode | null })[]
      total: number
      page: number
      pageSize: number
      verdictCounts: Record<VerdictCode, number>
    }>(`/image-list?${qs}`)
    return {
      ...r,
      items: r.items.map((i): ImageListItem => ({ ...i, verdict: VERDICT_KO[i.verdict], assignmentStatus: i.assignmentStatus ? STATUS_KO[i.assignmentStatus] : null })),
      verdictCounts: Object.fromEntries(Object.entries(r.verdictCounts).map(([k, v]) => [VERDICT_KO[k as VerdictCode], v])) as Record<Verdict, number>,
    }
  },
  /** 한 장의 상세(박스·히트맵): 확대 보기용. 검수 정보는 항상 미검토 */
  getImageDetail: (imageKey: string) => get<ApiImageItem>(`/image-list/${imageKey}`).then(toImageItem),
  /** 점검 이력: 검수 기록 목록. scope=all은 배정 관리 권한이 있어야 한다 */
  async listReviewHistory(p: { scope: 'mine' | 'all'; status?: '승인' | '반려'; q?: string; page: number; pageSize: number }) {
    const qs = new URLSearchParams({ scope: p.scope, page: String(p.page), pageSize: String(p.pageSize) })
    if (p.status) qs.set('status', REVIEW_CODE[p.status])
    if (p.q) qs.set('q', p.q)
    const r = await get<{
      items: (Omit<ReviewHistoryItem, 'status' | 'verdict'> & { status: 'APPROVED' | 'REJECTED'; verdict: VerdictCode })[]
      total: number
      page: number
      pageSize: number
      statusCounts: { APPROVED: number; REJECTED: number }
    }>(`/review-history?${qs}`)
    return {
      ...r,
      items: r.items.map((i): ReviewHistoryItem => ({ ...i, status: i.status === 'APPROVED' ? '승인' : '반려', verdict: VERDICT_KO[i.verdict] })),
      statusCounts: { 승인: r.statusCounts.APPROVED, 반려: r.statusCounts.REJECTED },
    }
  },
  /** 반려는 사유 코드를 1개 이상 함께 보낸다 (승인은 빈 배열) */
  reviewImage: (id: string, imageId: string, status: '승인' | '반려', comment: string, reasons: string[] = []) =>
    put<{ progress: { reviewed: number; approved: number; rejected: number } }>(
      `/assignments/${id}/images/${imageId}/review`,
      { status: REVIEW_CODE[status], comment, reasons },
    ),
  /** 반려 사유 선택지 (사용 중인 것만, 표시 순서대로) */
  listRejectReasons: () => get<{ items: RejectReason[] }>('/reject-reasons').then((r) => r.items),
}
