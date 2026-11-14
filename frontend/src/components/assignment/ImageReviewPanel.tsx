import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, ChevronLeft, ChevronRight, SkipForward, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, type ImageFilter } from '@/api'
import { REASON_LABELS, fmtDateTime } from '@/lib/domain'
import { useAuth } from '@/stores/auth'
import type { Assignment, ImageItem, Verdict } from '@/lib/types'
import { VIEW_ORDERS, VIEW_ORDER_LABEL, type ViewOrder } from '@/lib/imageSort'
import { cn } from '@/lib/utils'
import { toggleAll, type Overlay } from '@/lib/overlay'
import { ReasonBadge, ReviewMark, VerdictBadge } from './badges'
import { NumberBadge } from './BoxLayer'
import { ImageLightbox } from './ImageLightbox'
import { ImageViewer, type ViewMode } from './ImageViewer'

const VIEW_MODE_KEY = 'qa.reviewViewMode'
const PREFETCH_AHEAD = 2 // 원본 고정일 때 현재 이미지 뒤로 미리 받을 장수 (전체를 받지 않는다)

// 사용자 편의 설정이므로 브라우저 저장소를 쓰되, 막혀 있어도 화면은 정상 동작해야 한다
const loadViewMode = (): ViewMode => {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === 'original' ? 'original' : 'preview'
  } catch {
    return 'preview'
  }
}
const saveViewMode = (m: ViewMode) => {
  try {
    localStorage.setItem(VIEW_MODE_KEY, m)
  } catch {
    /* 저장 실패는 무시 */
  }
}

const PAGE_SIZE = 50
/** 결과 칩: 서버 filter 값과 같은 이름. 건수는 image-counts의 같은 키 */
const RESULT_CHIPS: [ImageFilter, string][] = [
  ['all', '전체'],
  ['unreviewed', '미검토'],
  ['approved', '승인'],
  ['rejected', '반려'],
]
const VERDICT_OPTIONS: (Verdict | 'all')[] = ['all', '정상', '의심', '불량']
const ROW_HEIGHT = 61
type ImagePage = Awaited<ReturnType<typeof api.listImages>>

export function ImageReviewPanel({ assignment, canReview }: { assignment: Assignment; canReview: boolean }) {
  const qc = useQueryClient()
  const aid = assignment.id
  const pageOf = (i: number) => Math.floor(i / PAGE_SIZE) + 1

  const [index, setIndex] = useState(0)
  const [overlay, setOverlay] = useState<Overlay>('both')
  const [opacity, setOpacity] = useState(60)
  const [hot, setHot] = useState<number | null>(null) // 마우스를 올린 이상 영역 번호 (박스와 오른쪽 목록이 함께 강조)
  const [zoomOpen, setZoomOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode)
  // 토글을 클릭하면 버튼이 포커스를 가져가 ←/→ 키를 토글 그룹이 먹어 버린다 → 바꾼 뒤 포커스를 풀어 이미지 이동 단축키가 계속 동작하게 한다
  const releaseFocus = () => (document.activeElement as HTMLElement | null)?.blur?.()
  const changeViewMode = (m: ViewMode) => {
    setViewMode(m)
    saveViewMode(m)
    releaseFocus()
  }
  const me = useAuth((s) => s.user)
  // 보는 목록의 조건: 결과(미검토·승인·반려), AI 판정, 정렬. 바꾸면 처음 이미지부터 본다.
  const [filter, setFilter] = useState<ImageFilter>('all')
  const [verdictFilter, setVerdictFilter] = useState<Verdict | 'all'>('all')
  const [sort, setSort] = useState<ViewOrder>('position')
  const filtersActive = filter !== 'all' || verdictFilter !== 'all'
  const verdictParam = verdictFilter === 'all' ? undefined : verdictFilter
  const changeView = (next: { filter?: ImageFilter; verdict?: Verdict | 'all'; sort?: ViewOrder }) => {
    if (next.filter !== undefined) setFilter(next.filter)
    if (next.verdict !== undefined) setVerdictFilter(next.verdict)
    if (next.sort !== undefined) setSort(next.sort)
    setIndex(0)
    releaseFocus()
  }
  const { data: counts } = useQuery({ queryKey: ['image-counts', aid, verdictFilter], queryFn: () => api.imageCounts(aid, verdictParam) })
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null)

  // 가상 스크롤 목록: 전체 장수만큼 행을 잡고, 보이는 행이 속한 페이지(50장 단위)만 서버에서 불러온다.
  const listRef = useRef<HTMLDivElement>(null)
  const [total, setTotal] = useState(assignment.counts.total)
  const virt = useVirtualizer({
    count: total,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })
  const virtualRows = virt.getVirtualItems()
  const firstVisible = virtualRows[0]?.index ?? 0
  const lastVisible = virtualRows[virtualRows.length - 1]?.index ?? 0

  // 지금 필요한 페이지: 보이는 범위 + 현재 이미지(앞뒤 한 장 포함)
  const needed = [...new Set([1, pageOf(firstVisible), pageOf(lastVisible), pageOf(index), pageOf(index + 1)])]
    .filter((p) => p >= 1 && (total === 0 || (p - 1) * PAGE_SIZE < total))
    .sort((x, y) => x - y)
  const results = useQueries({
    queries: needed.map((p) => ({
      queryKey: ['images', aid, filter, verdictFilter, sort, p],
      queryFn: () => api.listImages(aid, { page: p, pageSize: PAGE_SIZE, filter, verdict: verdictParam, sort }),
      placeholderData: (prev: ImagePage | undefined) => prev,
    })),
  })
  const pages = new Map<number, ImagePage>()
  needed.forEach((p, i) => {
    const d = results[i]?.data
    if (d && d.page === p) pages.set(p, d)
  })
  const firstError = results.find((r) => r.isError)?.error as Error | undefined
  const serverTotal = pages.get(1)?.total
  useEffect(() => {
    if (serverTotal !== undefined && serverTotal !== total) setTotal(serverTotal)
  }, [serverTotal, total])

  const itemAt = (i: number): ImageItem | undefined => pages.get(pageOf(i))?.items[i % PAGE_SIZE]
  const lastShown = useRef<ImageItem | undefined>(undefined)
  const at = itemAt(Math.min(index, Math.max(total - 1, 0)))
  if (at) lastShown.current = at
  const current = at ?? lastShown.current // 다른 페이지를 불러오는 동안은 직전 이미지를 보여 준다
  const review = current?.review
  const comment = draft && current && draft.id === current.imageId ? draft.text : (review?.comment ?? '')

  useEffect(() => {
    if (total) virt.scrollToIndex(Math.min(index, total - 1), { align: 'auto' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  // 처음 열 때 첫 미검토 이미지로 이동 (이어서 작업하는 경우)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    api.nextUnreviewed(aid, 0).then((pos) => pos && setIndex(pos - 1)).catch(() => undefined)
  }, [aid])

  const goNextUnreviewed = async (afterPosition: number) => {
    try {
      const pos = await api.nextUnreviewed(aid, afterPosition, { filter, verdict: verdictParam, sort })
      if (pos) setIndex(pos - 1)
      else toast.info('미검토 이미지가 없습니다.')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // 낙관적 업데이트: 저장 요청을 보내면서 화면은 바로 반영하고, 실패하면 되돌린다
  const patchReview = (imageId: string, review: ImageItem['review']) => {
    const prev = qc.getQueriesData<ImagePage>({ queryKey: ['images', aid] })
    prev.forEach(([key, data]) => {
      if (!data) return
      qc.setQueryData<ImagePage>(key, { ...data, items: data.items.map((i) => (i.imageId === imageId ? { ...i, review } : i)) })
    })
    return prev
  }
  const mutate = useMutation({
    mutationFn: (v: { imageId: string; status: '승인' | '반려'; comment: string }) =>
      api.reviewImage(aid, v.imageId, v.status, v.comment),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['images', aid] })
      return {
        prev: patchReview(v.imageId, { status: v.status, comment: v.comment, reviewedAt: new Date().toISOString(), reviewerName: me?.name ?? null }),
      }
    },
    onError: (e: Error, _v, ctx) => {
      ctx?.prev.forEach(([key, data]) => qc.setQueryData(key, data))
      toast.error(e.message)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['assignments'] })
      qc.invalidateQueries({ queryKey: ['image-counts', aid] }) // 결과 칩 건수. 목록은 다시 받지 않아 보던 목록이 흔들리지 않는다
    },
  })

  const decide = async (status: '승인' | '반려') => {
    if (!canReview || !current) return
    const saving = mutate.mutateAsync({ imageId: current.imageId, status, comment }).catch(() => undefined)
    setDraft(null)
    // 바로 다음 이미지가 불러와져 있고 미검토면 그대로 이동, 아니면 서버에 다음 미검토 위치를 묻는다
    const nextItem = itemAt(index + 1)
    if (nextItem?.review.status === '미검토') return setIndex(index + 1)
    await saving // 서버가 이번 결과를 저장한 뒤에 물어야 현재 이미지를 건너뛴다
    goNextUnreviewed(index + 1)
  }

  // 원본 고정: 현재 이미지의 다음 몇 장만 미리 받아 둔다 (이미 본 것은 브라우저 캐시)
  const prefetched = useRef<HTMLImageElement[]>([])
  const nextUrls = viewMode === 'original' ? Array.from({ length: PREFETCH_AHEAD }, (_, k) => itemAt(index + 1 + k)?.originalUrl) : []
  const nextKey = nextUrls.join('|')
  useEffect(() => {
    prefetched.current = nextUrls.filter((u): u is string => !!u).map((u) => Object.assign(new Image(), { src: u }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextKey])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') return
      if (zoomOpen) return // 확대 화면이 단축키를 받는다
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.toLowerCase() === 'z') setZoomOpen(true)
      else if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, total - 1))
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0))
      else if (e.key.toLowerCase() === 'a') decide('승인')
      else if (e.key.toLowerCase() === 'r') decide('반려')
      else if (e.key.toLowerCase() === 'h') setOverlay(toggleAll)
      else if (e.key.toLowerCase() === 'o') changeViewMode(viewMode === 'original' ? 'preview' : 'original')
    }
    // 캡처 단계에서 받고, 방향키는 다른 곳으로 넘기지 않는다: 포커스가 탭 버튼에 있으면 탭 컴포넌트가 ←/→를 가져가 이미지 이동이 안 되기 때문
    const onKeyCapture = (e: KeyboardEvent) => {
      onKey(e)
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const t = e.target as HTMLElement
        if (t.tagName !== 'TEXTAREA' && t.tagName !== 'INPUT' && !zoomOpen && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault()
          e.stopPropagation()
        }
      }
    }
    window.addEventListener('keydown', onKeyCapture, true)
    return () => window.removeEventListener('keydown', onKeyCapture, true)
  })

  if (firstError && !current) return <p className="p-6 text-sm text-destructive">{firstError.message}</p>
  const filterBar = (
    <div className="space-y-2 border-b bg-muted/40 p-2">
      <div className="flex overflow-hidden rounded-md border bg-card" role="group" aria-label="결과">
        {RESULT_CHIPS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => changeView({ filter: value })}
            className={cn('flex flex-1 flex-col items-center border-r py-1 leading-tight last:border-r-0', filter === value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
          >
            <span className="text-[11px]">{label}</span>
            <span className="text-xs font-semibold tabular-nums">{counts ? counts[value].toLocaleString() : '-'}</span>
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        <Select
          items={VERDICT_OPTIONS.map((v) => ({ value: v, label: v === 'all' ? '판정 전체' : v }))}
          value={verdictFilter}
          onValueChange={(v) => changeView({ verdict: (v ?? 'all') as Verdict | 'all' })}
        >
          <SelectTrigger className="w-2/5 min-w-0 text-xs" aria-label="AI 판정">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VERDICT_OPTIONS.map((v) => (
              <SelectItem key={v} value={v}>
                {v === 'all' ? '판정 전체' : v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select items={VIEW_ORDERS.map((v) => ({ value: v, label: VIEW_ORDER_LABEL[v] }))} value={sort} onValueChange={(v) => changeView({ sort: (v ?? 'position') as ViewOrder })}>
          <SelectTrigger className="w-3/5 min-w-0 text-xs" aria-label="정렬">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VIEW_ORDERS.map((v) => (
              <SelectItem key={v} value={v}>
                {VIEW_ORDER_LABEL[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )

  if (total === 0 && !filtersActive) return <p className="p-6 text-sm text-muted-foreground">이 배정에는 이미지가 없습니다.</p>
  if (total === 0)
    return (
      <div className="grid h-full min-h-0 grid-cols-[280px_1fr] gap-4">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border">{filterBar}</div>
        <div className="flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <p>조건에 맞는 이미지가 없습니다.</p>
          <Button variant="outline" size="sm" onClick={() => changeView({ filter: 'all', verdict: 'all' })}>
            필터 지우기
          </Button>
        </div>
      </div>
    )
  if (!current) return <p className="p-6 text-sm text-muted-foreground">이미지를 불러오는 중…</p>

  return (
    <div className="grid h-full min-h-0 grid-cols-[280px_1fr_280px] gap-4">
      {/* 이미지 목록: 필터 줄 + 가상 스크롤 */}
      <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border">
        {filterBar}
        <div ref={listRef} className="min-h-0 flex-1 overflow-auto">
        <ul className="relative" style={{ height: virt.getTotalSize() }}>
          {virtualRows.map((row) => {
            const img = itemAt(row.index)
            return (
              <li
                key={row.key}
                className="absolute left-0 top-0 w-full border-b"
                style={{ height: row.size, transform: `translateY(${row.start}px)` }}
              >
                {img ? (
                  <button
                    onClick={() => setIndex(row.index)}
                    className={cn(
                      'flex h-full w-full items-center gap-2 p-2 text-left hover:bg-muted',
                      row.index === index && 'bg-accent',
                    )}
                  >
                    <img src={img.thumbUrl} alt="" loading="lazy" className="aspect-video w-16 rounded border object-cover" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{img.fileName}</span>
                      <span className="flex items-center gap-1.5">
                        <span className="text-[11px] tabular-nums text-muted-foreground">{img.overallScore.toFixed(2)}</span>
                        <ReviewMark status={img.review.status} />
                      </span>
                    </span>
                  </button>
                ) : (
                  <p className="p-3 text-xs text-muted-foreground">불러오는 중…</p>
                )}
              </li>
            )
          })}
        </ul>
        </div>
      </div>

      {/* 뷰어 */}
      <div className="min-h-0 space-y-3 overflow-auto">
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[overlay]}
            onValueChange={(v) => {
              if (v[0]) setOverlay(v[0] as Overlay)
              releaseFocus()
            }}
          >
            <ToggleGroupItem value="both">둘 다</ToggleGroupItem>
            <ToggleGroupItem value="heatmap">히트맵</ToggleGroupItem>
            <ToggleGroupItem value="boxes">박스</ToggleGroupItem>
            <ToggleGroupItem value="off">끄기</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[viewMode]}
            onValueChange={(v) => v[0] && changeViewMode(v[0] as ViewMode)}
            aria-label="보기 모드"
          >
            <ToggleGroupItem value="preview">미리보기</ToggleGroupItem>
            <ToggleGroupItem value="original">원본 고정</ToggleGroupItem>
          </ToggleGroup>
          <div className="flex w-48 items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
            투명도
            <Slider value={[opacity]} min={0} max={100} onValueChange={(v) => setOpacity(Array.isArray(v) ? v[0] : v)} />
          </div>
          <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <Button variant="outline" size="xs" onClick={() => goNextUnreviewed(index + 1)} className="mr-2">
              <SkipForward className="size-3" /> 다음 미검토
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setIndex(Math.max(index - 1, 0))} aria-label="이전">
              <ChevronLeft className="size-4" />
            </Button>
            {index + 1} / {total}
            <Button variant="ghost" size="icon-sm" onClick={() => setIndex(Math.min(index + 1, total - 1))} aria-label="다음">
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
        <ImageViewer img={current} overlay={overlay} opacity={opacity} viewMode={viewMode} hot={hot} onHot={setHot} onExpand={() => setZoomOpen(true)} />
        <p className="text-xs text-muted-foreground">
          단축키: <kbd className="rounded border px-1">←</kbd> <kbd className="rounded border px-1">→</kbd> 이동 ·{' '}
          <kbd className="rounded border px-1">A</kbd> 승인 · <kbd className="rounded border px-1">R</kbd> 반려 ·{' '}
          <kbd className="rounded border px-1">H</kbd> 오버레이 토글 ·{' '}
          <kbd className="rounded border px-1">O</kbd> 원본/미리보기 ·{' '}
          <kbd className="rounded border px-1">Z</kbd> 크게 보기
        </p>
      </div>

      {/* 판정 정보 + 검수 */}
      <div className="min-h-0 space-y-4 overflow-auto rounded-lg border p-3">
        <div>
          <p className="truncate text-sm font-semibold">{current.fileName}</p>
          <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            AI 점수 <b className="text-foreground tabular-nums">{current.overallScore.toFixed(2)}</b>
            <VerdictBadge verdict={current.verdict} />
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {current.modelVersion} · {current.width}×{current.height}
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold">이상 영역 ({current.boxes.length})</p>
          {current.boxes.length === 0 && <p className="text-xs text-muted-foreground">감지된 이상 영역 없음</p>}
          {current.boxes.map((b, i) => (
            <div
              key={i}
              onPointerEnter={() => setHot(i)}
              onPointerLeave={() => setHot(null)}
              className={cn('space-y-1 rounded-md p-2 text-xs transition-colors', hot === i ? 'bg-accent' : 'bg-muted/60')}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <NumberBadge n={i + 1} />
                  <span className="text-[13px] font-medium">{REASON_LABELS[b.reasonCode]}</span>
                </span>
                <span className="tabular-nums">{b.score.toFixed(2)}</span>
              </div>
              <ReasonBadge code={b.reasonCode} />
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <p className="flex items-center justify-between text-xs font-semibold">
            검수 결과 <ReviewMark status={review?.status ?? '미검토'} />
          </p>
          <Textarea
            placeholder={canReview ? '코멘트 (선택)' : '코멘트 없음'}
            value={comment}
            disabled={!canReview}
            onChange={(e) => setDraft({ id: current.imageId, text: e.target.value })}
            className="min-h-20 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={!canReview} onClick={() => decide('승인')}>
              <Check className="size-4" /> 승인
            </Button>
            <Button variant="destructive" disabled={!canReview} onClick={() => decide('반려')}>
              <X className="size-4" /> 반려
            </Button>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            <b className="text-foreground">승인</b> 문제없이 사용할 수 있음 · <b className="text-foreground">반려</b> 문제가 있어 사용할 수 없음. AI 판정이 불량이어도 사람이 보고 문제없다면 승인합니다.
          </p>
          {review && review.status !== '미검토' && review.reviewedAt && (
            <p className="text-xs text-muted-foreground" data-testid="last-review">
              마지막 검수: {review.reviewerName ?? '알 수 없음'} · {fmtDateTime(review.reviewedAt)}
            </p>
          )}
          {!canReview && <p className="text-xs text-muted-foreground">‘점검중’ 상태에서 담당자만 검수할 수 있습니다.</p>}
        </div>
      </div>

      <ImageLightbox
        open={zoomOpen}
        onClose={() => setZoomOpen(false)}
        img={current}
        overlay={overlay}
        setOverlay={setOverlay}
        opacity={opacity}
        hot={hot}
        onHot={setHot}
        index={index}
        total={total}
        onPrev={() => setIndex((i) => Math.max(i - 1, 0))}
        onNext={() => setIndex((i) => Math.min(i + 1, total - 1))}
        canReview={canReview}
        onDecide={decide}
      />
    </div>
  )
}
