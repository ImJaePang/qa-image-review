// 사용자 관리 화면용 순수 함수와 매핑 (DB의 영문 코드 → 화면의 한글). 화면과 분리해 단위 테스트한다.
import type { Role } from '@/lib/types'

export type UserStatus = 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'DISABLED'
export const USER_STATUSES: UserStatus[] = ['PENDING', 'ACTIVE', 'EXPIRED', 'DISABLED']
export const USER_STATUS_LABEL: Record<UserStatus, string> = { PENDING: '승인 대기', ACTIVE: '사용 중', EXPIRED: '만료', DISABLED: '비활성' }

export type BulkAction = 'APPROVE' | 'REJECT' | 'DISABLE' | 'ENABLE' | 'RELEASE_EXPIRY'
export const BULK_LABEL: Record<BulkAction, string> = {
  APPROVE: '승인',
  REJECT: '반려',
  DISABLE: '비활성화',
  ENABLE: '재활성화',
  RELEASE_EXPIRY: '만료 해제',
}
/** 서버 한 번 호출당 상한 (backend BULK_MAX). 더 많이 고르면 이 크기로 끊어 연속 호출한다 */
export const BULK_CHUNK = 100

/** 상태 필터별로 일괄 처리 버튼에 보여 줄 동작. 전체 보기에서는 일괄 처리를 숨긴다(상태가 섞여 있어 대부분 건너뛰게 된다) */
export function bulkActionsFor(status: UserStatus | 'ALL'): BulkAction[] {
  switch (status) {
    case 'PENDING':
      return ['APPROVE', 'REJECT']
    case 'ACTIVE':
      return ['DISABLE']
    case 'EXPIRED':
      return ['RELEASE_EXPIRY', 'DISABLE']
    case 'DISABLED':
      return ['ENABLE']
    default:
      return []
  }
}

export const PROFILE_LABEL = { company: '업체', department: '부서', jobTitle: '직급', phone: '연락처', companyAddress: '업체 주소' } as const
export type ProfileKey = keyof typeof PROFILE_LABEL
export type UserProfile = Record<ProfileKey, string>

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export interface BulkResult {
  processed: number
  skipped: { id: string; name: string | null; reason: string }[]
}
/** 100명씩 끊어 받은 결과들을 하나로 합친다 */
export function mergeBulkResults(rs: BulkResult[]): BulkResult {
  return { processed: rs.reduce((n, r) => n + r.processed, 0), skipped: rs.flatMap((r) => r.skipped) }
}

/** 처리 결과 한 줄 요약: "3명 승인했습니다 (건너뜀 1명)" */
export function summarizeBulk(action: BulkAction, r: BulkResult): string {
  const base = `${r.processed}명 ${BULK_LABEL[action]}했습니다`
  return r.skipped.length ? `${base} (건너뜀 ${r.skipped.length}명)` : base
}

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(없음)' : String(v))
const day = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : show(v))

/** 이력 한 건을 사람이 읽는 줄로 바꾼다 */
export function describeUserHistory(h: { action: string; detail: Record<string, any> }, roleLabel: (r: string) => string): string[] {
  const d = h.detail ?? {}
  switch (h.action) {
    case 'SIGNUP':
      return [`가입 신청${d.requestedRole ? ` (신청 권한: ${roleLabel(d.requestedRole)})` : ''}`]
    case 'APPROVE':
      return [`가입 승인 (${roleLabel(d.role)})`]
    case 'REJECT':
      return ['가입 반려']
    case 'ENABLE':
      return ['재활성화']
    case 'DISABLE':
      return ['비활성화']
    case 'EXPIRE':
      return ['사용기한 만료']
    case 'EXPIRY_REQUEST':
      return ['만료 해제 요청']
    case 'EXPIRY_RELEASE':
      return [`만료 해제 (사용기한 ${day(d.to)})`]
    case 'ROLE':
      return [`권한: ${roleLabel(d.from)} → ${roleLabel(d.to)}`]
    case 'EXPIRES':
      return [`사용기한: ${day(d.from)} → ${day(d.to)}`]
    case 'PASSWORD_RESET':
      return ['임시 비밀번호 발급']
    case 'PROFILE':
      return Object.entries(d).map(([k, v]) => {
        const label = k === 'name' ? '이름' : (PROFILE_LABEL[k as ProfileKey] ?? k)
        const c = v as { from: unknown; to: unknown }
        return `${label}: ${show(c.from)} → ${show(c.to)}`
      })
    default:
      return [h.action]
  }
}

export type { Role }
