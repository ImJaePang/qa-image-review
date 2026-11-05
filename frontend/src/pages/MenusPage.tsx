import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api, type PermissionTable } from '@/api'
import { fmtDateTime } from '@/lib/domain'
import { diffGrants, summarizeChanges, visibleRoles, type Grants } from '@/lib/permissions'
import { useAuth, useCan } from '@/stores/auth'

const toSets = (granted: PermissionTable['granted']): Grants => Object.fromEntries(Object.entries(granted).map(([r, c]) => [r, new Set(c)]))

/** 권한별 메뉴 관리: 권한(열) × 메뉴·기능(행) 체크 표. 저장하면 서버의 권한 검사에도 똑같이 적용된다. */
export function MenusPage() {
  const allowed = useCan('menu.manage')
  const qc = useQueryClient()
  const { data: table, isLoading, isError, error } = useQuery({ queryKey: ['permissions'], queryFn: api.getPermissions, enabled: allowed })
  const { data: history = [] } = useQuery({ queryKey: ['permissions', 'history'], queryFn: api.permissionHistory, enabled: allowed })
  const [draft, setDraft] = useState<Grants>({})
  const [picked, setPicked] = useState<Set<string>>(new Set()) // 열 필터: 아무것도 안 고르면 전체 권한
  // 서버에서 표를 새로 받을 때마다 편집본을 서버 값으로 다시 채운다 (렌더 중에 한 번만 맞춘다)
  const [syncedTable, setSyncedTable] = useState(table)
  if (table && table !== syncedTable) {
    setSyncedTable(table)
    setDraft(toSets(table.granted))
  }

  const original = useMemo(() => (table ? toSets(table.granted) : {}), [table])
  const labels = useMemo(() => {
    const m: Record<string, string> = {}
    for (const x of table?.menus ?? []) m[x.permission] = x.label
    for (const f of table?.functions ?? []) m[f.code] = f.label
    return m
  }, [table])
  const roleLabels = useMemo(() => Object.fromEntries((table?.roles ?? []).map((r) => [r.code, r.label])), [table])
  const changes = table ? diffGrants(original, draft) : []
  const shown = visibleRoles(table?.roles ?? [], picked) // 필터는 보이는 열만 바꾼다 (숨겨진 열의 변경도 저장 대상에 남는다)

  const save = useMutation({
    mutationFn: async () => {
      // 바뀐 권한만 저장한다 (권한 하나의 코드 전체를 교체)
      const roles = [...new Set(changes.map((c) => c.role))]
      for (const role of roles) await api.saveRolePermissions(role, [...(draft[role] ?? [])])
    },
    onSuccess: () => {
      toast.success('저장했습니다. 로그인 중인 사용자에게도 바로 적용됩니다.')
      qc.invalidateQueries({ queryKey: ['permissions'] })
      qc.invalidateQueries({ queryKey: ['menus'] })
      useAuth.getState().init() // 내 권한이 바뀌었을 수 있다
    },
    onError: (e: Error) => {
      toast.error(e.message)
      qc.invalidateQueries({ queryKey: ['permissions'] })
    },
  })

  if (!allowed) return <p className="p-6 text-sm text-muted-foreground">이 화면을 쓸 권한이 없습니다.</p>
  if (isLoading) return <p className="text-sm text-muted-foreground">불러오는 중…</p>
  if (isError || !table) return <p className="text-sm text-destructive">{(error as Error)?.message ?? '불러오지 못했습니다.'}</p>

  const toggle = (role: string, code: string) =>
    setDraft((d) => {
      const s = new Set(d[role])
      if (!s.delete(code)) s.add(code)
      return { ...d, [role]: s }
    })

  const cell = (role: string, code: string) => {
    const locked = table.locked[role]?.includes(code)
    return (
      <TableCell key={role} className="text-center">
        <span className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={!!draft[role]?.has(code)}
            disabled={locked}
            onChange={() => toggle(role, code)}
            aria-label={`${roleLabels[role]}: ${labels[code]}`}
          />
          {locked && <Lock className="size-3 text-muted-foreground" aria-label="잠금" />}
        </span>
      </TableCell>
    )
  }
  const head = (first: string) => (
    <TableHeader>
      <TableRow>
        <TableHead className="sticky left-0 z-10 min-w-64 bg-card">{first}</TableHead>
        {shown.map((r) => (
          <TableHead key={r.code} className="w-28 min-w-28 text-center">
            {r.description ? (
              <Tooltip>
                <TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-4">{r.label}</TooltipTrigger>
                <TooltipContent light side="bottom">
                  <div>
                    <b>{r.label}</b>
                    <p className="mt-0.5 whitespace-pre-line">{r.description}</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            ) : (
              r.label
            )}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  )

  // 메뉴를 상단 메뉴별로 묶어 그린다
  const groups: { top: string; items: PermissionTable['menus'] }[] = []
  for (const m of table.menus) {
    const g = groups.find((x) => x.top === m.topLabel)
    if (g) g.items.push(m)
    else groups.push({ top: m.topLabel, items: [m] })
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">권한별 메뉴 관리</h1>
        <p className="text-sm text-muted-foreground">권한마다 쓸 수 있는 메뉴와 기능을 정합니다. 여기서 정한 내용은 화면 메뉴뿐 아니라 서버(API) 검사에도 똑같이 적용됩니다.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-sm">
        <span className="text-muted-foreground">표시할 권한</span>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            {picked.size === 0 ? `전체 (${table.roles.length})` : `${picked.size}개 선택`}
            <ChevronDown className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            {table.roles.map((r) => (
              <DropdownMenuCheckboxItem
                key={r.code}
                checked={picked.has(r.code)}
                closeOnClick={false}
                onCheckedChange={(v) =>
                  setPicked((s) => {
                    const n = new Set(s)
                    if (v) n.add(r.code)
                    else n.delete(r.code)
                    return n
                  })
                }
              >
                {r.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {picked.size > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
            전체 보기
          </Button>
        )}
        <span className="text-xs text-muted-foreground">권한이 많을 때 필요한 열만 골라 봅니다. 숨긴 열의 변경 내용도 저장에 포함됩니다.</span>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">
          메뉴 접근 <span className="font-normal text-muted-foreground">체크하면 그 권한의 사용자에게 메뉴가 보이고 해당 기능을 쓸 수 있습니다</span>
        </h2>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table className="min-w-max">
            {head('메뉴')}
            <TableBody>
              {groups.map((g) => (
                <GroupRows key={g.top} title={g.top} cols={shown.length + 1}>
                  {g.items.map((m) => (
                    <TableRow key={m.path}>
                      <TableCell className="sticky left-0 z-10 min-w-64 bg-card pl-6">
                        {m.label} <span className="ml-1 text-xs text-muted-foreground">{m.groupLabel}</span>
                      </TableCell>
                      {shown.map((r) => cell(r.code, m.permission))}
                    </TableRow>
                  ))}
                </GroupRows>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">
          기능 권한 <span className="font-normal text-muted-foreground">메뉴와 별개로 허용할 동작</span>
        </h2>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table className="min-w-max">
            {head('기능')}
            <TableBody>
              {table.functions.map((f) => (
                <TableRow key={f.code}>
                  <TableCell className="sticky left-0 z-10 min-w-64 bg-card">
                    {f.label}
                    {f.description && <p className="text-xs text-muted-foreground">{f.description}</p>}
                  </TableCell>
                  {shown.map((r) => cell(r.code, f.code))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <div className="sticky bottom-0 flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5 shadow-sm">
        <span className={changes.length ? 'rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200' : 'text-sm text-muted-foreground'}>
          {changes.length ? `변경 ${changes.length}건` : '변경 없음'}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{summarizeChanges(changes, roleLabels, labels, 3)}</span>
        <Button variant="outline" disabled={!changes.length || save.isPending} onClick={() => setDraft(toSets(table.granted))}>
          되돌리기
        </Button>
        <Button disabled={!changes.length || save.isPending} onClick={() => save.mutate()}>
          저장
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        <Lock className="mr-1 inline size-3" />
        관리자의 「사용자 관리」「권한 관리」「권한별 메뉴」는 뺄 수 없습니다 (아무도 설정을 바꿀 수 없게 되는 것을 막기 위해). 권한 종류는 「권한 관리」에서 추가·수정합니다.
      </p>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">변경 이력</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">이력이 없습니다.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {history.slice(0, 15).map((h) => (
              <li key={h.id} className="flex gap-3">
                <span className="w-36 shrink-0 tabular-nums text-muted-foreground">{fmtDateTime(h.at)}</span>
                <span className="w-20 shrink-0 text-muted-foreground">{h.actor}</span>
                <span>
                  {h.roleLabel}: {h.permissionLabel} {h.action === 'GRANT' ? '허용' : '해제'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function GroupRows({ title, cols, children }: { title: string; cols: number; children: React.ReactNode }) {
  return (
    <>
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <TableCell colSpan={cols} className="text-xs font-semibold text-primary">
          {title}
        </TableCell>
      </TableRow>
      {children}
    </>
  )
}
