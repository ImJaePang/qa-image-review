import { describe, expect, test } from 'vitest'
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, pageCount } from './paging'

describe('페이징 규칙', () => {
  test('기본은 20건, 선택지는 20/50/100/1000', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(20)
    expect([...PAGE_SIZE_OPTIONS]).toEqual([20, 50, 100, 1000])
  })
  test('페이지 수는 최소 1', () => {
    expect(pageCount(0, 20)).toBe(1)
    expect(pageCount(20, 20)).toBe(1)
    expect(pageCount(21, 20)).toBe(2)
    expect(pageCount(2500, 1000)).toBe(3)
  })
})
