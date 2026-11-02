import { describe, expect, test } from 'vitest'
import { ASSIGNMENT_STATUSES } from '@/lib/types'
import { REVIEW_CODE, REVIEW_KO, STATUS_CODE, STATUS_KO, VERDICT_CODE, VERDICT_KO, toImageItem, type ApiImageItem } from './mappers'

// 서버(DB 체크 제약)가 쓰는 코드와 화면 한글 값이 어긋나면 여기서 먼저 깨진다.
describe('영문 코드 ↔ 한글 매핑', () => {
  test('배정 상태: 왕복 변환이 일치하고 화면 순서(ASSIGNMENT_STATUSES)와 같은 5단계', () => {
    expect(Object.keys(STATUS_KO)).toEqual(['ASSIGNED', 'PRECHECKED', 'IN_REVIEW', 'REVIEWED', 'CONFIRMED'])
    expect(Object.values(STATUS_KO)).toEqual(ASSIGNMENT_STATUSES)
    for (const [code, ko] of Object.entries(STATUS_KO)) expect(STATUS_CODE[ko]).toBe(code)
  })

  test('판정: 왕복 변환', () => {
    for (const [code, ko] of Object.entries(VERDICT_KO)) expect(VERDICT_CODE[ko]).toBe(code)
  })

  test('검수: 승인/반려는 서버 코드로, 미검토(NONE)는 서버로 보내지 않는다', () => {
    expect(REVIEW_CODE).toEqual({ 승인: 'APPROVED', 반려: 'REJECTED' })
    expect(REVIEW_KO.NONE).toBe('미검토')
  })
})

describe('toImageItem', () => {
  const base: ApiImageItem = {
    imageId: 'img_0001', fileName: 'a.png', width: 1920, height: 1080, modelVersion: 'v1', overallScore: 0.4,
    boxes: [], previewUrl: '/files/a.svg', thumbUrl: '/files/a.svg', heatmapUrl: null, verdict: 'DEFECT',
    review: { status: 'NONE', comment: '', reviewedAt: null },
  }

  test('서버 코드를 한글로 바꾸고, 히트맵이 없으면 빈 문자열', () => {
    const r = toImageItem(base)
    expect(r.verdict).toBe('불량')
    expect(r.review.status).toBe('미검토')
    expect(r.heatmapUrl).toBe('')
  })

  test('승인/반려 상태와 코멘트가 유지된다', () => {
    const r = toImageItem({ ...base, review: { status: 'REJECTED', comment: '경계 이상', reviewedAt: '2026-11-02T00:00:00Z' } })
    expect(r.review).toEqual({ status: '반려', comment: '경계 이상', reviewedAt: '2026-11-02T00:00:00Z' })
  })
})
