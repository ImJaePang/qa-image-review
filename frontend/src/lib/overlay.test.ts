import { describe, expect, test } from 'vitest'
import { showsBoxes, showsHeatmap, toggleAll, toggleBoxes, toggleHeatmap, type Overlay } from './overlay'

describe('겹쳐 보기', () => {
  test('박스·히트맵은 서로 독립적으로 켜고 끈다', () => {
    expect(toggleBoxes('both')).toBe('heatmap')
    expect(toggleBoxes('heatmap')).toBe('both')
    expect(toggleBoxes('boxes')).toBe('off')
    expect(toggleBoxes('off')).toBe('boxes')
    expect(toggleHeatmap('both')).toBe('boxes')
    expect(toggleHeatmap('boxes')).toBe('both')
    expect(toggleHeatmap('heatmap')).toBe('off')
    expect(toggleHeatmap('off')).toBe('heatmap')
  })
  test('H 키는 전부 켜기 ↔ 전부 끄기', () => {
    expect(toggleAll('both')).toBe('off')
    expect(toggleAll('off')).toBe('both')
    expect(toggleAll('boxes')).toBe('both') // 일부만 켜져 있으면 전부 켠다
  })
  test('표시 여부', () => {
    const all: Overlay[] = ['both', 'heatmap', 'boxes', 'off']
    expect(all.map(showsBoxes)).toEqual([true, false, true, false])
    expect(all.map(showsHeatmap)).toEqual([true, true, false, false])
  })
})
