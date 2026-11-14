import { describe, expect, test } from 'vitest'
import { IMAGE_ORDERS, ORDER_DESC, ORDER_LABEL, VIEW_ORDERS, VIEW_ORDER_LABEL, assignmentPreview, sampleSize } from './imageSort'

describe('정렬 선택지', () => {
  test('배정 5개, 검수 화면은 배정 순서가 더해진 6개, 무작위는 없다', () => {
    expect(IMAGE_ORDERS).toEqual(['score_asc', 'score_desc', 'boundary', 'boxes_desc', 'newest'])
    expect(VIEW_ORDERS).toEqual(['position', ...IMAGE_ORDERS])
    expect(IMAGE_ORDERS.every((o) => ORDER_LABEL[o] && ORDER_DESC[o])).toBe(true)
    expect(Object.values(VIEW_ORDER_LABEL).join()).not.toContain('무작위')
  })
})

describe('정상 표본', () => {
  test('비율만큼, 100이면 전부, 후보가 있으면 최소 1장', () => {
    expect(sampleSize(2081, 5)).toBe(104)
    expect(sampleSize(2081, 100)).toBe(2081)
    expect(sampleSize(6, 1)).toBe(1)
    expect(sampleSize(0, 50)).toBe(0)
  })
  test('신규 배정 미리보기: 정상은 표본만, 의심·불량은 전부, 이미지 수 상한 적용', () => {
    const free = { 정상: 2081, 의심: 471, 불량: 448 }
    expect(assignmentPreview(free, ['의심', '불량'], 5, 200)).toEqual({ normal: 0, others: 919, candidates: 919, total: 200 })
    expect(assignmentPreview(free, ['정상', '의심', '불량'], 5, 5000)).toEqual({ normal: 104, others: 919, candidates: 1023, total: 1023 })
    expect(assignmentPreview(free, ['정상'], 100, 5000).total).toBe(2081)
    expect(assignmentPreview(free, ['불량'], 5, 0).total).toBe(0)
  })
})
