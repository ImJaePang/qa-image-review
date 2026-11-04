import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, type PermissionTable } from '@/api'
import { fmtDateTime } from '@/lib/domain'
import { diffGrants, summarizeChanges, type Grants } from '@/lib/permissions'
import { useAuth, useCan } from '@/stores/auth'

const toSets = (granted: PermissionTable['granted']): Grants => Object.fromEntries(Object.entries(granted).map(([r, c]) => [r, new Set(c)]))

/** 권한별 메뉴 관리: 권한(열) × 메뉴·기능(행) 체크 표. 저장하면 서버의 권한 검사에도 똑같이 적용된다. */
export function MenusPage() {
  const allowed = useCan('menu.manage')
  const qc = useQueryClient()
  const { data: table, isLoading, isError, error } = useQuery({ queryKey: ['permissions'], queryFn: api.getPermissions, enabled: allowed })
  const { data: history = [] } = useQuery({ queryKey: ['permissions', 'history'], queryFn: api.permissionHistory, enabled: allowed })
  const [draft, setDraft] = useState<Grants>({})
  useEffect(() => {
    if (table) setDraft(toSets(table.granted))
  }, [table])

  const original = useMemo(() => (table ? toSets(table.granted) : {}), [table])
  const labels = useMemo(() => {
    const m: Record<string, string> = {}
    for (const x of table?.menus ?? []) m[x.permission] = x.label
    for (const f of table?.functions ?? []) m[f.code] = f.label
    return m
  }, [table])
  const roleLabels = useMemo(() => Object.fromEntries((table?.roles ?? []).map((r) => [r.code, r.label])), [table])
  const changes = table ? diffGrants(original, draft) : []

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
        <TableHead>{first}</TableHead>
        {table.roles.map((r) => (
          <TableHead key={r.code} className="w-28 text-center">
            {r.label}
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

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">
          메뉴 접근 <span className="font-normal text-muted-foreground">체크하면 그 권한의 사용자에게 메뉴가 보이고 해당 기능을 쓸 수 있습니다</span>
        </h2>
        <div className="rounded-lg border bg-card">
          <Table>
            {head('메뉴')}
            <TableBody>
              {groups.map((g) => (
                <GroupRows key={g.top} title={g.top} cols={table.roles.length + 1}>
                  {g.items.map((m) => (
                    <TableRow key={m.path}>
                      <TableCell className="pl-6">
                        {m.label} <span className="ml-1 text-xs text-muted-foreground">{m.groupLabel}</span>
                      </TableCell>
                      {table.roles.map((r) => cell(r.code, m.permission))}
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
        <div className="rounded-lg border bg-card">
          <Table>
            {head('기능')}
            <TableBody>
              {table.functions.map((f) => (
                <TableRow key={f.code}>
                  <TableCell>
                    {f.label}
                    {f.description && <p className="text-xs text-muted-foreground">{f.description}</p>}
                  </TableCell>
                  {table.roles.map((r) => cell(r.code, f.code))}
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
        관리자의 「사용자 관리」「권한별 메뉴」는 잠글 수 없습니다 (아무도 권한을 바꿀 수 없게 되는 것을 막기 위해). 권한(역할) 종류 추가는 이후 확장 과제입니다.
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
