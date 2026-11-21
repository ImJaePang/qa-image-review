import { describe, expect, test } from 'vitest'
import { globalIndex, stepPaged } from './pagedNav'

// 45장, 20개씩 → 1쪽 20, 2쪽 20, 3쪽 5
describe('크게 보기에서 쪽을 넘어 이동', () => {
  test('같은 쪽 안에서는 한 칸씩 움직인다', () => {
    expect(stepPaged({ page: 1, idx: 3 }, 1, 20, 45, 20)).toEqual({ page: 1, idx: 4 })
    expect(stepPaged({ page: 2, idx: 3 }, -1, 20, 45, 20)).toEqual({ page: 2, idx: 2 })
  })

  test('쪽의 끝에서 다음은 다음 쪽의 처음, 쪽의 처음에서 이전은 이전 쪽의 끝', () => {
    expect(stepPaged({ page: 1, idx: 19 }, 1, 20, 45, 20)).toEqual({ page: 2, edge: 'first' })
    expect(stepPaged({ page: 3, idx: 0 }, -1, 5, 45, 20)).toEqual({ page: 2, edge: 'last' })
  })

  test('전체의 처음과 끝에서는 더 가지 않는다', () => {
    expect(stepPaged({ page: 1, idx: 0 }, -1, 20, 45, 20)).toBeNull()
    expect(stepPaged({ page: 3, idx: 4 }, 1, 5, 45, 20)).toBeNull()
  })

  test('전체 위치는 쪽과 쪽 안 위치로 계산한다', () => {
    expect(globalIndex({ page: 3, idx: 4 }, 20)).toBe(44)
  })
})
