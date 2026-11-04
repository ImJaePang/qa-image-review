import { describe, expect, it } from 'vitest'
import { describeHistory, parseExtensions } from './integration'

describe('describeHistory', () => {
  it('설정 변경은 항목별 "이전 → 바뀐 값"으로 풀어 쓴다', () => {
    const lines = describeHistory({
      action: 'UPDATE',
      changes: { name: { from: 'A', to: 'B' }, config: { scanIntervalSec: { from: 5, to: 30 }, extensions: { from: ['.png', '.jpg'], to: ['.png'] } } },
    })
    expect(lines).toEqual(['이름: A → B', '스캔 주기(초): 5 → 30', '파일 확장자: .png .jpg → .png'])
  })
  it('켜기/끄기/추가/재시도 문구', () => {
    expect(describeHistory({ action: 'ENABLE', changes: {} })).toEqual(['사용을 켰습니다'])
    expect(describeHistory({ action: 'DISABLE', changes: {} })).toEqual(['사용을 껐습니다'])
    expect(describeHistory({ action: 'CREATE', changes: {} })).toEqual(['연계를 추가했습니다'])
    expect(describeHistory({ action: 'RETRY', changes: { retried: 3 } })).toEqual(['실패 3건을 다시 처리하도록 되돌렸습니다'])
  })
  it('모르는 설정 키도 키 이름 그대로 보여 준다', () => {
    expect(describeHistory({ action: 'UPDATE', changes: { config: { foo: { from: 1, to: 2 } } } })).toEqual(['foo: 1 → 2'])
  })
})

describe('parseExtensions', () => {
  it('공백·쉼표로 나누고 점과 소문자를 맞춘다', () => {
    expect(parseExtensions('png jpg, .WEBP')).toEqual(['.png', '.jpg', '.webp'])
    expect(parseExtensions('  ')).toEqual([])
  })
})
