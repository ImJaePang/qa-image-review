import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/stores/auth'
import { TopBar } from './TopBar'
import { SideMenu } from './SideMenu'

export function AppLayout() {
  const user = useAuth((s) => s.user)
  const ready = useAuth((s) => s.ready)
  const loc = useLocation()
  if (!ready) return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">불러오는 중…</div>
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />

  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <SideMenu />
        <main className="min-w-0 flex-1 overflow-auto bg-muted/30 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
