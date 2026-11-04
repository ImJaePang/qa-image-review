import { describe, expect, it } from 'vitest'
import { describeRuleHistory, fmtParams, parseThreshold, thresholdProblem } from './rules'

describe('parseThreshold', () => {
  it('0~1 숫자만 받는다', () => {
    expect(parseThreshold('0.8')).toBe(0.8)
    expect(parseThreshold('0')).toBe(0)
    expect(parseThreshold('1')).toBe(1)
    expect(parseThreshold('')).toBeNull()
    expect(parseThreshold('abc')).toBeNull()
    expect(parseThreshold('1.2')).toBeNull()
    expect(parseThreshold('-0.1')).toBeNull()
  })
})

describe('thresholdProblem', () => {
  it('의심 기준이 정상 기준보다 낮아야 한다 (같아도 안 됨)', () => {
    expect(thresholdProblem(0.8, 0.4)).toBeNull()
    expect(thresholdProblem(0.5, 0.5)).toMatch(/낮아야/)
    expect(thresholdProblem(0.4, 0.8)).toMatch(/낮아야/)
    expect(thresholdProblem(null, 0.4)).toMatch(/숫자/)
  })
})

describe('describeRuleHistory', () => {
  it('만듦/켬/끔/재판정 문구', () => {
    expect(fmtParams({ normalMin: 0.9, suspectMin: 0.5 })).toBe('정상 ≥ 0.90 · 의심 ≥ 0.50')
    expect(describeRuleHistory({ action: 'CREATE', version: 2, detail: { params: { normalMin: 0.8, suspectMin: 0.4 } } })).toBe('v2 만듦 (정상 ≥ 0.80 · 의심 ≥ 0.40)')
    expect(describeRuleHistory({ action: 'DISABLE', version: 2, detail: {} })).toBe('v2 끔')
    expect(describeRuleHistory({ action: 'ENABLE', version: 2, detail: {} })).toBe('v2 켬')
    expect(describeRuleHistory({ action: 'REJUDGE', version: 2, detail: { scope: 'unassigned', rejudged: 11, changed: 1 } })).toBe('v2 재판정 (미배정만): 11장 중 1장 바뀜')
    expect(describeRuleHistory({ action: 'REJUDGE', version: 1, detail: { scope: 'all', rejudged: 12, changed: 2 } })).toBe('v1 재판정 (배정된 이미지 포함): 12장 중 2장 바뀜')
  })
})
