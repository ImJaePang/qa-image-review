// 계정 상태 규칙 (설계 9장). 로그인·토큰 확인·사용자 목록이 같은 기준을 쓰도록 한곳에 둔다.
// 권한 종류는 roles 테이블이 정한다(코드에 목록을 두지 않는다). 아래는 목록이 아니라 '기본값' 하나뿐:
// 가입한 직후 실제 권한은 승인 전까지 쓸 수 없는 상태로 두고, 신청이 없을 때의 기본 신청 권한이다.
export const DEFAULT_ROLE = 'qa'

/** 권한 코드가 roles에 있는지 확인한다. signupOnly면 가입 때 신청할 수 있는 권한(signup_selectable)만 허용. 아니면 400 */
export async function assertRole(db, code, { signupOnly = false } = {}) {
  const { rows } = await db.query('SELECT signup_selectable FROM roles WHERE code = $1', [code])
  if (!rows.length || (signupOnly && !rows[0].signup_selectable)) {
    const err = new Error(signupOnly ? '신청할 수 없는 권한입니다.' : '알 수 없는 권한입니다.')
    err.statusCode = 400
    throw err
  }
}
export const EXPIRY_YEARS = 1
export const STATUSES = ['PENDING', 'ACTIVE', 'EXPIRED', 'DISABLED']

/** 프로필 항목 (user_profiles 열과 1:1). 항목을 늘릴 때는 여기와 마이그레이션만 고치면 된다 */
export const PROFILE_FIELDS = { company: 'company', department: 'department', jobTitle: 'job_title', phone: 'phone', companyAddress: 'company_address' }

/** 프로필에 모르는 항목이 있으면 400. (스키마 검증은 모르는 항목을 조용히 지워 버려 오타가 저장된 것처럼 보인다) */
export function rejectUnknownProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return
  const extra = Object.keys(profile).filter((k) => !(k in PROFILE_FIELDS))
  if (extra.length) {
    const err = new Error(`알 수 없는 프로필 항목: ${extra.join(', ')}`)
    err.statusCode = 400
    throw err
  }
}

/** 저장된 상태가 ACTIVE여도 사용기한이 지났으면 EXPIRED로 본다 */
export function effectiveStatus(u, now = new Date()) {
  if (u.status === 'ACTIVE' && u.expires_at && new Date(u.expires_at) <= now) return 'EXPIRED'
  return u.status
}
export const isUsable = (u, now) => effectiveStatus(u, now) === 'ACTIVE'

/** 목록·검색용: effectiveStatus의 SQL 버전. u는 users 별칭 */
export const EFFECTIVE_STATUS_SQL = (u = 'u') =>
  `(CASE WHEN ${u}.status = 'ACTIVE' AND ${u}.expires_at IS NOT NULL AND ${u}.expires_at <= now() THEN 'EXPIRED' ELSE ${u}.status END)`

/** 로그인할 수 없는 상태의 안내 문구. 비밀번호가 맞을 때만 보여 준다 (틀린 경우에 알려 주면 계정 존재 여부가 드러난다) */
export const BLOCKED_MESSAGE = {
  PENDING: '가입 승인 대기 중입니다. 관리자가 승인하면 로그인할 수 있습니다.',
  EXPIRED: '사용기한이 만료된 계정입니다. 만료 해제를 요청해 주세요.',
  DISABLED: '비활성화된 계정입니다. 관리자에게 문의해 주세요.',
}
