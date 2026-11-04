// 권한 검사 (설계 9장 3단계). 판단의 근거는 DB의 role_permissions 하나다.
//  - authenticate가 요청마다 사용자의 권한 코드를 읽어 req.user.permissions(Set)에 담는다 → 권한을 바꾸면 로그인 중인 사용자에게도 다음 요청부터 적용된다.
//  - 코드에는 "관리자인가"가 아니라 "이 권한 코드가 있는가"만 쓴다.
import { httpError } from './errors.mjs'

/** 관리자가 권한을 모두 잃어 아무도 설정을 못 바꾸게 되는 일을 막기 위해, 관리자 권한에서 빼지 못하는 코드 */
export const LOCKED_ADMIN_PERMISSIONS = ['user.manage', 'role.manage', 'menu.manage']

export async function loadPermissions(db, roleCode) {
  const { rows } = await db.query('SELECT permission_code FROM role_permissions WHERE role_code = $1', [roleCode])
  return new Set(rows.map((r) => r.permission_code))
}

export const can = (user, code) => !!user?.permissions?.has(code)
export const canAny = (user, codes) => codes.some((c) => can(user, c))

/** 라우트 훅: 이 권한 코드가 없으면 403. app.authenticate 뒤에 등록한다 (검증 400보다 권한 403이 먼저 나가도록 onRequest에서) */
export const requirePermission = (code, message = '권한이 없습니다.') => async (req) => {
  if (!can(req.user, code)) throw httpError(403, message)
}
export const requireAnyPermission = (codes, message = '권한이 없습니다.') => async (req) => {
  if (!canAny(req.user, codes)) throw httpError(403, message)
}
