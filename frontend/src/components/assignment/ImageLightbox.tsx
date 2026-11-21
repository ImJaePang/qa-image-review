import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { showsBoxes, showsHeatmap, toggleAll, toggleBoxes, toggleHeatmap, type Overlay } from '@/lib/overlay'
import { BUTTON_STEP, FIT, WHEEL_STEP, actualScale, fitSize, percentOf, toggleZoom, zoomAround, type View } from '@/lib/zoom'
import type { ImageItem } from '@/lib/types'
import { cn } from '@/lib/utils'
import { BoxLayer, BoxTip } from './BoxLayer'
import { ReviewMark, VerdictBadge } from './badges'

interface Props {
  open: boolean
  onClose: () => void
  img: ImageItem
  overlay: Overlay
  setOverlay: (o: Overlay) => void
  opacity: number
  hot: number | null
  onHot: (i: number | null) => void
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
  canReview: boolean
  onDecide: (status: '승인' | '반려') => void
  /** 반려 사유 상자 (열려 있으면 화면 위에 띄우고, 단축키는 상자가 받는다) */
  reject?: React.ReactNode
  /** 보기 전용(이미지 목록): 검수 상태와 승인/반려 버튼을 숨긴다 */
  browse?: boolean
}

/** 이미지를 화면 가득 크게 본다: 휠 확대, 드래그 이동, 더블클릭 맞춤/2배, 원본 크기(1:1). 그 자리에서 승인/반려까지 한다. */
export function ImageLightbox(props: Props) {
  const { open, onClose, img } = props
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="inset-3 top-3 left-3 flex h-auto w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden bg-neutral-950 p-0 text-neutral-100 ring-white/10 sm:max-w-none"
      >
        <DialogTitle className="sr-only">이미지 크게 보기: {img.fileName}</DialogTitle>
        <DialogDescription className="sr-only">휠로 확대하고 드래그로 이동합니다. Esc로 닫습니다.</DialogDescription>
        {/* 이미지가 바뀌면(승인/반려 후 다음 이미지 등) 확대 상태를 처음으로 되돌리기 위해 key로 새로 만든다 */}
        <LightboxBody key={img.imageId} {...props} />
      </DialogContent>
    </Dialog>
  )
}

function LightboxBody({ onClose, img, overlay, setOverlay, opacity, hot, onHot, index, total, onPrev, onNext, canReview, onDecide, browse, reject }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View>(FIT)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; y: number } | null>(null)

  // 스테이지 크기를 따라간다 (창 크기 변경 포함)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const base = fitSize(stage.w, stage.h, img.width, img.height)
  const pct = percentOf(base.w, view.s, img.width)

  // 휠은 브라우저 스크롤을 막아야 하므로 passive가 아닌 리스너로 직접 단다
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left - r.width / 2
      const py = e.clientY - r.top - r.height / 2
      setView((v) => zoomAround(v, e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, px, py))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const zoomCenter = (f: number) => setView((v) => zoomAround(v, f, 0, 0))
  const oneToOne = () => setView({ s: actualScale(base.w, img.width), tx: 0, ty: 0 })

  // 단축키: 열려 있는 동안은 이 창이 키를 받는다 (뒤쪽 검수 화면의 단축키는 멈춘다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (reject) return // 반려 사유 상자가 숫자·Enter·Esc를 받는다
      const k = e.key.toLowerCase()
      if (k === 'z') onClose()
      else if (k === '+' || k === '=') zoomCenter(BUTTON_STEP)
      else if (k === '-' || k === '_') zoomCenter(1 / BUTTON_STEP)
      else if (k === '0') setView(FIT)
      else if (k === '1') oneToOne()
      else if (k === 'h') setOverlay(toggleAll(overlay))
      else if (k === 'arrowright') onNext()
      else if (k === 'arrowleft') onPrev()
      else if (k === 'a' || k === 'r') {
        if (canReview && !browse) onDecide(k === 'a' ? '승인' : '반려')
      }
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    // 캡처 단계에서 받는다: 모달 안의 포커스된 버튼·포커스 관리가 방향키를 먼저 가져가도 이 창의 단축키는 동작해야 한다
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const centerOf = (e: { clientX: number; clientY: number }) => {
    const r = stageRef.current!.getBoundingClientRect()
    return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2] as const
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-neutral-900 px-4 py-2 text-sm">
        <span className="font-medium">{img.fileName}</span>
        <VerdictBadge verdict={img.verdict} />
        <span className="text-xs tabular-nums text-neutral-400">
          AI 점수 {img.overallScore.toFixed(2)} · {img.width}×{img.height} · {img.modelVersion}
        </span>
        {!browse && <ReviewMark status={img.review.status} />}
        <span className="flex-1" />
        <span className="text-xs tabular-nums text-neutral-400">
          {index + 1} / {total}
        </span>
        <DarkButton onClick={onPrev} aria-label="이전" disabled={index <= 0}>
          <ChevronLeft className="size-4" />
        </DarkButton>
        <DarkButton onClick={onNext} aria-label="다음" disabled={index >= total - 1}>
          <ChevronRight className="size-4" />
        </DarkButton>
        <DarkButton onClick={onClose} aria-label="닫기">
          <X className="size-4" /> 닫기 <Kbd>Esc</Kbd>
        </DarkButton>
      </div>

      <div
        ref={stageRef}
        data-testid="lightbox-stage"
        className={cn('relative grid min-h-0 flex-1 touch-none select-none place-items-center overflow-hidden', dragging ? 'cursor-grabbing' : 'cursor-grab')}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const dx = e.clientX - d.x
          const dy = e.clientY - d.y
          if (!dragging && Math.abs(dx) + Math.abs(dy) > 2) {
            setDragging(true)
            onHot(null)
          }
          drag.current = { x: e.clientX, y: e.clientY }
          setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }))
        }}
        onPointerUp={() => {
          drag.current = null
          setDragging(false)
        }}
        onDoubleClick={(e) => {
          const [px, py] = centerOf(e)
          setView((v) => toggleZoom(v, px, py))
        }}
      >
        <div
          className="relative"
          style={{ width: base.w, height: base.h, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`, transformOrigin: '50% 50%' }}
        >
          {/* 원본을 쓴다: 확대했을 때 해상도가 필요하다. 줄인 사본을 밑에 깔아 두어 원본이 내려오는 동안에도 빈 화면이 없다 */}
          <img src={img.previewUrl} alt="" className="absolute inset-0 size-full object-fill" draggable={false} />
          <img src={img.originalUrl} alt={img.fileName} className="absolute inset-0 size-full object-fill" draggable={false} />
          {!!img.heatmapUrl && showsHeatmap(overlay) && (
            <img src={img.heatmapUrl} alt="" className="absolute inset-0 size-full object-fill" style={{ opacity: opacity / 100 }} draggable={false} />
          )}
          {showsBoxes(overlay) && <BoxLayer boxes={img.boxes} imgW={img.width} imgH={img.height} hot={hot} onHot={onHot} scale={view.s} />}
        </div>
        <BoxTip host={stageRef} boxes={img.boxes} hot={showsBoxes(overlay) && !dragging ? hot : null} bust={view} />
        <p className="pointer-events-none absolute bottom-2.5 left-3 rounded-md bg-black/60 px-2 py-1 text-[11.5px] text-neutral-300">
          휠 확대·축소 · 드래그 이동 · 더블클릭 맞춤/2배 · <Kbd>+</Kbd> <Kbd>−</Kbd> <Kbd>0</Kbd>
        </p>
      </div>

      <div className="relative flex flex-wrap items-center gap-3 border-t border-white/10 bg-neutral-900 px-4 py-2">
        {/* 반려 사유 상자: 이미지 영역(휠 확대·드래그) 밖인 하단 막대에 붙여 위로 띄운다 */}
        {reject && <div className="absolute right-3 bottom-full z-10 mb-3">{reject}</div>}
        <div className="inline-flex items-center overflow-hidden rounded-lg border border-white/10" role="group" aria-label="확대 조절">
          <DarkButton className="rounded-none border-0" onClick={() => zoomCenter(1 / BUTTON_STEP)} aria-label="축소">
            −
          </DarkButton>
          <span data-testid="zoom-percent" className="min-w-14 text-center font-mono text-xs tabular-nums">
            {pct}%
          </span>
          <DarkButton className="rounded-none border-0" onClick={() => zoomCenter(BUTTON_STEP)} aria-label="확대">
            ＋
          </DarkButton>
        </div>
        <DarkButton onClick={() => setView(FIT)}>
          맞춤 <Kbd>0</Kbd>
        </DarkButton>
        <DarkButton onClick={oneToOne}>
          원본 크기 <Kbd>1</Kbd>
        </DarkButton>
        <DarkButton active={showsBoxes(overlay)} onClick={() => setOverlay(toggleBoxes(overlay))} aria-pressed={showsBoxes(overlay)}>
          박스
        </DarkButton>
        {!!img.heatmapUrl && (
          <DarkButton active={showsHeatmap(overlay)} onClick={() => setOverlay(toggleHeatmap(overlay))} aria-pressed={showsHeatmap(overlay)}>
            히트맵
          </DarkButton>
        )}
        <span className="flex-1" />
        {!browse && !canReview && <span className="text-xs text-neutral-400">‘점검중’ 상태에서 담당자만 검수할 수 있습니다.</span>}
        {!browse && (
          <>
            <Button variant="destructive" size="sm" disabled={!canReview || !!reject} onClick={() => onDecide('반려')}>
              <X className="size-4" /> 반려 <Kbd>R</Kbd>
            </Button>
            <Button size="sm" disabled={!canReview || !!reject} onClick={() => onDecide('승인')}>
              <Check className="size-4" /> 승인 <Kbd>A</Kbd>
            </Button>
          </>
        )}
      </div>
    </>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-white/25 px-1 font-mono text-[10px]">{children}</kbd>
}

function DarkButton({ active, className, ...props }: React.ComponentProps<typeof Button> & { active?: boolean }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn('border-white/10 bg-white/5 text-neutral-100 hover:bg-white/15 hover:text-white', active && 'bg-white/20', className)}
      {...props}
    />
  )
}
