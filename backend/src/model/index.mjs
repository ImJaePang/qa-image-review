// 설정(MODEL_ADAPTER)에 따라 모델 어댑터를 고른다. 실제 모델이 생기면 여기에 한 줄 추가.
import { createMockAdapter } from './mock.mjs'

export function loadAdapter(name = 'mock') {
  if (name === 'mock') return createMockAdapter()
  throw new Error(`알 수 없는 MODEL_ADAPTER: ${name}`)
}
