import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { judge, reasonsOf } from '../src/rules.mjs'

const params = { normalMin: 0.9, suspectMin: 0.5 }

describe('judge: 임계값은 인자로 받는다', () => {
  test('경계값 포함 여부', () => {
    assert.equal(judge(0.9, params), 'NORMAL')
    assert.equal(judge(0.899, params), 'SUSPECT')
    assert.equal(judge(0.5, params), 'SUSPECT')
    assert.equal(judge(0.499, params), 'DEFECT')
  })

  test('규칙이 바뀌면 같은 점수의 판정도 바뀐다', () => {
    assert.equal(judge(0.85, { normalMin: 0.8, suspectMin: 0.4 }), 'NORMAL')
  })
})

describe('reasonsOf', () => {
  test('점수 낮은 순, 중복 제거', () => {
    const boxes = [
      { score: 0.6, reasonCode: 'B' },
      { score: 0.2, reasonCode: 'A' },
      { score: 0.4, reasonCode: 'B' },
    ]
    assert.deepEqual(reasonsOf(boxes), ['A', 'B'])
  })

  test('박스가 없으면 빈 배열', () => assert.deepEqual(reasonsOf([]), []))
})
