import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pagination } from '@/components/common/Pagination'
import { ReviewMark, VerdictBadge } from '@/components/assignment/badges'
import { AssignmentDetailDialog } from '@/components/assignment/AssignmentDetailDialog'
import { api } from '@/api'
import { fmtDateTime } from '@/lib/domain'
import { DEFAULT_PAGE_SIZE } from '@/lib/paging'
import { cn } from '@/lib/utils'
import { useCan } from '@/stores/auth'

type StatusFilter = 'all' | '승인' | '반려'
type Scope = 'mine' | 'all'

export function HistoryPage() {
  const canManage = useCan('assignment.manage')
  const [params, setParams] = useSearchParams()
  const openId = params.get('id')
  const [scope, setScope] = useState<Scope>('mine')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)

  // 검색어는 입력이 멈춘 뒤에 서버로 보낸다
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  // 전체 보기는 배정 관리 권한이 있을 때만 (서버도 같은 기준으로 막는다)
  const effectiveScope: Scope = canManage ? scope : 'mine'
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['review-history', { scope: effectiveScope, status, q: debouncedQ, page, pageSize }],
    queryFn: () => api.listReviewHistory({ scope: effectiveScope, status: status === 'all' ? undefined : status, q: debouncedQ || undefined, page, pageSize }),
    placeholderData: keepPreviousData,
  })
  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const counts = data?.statusCounts
  const showReviewer = effectiveScope === 'all'
  const cols = showReviewer ? 7 : 6

  const chip = (value: StatusFilter, label: string, n?: number) => (
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
      {n !== undefined && <span className={cn('ml-1.5 rounded-full px-1.5 text-xs tabular-nums', status === value ? 'bg-primary-foreground/25' : 'bg-muted text-muted-foreground')}>{n}</span>}
    </button>
  )
  const scopeChip = (value: Scope, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => {
        setScope(value)
        setPage(1)
      }}
      className={cn('border-r px-3 py-1.5 text-sm last:border-r-0', effectiveScope === value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">점검 이력</h1>
        <p className="text-sm text-muted-foreground">
          {showReviewer ? '모든 담당자의 검수(승인/반려) 기록입니다.' : '내가 검수(승인/반려)한 기록입니다.'} 결정을 바꾸면 새 기록이 쌓이고 이전 기록은 ‘번복됨’으로 남습니다. 행을 누르면 그 배정을 엽니다.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
        <div className="flex overflow-hidden rounded-md border" role="group" aria-label="결과 필터">
          {chip('all', '전체', counts ? counts.승인 + counts.반려 : undefined)}
          {chip('승인', '승인', counts?.승인)}
          {chip('반려', '반려', counts?.반려)}
        </div>
        {canManage && (
          <div className="flex overflow-hidden rounded-md border" role="group" aria-label="범위">
            {scopeChip('mine', '내 기록')}
            {scopeChip('all', '전체')}
          </div>
        )}
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="파일명 · 배정 · 코멘트 검색"
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
              <TableHead className="w-40">일시</TableHead>
              <TableHead>이미지</TableHead>
              <TableHead>배정</TableHead>
              <TableHead>AI 판정</TableHead>
              <TableHead>결과</TableHead>
              <TableHead>코멘트</TableHead>
              {showReviewer && <TableHead>검수자</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={cols} className="h-24 text-center text-muted-foreground">
                  불러오는 중…
                </TableCell>
              </TableRow>
            )}
            {isError && (
              <TableRow>
                <TableCell colSpan={cols} className="h-24 text-center text-destructive">
                  {(error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={cols} className="h-24 text-center text-muted-foreground">
                  {status === 'all' && !debouncedQ ? '검수 기록이 없습니다.' : '조건에 맞는 기록이 없습니다.'}
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => setParams({ id: r.assignmentId })}>
                <TableCell className="text-sm tabular-nums text-muted-foreground">{fmtDateTime(r.decidedAt)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <img src={r.thumbUrl} alt="" loading="lazy" className="aspect-video w-14 rounded border bg-muted object-cover" />
                    <span className="max-w-48 truncate text-sm font-medium">{r.fileName}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs text-muted-foreground">{r.assignmentId}</span>
                  <span className="ml-2 text-sm">{r.assignmentTitle}</span>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    <VerdictBadge verdict={r.verdict} />
                    <span className="text-xs tabular-nums text-muted-foreground">{r.overallScore.toFixed(2)}</span>
                  </span>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    <ReviewMark status={r.status} />
                    {!r.isCurrent && <Badge variant="outline">번복됨</Badge>}
                  </span>
                </TableCell>
                <TableCell className="max-w-64 truncate text-sm text-muted-foreground">{r.comment || '-'}</TableCell>
                {showReviewer && <TableCell className="text-sm">{r.reviewerName}</TableCell>}
              </TableRow>
            ))}
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

      <AssignmentDetailDialog id={openId} onClose={() => setParams({})} />
    </div>
  )
}
