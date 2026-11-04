// 메뉴 구조는 서버(DB의 menus 테이블, 내 권한으로 볼 수 있는 것만)가 내려준다: GET /api/menus/mine.
// 상단(상위) → 좌측(중메뉴 → 소메뉴) 구조. 소메뉴 하나가 우측 화면 하나(route)에 대응한다.
export interface MenuLeaf {
  label: string
  path: string
}
export interface MenuGroup {
  label: string
  items: MenuLeaf[]
}
export interface TopMenu {
  key: string
  label: string
  groups: MenuGroup[]
}

/** 아직 화면을 만들지 않은 메뉴 경로 (DB에는 있고, 열면 준비 중 화면이 나온다) */
export const PLACEHOLDER_PATHS = ['/home/dashboard', '/review/my-assignments', '/review/history', '/data/images', '/data/model-runs', '/data/upload']

export const allLeaves = (menus: TopMenu[]) => menus.flatMap((m) => m.groups.flatMap((g) => g.items))

/** 경로가 속한 상단 메뉴 키. 없으면 첫 번째 */
export function topKeyOfPath(menus: TopMenu[], pathname: string) {
  return menus.find((m) => pathname.startsWith(`/${m.key}`))?.key ?? menus[0]?.key ?? ''
}
