// 이미지 확대 보기의 계산 (화면과 분리해 단위 테스트한다).
// 좌표는 스테이지(보는 영역) 중심을 원점으로 한다. 이미지는 중심에 놓이고 transform: translate(tx, ty) scale(s)로 움직인다.

export const MIN_SCALE = 0.5
export const MAX_SCALE = 8
export const BUTTON_STEP = 1.25
export const WHEEL_STEP = 1.15

export interface View {
  /** 확대 배율 (1 = 맞춤) */
  s: number
  tx: number
  ty: number
}
export const FIT: View = { s: 1, tx: 0, ty: 0 }

/** 스테이지 안에 비율을 유지하며 들어가는 이미지 크기 (맞춤, 1배). 스테이지를 아직 못 쟀으면 0 */
export function fitSize(stageW: number, stageH: number, imgW: number, imgH: number, margin = 24) {
  const availW = stageW - margin
  const availH = stageH - margin
  if (availW <= 0 || availH <= 0 || imgW <= 0 || imgH <= 0) return { w: 0, h: 0 }
  const w = Math.min(availW, (availH * imgW) / imgH)
  return { w, h: (w * imgH) / imgW }
}

const clamp = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s))

/** (px, py) 아래의 이미지 점이 그대로 그 자리에 있도록 factor배 확대·축소 */
export function zoomAround(v: View, factor: number, px: number, py: number): View {
  const s = clamp(v.s * factor)
  const f = s / v.s
  return { s, tx: px - (px - v.tx) * f, ty: py - (py - v.ty) * f }
}

/** 원본 픽셀 대비 화면 크기(%). 100이면 원본 1픽셀이 화면 1픽셀 */
export function percentOf(baseW: number, s: number, imgW: number) {
  return imgW > 0 ? Math.round(((baseW * s) / imgW) * 100) : 0
}

/** 원본 크기(1:1)가 되는 배율. 맞춤 크기가 원본보다 작으면 1보다 크다 */
export function actualScale(baseW: number, imgW: number) {
  return baseW > 0 ? clamp(imgW / baseW) : 1
}

/** 더블클릭: 확대돼 있으면 맞춤으로, 아니면 클릭한 자리를 2배로 */
export function toggleZoom(v: View, px: number, py: number): View {
  return v.s > 1.01 ? FIT : zoomAround(v, 2, px, py)
}
