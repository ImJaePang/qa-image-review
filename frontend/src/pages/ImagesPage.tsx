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
import { globalIndex, stepPaged } from '@/lib/pagedNav'
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

  const { data, isLoading, isError, error, isPlaceholderData } = useQuery({
    queryKey: ['image-catalog', { verdict, assigned, sort, q: debouncedQ, page, pageSize }],
    queryFn: () => api.listImageCatalog({ verdict: verdict === 'all' ? undefined : verdict, assigned, sort, q: debouncedQ || undefined, page, pageSize }),
    placeholderData: keepPreviousData,
  })
  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const counts = data?.verdictCounts

  // 크게 보기 (보기 전용): 이전/다음으로 넘기다 쪽의 끝에 닿으면 옆 쪽을 불러와 창을 연 채로 이어 본다.
  // 보고 있는 이미지는 위치가 아니라 이미지 번호(key)로 기억한다. 옆 쪽으로 넘어갈 때는 edge(새 쪽의 처음/끝)를 적어 두고,
  // 그 쪽이 도착하면 그 자리의 이미지가 된다. 도착 전에는 지금 이미지와 위치(pos)를 그대로 보여 준다.
  const [view, setView] = useState<{ key: string; edge: 'first' | 'last' | null; pos: number } | null>(null)
  const [overlay, setOverlay] = useState<Overlay>('both')
  const [hot, setHot] = useState<number | null>(null)
  const fresh = !!data && !isPlaceholderData
  const edgeRow = view?.edge && fresh ? (view.edge === 'first' ? rows[0] : rows[rows.length - 1]) : undefined
  const viewKey = edgeRow?.imageKey ?? view?.key
  const waiting = !!view?.edge && !fresh
  const viewIdx = viewKey && !waiting ? rows.findIndex((r) => r.imageKey === viewKey) : -1
  const viewPos = data && viewIdx >= 0 ? globalIndex({ page: data.page, idx: viewIdx }, data.pageSize) : (view?.pos ?? 0)
  const detail = useQuery({ queryKey: ['image-detail', viewKey], queryFn: () => api.getImageDetail(viewKey!), enabled: !!viewKey, placeholderData: keepPreviousData })

  const openView = (key: string) => setView({ key, edge: null, pos: 0 })
  const step = (dir: 1 | -1) => {
    if (!view || !data || viewIdx < 0) return
    const next = stepPaged({ page: data.page, idx: viewIdx }, dir, rows.length, total, data.pageSize)
    if (!next) return
    if ('idx' in next) return openView(rows[next.idx].imageKey)
    setView({ key: viewKey!, edge: next.edge, pos: viewPos })
    setPage(next.page)
  }
  const closeView = () => setView(null)

  const reset = () => {
    setPage(1)
    closeView()
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
        <p className="text-sm text-muted-foreground">수신·판정이 끝난 이미지를 판정과 배정 여부로 찾아봅니다. 행을 누르면 크게 보고, 이전/다음으로 쪽을 넘어 계속 볼 수 있습니다.</p>
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
            {rows.map((r) => (
              <TableRow key={r.imageKey} className="cursor-pointer" onClick={() => openView(r.imageKey)}>
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
          closeView()
        }}
        onPageSize={(n) => {
          setPageSize(n)
          reset()
        }}
      />

      {detail.data && viewKey && (
        <ImageLightbox
          open
          browse
          onClose={() => {
            closeView()
            setHot(null)
          }}
          img={detail.data}
          overlay={overlay}
          setOverlay={setOverlay}
          opacity={60}
          hot={hot}
          onHot={setHot}
          index={viewPos}
          total={total}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          canReview={false}
          onDecide={() => undefined}
        />
      )}
    </div>
  )
}
