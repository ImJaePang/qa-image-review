import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pagination } from '@/components/common/Pagination'
import { RoleEditDialog, type RoleDialogTarget } from '@/components/role/RoleEditDialog'
import { api } from '@/api'
import { DEFAULT_PAGE_SIZE } from '@/lib/paging'
import { ROLE_STATUS_LABEL, type RoleStatusFilter } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useCan } from '@/stores/auth'

const COLS = 7

export function RolesPage() {
  const allowed = useCan('role.manage')
  const [status, setStatus] = useState<RoleStatusFilter>('ALL')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [dialog, setDialog] = useState<RoleDialogTarget | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const query = { status: status === 'ALL' ? undefined : status, q: debouncedQ || undefined }
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin-roles', 'list', { ...query, page, pageSize }],
    queryFn: () => api.listAdminRoles({ ...query, page, pageSize }),
    placeholderData: keepPreviousData,
    enabled: allowed,
  })
  const rows = data?.items ?? []
  const counts = data?.statusCounts

  if (!allowed) return <p className="text-sm text-muted-foreground">이 화면을 쓸 권한이 없습니다.</p>

  const chip = (value: RoleStatusFilter, label: string, n?: number) => (
    <button
      key={value}
      type="button"
      onClick={() => {
        setStatus(value)
        setPage(1)
      }}
      className={cn('border-r px-3 py-1.5 text-sm last:border-r-0', status === value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
    >
      {label}
      {n !== undefined && <span className={cn('ml-1.5 rounded-full px-1.5 text-xs', status === value ? 'bg-primary-foreground/25' : 'bg-muted text-muted-foreground')}>{n}</span>}
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">권한 관리</h1>
          <p className="text-sm text-muted-foreground">권한(역할) 종류를 만들고 이름·설명을 관리합니다. 무엇을 쓸 수 있는지는 「권한별 메뉴」에서 정합니다.</p>
        </div>
        <Button className="mt-0.5 shrink-0" onClick={() => setDialog({ mode: 'new' })}>
          <Plus className="size-4" />새 권한
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
        <div className="flex overflow-hidden rounded-lg border" role="radiogroup" aria-label="상태">
          {chip('ALL', '전체', counts ? counts.ACTIVE + counts.INACTIVE : undefined)}
          {chip('ACTIVE', ROLE_STATUS_LABEL.ACTIVE, counts?.ACTIVE)}
          {chip('INACTIVE', ROLE_STATUS_LABEL.INACTIVE, counts?.INACTIVE)}
        </div>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="이름 · 코드 · 설명 검색"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
          />
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead>코드</TableHead>
              <TableHead>설명</TableHead>
              <TableHead>사용자</TableHead>
              <TableHead>가입 선택</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={COLS} className="py-10 text-center text-muted-foreground">
                  불러오는 중…
                </TableCell>
              </TableRow>
            )}
            {isError && (
              <TableRow>
                <TableCell colSpan={COLS} className="py-10 text-center text-destructive">
                  {(error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLS} className="py-10 text-center text-muted-foreground">
                  조건에 맞는 권한이 없습니다.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.code} className={cn(!r.active && 'text-muted-foreground')}>
                <TableCell className="font-medium">
                  {r.label}
                  {r.system && (
                    <Badge variant="outline" className="ml-2">
                      시스템
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{r.code}</TableCell>
                <TableCell className="max-w-72 truncate text-sm text-muted-foreground" title={r.description ?? undefined}>
                  {r.description ?? '—'}
                </TableCell>
                <TableCell className="tabular-nums">{r.userCount}명</TableCell>
                <TableCell className="text-sm">{r.signupSelectable ? '가능' : '불가'}</TableCell>
                <TableCell>
                  <Badge variant={r.active ? 'default' : 'secondary'}>{r.active ? ROLE_STATUS_LABEL.ACTIVE : ROLE_STATUS_LABEL.INACTIVE}</Badge>
                </TableCell>
                <TableCell>
                  <Button variant="outline" size="sm" onClick={() => setDialog({ mode: 'edit', code: r.code })}>
                    수정
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Pagination
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={(n) => {
          setPageSize(n)
          setPage(1)
        }}
      />

      <RoleEditDialog target={dialog} onClose={() => setDialog(null)} />
    </div>
  )
}
