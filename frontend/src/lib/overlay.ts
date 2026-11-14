// 검수 화면의 겹쳐 보기(박스·히트맵) 상태. 인라인 뷰어와 확대 화면이 같은 값을 쓴다.
export type Overlay = 'both' | 'heatmap' | 'boxes' | 'off'

export const showsBoxes = (o: Overlay) => o === 'both' || o === 'boxes'
export const showsHeatmap = (o: Overlay) => o === 'both' || o === 'heatmap'

/** 박스만 켜고 끄기 (히트맵 상태는 유지) */
export function toggleBoxes(o: Overlay): Overlay {
  return fromFlags(!showsBoxes(o), showsHeatmap(o))
}
/** 히트맵만 켜고 끄기 (박스 상태는 유지) */
export function toggleHeatmap(o: Overlay): Overlay {
  return fromFlags(showsBoxes(o), !showsHeatmap(o))
}
/** H 키: 전부 켜기 ↔ 전부 끄기 */
export const toggleAll = (o: Overlay): Overlay => (o === 'both' ? 'off' : 'both')

function fromFlags(boxes: boolean, heat: boolean): Overlay {
  if (boxes && heat) return 'both'
  if (boxes) return 'boxes'
  if (heat) return 'heatmap'
  return 'off'
}
