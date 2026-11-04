// 계정 상태 규칙 (설계 9장). 로그인·토큰 확인·사용자 목록이 같은 기준을 쓰도록 한곳에 둔다.
export const ROLES = ['admin', 'researcher', 'qa']
export const SIGNUP_ROLES = ['researcher', 'qa'] // 가입 때 신청할 수 있는 권한 (관리자는 신청 불가)
export const EXPIRY_YEARS = 1

/** 저장된 상태가 ACTIVE여도 사용기한이 지났으면 EXPIRED로 본다 */
export function effectiveStatus(u, now = new Date()) {
  if (u.status === 'ACTIVE' && u.expires_at && new Date(u.expires_at) <= now) return 'EXPIRED'
  return u.status
}
export const isUsable = (u, now) => effectiveStatus(u, now) === 'ACTIVE'

/** 로그인할 수 없는 상태의 안내 문구. 비밀번호가 맞을 때만 보여 준다 (틀린 경우에 알려 주면 계정 존재 여부가 드러난다) */
export const BLOCKED_MESSAGE = {
  PENDING: '가입 승인 대기 중입니다. 관리자가 승인하면 로그인할 수 있습니다.',
  EXPIRED: '사용기한이 만료된 계정입니다. 만료 해제를 요청해 주세요.',
  DISABLED: '비활성화된 계정입니다. 관리자에게 문의해 주세요.',
}
