import { useRef } from 'react'
import { Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { showsBoxes, showsHeatmap, type Overlay } from '@/lib/overlay'
import type { ImageItem } from '@/lib/types'
import { BoxLayer, BoxTip } from './BoxLayer'

/** 보기 모드: 미리보기(줄인 사본, 기본) / 원본 고정. 판정은 어느 모드든 원본 기준이고, 박스 좌표도 원본 픽셀 기준이다 */
export type ViewMode = 'preview' | 'original'

/**
 * 검수 화면의 이미지. 이미지를 누르거나 오른쪽 위 버튼, Z 키로 확대 화면을 연다.
 * 박스에는 번호만 항상 보이고, 마우스를 올리면 원인·설명 카드가 뜬다 (오른쪽 목록과 hot으로 서로 강조).
 */
export function ImageViewer({
  img,
  overlay,
  opacity,
  viewMode,
  hot,
  onHot,
  onExpand,
}: {
  img: ImageItem
  overlay: Overlay
  opacity: number
  viewMode: ViewMode
  hot: number | null
  onHot: (i: number | null) => void
  onExpand: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  return (
    <div ref={hostRef} className="group relative mx-auto aspect-video w-full cursor-zoom-in overflow-hidden rounded-lg border bg-black" onClick={onExpand}>
      {/* 미리보기는 항상 깔아 두고, 원본 고정이면 그 위에 원본을 얹는다 (원본이 내려오는 동안에도 빈 화면이 없다) */}
      <img src={img.previewUrl} alt={img.fileName} className="absolute inset-0 size-full object-fill" draggable={false} />
      {viewMode === 'original' && <img key={img.imageId} src={img.originalUrl} alt="" className="absolute inset-0 size-full object-fill" draggable={false} />}
      {!!img.heatmapUrl && showsHeatmap(overlay) && (
        <img src={img.heatmapUrl} alt="" className="absolute inset-0 size-full object-fill mix-blend-normal" style={{ opacity: opacity / 100 }} draggable={false} />
      )}
      {showsBoxes(overlay) && <BoxLayer boxes={img.boxes} imgW={img.width} imgH={img.height} hot={hot} onHot={onHot} />}
      <BoxTip host={hostRef} boxes={img.boxes} hot={showsBoxes(overlay) ? hot : null} />
      <Button
        variant="secondary"
        size="xs"
        className="absolute right-2 top-2 bg-black/55 text-white hover:bg-black/70"
        onClick={(e) => {
          e.stopPropagation()
          onExpand()
        }}
        aria-label="크게 보기"
      >
        <Maximize2 className="size-3" /> 크게 보기 <kbd className="rounded border border-white/30 px-1 text-[10px]">Z</kbd>
      </Button>
    </div>
  )
}
