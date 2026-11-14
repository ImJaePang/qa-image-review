import { describe, expect, test } from 'vitest'
import { barRatio, dayLabel, niceMax, percentLabel, percentOf, ticks } from './dashboard'

describe('대시보드 계산', () => {
  test('비율은 정수 %, 전체가 0이면 0', () => {
    expect(percentOf(2081, 3000)).toBe(69)
    expect(percentOf(1, 3)).toBe(33)
    expect(percentOf(0, 0)).toBe(0)
  })
  test('진행률 문구: 했는데 0%로 보이면 1% 미만', () => {
    expect(percentLabel(3, 3300)).toBe('1% 미만')
    expect(percentLabel(0, 3300)).toBe('0%')
    expect(percentLabel(33, 3300)).toBe('1%')
    expect(percentLabel(3300, 3300)).toBe('100%')
    expect(percentLabel(0, 0)).toBe('0%')
  })
  test('세로 눈금 최댓값은 값이 들어가는 깔끔한 수', () => {
    expect(niceMax(0)).toBe(4)
    expect(niceMax(3)).toBe(4)
    expect(niceMax(5)).toBe(5)
    expect(niceMax(7)).toBe(10)
    expect(niceMax(13)).toBe(20)
    expect(niceMax(47)).toBe(50)
    expect(niceMax(51)).toBe(100)
    expect(niceMax(1234)).toBe(2000)
  })
  test('눈금은 0부터 같은 간격', () => {
    expect(ticks(20)).toEqual([0, 5, 10, 15, 20])
    expect(ticks(4, 2)).toEqual([0, 2, 4])
  })
  test('날짜 라벨은 요일 포함, 시간대와 무관', () => {
    expect(dayLabel('2026-11-14')).toBe('11/14 (토)')
    expect(dayLabel('2026-01-01')).toBe('1/1 (목)')
    expect(dayLabel('이상한 값')).toBe('이상한 값')
  })
  test('막대 비율', () => {
    expect(barRatio(5, 10)).toBe(0.5)
    expect(barRatio(0, 0)).toBe(0)
    expect(barRatio(12, 10)).toBe(1)
  })
})
