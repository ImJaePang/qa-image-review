// 목 API: 나중에 fetch('/api/...')로 바꾸면 화면 코드는 그대로 둘 수 있게 Promise 시그니처를 유지한다.
import type { Assignment, AssignmentStatus, ImageResult, ReviewStatus, Verdict } from '@/lib/types'
import { verdictOf } from '@/lib/domain'
import { seedAssignments, seedImages, seedUsers } from './data'

let assignments: Assignment[] = structuredClone(seedAssignments)
const images: ImageResult[] = seedImages
const delay = <T,>(v: T, ms = 250) => new Promise<T>((res) => setTimeout(() => res(structuredClone(v)), ms))
const now = () => new Date().toISOString()

export const api = {
  listAssignments: () => delay([...assignments].sort((a, b) => b.id.localeCompare(a.id))),
  getAssignment: (id: string) => delay(assignments.find((a) => a.id === id) ?? null, 120),
  listImages: (ids: string[]) => delay(images.filter((i) => ids.includes(i.imageId)), 120),

  /** 어느 배정에도 속하지 않은 이미지 수 (판정별) */
  unassignedCounts: () => {
    const used = new Set(assignments.flatMap((a) => a.imageIds))
    const free = images.filter((i) => !used.has(i.imageId))
    const counts: Record<Verdict, number> = { 정상: 0, 의심: 0, 불량: 0 }
    free.forEach((i) => counts[verdictOf(i)]++)
    return delay(counts, 100)
  },

  createAssignment: (input: { title: string; assigneeId: string; dueDate: string; verdicts: Verdict[]; count: number; actor: string }) => {
    const used = new Set(assignments.flatMap((a) => a.imageIds))
    const pick = images.filter((i) => !used.has(i.imageId) && input.verdicts.includes(verdictOf(i))).slice(0, input.count)
    if (pick.length === 0) return Promise.reject(new Error('조건에 맞는 미배정 이미지가 없습니다.'))
    const assignee = seedUsers.find((u) => u.id === input.assigneeId)
    const no = assignments.length + 1
    const a: Assignment = {
      id: `AS-${String(no).padStart(4, '0')}`,
      title: input.title,
      status: '배정',
      assigneeId: input.assigneeId,
      assigneeName: assignee?.name ?? '-',
      createdBy: input.actor,
      createdAt: now(),
      dueDate: input.dueDate,
      imageIds: pick.map((i) => i.imageId),
      reviews: Object.fromEntries(pick.map((i) => [i.imageId, { status: '미검토' as const, comment: '' }])),
      inspectionNote: '',
      history: [{ at: now(), actor: input.actor, action: `${assignee?.name ?? '-'}에게 배정 (${pick.length}장)` }],
    }
    assignments = [...assignments, a]
    return delay(a)
  },

  setStatus: (id: string, status: AssignmentStatus, actor: string, action: string) => {
    const a = assignments.find((x) => x.id === id)
    if (!a) return Promise.reject(new Error('배정을 찾을 수 없습니다.'))
    a.status = status
    a.history.push({ at: now(), actor, action })
    return delay(a, 150)
  },

  reviewImage: (id: string, imageId: string, status: ReviewStatus, comment: string) => {
    const a = assignments.find((x) => x.id === id)
    if (!a) return Promise.reject(new Error('배정을 찾을 수 없습니다.'))
    a.reviews[imageId] = { status, comment, reviewedAt: now() }
    return delay(a, 80)
  },

  saveNote: (id: string, note: string, actor: string) => {
    const a = assignments.find((x) => x.id === id)
    if (!a) return Promise.reject(new Error('배정을 찾을 수 없습니다.'))
    a.inspectionNote = note
    a.history.push({ at: now(), actor, action: '점검 내용 저장' })
    return delay(a, 150)
  },
}
