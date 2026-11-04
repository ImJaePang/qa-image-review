import { NavLink, useLocation } from 'react-router-dom'
import { topKeyOfPath, type TopMenu } from '@/config/menu'
import { cn } from '@/lib/utils'

export function SideMenu({ menus }: { menus: TopMenu[] }) {
  const { pathname } = useLocation()
  const top = menus.find((m) => m.key === topKeyOfPath(menus, pathname)) ?? menus[0]
  if (!top) return <aside className="w-56 shrink-0 border-r bg-sidebar" />

  return (
    <aside className="w-56 shrink-0 overflow-auto border-r bg-sidebar p-3 text-sidebar-foreground">
      <p className="px-2 pb-3 pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{top.label}</p>
      <div className="space-y-5">
        {top.groups.map((g) => (
          <div key={g.label}>
            <p className="px-2 pb-1 text-sm font-semibold">{g.label}</p>
            <ul className="space-y-0.5">
              {g.items.map((it) => (
                <li key={it.path}>
                  <NavLink
                    to={it.path}
                    className={({ isActive }) =>
                      cn(
                        'block rounded-md px-3 py-1.5 text-sm transition-colors',
                        isActive
                          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                          : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
                      )
                    }
                  >
                    {it.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  )
}
