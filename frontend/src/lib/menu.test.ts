import { describe, expect, test } from 'vitest'
import { allLeaves, topKeyOfPath, type TopMenu } from '@/config/menu'

const menus: TopMenu[] = [
  { key: 'review', label: '검수 관리', groups: [{ label: '배정', items: [{ label: '배정 리스트', path: '/review/assignments' }] }] },
  { key: 'settings', label: '설정', groups: [{ label: '사용자', items: [{ label: '사용자 관리', path: '/settings/users' }, { label: '권한별 메뉴', path: '/settings/menus' }] }] },
]

describe('메뉴 트리', () => {
  test('모든 소메뉴 경로', () => {
    expect(allLeaves(menus).map((i) => i.path)).toEqual(['/review/assignments', '/settings/users', '/settings/menus'])
  })
  test('경로가 속한 상단 메뉴, 모르면 첫 번째, 메뉴가 없으면 빈 문자열', () => {
    expect(topKeyOfPath(menus, '/settings/menus')).toBe('settings')
    expect(topKeyOfPath(menus, '/nowhere')).toBe('review')
    expect(topKeyOfPath([], '/x')).toBe('')
  })
})
