import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pagination } from '@/components/common/Pagination'
import { StatusBadge } from '@/components/assignment/badges'
import { NewAssignmentDialog } from '@/components/assignment/NewAssignmentDialog'
import { AssignmentDetailDialog } from '@/components/assignment/AssignmentDetailDialog'
import { api } from '@/api'
import { fmtDate } from '@/lib/domain'
import { DEFAULT_PAGE_SIZE } from '@/lib/paging'
import { ASSIGNMENT_STATUSES, type AssignmentStatus } from '@/lib/types'
import { useCurrentUser } from '@/stores/auth'

const ALL = 'all'

export function AssignmentListPage() {
  const me = useCurrentUser()
  const [params, setParams] = useSearchParams()
  const openId = params.get('id')
  const [newOpen, setNewOpen] = useState(false)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string>(ALL)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)

  // 검색어는 입력이 멈춘 뒤에 서버로 보낸다
  const [debouncedQ, setDebouncedQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['assignments', 'list', { status, q: debouncedQ, page, pageSize }],
    queryFn: () =>
      api.listAssignments({
        status: status === ALL ? undefined : (status as AssignmentStatus),
        q: debouncedQ || undefined,
        page,
        pageSize,
      }),
    placeholderData: keepPreviousData,
  })

  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const statusCount = (s: AssignmentStatus) => data?.statusCounts[s] ?? 0

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">배정 리스트</h1>
          <p className="text-sm text-muted-foreground">QA 담당자에게 배정된 검수 건을 확인하고 점검합니다.</p>
        </div>
        {me?.role === 'admin' && (
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="size-4" /> 신규 배정
          </Button>
        )}
      </div>

      {/* 상태별 요약 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ASSIGNMENT_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => {
              setStatus(status === s ? ALL : s)
              setPage(1)
            }}
            className={`rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary ${status === s ? 'border-primary ring-1 ring-primary' : ''}`}
          >
            <p className="text-xs text-muted-foreground">{s}</p>
            <p className="text-2xl font-semibold tabular-nums">{statusCount(s)}</p>
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="배정명 · 번호 · 담당자 검색"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <Select
          items={[{ value: ALL, label: '전체 상태' }, ...ASSIGNMENT_STATUSES.map((s) => ({ value: s, label: s }))]}
          value={status}
          onValueChange={(v) => {
            setStatus(v ?? ALL)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>전체 상태</SelectItem>
            {ASSIGNMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">번호</TableHead>
              <TableHead>배정명</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>담당자</TableHead>
              <TableHead className="text-right">이미지</TableHead>
              <TableHead>AI 판정 (정상/의심/불량)</TableHead>
              <TableHead>검수 진행</TableHead>
              <TableHead>마감일</TableHead>
              <TableHead>배정일</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                  불러오는 중…
                </TableCell>
              </TableRow>
            )}
            {isError && (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-destructive">
                  {(error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                  조건에 맞는 배정이 없습니다.
                </TableCell>
              </TableRow>
            )}
            {rows.map((a) => {
              const c = a.counts
              const done = c.reviewed
              const total = c.total
              return (
                <TableRow key={a.id} className="cursor-pointer" onClick={() => setParams({ id: a.id })}>
                  <TableCell className="font-mono text-xs">{a.id}</TableCell>
                  <TableCell className="font-medium">{a.title}</TableCell>
                  <TableCell>
                    <StatusBadge status={a.status} />
                  </TableCell>
                  <TableCell>{a.assigneeName}</TableCell>
                  <TableCell className="text-right tabular-nums">{total}</TableCell>
                  <TableCell className="text-xs tabular-nums">
                    <span className="text-emerald-600 dark:text-emerald-400">{c.normal}</span> /{' '}
                    <span className="text-amber-600 dark:text-amber-400">{c.suspect}</span> /{' '}
                    <span className="text-red-600 dark:text-red-400">{c.defect}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-primary" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {done}/{total}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{a.dueDate}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{fmtDate(a.createdAt)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <Pagination
        total={total}
        page={page}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={(n) => {
          setPageSize(n)
          setPage(1)
        }}
      />

      <NewAssignmentDialog open={newOpen} onOpenChange={setNewOpen} />
      <AssignmentDetailDialog id={openId} onClose={() => setParams({})} />
    </div>
  )
}
