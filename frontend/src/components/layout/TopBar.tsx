import { Link, useLocation, useNavigate } from 'react-router-dom'
import { LogOut, Moon, ScanSearch, Sun } from 'lucide-react'
import { useRoles } from '@/hooks/useRoles'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { topKeyOfPath, type TopMenu } from '@/config/menu'
import { useAuth, useCurrentUser } from '@/stores/auth'
import { useTheme } from '@/stores/theme'
import { cn } from '@/lib/utils'

export function Logo() {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <ScanSearch className="size-5" />
      </span>
      <span className="text-lg">ImageQA</span>
    </span>
  )
}

export function TopBar({ menus }: { menus: TopMenu[] }) {
  const { roleLabel } = useRoles()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const user = useCurrentUser()
  const logout = useAuth((s) => s.logout)
  const { theme, toggle } = useTheme()
  const active = topKeyOfPath(menus, pathname)

  return (
    <header className="flex h-14 shrink-0 items-center gap-6 border-b bg-background px-4">
      <Link to={menus[0]?.groups[0]?.items[0]?.path ?? '/login'}>
        <Logo />
      </Link>

      <nav className="flex h-full items-stretch gap-1">
        {menus.map((m) => (
          <Link
            key={m.key}
            to={m.groups[0].items[0].path}
            className={cn(
              'flex items-center border-b-2 px-3 text-sm font-medium transition-colors',
              active === m.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {m.label}
          </Link>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {user && (
          <div className="mr-2 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{user.name}</span>
            <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>{roleLabel(user.role)}</Badge>
          </div>
        )}
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="테마 전환">
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await logout()
            navigate('/login')
          }}
        >
          <LogOut className="size-4" /> 로그아웃
        </Button>
      </div>
    </header>
  )
}
