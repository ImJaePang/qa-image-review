import { useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { FolderUp, ImageUp, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pagination } from '@/components/common/Pagination'
import { UploadDetailDialog } from '@/components/upload/UploadDetailDialog'
import { api } from '@/api'
import { filesFromDrop, useUploader } from '@/hooks/useUploader'
import { fmtDateTime } from '@/lib/domain'
import { DEFAULT_PAGE_SIZE } from '@/lib/paging'
import { fmtBytes, fmtEta, summarizeProgress } from '@/lib/upload'
import { cn } from '@/lib/utils'
import { useCan } from '@/stores/auth'

const n = (v: number) => v.toLocaleString('ko-KR')

export function UploadPage() {
  const allowed = useCan('image.upload')
  const { data: limits, error: limitsError } = useQuery({ queryKey: ['upload-limits'], queryFn: api.uploadLimits, enabled: allowed, retry: false })
  const up = useUploader(limits)
  const { view } = up
  const fileInput = useRef<HTMLInputElement>(null)
  const dirInput = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [memo, setMemo] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [mine, setMine] = useState(false)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [detail, setDetail] = useState<string | null>(null)
  const [showExcluded, setShowExcluded] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])
  // 올리는 동안만 남은 시간 계산을 위해 시계를 돌린다
  useEffect(() => {
    if (view.phase !== 'running') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [view.phase])
  // 폴더 선택 입력은 비표준 속성이라 직접 지정한다
  useEffect(() => {
    dirInput.current?.setAttribute('webkitdirectory', '')
  }, [])

  const history = useQuery({
    queryKey: ['uploads', 'list', { mine, q: debouncedQ, page, pageSize }],
    queryFn: () => api.listUploads({ mine, q: debouncedQ || undefined, page, pageSize }),
    placeholderData: keepPreviousData,
    enabled: allowed,
    // 수신 대기·검사 중인 건이 있으면 5초마다 새로 고쳐 처리 현황이 바뀌는 것을 보여 준다
    refetchInterval: (query) => (query.state.data?.items.some((b) => b.waiting || b.processing) ? 5000 : false),
  })
  const rows = history.data?.items ?? []
  const canSeeAll = history.data?.canSeeAll ?? false

  if (!allowed) return <p className="text-sm text-muted-foreground">이 화면을 쓸 권한이 없습니다.</p>

  const busy = view.phase === 'running' || view.phase === 'paused'
  const totalBytes = up.files.reduce((s, f) => s + f.size, 0)
  const pct = view.total ? Math.round(((view.progress.done + view.progress.failed) / view.total) * 100) : 0
  const eta = view.phase === 'running' && view.startedAt ? fmtEta(view.progress.done, view.total, now - view.startedAt) : null

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (busy) return
    const dropped = e.dataTransfer.items?.length ? await filesFromDrop(e.dataTransfer.items) : [...e.dataTransfer.files]
    up.select(dropped)
  }
  const chip = (value: boolean, label: string, count?: number) => (
    <button
      key={label}
      type="button"
      onClick={() => {
        setMine(value)
        setPage(1)
      }}
      className={cn('border-r px-3 py-1.5 text-sm last:border-r-0', mine === value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
    >
      {label}
      {count !== undefined && <span className={cn('ml-1.5 rounded-full px-1.5 text-xs', mine === value ? 'bg-primary-foreground/25' : 'bg-muted text-muted-foreground')}>{count}</span>}
    </button>
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">이미지 업로드</h1>
        <p className="text-sm text-muted-foreground">올린 이미지는 수신 폴더로 들어가 자동으로 모델 검사를 거칩니다. 몇 천 장도 나눠서 올립니다.</p>
      </div>

      <div className="space-y-4 rounded-lg border bg-card p-4">
        <div
          onDragOver={(e) => {
            e.preventDefault()
            if (!busy) setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn('rounded-lg border-2 border-dashed px-6 py-6 text-center transition-colors', dragging ? 'border-primary bg-accent' : 'border-primary/30 bg-muted/40', busy && 'opacity-50')}
        >
          <p className="font-medium text-primary">파일이나 폴더를 여기에 끌어다 놓으세요</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {limits ? `${limits.extensions.map((e) => e.slice(1).toUpperCase()).join(' · ')}, 한 장 최대 ${Math.floor(limits.maxFileBytes / 1024 / 1024)}MB, 한 번에 최대 ${n(limits.maxBatchFiles)}장` : (limitsError as Error)?.message ?? '한도를 불러오는 중…'}
          </p>
          <div className="mt-3 flex justify-center gap-2">
            <Button variant="outline" size="sm" disabled={busy || !limits} onClick={() => fileInput.current?.click()}>
              <ImageUp className="size-4" />
              파일 선택
            </Button>
            <Button variant="outline" size="sm" disabled={busy || !limits} onClick={() => dirInput.current?.click()}>
              <FolderUp className="size-4" />
              폴더 선택
            </Button>
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept={limits?.extensions.join(',')}
            onChange={(e) => {
              up.select([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
          <input
            ref={dirInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              up.select([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
        </div>

        {up.error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{up.error}</p>}

        {!busy && view.phase !== 'finished' && (up.files.length > 0 || up.excluded.length > 0) && (
          <section className="space-y-2">
            <h3 className="border-b pb-1 text-xs font-semibold text-primary">선택한 파일</h3>
            <p className="text-sm">
              올릴 수 있는 파일 <b className="tabular-nums">{n(up.files.length)}장</b> · {fmtBytes(totalBytes)}
              {up.excluded.length > 0 && (
                <span className="text-muted-foreground">
                  {' '}
                  — 제외 <b className="tabular-nums">{n(up.excluded.length)}장</b> (이미지가 아니거나 크기 초과){' '}
                  <button type="button" className="text-primary hover:underline" onClick={() => setShowExcluded((v) => !v)}>
                    {showExcluded ? '제외 목록 접기' : '제외 목록 보기'}
                  </button>
                </span>
              )}
            </p>
            {up.overLimit > 0 && limits && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                한 번에 {n(limits.maxBatchFiles)}장까지 올릴 수 있어 앞의 {n(limits.maxBatchFiles)}장만 선택했습니다. 나머지 {n(up.overLimit)}장은 이번 업로드가 끝난 뒤 다시 선택해 주세요.
              </p>
            )}
            {showExcluded && (
              <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
                {up.excluded.slice(0, 200).map((e, i) => (
                  <li key={i}>
                    {e.name} — {e.reason}
                  </li>
                ))}
                {up.excluded.length > 200 && <li>… 외 {n(up.excluded.length - 200)}장</li>}
              </ul>
            )}
            {up.files.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Input className="w-64" placeholder="메모 (선택)" maxLength={200} value={memo} onChange={(e) => setMemo(e.target.value)} />
                <Button onClick={() => up.start(memo.trim() || undefined)}>{n(up.files.length)}장 업로드 시작</Button>
                <Button variant="outline" onClick={up.clear}>
                  선택 비우기
                </Button>
                <span className="text-xs text-muted-foreground">업로드 중에 이 창이나 탭을 닫으면 남은 파일은 올라가지 않습니다. 이미 올라간 파일은 그대로 처리됩니다.</span>
              </div>
            )}
          </section>
        )}

        {view.phase !== 'idle' && (
          <section className="space-y-2">
            <h3 className="border-b pb-1 text-xs font-semibold text-primary">업로드 진행</h3>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span>
                <b className="tabular-nums">
                  {n(view.progress.done)} / {n(view.total)}장
                </b>{' '}
                {view.phase === 'finished' ? '처리함' : view.phase === 'paused' ? '올림 (일시 중지)' : '올림'}
                {view.rejected.length > 0 && (
                  <span className="text-amber-700 dark:text-amber-300">
                    {' '}
                    · 거절 <b className="tabular-nums">{n(view.rejected.length)}장</b>
                  </span>
                )}
                {view.progress.failed > 0 && (
                  <span className="text-destructive">
                    {' '}
                    · 전송 실패 <b className="tabular-nums">{n(view.progress.failed)}장</b>
                  </span>
                )}
              </span>
              <span className="text-xs text-muted-foreground">{view.phase === 'running' ? [eta, '동시에 4장씩 전송'].filter(Boolean).join(' · ') : view.canceled ? '취소됨' : ''}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {view.phase === 'running' && (
                <Button variant="outline" size="sm" onClick={up.pause}>
                  일시 중지
                </Button>
              )}
              {view.phase === 'paused' && (
                <Button size="sm" onClick={up.resume}>
                  이어서 올리기
                </Button>
              )}
              {busy && (
                <Button variant="outline" size="sm" onClick={() => confirm('남은 파일 업로드를 취소할까요? 이미 올라간 파일은 그대로 처리됩니다.') && up.cancel()}>
                  취소
                </Button>
              )}
              {view.phase === 'finished' && view.failures.length > 0 && (
                <>
                  <Button size="sm" onClick={up.retryFailed}>
                    실패 {n(view.failures.length)}장 다시 시도
                  </Button>
                  <Button variant="outline" size="sm" onClick={up.finish}>
                    그만하고 끝내기
                  </Button>
                </>
              )}
              {view.phase === 'finished' && view.failures.length === 0 && (
                <Button variant="outline" size="sm" onClick={up.reset}>
                  확인
                </Button>
              )}
            </div>
            {view.phase === 'finished' && (view.rejected.length > 0 || view.failures.length > 0) && (
              <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
                {view.failures.slice(0, 100).map((f) => (
                  <li key={`f${f.index}`} className="text-destructive">
                    {f.name} — 전송 실패: {f.error}
                  </li>
                ))}
                {view.rejected.slice(0, 100).map((r, i) => (
                  <li key={`r${i}`}>
                    {r.name} — 거절: {r.reason}
                  </li>
                ))}
                {view.failures.length + view.rejected.length > 200 && <li>… 전체 내용은 아래 업로드 이력의 「보기」에서 확인하세요.</li>}
              </ul>
            )}
          </section>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-base font-semibold">업로드 이력</h2>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
          {canSeeAll && (
            <div className="flex overflow-hidden rounded-lg border" role="radiogroup" aria-label="범위">
              {chip(false, '전체', history.data?.counts.total)}
              {chip(true, '내가 올린 것', history.data?.counts.mine)}
            </div>
          )}
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder={canSeeAll ? '올린 사람 · 메모 검색' : '메모 검색'}
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>업로드 시각</TableHead>
              <TableHead>올린 사람</TableHead>
              <TableHead>메모</TableHead>
              <TableHead>업로드됨</TableHead>
              <TableHead>처리 현황</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  불러오는 중…
                </TableCell>
              </TableRow>
            )}
            {history.isError && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-destructive">
                  {(history.error as Error).message}
                </TableCell>
              </TableRow>
            )}
            {!history.isLoading && !history.isError && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  업로드 이력이 없습니다.
                </TableCell>
              </TableRow>
            )}
            {rows.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="tabular-nums">{fmtDateTime(b.createdAt)}</TableCell>
                <TableCell>{b.createdByName}</TableCell>
                <TableCell className="max-w-48 truncate text-sm text-muted-foreground" title={b.memo ?? undefined}>
                  {b.memo ?? '-'}
                </TableCell>
                <TableCell className="tabular-nums">
                  {n(b.uploaded)} / {n(b.expectedCount)}장
                  {b.status === 'OPEN' && (
                    <Badge variant="outline" className="ml-2">
                      진행 중
                    </Badge>
                  )}
                  {b.status === 'CANCELED' && (
                    <Badge variant="secondary" className="ml-2">
                      취소
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm">{summarizeProgress(b)}</TableCell>
                <TableCell>
                  <Button variant="outline" size="sm" onClick={() => setDetail(b.id)}>
                    보기
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Pagination
        total={history.data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={(s) => {
          setPageSize(s)
          setPage(1)
        }}
      />

      <UploadDetailDialog batchId={detail} onClose={() => setDetail(null)} />
    </div>
  )
}
