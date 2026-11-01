import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import { api } from '@/mock/api'
import { REASON_LABELS, verdictOf } from '@/lib/domain'
import type { Assignment, ImageResult } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ReasonBadge, ReviewMark, VerdictBadge } from './badges'

type Overlay = 'both' | 'heatmap' | 'boxes' | 'off'

function ImageViewer({ img, overlay, opacity }: { img: ImageResult; overlay: Overlay; opacity: number }) {
  const showHeat = overlay === 'both' || overlay === 'heatmap'
  const showBoxes = overlay === 'both' || overlay === 'boxes'
  return (
    <div className="relative mx-auto aspect-video w-full overflow-hidden rounded-lg border bg-black">
      <img src={img.previewUrl} alt={img.fileName} className="absolute inset-0 size-full object-fill" draggable={false} />
      {showHeat && (
        <img
          src={img.heatmapUrl}
          alt=""
          className="absolute inset-0 size-full object-fill mix-blend-normal"
          style={{ opacity: opacity / 100 }}
          draggable={false}
        />
      )}
      {showBoxes &&
        img.boxes.map((b, i) => (
          // 박스 좌표는 원본 픽셀 기준으로 저장 → 화면에서는 비율(%)로 변환 (기획서 5장)
          <div
            key={i}
            className="absolute border-2 border-red-500 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
            style={{
              left: `${(b.x / img.width) * 100}%`,
              top: `${(b.y / img.height) * 100}%`,
              width: `${(b.width / img.width) * 100}%`,
              height: `${(b.height / img.height) * 100}%`,
            }}
          >
            <span className="absolute -top-5 left-0 whitespace-nowrap rounded-sm bg-red-500 px-1 text-[10px] font-medium leading-4 text-white">
              {b.reasonCode} {b.score.toFixed(2)}
            </span>
          </div>
        ))}
    </div>
  )
}

export function ImageReviewPanel({ assignment, canReview }: { assignment: Assignment; canReview: boolean }) {
  const qc = useQueryClient()
  const { data: images = [] } = useQuery({
    queryKey: ['images', assignment.id],
    queryFn: () => api.listImages(assignment.imageIds),
  })
  // 점수 낮은 순(문제 많은 것부터) 정렬
  const sorted = useMemo(() => [...images].sort((a, b) => a.overallScore - b.overallScore), [images])

  const [index, setIndex] = useState(0)
  const [overlay, setOverlay] = useState<Overlay>('both')
  const [opacity, setOpacity] = useState(60)
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null)

  const current = sorted[Math.min(index, sorted.length - 1)]
  const review = current ? assignment.reviews[current.imageId] : undefined
  const comment = draft && current && draft.id === current.imageId ? draft.text : (review?.comment ?? '')

  const mutate = useMutation({
    mutationFn: (v: { status: '승인' | '반려' }) => api.reviewImage(assignment.id, current!.imageId, v.status, comment),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assignments'] }),
  })

  const decide = (status: '승인' | '반려') => {
    if (!canReview || !current) return
    mutate.mutate({ status })
    // 다음 미검토 이미지로 이동
    const next = sorted.findIndex((x, i) => i > index && assignment.reviews[x.imageId]?.status === '미검토')
    if (next >= 0) setIndex(next)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') return
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, sorted.length - 1))
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0))
      else if (e.key.toLowerCase() === 'a') decide('승인')
      else if (e.key.toLowerCase() === 'r') decide('반려')
      else if (e.key.toLowerCase() === 'h') setOverlay((o) => (o === 'both' ? 'off' : 'both'))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!current) return <p className="p-6 text-sm text-muted-foreground">이미지를 불러오는 중…</p>

  return (
    <div className="grid h-full min-h-0 grid-cols-[220px_1fr_280px] gap-4">
      {/* 이미지 목록 */}
      <ScrollArea className="min-h-0 rounded-lg border">
        <ul className="divide-y">
          {sorted.map((img, i) => (
            <li key={img.imageId}>
              <button
                onClick={() => setIndex(i)}
                className={cn('flex w-full items-center gap-2 p-2 text-left hover:bg-muted', i === index && 'bg-accent')}
              >
                <img src={img.previewUrl} alt="" className="aspect-video w-16 rounded border object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{img.fileName}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-[11px] tabular-nums text-muted-foreground">{img.overallScore.toFixed(2)}</span>
                    <ReviewMark status={assignment.reviews[img.imageId]?.status ?? '미검토'} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea>

      {/* 뷰어 */}
      <div className="min-h-0 space-y-3 overflow-auto">
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[overlay]}
            onValueChange={(v) => v[0] && setOverlay(v[0] as Overlay)}
          >
            <ToggleGroupItem value="both">둘 다</ToggleGroupItem>
            <ToggleGroupItem value="heatmap">히트맵</ToggleGroupItem>
            <ToggleGroupItem value="boxes">박스</ToggleGroupItem>
            <ToggleGroupItem value="off">끄기</ToggleGroupItem>
          </ToggleGroup>
          <div className="flex w-48 items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
            투명도
            <Slider value={[opacity]} min={0} max={100} onValueChange={(v) => setOpacity(Array.isArray(v) ? v[0] : v)} />
          </div>
          <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <Button variant="ghost" size="icon-sm" onClick={() => setIndex(Math.max(index - 1, 0))} aria-label="이전">
              <ChevronLeft className="size-4" />
            </Button>
            {index + 1} / {sorted.length}
            <Button variant="ghost" size="icon-sm" onClick={() => setIndex(Math.min(index + 1, sorted.length - 1))} aria-label="다음">
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
        <ImageViewer img={current} overlay={overlay} opacity={opacity} />
        <p className="text-xs text-muted-foreground">
          단축키: <kbd className="rounded border px-1">←</kbd> <kbd className="rounded border px-1">→</kbd> 이동 ·{' '}
          <kbd className="rounded border px-1">A</kbd> 승인 · <kbd className="rounded border px-1">R</kbd> 반려 ·{' '}
          <kbd className="rounded border px-1">H</kbd> 오버레이 토글
        </p>
      </div>

      {/* 판정 정보 + 검수 */}
      <div className="min-h-0 space-y-4 overflow-auto rounded-lg border p-3">
        <div>
          <p className="truncate text-sm font-semibold">{current.fileName}</p>
          <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            AI 점수 <b className="text-foreground tabular-nums">{current.overallScore.toFixed(2)}</b>
            <VerdictBadge verdict={verdictOf(current)} />
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {current.modelVersion} · {current.width}×{current.height}
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold">이상 영역 ({current.boxes.length})</p>
          {current.boxes.length === 0 && <p className="text-xs text-muted-foreground">감지된 이상 영역 없음</p>}
          {current.boxes.map((b, i) => (
            <div key={i} className="space-y-1 rounded-md bg-muted/60 p-2 text-xs">
              <div className="flex items-center justify-between">
                <ReasonBadge code={b.reasonCode} />
                <span className="tabular-nums">{b.score.toFixed(2)}</span>
              </div>
              <p className="text-muted-foreground">{REASON_LABELS[b.reasonCode]}</p>
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
          {!canReview && <p className="text-xs text-muted-foreground">‘점검중’ 상태에서 담당자만 검수할 수 있습니다.</p>}
        </div>
      </div>
    </div>
  )
}
