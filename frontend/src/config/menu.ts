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

export const MENU: TopMenu[] = [
  {
    key: 'home',
    label: '홈',
    groups: [{ label: '현황', items: [{ label: '대시보드', path: '/home/dashboard' }] }],
  },
  {
    key: 'review',
    label: '검수 관리',
    groups: [
      {
        label: '배정',
        items: [
          { label: '배정 리스트', path: '/review/assignments' },
          { label: '내 배정', path: '/review/my-assignments' },
        ],
      },
      { label: '점검', items: [{ label: '점검 이력', path: '/review/history' }] },
    ],
  },
  {
    key: 'data',
    label: '데이터',
    groups: [
      { label: '이미지', items: [{ label: '이미지 목록', path: '/data/images' }] },
      { label: '모델', items: [{ label: '모델 실행 이력', path: '/data/model-runs' }] },
    ],
  },
  {
    key: 'monitoring',
    label: '모니터링',
    groups: [{ label: '분석', items: [{ label: '소요 시간 분석', path: '/monitoring/time' }] }],
  },
  {
    key: 'settings',
    label: '설정',
    groups: [
      { label: '판정', items: [{ label: '임계값/규칙', path: '/settings/rules' }] },
      { label: '연계', items: [{ label: '연계 관리', path: '/settings/integrations' }] },
      { label: '사용자', items: [{ label: '사용자 관리', path: '/settings/users' }] },
    ],
  },
]

export const IMPLEMENTED = new Set(['/review/assignments', '/monitoring/time', '/settings/integrations', '/settings/rules', '/settings/users'])

export function topKeyOfPath(pathname: string) {
  return MENU.find((m) => pathname.startsWith(`/${m.key}`))?.key ?? MENU[0].key
}
