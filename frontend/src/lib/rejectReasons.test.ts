import { describe, expect, test } from 'vitest'
import { aiReasonCodes, initialRejectReasons, missingCommentReason } from './rejectReasons'
import type { Detection, ImageReview } from './types'

const CODES = ['COMPOSITE_EDGE', 'SHAPE_DISTORTION', 'LIGHTING_MISMATCH', 'TEXTURE_ANOMALY', 'SCALE_ANOMALY', 'PART_COUNT_MISMATCH', 'OTHER']
const box = (reasonCode: Detection['reasonCode']): Detection => ({ x: 0, y: 0, width: 1, height: 1, score: 0.4, reasonCode })
const unreviewed: ImageReview = { status: '미검토', comment: '' }

describe('반려 사유 미리 고르기', () => {
  test('처음 반려하면 AI가 찾은 원인을 선택지 순서대로, 중복 없이 고른다', () => {
    const img = { boxes: [box('PART_COUNT_MISMATCH'), box('SHAPE_DISTORTION'), box('PART_COUNT_MISMATCH')], review: unreviewed }
    expect(initialRejectReasons(img, CODES)).toEqual(['SHAPE_DISTORTION', 'PART_COUNT_MISMATCH'])
  })

  test('원인 미분류(UNKNOWN)처럼 선택지에 없는 코드는 고르지 않는다', () => {
    const img = { boxes: [box('UNKNOWN')], review: unreviewed }
    expect(initialRejectReasons(img, CODES)).toEqual([])
    expect(aiReasonCodes(img, CODES)).toEqual([])
  })

  test('이미 반려한 이미지는 그때 고른 사유를 다시 보여 준다', () => {
    const img = { boxes: [box('SHAPE_DISTORTION')], review: { status: '반려' as const, comment: '', reasons: ['OTHER', 'TEXTURE_ANOMALY'] } }
    expect(initialRejectReasons(img, CODES)).toEqual(['TEXTURE_ANOMALY', 'OTHER'])
  })

  test('승인했던 이미지를 반려로 바꾸면 AI 원인부터 시작한다', () => {
    const img = { boxes: [box('LIGHTING_MISMATCH')], review: { status: '승인' as const, comment: '' } }
    expect(initialRejectReasons(img, CODES)).toEqual(['LIGHTING_MISMATCH'])
  })
})

describe('코멘트가 필요한 사유', () => {
  const options = [
    { code: 'TEXTURE_ANOMALY', label: '질감 이상', requiresComment: false },
    { code: 'OTHER', label: '기타', requiresComment: true },
  ]
  test('기타를 고르고 코멘트가 비어 있으면(공백만 포함) 기타를 알려 준다', () => {
    expect(missingCommentReason(options, ['OTHER'], '  ')?.label).toBe('기타')
  })
  test('코멘트가 있거나 기타를 고르지 않았으면 문제없다', () => {
    expect(missingCommentReason(options, ['OTHER'], '바퀴 수가 이상함')).toBeNull()
    expect(missingCommentReason(options, ['TEXTURE_ANOMALY'], '')).toBeNull()
  })
})
