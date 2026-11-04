import { describe, expect, test } from 'vitest'
import { classifyFiles, runQueue, summarizeProgress } from './upload'

const limits = { maxFileBytes: 50 * 1024 * 1024, maxBatchFiles: 3, extensions: ['.png', '.jpg'] }
const noSleep = async () => {}

describe('classifyFiles', () => {
  test('형식·빈 파일·크기를 걸러 이유를 알려 준다 (확장자는 대소문자 무시)', () => {
    const r = classifyFiles(
      [
        { name: 'a.PNG', size: 10 },
        { name: 'b.txt', size: 10 },
        { name: 'c.jpg', size: 0 },
        { name: 'd.jpg', size: 51 * 1024 * 1024 },
        { name: '무확장자', size: 5 },
      ],
      limits,
    )
    expect(r.ok.map((f) => f.name)).toEqual(['a.PNG'])
    expect(r.excluded.map((e) => e.reason)).toEqual([expect.stringContaining('.txt'), '빈 파일', expect.stringContaining('50MB'), expect.stringContaining('확장자 없음')])
  })
  test('한 번에 올릴 수 있는 장수를 넘으면 앞에서부터 자르고 넘친 수를 알려 준다', () => {
    const files = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.png`, size: 1 }))
    const r = classifyFiles(files, limits)
    expect(r.ok).toHaveLength(3)
    expect(r.overLimit).toBe(2)
  })
})

describe('runQueue', () => {
  test('수천 장도 동시 전송 수를 넘지 않고 모두 처리한다', async () => {
    let active = 0
    let peak = 0
    const run = async () => {
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
    }
    const idx = Array.from({ length: 3000 }, (_, i) => i)
    const r = await runQueue(idx, run, { concurrency: 4, sleep: noSleep })
    expect(r).toMatchObject({ total: 3000, done: 3000, failed: 0, canceled: false })
    expect(peak).toBe(4)
  })

  test('실패는 정해진 횟수만 다시 시도하고, 끝내 실패한 항목을 인덱스로 돌려준다', async () => {
    const tries = new Map<number, number>()
    const run = async (i: number) => {
      tries.set(i, (tries.get(i) ?? 0) + 1)
      if (i === 1) throw new Error('네트워크 오류')
      if (i === 2 && tries.get(i)! < 3) throw new Error('일시 오류') // 세 번째에 성공
    }
    const r = await runQueue([0, 1, 2], run, { retries: 2, sleep: noSleep })
    expect(r.done).toBe(2)
    expect(r.failures).toEqual([{ index: 1, error: '네트워크 오류' }])
    expect(tries.get(1)).toBe(3) // 최초 + 재시도 2번
    expect(tries.get(2)).toBe(3)
  })

  test('retryable=false 오류(권한 없음 등)는 다시 시도하지 않는다', async () => {
    let n = 0
    const run = async () => {
      n++
      throw Object.assign(new Error('권한이 없습니다.'), { retryable: false })
    }
    const r = await runQueue([0], run, { retries: 5, sleep: noSleep })
    expect(n).toBe(1)
    expect(r.failed).toBe(1)
  })

  test('다시 시도 대기는 시도마다 배로 늘어난다', async () => {
    const waits: number[] = []
    await runQueue([0], async () => { throw new Error('x') }, { retries: 3, retryDelayMs: 100, sleep: async (ms) => void waits.push(ms) })
    expect(waits).toEqual([100, 200, 400])
  })

  test('취소하면 새 전송을 시작하지 않고, 이미 올라간 수는 그대로 보고한다', async () => {
    let canceled = false
    let started = 0
    const run = async () => {
      started++
      if (started === 5) canceled = true
    }
    const r = await runQueue(Array.from({ length: 100 }, (_, i) => i), run, { concurrency: 1, isCanceled: () => canceled, sleep: noSleep })
    expect(r.canceled).toBe(true)
    expect(r.done).toBe(5)
    expect(r.total).toBe(100)
  })

  test('일시 중지 중에는 새 전송을 시작하지 않고, 풀면 이어간다', async () => {
    let paused = true
    let started = 0
    let sleeps = 0
    const run = async () => void started++
    const r = await runQueue([0, 1, 2], run, {
      concurrency: 1,
      isPaused: () => paused,
      sleep: async () => {
        sleeps++
        expect(started).toBe(0) // 중지 동안은 아무것도 시작하지 않았다
        if (sleeps === 3) paused = false
      },
    })
    expect(sleeps).toBe(3)
    expect(r.done).toBe(3)
  })

  test('진행 상황을 알려 준다 (진행 중 수, 성공 수)', async () => {
    const seen: number[] = []
    await runQueue([0, 1, 2, 3], async () => {}, { concurrency: 2, sleep: noSleep, onProgress: (s) => seen.push(s.done) })
    expect(Math.max(...seen)).toBe(4)
  })
})

describe('summarizeProgress', () => {
  test('0인 항목은 빼고 천 단위 구분', () => {
    expect(summarizeProgress({ done: 2711, waiting: 286, processing: 0, failed: 3, rejected: 0 })).toBe('완료 2,711 · 수신 대기 286 · 검사 실패 3')
    expect(summarizeProgress({ done: 0, waiting: 0, processing: 0, failed: 0, rejected: 0 })).toBe('-')
  })
})
