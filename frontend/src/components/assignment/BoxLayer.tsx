import { useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react'
import { REASON_DESCRIPTIONS, REASON_LABELS } from '@/lib/domain'
import type { ImageItem } from '@/lib/types'
import { cn } from '@/lib/utils'

export type Box = ImageItem['boxes'][number]

const RED = 'oklch(0.637 0.237 25.331)'

/** 이상 영역 번호 배지. 박스 위·호버 카드·오른쪽 목록이 같은 모양을 쓴다 */
export function NumberBadge({ n, className, style }: { n: number; className?: string; style?: CSSProperties }) {
  return (
    <span className={cn('inline-grid size-5 shrink-0 place-items-center rounded-md text-[11px] font-semibold text-white', className)} style={{ background: RED, ...style }}>
      {n}
    </span>
  )
}

/**
 * 이미지 위의 박스. 좌표는 원본 픽셀 기준으로 저장되므로 비율(%)로 그린다 (기획서 5장).
 * 항상 보이는 것은 번호 배지뿐이고, 원인·점수는 마우스를 올리면 BoxTip이 보여 준다.
 * scale: 확대 화면에서 이미지가 커져도 테두리 두께와 배지 크기는 그대로 보이게 나눠 준다.
 */
export function BoxLayer({
  boxes,
  imgW,
  imgH,
  hot,
  onHot,
  scale = 1,
}: {
  boxes: Box[]
  imgW: number
  imgH: number
  hot: number | null
  onHot: (i: number | null) => void
  scale?: number
}) {
  return (
    <>
      {boxes.map((b, i) => (
        <div
          key={i}
          data-box={i}
          onPointerEnter={() => onHot(i)}
          onPointerLeave={() => onHot(null)}
          className="absolute cursor-help"
          style={{
            left: `${(b.x / imgW) * 100}%`,
            top: `${(b.y / imgH) * 100}%`,
            width: `${(b.width / imgW) * 100}%`,
            height: `${(b.height / imgH) * 100}%`,
            border: `${(hot === i ? 3 : 2) / scale}px solid ${RED}`,
            boxShadow: hot === i ? `0 0 0 1px rgba(0,0,0,.5), 0 0 0 ${4 / scale}px color-mix(in oklch, ${RED} 35%, transparent), inset 0 0 0 9999px rgba(255,255,255,.08)` : '0 0 0 1px rgba(0,0,0,.5)',
          }}
        >
          {/* 위쪽 가장자리에 붙은 박스는 배지가 잘리지 않도록 안쪽에 둔다 */}
          <NumberBadge
            n={i + 1}
            className="absolute -left-0.5 rounded-b-none"
            // 배지는 확대해도 같은 크기로 보이게 반대로 줄이고, 박스의 왼쪽 아래 모서리를 기준으로 한다
            style={{ top: b.y / imgH < 0.06 ? 0 : -22, transform: `scale(${1 / scale})`, transformOrigin: '0 100%' }}
          />
        </div>
      ))}
    </>
  )
}

const TIP_W = 262
const TIP_H = 150 // 카드 높이 추정치 (화면 밖으로 나가지 않게 자리를 잡는 데만 쓴다)

/**
 * 호버 중인 박스 옆에 원인·점수·설명 카드를 보여 준다. hot이 null이면 숨긴다.
 * host: 박스들을 담은 영역(카드가 이 영역 안에 머문다). 위치는 DOM에서 직접 재서 스타일에 쓰므로 상태를 더 만들지 않는다.
 * bust: 이 값이 바뀌면 위치를 다시 잰다 (확대·이동할 때).
 */
export function BoxTip({ host, boxes, hot, bust }: { host: RefObject<HTMLElement | null>; boxes: Box[]; hot: number | null; bust?: unknown }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const tip = ref.current
    const h = host.current
    if (!tip || !h || hot === null) return
    const el = h.querySelector<HTMLElement>(`[data-box="${hot}"]`)
    if (!el) return
    const hr = h.getBoundingClientRect()
    const br = el.getBoundingClientRect()
    const gap = 10
    let left = br.right - hr.left + gap
    if (left + TIP_W > hr.width - 8) left = br.left - hr.left - TIP_W - gap // 오른쪽에 자리가 없으면 왼쪽
    left = Math.max(8, Math.min(left, hr.width - TIP_W - 8))
    let top = br.top - hr.top
    top = Math.max(8, Math.min(top, hr.height - TIP_H - 8))
    tip.style.left = `${left}px`
    tip.style.top = `${top}px`
  }, [host, hot, bust])

  const b = hot === null ? undefined : boxes[hot]
  return (
    <div
      ref={ref}
      role="tooltip"
      data-testid="box-tip"
      className={cn(
        'pointer-events-none absolute z-10 w-[262px] max-w-[calc(100%-16px)] rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg transition-opacity duration-100',
        b ? 'opacity-100' : 'opacity-0',
      )}
    >
      {b && hot !== null && (
        <>
          <div className="flex items-center gap-2">
            <NumberBadge n={hot + 1} />
            <span className="text-[13px] font-semibold">{REASON_LABELS[b.reasonCode]}</span>
            <span className="ml-auto text-[13px] font-medium tabular-nums">{b.score.toFixed(2)}</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded bg-muted">
            <div className="h-full" style={{ width: `${Math.round(b.score * 100)}%`, background: RED }} />
          </div>
          <p className="mb-2 mt-1.5 text-[12.5px] text-muted-foreground">{REASON_DESCRIPTIONS[b.reasonCode]}</p>
          <p className="border-t pt-1.5 font-mono text-[11px] leading-snug text-muted-foreground">
            {b.reasonCode}
            <br />
            위치 {Math.round(b.x)}, {Math.round(b.y)} · {Math.round(b.width)}×{Math.round(b.height)} px
          </p>
        </>
      )}
    </div>
  )
}
