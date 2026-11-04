import { describe, expect, test } from 'vitest'
import { fmtDateTime } from './domain'

describe('fmtDateTime', () => {
  test('UTC ISO 시각을 현지 시간으로 표시한다 (어느 시간대에서 돌려도 같은 결과)', () => {
    const local = new Date(2026, 10, 2, 14, 3) // 현지 시간 2026-11-02 14:03
    expect(fmtDateTime(local.toISOString())).toBe('2026-11-02 14:03')
  })
  test('해석할 수 없는 값은 그대로 돌려준다', () => {
    expect(fmtDateTime('not-a-date')).toBe('not-a-date')
  })
})
