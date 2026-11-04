// 권한별 메뉴 관리 화면용 순수 함수 (화면과 분리해 단위 테스트한다)
/** 권한(role) → 부여된 권한 코드 집합 */
export type Grants = Record<string, Set<string>>

export interface GrantChange {
  role: string
  code: string
  action: 'GRANT' | 'REVOKE'
}

/** 저장된 상태(before)와 화면에서 고친 상태(after)의 차이. 권한 순서·코드 순서대로 */
export function diffGrants(before: Grants, after: Grants): GrantChange[] {
  const out: GrantChange[] = []
  for (const role of Object.keys(after)) {
    const b = before[role] ?? new Set<string>()
    const a = after[role]
    for (const code of [...a].filter((c) => !b.has(c)).sort()) out.push({ role, code, action: 'GRANT' })
    for (const code of [...b].filter((c) => !a.has(c)).sort()) out.push({ role, code, action: 'REVOKE' })
  }
  return out
}

/** 변경 요약 한 줄: "연구원: 모델 실행 이력 해제 · QA: 규칙 허용 외 1건" (max개까지만 풀어 쓴다) */
export function summarizeChanges(changes: GrantChange[], roleLabels: Record<string, string>, codeLabels: Record<string, string>, max = 3): string {
  const lines = changes.slice(0, max).map((c) => `${roleLabels[c.role] ?? c.role}: ${codeLabels[c.code] ?? c.code} ${c.action === 'GRANT' ? '허용' : '해제'}`)
  const rest = changes.length - max
  return lines.join(' · ') + (rest > 0 ? ` 외 ${rest}건` : '')
}

/** 필터로 고른 권한(code 집합)만 남긴다. 아무것도 안 골랐으면 전부 */
export function visibleRoles<T extends { code: string }>(roles: T[], selected: Set<string>): T[] {
  return selected.size === 0 ? roles : roles.filter((r) => selected.has(r.code))
}
