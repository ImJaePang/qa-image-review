// 권한 관리 화면용 순수 함수 (입력 검사, 이력 문구). 화면과 분리해 단위 테스트한다.

/** 서버(backend/src/routes/roles.mjs CODE_RE)와 같은 규칙: 영문 소문자로 시작, 소문자·숫자·밑줄, 2~30자 */
export const ROLE_CODE_PATTERN = /^[a-z][a-z0-9_]{1,29}$/
export const ROLE_LABEL_MAX = 30
export const ROLE_DESCRIPTION_MAX = 300

export type RoleStatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE'
export const ROLE_STATUS_LABEL = { ACTIVE: '사용 중', INACTIVE: '사용 안 함' } as const

/** 모달 입력 검사. 문제가 있으면 한국어 안내를 돌려주고, 없으면 null */
export function validateRoleForm(f: { isNew: boolean; code: string; label: string; description: string; sortOrder: string }): string | null {
  if (f.isNew && !ROLE_CODE_PATTERN.test(f.code)) return '코드는 영문 소문자로 시작하는 2~30자(소문자·숫자·밑줄)로 입력하세요.'
  if (!f.label.trim()) return '이름을 입력하세요.'
  if (f.label.trim().length > ROLE_LABEL_MAX) return `이름은 ${ROLE_LABEL_MAX}자까지 입력할 수 있습니다.`
  if (f.description.length > ROLE_DESCRIPTION_MAX) return `설명은 ${ROLE_DESCRIPTION_MAX}자까지 입력할 수 있습니다.`
  if (f.sortOrder.trim() !== '' && !/^\d{1,4}$/.test(f.sortOrder.trim())) return '표시 순서는 0~9999 사이 숫자로 입력하세요.'
  return null
}

const FIELD_LABEL: Record<string, string> = { label: '이름', description: '설명', signupSelectable: '가입 신청 가능', sortOrder: '표시 순서' }

const show = (key: string, v: unknown) => {
  if (v === null || v === undefined || v === '') return '(없음)'
  if (key === 'signupSelectable') return v ? '가능' : '불가'
  return String(v)
}

/** 이력 한 건을 사람이 읽는 줄로 바꾼다 */
export function describeRoleHistory(h: { action: string; detail: Record<string, any> }): string[] {
  const d = h.detail ?? {}
  switch (h.action) {
    case 'CREATE':
      return ['권한 만들기']
    case 'DEACTIVATE':
      return ['사용 안 함으로 전환']
    case 'ACTIVATE':
      return ['다시 사용']
    case 'DELETE':
      return ['삭제']
    case 'UPDATE':
      return Object.entries(d).map(([k, v]) => {
        const c = v as { from: unknown; to: unknown }
        // 설명은 길 수 있어 바뀐 사실만 적는다
        return k === 'description' ? '설명 변경' : `${FIELD_LABEL[k] ?? k}: ${show(k, c.from)} → ${show(k, c.to)}`
      })
    default:
      return [h.action]
  }
}
