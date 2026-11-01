import type { Assignment, Detection, ImageResult, ImageReview, ReasonCode, User } from '@/lib/types'
import { makeHeatmap, makeImage, rng, H, W } from './svg'

export const seedUsers: User[] = [
  { id: 'u_admin', name: '관리자', email: 'admin@example.com', password: '1234', role: 'admin' },
  { id: 'u_qa1', name: '김검수', email: 'qa1@example.com', password: '1234', role: 'qa' },
  { id: 'u_qa2', name: '이점검', email: 'qa2@example.com', password: '1234', role: 'qa' },
  { id: 'u_qa3', name: '박확인', email: 'qa3@example.com', password: '1234', role: 'qa' },
]

const REASONS: ReasonCode[] = [
  'COMPOSITE_EDGE',
  'SHAPE_DISTORTION',
  'LIGHTING_MISMATCH',
  'TEXTURE_ANOMALY',
  'SCALE_ANOMALY',
  'PART_COUNT_MISMATCH',
]
const SUBJECTS = ['tank', 'howitzer', 'apc', 'truck']

function buildImages(count: number): ImageResult[] {
  const r = rng(2026)
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1
    const defective = r() < 0.3
    const boxes: Detection[] = []
    let overall = 0.9 + r() * 0.09
    if (defective) {
      const nb = 1 + Math.floor(r() * 2)
      for (let k = 0; k < nb; k++) {
        const w = 120 + Math.floor(r() * 220)
        const h = 90 + Math.floor(r() * 160)
        boxes.push({
          x: 500 + Math.floor(r() * (W - 1000 - w + 400)),
          y: 380 + Math.floor(r() * (H - 380 - h - 260)),
          width: w,
          height: h,
          score: Math.round((0.15 + r() * 0.6) * 100) / 100,
          reasonCode: REASONS[Math.floor(r() * REASONS.length)],
        })
      }
      overall = Math.min(...boxes.map((b) => b.score))
      if (r() < 0.4) overall = Math.min(0.89, overall + 0.3) // 일부는 의심 구간으로
    }
    const fileName = `${SUBJECTS[i % SUBJECTS.length]}_${String(n).padStart(4, '0')}.png`
    return {
      imageId: `img_${String(n).padStart(4, '0')}`,
      fileName,
      width: W,
      height: H,
      modelVersion: 'mock-v1',
      overallScore: Math.round(overall * 100) / 100,
      boxes,
      previewUrl: makeImage(n, fileName, boxes),
      heatmapUrl: makeHeatmap(boxes, n),
    }
  })
}

export const seedImages = buildImages(120)

const iso = (daysAgo: number, hour = 10) => {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

function emptyReviews(ids: string[]): Record<string, ImageReview> {
  return Object.fromEntries(ids.map((id) => [id, { status: '미검토' as const, comment: '' }]))
}

function mk(
  no: number,
  title: string,
  status: Assignment['status'],
  assignee: User,
  range: [number, number],
  doneRatio: number,
  daysAgo: number,
): Assignment {
  const ids = seedImages.slice(range[0], range[1]).map((x) => x.imageId)
  const reviews = emptyReviews(ids)
  const doneCount = Math.floor(ids.length * doneRatio)
  ids.slice(0, doneCount).forEach((id, i) => {
    const bad = seedImages.find((x) => x.imageId === id)!.overallScore < 0.9
    reviews[id] = {
      status: bad && i % 2 === 0 ? '반려' : '승인',
      comment: bad && i % 2 === 0 ? '합성 경계가 눈에 띔' : '',
      reviewedAt: iso(daysAgo - 1, 14),
    }
  })
  const history = [{ at: iso(daysAgo), actor: '관리자', action: `${assignee.name}에게 배정` }]
  const order = ['배정', '사전배치', '점검중', '점검완료', '확인완료']
  const idx = order.indexOf(status)
  if (idx >= 1) history.push({ at: iso(daysAgo, 11), actor: '시스템', action: '사전배치(AI 사전 검증) 완료' })
  if (idx >= 2) history.push({ at: iso(daysAgo - 1, 9), actor: assignee.name, action: '점검 시작' })
  if (idx >= 3) history.push({ at: iso(daysAgo - 2, 17), actor: assignee.name, action: '점검 완료' })
  if (idx >= 4) history.push({ at: iso(daysAgo - 3, 10), actor: '관리자', action: '확인 완료' })
  return {
    id: `AS-${String(no).padStart(4, '0')}`,
    title,
    status,
    assigneeId: assignee.id,
    assigneeName: assignee.name,
    createdBy: '관리자',
    createdAt: iso(daysAgo),
    dueDate: iso(daysAgo - 7).slice(0, 10),
    imageIds: ids,
    reviews,
    inspectionNote: idx >= 3 ? '전반적으로 합성 경계 이상이 반복됨. 모델 재생성 권장.' : '',
    history,
  }
}

const [, qa1, qa2, qa3] = seedUsers

export const seedAssignments: Assignment[] = [
  mk(1, '주력전차 1차 배치', '확인완료', qa1, [0, 12], 1, 12),
  mk(2, '자주포 야외 시리즈 A', '점검완료', qa2, [12, 24], 1, 9),
  mk(3, '장갑차 야외 시리즈', '점검중', qa1, [24, 40], 0.4, 6),
  mk(4, '트럭류 샘플 점검', '점검중', qa3, [40, 52], 0.7, 5),
  mk(5, '주력전차 2차 배치', '사전배치', qa2, [52, 68], 0, 3),
  mk(6, '자주포 야외 시리즈 B', '사전배치', qa3, [68, 80], 0, 2),
  mk(7, '혼합 장비 신규 배치', '배정', qa1, [80, 92], 0, 1),
  mk(8, '재생성 건 재점검', '배정', qa2, [92, 100], 0, 0),
]
