import { describe, expect, test } from 'vitest'
import { fmtDuration, fmtMs } from './format'

describe('fmtDuration', () => {
  test('값이 없으면 -', () => {
    expect(fmtDuration(null)).toBe('-')
    expect(fmtDuration(undefined)).toBe('-')
    expect(fmtDuration(Number.NaN)).toBe('-')
  })
  test('10초 미만은 소수 한 자리, 1분 미만은 초', () => {
    expect(fmtDuration(2.34)).toBe('2.3초')
    expect(fmtDuration(0)).toBe('0초')
    expect(fmtDuration(45)).toBe('45초')
  })
  test('분 단위: 딱 떨어지면 초를 생략', () => {
    expect(fmtDuration(60)).toBe('1분')
    expect(fmtDuration(83)).toBe('1분 23초')
    expect(fmtDuration(900)).toBe('15분')
  })
  test('시간 단위', () => {
    expect(fmtDuration(7200)).toBe('2시간')
    expect(fmtDuration(7500)).toBe('2시간 5분')
  })
})

describe('fmtMs', () => {
  test('1초 미만은 ms, 이상은 초', () => {
    expect(fmtMs(120)).toBe('120ms')
    expect(fmtMs(1500)).toBe('1.5초')
    expect(fmtMs(null)).toBe('-')
  })
})
