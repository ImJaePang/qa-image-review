import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pagination } from '@/components/common/Pagination'
import { UserEditDialog } from '@/components/user/UserEditDialog'
import { api, type AdminUser } from '@/api'
import { fmtDate, fmtDateTime } from '@/lib/domain'
import { DEFAULT_PAGE_SIZE } from '@/lib/paging'
import { useRoles } from '@/hooks/useRoles'
import type { Role } from '@/lib/types'
import {
  BULK_CHUNK,
  BULK_LABEL,
  USER_STATUSES,
  USER_STATUS_LABEL,
  bulkActionsFor,
  chunk,
  mergeBulkResults,
  summarizeBulk,
  type BulkAction,
  type UserStatus,
} from '@/lib/users'
import { cn } from '@/lib/utils'
import { useCan } from '@/stores/auth'

type StatusFilter = UserStatus | 'ALL'
const ALL = 'ALL'

const statusTone = (s: UserStatus) => (s === 'ACTIVE' ? 'default' : 'secondary')
const dash = (v: string | null | undefined, f: (s: string) => string = (s) => s) => (v ? f(v) : '-')

/** 상태 필터에 따라 보여 줄 열 (승인 대기 → 신청 정보, 만료 → 만료일·해제 요청 …) */
function extraColumns(status: StatusFilter, roleLabel: (c: string | null) => string): { head: string; cell: (u: AdminUser) => React.ReactNode }[] {
  const role = { head: '권한', cell: (u: AdminUser) => roleLabel(u.role) }
  const expires = { head: status === 'EXPIRED' ? '만료일' : '사용기한', cell: (u: AdminUser) => dash(u.expiresAt, fmtDate) }
  const lastLogin = { head: '마지막 로그인', cell: (u: AdminUser) => dash(u.lastLoginAt, fmtDateTime) }
  switch (status) {
    case 'PENDING':
      return [
        { head: '신청 권한', cell: (u) => roleLabel(u.requestedRole) },
        { head: '신청일', cell: (u) => fmtDateTime(u.createdAt) },
      ]
    case 'EXPIRED':
      return [role, expires, lastLogin, { head: '해제 요청', cell: (u) => (u.expiryReleaseRequestedAt ? <Badge variant="outline">요청 {fmtDateTime(u.expiryReleaseRequestedAt)}</Badge> : '-') }]
    case 'ACTIVE':
      return [role, expires, lastLogin]
    case 'DISABLED':
      return [role, lastLogin]
    default:
      return [role, { head: '상태', cell: (u) => <Badge variant={statusTone(u.status)}>{USER_STATUS_LABEL[u.status]}</Badge> }, expires]
  }
}

export function UsersPage() {
  const qc = useQueryClient()
  const { roles, activeRoles, roleLabel } = useRoles()
  const roleOptions = [{ value: ALL, label: '전체 권한' }, ...roles.map((r) => ({ value: r.code, label: r.label }))]
  const assignable = activeRoles.map((r) => ({ value: r.code, label: r.label })) // 승인할 때 지정할 수 있는 권한
  const isAdmin = useCan('user.manage')
  const [status, setStatus] = useState<StatusFilter>(ALL)
  const [role, setRole] = useState<string>(ALL)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editId, setEditId] = useState<string | null>(null)
  const [allMatching, setAllMatching] = useState(false) // '조건에 맞는 전체'를 골랐는지

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])
  // 조건·페이지가 바뀌면 선택을 비운다 (보이지 않는 사용자를 처리하는 실수 방지)
  const resetSelection = () => {
    setSelected(new Set())
    setAllMatching(false)
  }

  const query = { status: status === ALL ? undefined : status, role: role === ALL ? undefined : (role as Role), q: debouncedQ || undefined }
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin-users', 'list', { ...query, page, pageSize }],
    queryFn: () => api.listAdminUsers({ ...query, page, pageSize }),
    placeholderData: keepPreviousData,
    enabled: isAdmin,
  })
  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const counts = data?.statusCounts
  const allCount = counts ? USER_STATUSES.reduce((n, s) => n + counts[s], 0) : 0
  const actions = bulkActionsFor(status)
  const cols = extraColumns(status, roleLabel)

  const pageAllSelected = rows.length > 0 && rows.every((u) => selected.has(u.id))
  const togglePage = () => {
    setAllMatching(false)
    setSelected(pageAllSelected ? new Set() : new Set(rows.map((u) => u.id)))
  }
  const toggleOne = (id: string) => {
    setAllMatching(false)
    setSelected((s) => {
      const n = new Set(s)
      if (!n.delete(id)) n.add(id)
      return n
    })
  }

  // 조건에 맞는 전체: 1000건씩 id만 모은다
  const selectAllMatching = useMutation({
    mutationFn: async () => {
      const ids: string[] = []
      for (let p = 1; ids.length < total; p++) {
        const r = await api.listAdminUsers({ ...query, page: p, pageSize: 1000 })
        ids.push(...r.items.map((u) => u.id))
        if (!r.items.length) break
      }
      return ids
    },
    onSuccess: (ids) => {
      setSelected(new Set(ids))
      setAllMatching(true)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const run = useMutation({
    mutationFn: async ({ action, withRole }: { action: BulkAction; withRole?: Role }) => {
      // 서버는 한 번에 100명까지: 넘으면 100명씩 끊어 차례로 호출하고 결과를 합친다
      const results = []
      for (const ids of chunk([...selected], BULK_CHUNK)) results.push(await api.bulkUsers(action, ids, withRole))
      return { action, result: mergeBulkResults(results) }
    },
    onSuccess: ({ action, result }) => {
      const msg = summarizeBulk(action, result)
      if (result.skipped.length) {
        const first = result.skipped.slice(0, 3).map((s) => `${s.name ?? s.id}: ${s.reason}`).join('\n')
        toast.warning(`${msg}\n${first}${result.skipped.length > 3 ? `\n외 ${result.skipped.length - 3}명` : ''}`)
      } else toast.success(msg)
      resetSelection()
      qc.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (e: Error) => {
      toast.error(e.message)
      qc.invalidateQueries({ queryKey: ['admin-users'] })
    },
  })

  const start = (action: BulkAction, withRole?: Role) => {
    const n = selected.size
    const what = withRole ? `${n}명을 ${roleLabel(withRole)} 권한으로 ${BULK_LABEL[action]}` : `${n}명 ${BULK_LABEL[action]}`
    if (['REJECT', 'DISABLE'].includes(action) || n > BULK_CHUNK || withRole) if (!confirm(`${what}할까요?`)) return
    run.mutate({ action, withRole })
  }

  if (!isAdmin) return <p className="text-sm text-muted-foreground">이 화면을 쓸 권한이 없습니다.</p>

  const chip = (value: StatusFilter, label: string, n?: number) => (
    <button
      key={value}
      type="button"
      onClick={() => {
        setStatus(value)
        setPage(1)
        resetSelection()
      }}
      className={cn('border-r px-3 py-1.5 text-sm last:border-r-0', status === value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
    >
      {label}
      {n !== undefined && <span className={cn('ml-1.5 rounded-full px-1.5 text-xs', status === value ? 'bg-primary-foreground/25' : 'bg-muted text-muted-foreground')}>{n}</span>}
    </button>
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">사용자 관리</h1>
        <p className="text-sm text-muted-foreground">가입 승인, 만료 해제, 권한·사용기한 변경을 한 화면에서 처리합니다.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
        <div className="flex overflow-hidden rounded-lg border" role="radiogroup" aria-label="상태">
          {chip(ALL, '전체', allCount)}
          {USER_STATUSES.map((s) => chip(s, USER_STATUS_LABEL[s], counts?.[s]))}
        </div>
        <Select
          items={roleOptions}
          value={role}
          onValueChange={(v) => {
            setRole(v ?? ALL)
            setPage(1)
            resetSelection()
          }}
        >
          <SelectTrigger className="w-36" aria-label="권한 필터">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roleOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="이름 · 이메일 · 업체 · 부서"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
              resetSelection()
            }}
          />
        </div>
      </div>

      {selected.size > 0 && actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-accent px-3 py-2 text-sm">
          <b>{selected.size}명 선택</b>
          {allMatching && <span className="text-muted-foreground">(조건에 맞는 전체)</span>}
          <span className="text-muted-foreground">|</span>
          {actions.map((a) =>
            a === 'APPROVE' ? (
              <span key={a} className="flex items-center gap-2">
                <Button size="sm" disabled={run.isPending} onClick={() => start('APPROVE')}>
                  신청 권한대로 일괄 승인
                </Button>
                <Select
                  items={[{ value: '', label: '권한 지정 승인' }, ...assignable]}
                  value=""
                  onValueChange={(v) => v && start('APPROVE', v as Role)}
                  disabled={run.isPending}
                >
                  <SelectTrigger size="sm" className="w-36" aria-label="권한 지정 승인">
                    <SelectValue placeholder="권한 지정 승인" />
                  </SelectTrigger>
                  <SelectContent>
                    {assignable.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}로 승인
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </span>
            ) : (
              <Button
                key={a}
                size="sm"
                variant={a === 'REJECT' || a === 'DISABLE' ? 'destructive' : 'default'}
                disabled={run.isPending}
                onClick={() => start(a)}
              >
                {`일괄 ${BULK_LABEL[a]}`}
              </Button>
            ),
          )}
          {a11yHint(status)}
        </div>
      )}
      {actions.length > 0 && pageAllSelected && !allMatching && total > rows.length && (
        <p className="text-sm text-muted-foreground">
          이 페이지 {rows.length}명이 선택되었습니다.{' '}
          <button type="button" className="font-medium text-primary hover:underline" disabled={selectAllMatching.isPending} onClick={() => selectAllMatching.mutate()}>
            조건에 맞는 전체 {total}명 선택
          </button>
        </p>
      )}

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                {actions.length > 0 && <input type="checkbox" className="size-4 accent-primary" checked={pageAllSelected} onChange={togglePage} aria-label="현재 페이지 전체 선택" />}
              </TableHead>
              <TableHead>이름</TableHead>
              <TableHead>업체 / 부서</TableHead>
              <TableHead>이메일</TableHead>
              {cols.map((c) => (
                <TableHead key={c.head}>{c.head}</TableHead>
              ))}
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5 + cols.length} className="py-10 text-center text-muted-foreground">
                  불러오는 중…
                </TableCell>
              </TableRow>
            )}
            {isError && (
              <TableRow>
                <TableCell colSpan={5 + cols.length} className="py-10 text-center text-destructive">
                  {(error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5 + cols.length} className="py-10 text-center text-muted-foreground">
                  조건에 맞는 사용자가 없습니다.
                </TableCell>
              </TableRow>
            )}
            {rows.map((u) => (
              <TableRow key={u.id} data-state={selected.has(u.id) ? 'selected' : undefined}>
                <TableCell>
                  {actions.length > 0 && <input type="checkbox" className="size-4 accent-primary" checked={selected.has(u.id)} onChange={() => toggleOne(u.id)} aria-label={`${u.name} 선택`} />}
                </TableCell>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{[u.profile.company, u.profile.department].filter(Boolean).join(' / ') || '-'}</TableCell>
                <TableCell className="text-sm">{u.email}</TableCell>
                {cols.map((c) => (
                  <TableCell key={c.head} className="text-sm">
                    {c.cell(u)}
                  </TableCell>
                ))}
                <TableCell>
                  <Button variant="outline" size="sm" onClick={() => setEditId(u.id)}>
                    수정
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Pagination
        total={total}
        page={page}
        pageSize={pageSize}
        onPage={(p) => {
          setPage(p)
          resetSelection()
        }}
        onPageSize={(n) => {
          setPageSize(n)
          setPage(1)
          resetSelection()
        }}
      />

      <UserEditDialog userId={editId} onClose={() => setEditId(null)} />
    </div>
  )
}

function a11yHint(status: StatusFilter) {
  if (status === 'PENDING') return <span className="ml-auto text-xs text-muted-foreground">승인하면 사용기한은 오늘 + 1년으로 설정됩니다</span>
  if (status === 'EXPIRED') return <span className="ml-auto text-xs text-muted-foreground">해제하면 사용기한이 오늘 + 1년으로 설정됩니다</span>
  return null
}
