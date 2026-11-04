import { describe, expect, test } from 'vitest'
import { diffGrants, summarizeChanges, visibleRoles, type Grants } from './permissions'

const g = (o: Record<string, string[]>): Grants => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, new Set(v)]))

describe('권한 표 변경 비교', () => {
  test('바뀐 것만, 허용 → 해제 순서로', () => {
    const before = g({ qa: ['a', 'b'], researcher: ['a'] })
    const after = g({ qa: ['b', 'c'], researcher: ['a'] })
    expect(diffGrants(before, after)).toEqual([
      { role: 'qa', code: 'c', action: 'GRANT' },
      { role: 'qa', code: 'a', action: 'REVOKE' },
    ])
  })
  test('같으면 변경 없음', () => {
    expect(diffGrants(g({ qa: ['a'] }), g({ qa: ['a'] }))).toEqual([])
  })
  test('요약: 3건까지 풀어 쓰고 나머지는 "외 N건"', () => {
    const roles = { qa: 'QA', researcher: '연구원' }
    const codes = { a: '배정', b: '규칙', c: '연계', d: '사용자' }
    const ch = diffGrants(g({ qa: [], researcher: ['a'] }), g({ qa: ['b', 'c', 'd'], researcher: [] }))
    expect(summarizeChanges(ch, roles, codes, 3)).toBe('QA: 규칙 허용 · QA: 연계 허용 · QA: 사용자 허용 외 1건')
    expect(summarizeChanges([], roles, codes)).toBe('')
  })
})

describe('권한 열 필터', () => {
  const roles = [{ code: 'admin' }, { code: 'researcher' }, { code: 'qa' }]
  test('아무것도 안 고르면 전부, 고르면 그 권한만 (원래 순서 유지)', () => {
    expect(visibleRoles(roles, new Set())).toHaveLength(3)
    expect(visibleRoles(roles, new Set(['qa', 'admin'])).map((r) => r.code)).toEqual(['admin', 'qa'])
  })
})
