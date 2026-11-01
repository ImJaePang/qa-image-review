import { useLocation } from 'react-router-dom'
import { Construction } from 'lucide-react'
import { MENU } from '@/config/menu'

export function Placeholder() {
  const { pathname } = useLocation()
  const label = MENU.flatMap((m) => m.groups.flatMap((g) => g.items)).find((i) => i.path === pathname)?.label ?? '화면'
  return (
    <div className="flex h-full min-h-80 flex-col items-center justify-center gap-3 text-muted-foreground">
      <Construction className="size-10" />
      <p className="text-lg font-medium text-foreground">{label}</p>
      <p className="text-sm">아직 만들지 않은 화면입니다. (메뉴 구조 확인용)</p>
    </div>
  )
}
