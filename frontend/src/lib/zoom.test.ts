import { describe, expect, test } from 'vitest'
import { FIT, MAX_SCALE, MIN_SCALE, actualScale, fitSize, percentOf, toggleZoom, zoomAround } from './zoom'

describe('맞춤 크기', () => {
  test('가로가 넉넉하면 높이에 맞추고, 아니면 너비에 맞춘다 (비율 유지)', () => {
    // 1344×768(16:9)을 1476×700 영역(여백 24)에: 높이가 먼저 막힌다
    const a = fitSize(1500, 724, 1344, 768)
    expect(a.h).toBeCloseTo(700)
    expect(a.w / a.h).toBeCloseTo(1344 / 768)
    // 좁은 영역: 너비에 맞춘다
    const b = fitSize(424, 800, 1344, 768)
    expect(b.w).toBeCloseTo(400)
    expect(b.h).toBeCloseTo((400 * 768) / 1344)
  })
  test('아직 못 쟀거나 이미지 크기가 없으면 0', () => {
    expect(fitSize(0, 0, 1344, 768)).toEqual({ w: 0, h: 0 })
    expect(fitSize(800, 600, 0, 0)).toEqual({ w: 0, h: 0 })
  })
})

describe('커서 기준 확대', () => {
  test('커서 아래의 이미지 점은 확대 전후에 같은 자리에 있다', () => {
    const v = { s: 1.5, tx: 30, ty: -20 }
    const px = 120
    const py = 80
    const w = zoomAround(v, 2, px, py)
    // 화면 좌표 p의 이미지 점 = (p - t) / s
    expect((px - v.tx) / v.s).toBeCloseTo((px - w.tx) / w.s)
    expect((py - v.ty) / v.s).toBeCloseTo((py - w.ty) / w.s)
    expect(w.s).toBeCloseTo(3)
  })
  test('중심(0,0)에서 확대하면 이동하지 않는다', () => {
    expect(zoomAround(FIT, 2, 0, 0)).toEqual({ s: 2, tx: 0, ty: 0 })
  })
  test('배율은 범위를 넘지 않는다', () => {
    expect(zoomAround({ s: 7, tx: 0, ty: 0 }, 10, 0, 0).s).toBe(MAX_SCALE)
    expect(zoomAround({ s: 0.6, tx: 0, ty: 0 }, 0.1, 0, 0).s).toBe(MIN_SCALE)
  })
})

describe('원본 대비 %와 1:1', () => {
  test('맞춤 크기가 원본의 절반이면 50%, 1:1 배율은 2', () => {
    expect(percentOf(672, 1, 1344)).toBe(50)
    expect(actualScale(672, 1344)).toBe(2)
    expect(percentOf(672, actualScale(672, 1344), 1344)).toBe(100)
  })
  test('맞춤이 원본보다 크면 1:1은 축소(범위 안에서)', () => {
    expect(actualScale(2000, 1000)).toBe(0.5)
  })
  test('이미지 폭이 0이면 0%', () => {
    expect(percentOf(100, 1, 0)).toBe(0)
  })
})

describe('더블클릭', () => {
  test('맞춤 상태에서는 클릭한 자리를 2배로, 확대 상태에서는 맞춤으로', () => {
    const zoomed = toggleZoom(FIT, 50, 0)
    expect(zoomed.s).toBe(2)
    expect(toggleZoom(zoomed, 0, 0)).toEqual(FIT)
  })
})
