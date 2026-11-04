import { describe, expect, test } from 'vitest'
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, pageCount, pageWindow } from './paging'

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

describe('번호 창 (10개씩)', () => {
  test('15페이지: 1~10쪽에서는 1~10, 11쪽부터는 11~15', () => {
    expect(pageWindow(1, 15)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(pageWindow(10, 15)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(pageWindow(11, 15)).toEqual([11, 12, 13, 14, 15])
    expect(pageWindow(15, 15)).toEqual([11, 12, 13, 14, 15])
  })
  test('적으면 있는 만큼만, 한 페이지면 [1]', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3])
    expect(pageWindow(1, 1)).toEqual([1])
  })
})
