// 백엔드 API 호출. 화면 코드는 한글 값만 다루고, 변환은 mappers에서 한다.
import type { AssignmentListItem, AssignmentStatus, ImageItem, User, Verdict } from '@/lib/types'
import { get, post, put } from './client'
import {
  REVIEW_CODE,
  STATUS_CODE,
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
  signup: (name: string, email: string, password: string) =>
    post<{ user: User }>('/auth/signup', { name, email, password }).then((r) => r.user),
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
  reviewImage: (id: string, imageId: string, status: '승인' | '반려', comment: string) =>
    put<{ progress: { reviewed: number; approved: number; rejected: number } }>(
      `/assignments/${id}/images/${imageId}/review`,
      { status: REVIEW_CODE[status], comment },
    ),
}
