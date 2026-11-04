// 백엔드 API 호출. 화면 코드는 한글 값만 다루고, 변환은 mappers에서 한다.
import type { AssignmentListItem, AssignmentStatus, ImageItem, SignupRole, User, Verdict } from '@/lib/types'
import { get, patch, post, put } from './client'
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

export type ImageFilter = 'all' | 'unreviewed' | 'approved' | 'rejected'

export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export const api = {
  // ── 인증 ──
  me: () => get<{ user: User }>('/auth/me').then((r) => r.user),
  login: (email: string, password: string) => post<{ user: User }>('/auth/login', { email, password }).then((r) => r.user),
  // 가입은 승인 신청이다: 로그인되지 않고 승인 대기 안내만 돌려받는다
  signup: (name: string, email: string, password: string, requestedRole: SignupRole) =>
    post<{ status: 'PENDING'; message: string }>('/auth/signup', { name, email, password, requestedRole }),
  logout: () => post<{ ok: true }>('/auth/logout'),
  listUsers: () => get<{ items: User[] }>('/users').then((r) => r.items),

  // ── 배정 ──
  async listAssignments(p: { status?: AssignmentStatus; q?: string; page: number; pageSize: number }) {
    const qs = new URLSearchParams({ page: String(p.page), pageSize: String(p.pageSize) })
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

  createAssignment: (input: { title: string; assigneeId: string; dueDate: string; verdicts: Verdict[]; count: number }) =>
    post<{ id: string; count: number }>('/assignments', { ...input, verdicts: input.verdicts.map((v) => VERDICT_CODE[v]) }),

  setStatus: (id: string, to: AssignmentStatus) => post<{ id: string }>(`/assignments/${id}/status`, { to: STATUS_CODE[to] }),
  saveNote: (id: string, note: string) => put<{ ok: true }>(`/assignments/${id}/note`, { note }),

  // ── 이미지 (서버 페이지네이션) ──
  async listImages(id: string, p: { page: number; pageSize: number; filter?: ImageFilter }) {
    const qs = new URLSearchParams({ page: String(p.page), pageSize: String(p.pageSize), filter: p.filter ?? 'all' })
    const r = await get<Page<ApiImageItem>>(`/assignments/${id}/images?${qs}`)
    return { ...r, items: r.items.map(toImageItem) as ImageItem[] }
  },
  /** afterPosition(1부터) 다음의 첫 미검토 이미지 위치. 없으면 처음부터 다시 찾고, 전부 검토했으면 null */
  nextUnreviewed: (id: string, afterPosition: number) =>
    get<{ position: number | null }>(`/assignments/${id}/next-unreviewed?after=${afterPosition}`).then((r) => r.position),
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

  // ── 판정 규칙 (관리자) ──
  listRules: () => get<RuleList>('/rules'),
  previewRule: (p: { normalMin: number; suspectMin: number }) => get<RulePreview>(`/rules/preview?normalMin=${p.normalMin}&suspectMin=${p.suspectMin}`),
  createRule: (p: { normalMin: number; suspectMin: number }) => post<Rule>('/rules', p),
  setRuleEnabled: (id: string, enabled: boolean) => patch<Rule>(`/rules/${id}`, { enabled }),
  rejudge: (id: string, scope: 'unassigned' | 'all') => post<RejudgeResult>(`/rules/${id}/rejudge`, { scope }),
  ruleHistory: () => get<{ items: RuleHistoryItem[] }>('/rules/history').then((r) => r.items),

  reviewImage: (id: string, imageId: string, status: '승인' | '반려', comment: string) =>
    put<{ progress: { reviewed: number; approved: number; rejected: number } }>(
      `/assignments/${id}/images/${imageId}/review`,
      { status: REVIEW_CODE[status], comment },
    ),
}
