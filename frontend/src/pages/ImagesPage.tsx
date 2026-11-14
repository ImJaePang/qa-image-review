import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pagination } from '@/components/common/Pagination'
import { StatusBadge, VerdictBadge } from '@/components/assignment/badges'
import { ImageLightbox } from '@/components/assignment/ImageLightbox'
import { api } from '@/api'
import { fmtDate } from '@/lib/domain'
import { DEFAULT_PAGE_SIZE } from '@/lib/paging'
import type { Overlay } from '@/lib/overlay'
import type { Verdict } from '@/lib/types'
import { cn } from '@/lib/utils'

type Assigned = 'all' | 'unassigned' | 'assigned'
type Sort = 'newest' | 'score_asc' | 'score_desc'
const VERDICTS: Verdict[] = ['정상', '의심', '불량']
const ASSIGNED_LABEL: Record<Assigned, string> = { all: '배정 전체', unassigned: '미배정', assigned: '배정됨' }
const SORT_LABEL: Record<Sort, string> = { newest: '최신순', score_asc: '점수 낮은 순', score_desc: '점수 높은 순' }

export function ImagesPage() {
  const [verdict, setVerdict] = useState<Verdict | 'all'>('all')
  const [assigned, setAssigned] = useState<Assigned>('all')
  const [sort, setSort] = useState<Sort>('newest')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)

  // 검색어는 입력이 멈춘 뒤에 서버로 보낸다
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['image-catalog', { verdict, assigned, sort, q: debouncedQ, page, pageSize }],
    queryFn: () => api.listImageCatalog({ verdict: verdict === 'all' ? undefined : verdict, assigned, sort, q: debouncedQ || undefined, page, pageSize }),
    placeholderData: keepPreviousData,
  })
  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const counts = data?.verdictCounts

  // 크게 보기: 이 쪽의 이미지를 이전/다음으로 넘겨 본다 (보기 전용)
  const [view, setView] = useState<number | null>(null)
  const [overlay, setOverlay] = useState<Overlay>('both')
  const [hot, setHot] = useState<number | null>(null)
  const viewKey = view !== null ? rows[view]?.imageKey : undefined
  const detail = useQuery({ queryKey: ['image-detail', viewKey], queryFn: () => api.getImageDetail(viewKey!), enabled: !!viewKey, placeholderData: keepPreviousData })

  const reset = () => {
    setPage(1)
    setView(null)
  }
  const chip = (value: Verdict | 'all', label: string, n?: number) => (
    <button
      key={value}
      type="button"
      onClick={() => {
        setVerdict(value)
        reset()
      }}
      className={cn('border-r px-3 py-1.5 text-sm last:border-r-0', verdict === value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
    >
      {label}
      {n !== undefined && <span className={cn('ml-1.5 rounded-full px-1.5 text-xs tabular-nums', verdict === value ? 'bg-primary-foreground/25' : 'bg-muted text-muted-foreground')}>{n}</span>}
    </button>
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">이미지 목록</h1>
        <p className="text-sm text-muted-foreground">수신·판정이 끝난 이미지를 판정과 배정 여부로 찾아봅니다. 행을 누르면 크게 보고, 이전/다음으로 넘겨 볼 수 있습니다.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
        <div className="flex overflow-hidden rounded-md border" role="group" aria-label="AI 판정">
          {chip('all', '전체', counts ? VERDICTS.reduce((n, v) => n + counts[v], 0) : undefined)}
          {VERDICTS.map((v) => chip(v, v, counts?.[v]))}
        </div>
        <Select
          items={(Object.keys(ASSIGNED_LABEL) as Assigned[]).map((v) => ({ value: v, label: ASSIGNED_LABEL[v] }))}
          value={assigned}
          onValueChange={(v) => {
            setAssigned((v ?? 'all') as Assigned)
            reset()
          }}
        >
          <SelectTrigger className="w-32" aria-label="배정 여부">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ASSIGNED_LABEL) as Assigned[]).map((v) => (
              <SelectItem key={v} value={v}>
                {ASSIGNED_LABEL[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={(Object.keys(SORT_LABEL) as Sort[]).map((v) => ({ value: v, label: SORT_LABEL[v] }))}
          value={sort}
          onValueChange={(v) => {
            setSort((v ?? 'newest') as Sort)
            reset()
          }}
        >
          <SelectTrigger className="w-36" aria-label="정렬">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABEL) as Sort[]).map((v) => (
              <SelectItem key={v} value={v}>
                {SORT_LABEL[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="파일명 · 이미지 번호 검색"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              reset()
            }}
          />
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이미지</TableHead>
              <TableHead>AI 판정</TableHead>
              <TableHead className="text-right">크기</TableHead>
              <TableHead>배정</TableHead>
              <TableHead>수신일</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  불러오는 중…
                </TableCell>
              </TableRow>
            )}
            {isError && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-destructive">
                  {(error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  {verdict === 'all' && assigned === 'all' && !debouncedQ ? '보여 줄 이미지가 없습니다.' : '조건에 맞는 이미지가 없습니다.'}
                </TableCell>
              </TableRow>
            )}
            {rows.map((r, i) => (
              <TableRow key={r.imageKey} className="cursor-pointer" onClick={() => setView(i)}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <img src={r.thumbUrl} alt="" loading="lazy" className="aspect-video w-20 rounded border bg-muted object-cover" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.fileName}</p>
                      <p className="font-mono text-xs text-muted-foreground">{r.imageKey}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    <VerdictBadge verdict={r.verdict} />
                    <span className="text-xs tabular-nums text-muted-foreground">{r.overallScore.toFixed(2)}</span>
                  </span>
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                  {r.width}×{r.height}
                </TableCell>
                <TableCell>
                  {r.assignmentId && r.assignmentStatus ? (
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs">{r.assignmentId}</span>
                      <StatusBadge status={r.assignmentStatus} />
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">미배정</span>
                  )}
                </TableCell>
                <TableCell className="text-sm tabular-nums text-muted-foreground">{fmtDate(r.receivedAt)}</TableCell>
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
          setView(null)
        }}
        onPageSize={(n) => {
          setPageSize(n)
          reset()
        }}
      />

      {detail.data && view !== null && (
        <ImageLightbox
          open
          browse
          onClose={() => {
            setView(null)
            setHot(null)
          }}
          img={detail.data}
          overlay={overlay}
          setOverlay={setOverlay}
          opacity={60}
          hot={hot}
          onHot={setHot}
          index={view}
          total={rows.length}
          onPrev={() => setView((v) => (v === null ? v : Math.max(v - 1, 0)))}
          onNext={() => setView((v) => (v === null ? v : Math.min(v + 1, rows.length - 1)))}
          canReview={false}
          onDecide={() => undefined}
        />
      )}
    </div>
  )
}
