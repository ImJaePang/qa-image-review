import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ShieldAlert } from 'lucide-react'
import { api } from '@/api'
import { allLeaves } from '@/config/menu'
import { useAuth } from '@/stores/auth'
import { TopBar } from './TopBar'
import { SideMenu } from './SideMenu'

export function AppLayout() {
  const user = useAuth((s) => s.user)
  const ready = useAuth((s) => s.ready)
  const loc = useLocation()
  // 메뉴는 서버가 내 권한으로 볼 수 있는 것만 내려준다 (권한표를 바꾸면 다음에 불러올 때 바로 바뀐다)
  const { data: menus } = useQuery({ queryKey: ['menus', user?.id, user?.permissions.join(',')], queryFn: api.myMenus, enabled: !!user })
  if (!ready) return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">불러오는 중…</div>
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (!menus) return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">불러오는 중…</div>

  const leaves = allLeaves(menus)
  const allowed = leaves.some((l) => l.path === loc.pathname)

  return (
    <div className="flex h-screen flex-col">
      <TopBar menus={menus} />
      <div className="flex min-h-0 flex-1">
        <SideMenu menus={menus} />
        <main className="min-w-0 flex-1 overflow-auto bg-muted/30 p-6">
          {allowed ? (
            <Outlet />
          ) : (
            <div className="flex h-full min-h-80 flex-col items-center justify-center gap-3 text-muted-foreground">
              <ShieldAlert className="size-10" />
              <p className="text-lg font-medium text-foreground">이 화면을 쓸 권한이 없습니다</p>
              {leaves[0] ? (
                <Link to={leaves[0].path} className="text-sm text-primary hover:underline">
                  {leaves[0].label}(으)로 이동
                </Link>
              ) : (
                <p className="text-sm">사용할 수 있는 메뉴가 없습니다. 관리자에게 문의해 주세요.</p>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
