import { describe, expect, test } from 'vitest'
import { BULK_CHUNK, bulkActionsFor, chunk, describeUserHistory, mergeBulkResults, summarizeBulk } from './users'
import { ROLE_LABEL } from './types'

const role = (r: string) => ROLE_LABEL[r as keyof typeof ROLE_LABEL] ?? r

describe('상태 필터별 일괄 처리 동작', () => {
  test('승인 대기는 승인/반려, 만료는 해제/비활성, 전체 보기는 없음', () => {
    expect(bulkActionsFor('PENDING')).toEqual(['APPROVE', 'REJECT'])
    expect(bulkActionsFor('EXPIRED')).toEqual(['RELEASE_EXPIRY', 'DISABLE'])
    expect(bulkActionsFor('ACTIVE')).toEqual(['DISABLE'])
    expect(bulkActionsFor('DISABLED')).toEqual(['ENABLE'])
    expect(bulkActionsFor('ALL')).toEqual([])
  })
})

describe('100명씩 끊어 처리', () => {
  test('chunk', () => {
    const ids = Array.from({ length: 250 }, (_, i) => i)
    expect(chunk(ids, BULK_CHUNK).map((c) => c.length)).toEqual([100, 100, 50])
    expect(chunk([], 100)).toEqual([])
  })
  test('결과 합치기와 요약', () => {
    const r = mergeBulkResults([
      { processed: 100, skipped: [] },
      { processed: 49, skipped: [{ id: '5', name: '김', reason: '사용 중 상태에서는 할 수 없습니다.' }] },
    ])
    expect(r.processed).toBe(149)
    expect(r.skipped).toHaveLength(1)
    expect(summarizeBulk('APPROVE', r)).toBe('149명 승인했습니다 (건너뜀 1명)')
    expect(summarizeBulk('REJECT', { processed: 2, skipped: [] })).toBe('2명 반려했습니다')
  })
})

describe('이력 문구', () => {
  test('승인·권한·프로필', () => {
    expect(describeUserHistory({ action: 'SIGNUP', detail: { requestedRole: 'researcher' } }, role)).toEqual(['가입 신청 (신청 권한: 연구원)'])
    expect(describeUserHistory({ action: 'APPROVE', detail: { role: 'qa' } }, role)).toEqual(['가입 승인 (QA)'])
    expect(describeUserHistory({ action: 'ROLE', detail: { from: 'qa', to: 'researcher' } }, role)).toEqual(['권한: QA → 연구원'])
    expect(describeUserHistory({ action: 'EXPIRY_RELEASE', detail: { to: '2027-11-04T00:00:00Z' } }, role)).toEqual(['만료 해제 (사용기한 2027-11-04)'])
    expect(describeUserHistory({ action: 'PROFILE', detail: { company: { from: '', to: '한빛' }, name: { from: 'a', to: 'b' } } }, role)).toEqual(['업체: (없음) → 한빛', '이름: a → b'])
  })
})
