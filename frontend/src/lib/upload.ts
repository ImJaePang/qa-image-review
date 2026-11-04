// 이미지 업로드 화면용 순수 로직: 올릴 파일 고르기, 전송 큐(동시 전송·재시도·일시 중지·취소). 화면과 분리해 단위 테스트한다.

export interface UploadLimits {
  maxFileBytes: number
  maxBatchFiles: number
  extensions: string[] // 소문자, 점 포함 (예: ".png")
}

export interface Candidate {
  name: string
  size: number
}

export interface Excluded {
  name: string
  reason: string
}

const extOf = (name: string) => {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i).toLowerCase()
}

const fmtMB = (bytes: number) => `${Math.floor(bytes / 1024 / 1024)}MB`

/** 선택한 파일 중 올릴 수 있는 것과 제외할 것(이유 포함)을 나눈다. 서버도 같은 기준으로 다시 검사한다 (내용 확인은 서버만 할 수 있다). */
export function classifyFiles<T extends Candidate>(files: T[], limits: UploadLimits): { ok: T[]; excluded: Excluded[]; overLimit: number } {
  const exts = new Set(limits.extensions)
  const ok: T[] = []
  const excluded: Excluded[] = []
  for (const f of files) {
    if (!exts.has(extOf(f.name))) excluded.push({ name: f.name, reason: `허용하지 않는 형식 (${extOf(f.name) || '확장자 없음'})` })
    else if (f.size === 0) excluded.push({ name: f.name, reason: '빈 파일' })
    else if (f.size > limits.maxFileBytes) excluded.push({ name: f.name, reason: `파일이 너무 큼 (상한 ${fmtMB(limits.maxFileBytes)})` })
    else ok.push(f)
  }
  // 한 번에 올릴 수 있는 장수를 넘으면 앞에서부터 상한까지만 올리고 나머지는 알려 준다
  const overLimit = Math.max(0, ok.length - limits.maxBatchFiles)
  return { ok: overLimit ? ok.slice(0, limits.maxBatchFiles) : ok, excluded, overLimit }
}

export interface QueueState {
  total: number
  done: number // 성공
  failed: number // 재시도까지 모두 실패
  inFlight: number
}

export interface QueueOptions {
  concurrency?: number // 동시에 보내는 수 (기본 4)
  retries?: number // 실패 후 다시 시도 횟수 (기본 2)
  retryDelayMs?: number // 다시 시도 전 대기 (시도마다 배로 늘어난다)
  isPaused?: () => boolean // true인 동안 새 전송을 시작하지 않는다
  isCanceled?: () => boolean // true가 되면 새 전송을 시작하지 않고 끝낸다
  onProgress?: (s: QueueState) => void
  sleep?: (ms: number) => Promise<void> // 테스트용으로 바꿀 수 있다
}

export interface QueueResult extends QueueState {
  canceled: boolean
  /** 끝내 실패한 항목: 인덱스와 마지막 오류 (화면의 "실패 다시 시도"가 이 인덱스로 다시 돌린다) */
  failures: { index: number; error: string }[]
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * indexes에 있는 항목을 run(index)으로 한 장씩 전송한다. 몇 천 장도 같은 방식: 동시 전송 수만큼만 진행 중이고,
 * 실패하면 잠시 뒤 다시 시도하며, 일시 중지·취소를 새 전송을 시작하기 전에 확인한다 (진행 중인 전송은 끝까지 기다린다).
 * run이 던지는 오류의 `retryable === false`이면 다시 시도하지 않는다 (예: 권한 없음, 끝난 배치).
 */
export async function runQueue(indexes: number[], run: (index: number) => Promise<void>, opts: QueueOptions = {}): Promise<QueueResult> {
  const { concurrency = 4, retries = 2, retryDelayMs = 500, isPaused = () => false, isCanceled = () => false, onProgress, sleep = realSleep } = opts
  const state: QueueState = { total: indexes.length, done: 0, failed: 0, inFlight: 0 }
  const failures: { index: number; error: string }[] = []
  let next = 0
  const emit = () => onProgress?.({ ...state })

  const one = async (index: number) => {
    let lastError = ''
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await run(index)
        state.done++
        return
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
        if ((e as { retryable?: boolean })?.retryable === false || attempt === retries || isCanceled()) break
        await sleep(retryDelayMs * 2 ** attempt)
      }
    }
    state.failed++
    failures.push({ index, error: lastError })
  }

  const lane = async () => {
    while (next < indexes.length) {
      while (isPaused() && !isCanceled()) await sleep(200)
      if (isCanceled() || next >= indexes.length) return
      const index = indexes[next++]
      state.inFlight++
      emit()
      await one(index)
      state.inFlight--
      emit()
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, indexes.length || 1)) }, lane))
  emit()
  return { ...state, canceled: isCanceled() && state.done + state.failed < state.total, failures: failures.sort((a, b) => a.index - b.index) }
}

/** 업로드 이력의 처리 현황을 한 줄 문구로 (예: 완료 2,711 · 대기 286 · 검사 실패 3) */
export function summarizeProgress(b: { done: number; waiting: number; processing: number; failed: number; rejected: number }): string {
  const parts: string[] = []
  if (b.done) parts.push(`완료 ${b.done.toLocaleString('ko-KR')}`)
  if (b.waiting) parts.push(`수신 대기 ${b.waiting.toLocaleString('ko-KR')}`)
  if (b.processing) parts.push(`검사 중 ${b.processing.toLocaleString('ko-KR')}`)
  if (b.failed) parts.push(`검사 실패 ${b.failed.toLocaleString('ko-KR')}`)
  if (b.rejected) parts.push(`업로드 실패 ${b.rejected.toLocaleString('ko-KR')}`)
  return parts.join(' · ') || '-'
}

/** 업로드한 파일 한 개의 처리 상태 (서버 `GET /uploads/:id` 의 state) */
export type UploadFileState = 'REJECTED' | 'WAITING' | 'PROCESSING' | 'DONE' | 'FAILED'
export const UPLOAD_STATES: UploadFileState[] = ['WAITING', 'PROCESSING', 'DONE', 'FAILED', 'REJECTED']
export const UPLOAD_STATE_LABEL: Record<UploadFileState, string> = {
  WAITING: '수신 대기',
  PROCESSING: '검사 중',
  DONE: '완료',
  FAILED: '검사 실패',
  REJECTED: '업로드 실패',
}

/** 바이트를 읽기 쉽게 (1.9MB, 4.2GB) */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)}${units[i]}`
}

/** 남은 시간 문구. 아직 알 수 없으면 null */
export function fmtEta(done: number, total: number, elapsedMs: number): string | null {
  if (done < 5 || elapsedMs < 2000 || done >= total) return null
  const sec = Math.round(((total - done) * elapsedMs) / done / 1000)
  if (sec < 60) return `약 ${Math.max(sec, 1)}초 남음`
  const m = Math.round(sec / 60)
  return m < 60 ? `약 ${m}분 남음` : `약 ${Math.floor(m / 60)}시간 ${m % 60}분 남음`
}
