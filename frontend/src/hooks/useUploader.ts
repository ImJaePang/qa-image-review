import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import { classifyFiles, runQueue, type Excluded, type QueueState, type UploadLimits } from '@/lib/upload'

export type UploadPhase = 'idle' | 'running' | 'paused' | 'finished'

export interface UploadView {
  phase: UploadPhase
  batchId: string | null
  total: number
  progress: QueueState
  /** 서버가 받았지만 이미지가 아니거나 커서 거절한 파일 */
  rejected: { name: string; reason: string }[]
  /** 전송 오류로 끝내 못 올린 파일 (다시 시도할 수 있다) */
  failures: { index: number; name: string; error: string }[]
  canceled: boolean
  startedAt: number | null
}

const EMPTY: UploadView = { phase: 'idle', batchId: null, total: 0, progress: { total: 0, done: 0, failed: 0, inFlight: 0 }, rejected: [], failures: [], canceled: false, startedAt: null }

/**
 * 업로드 한 번(배치)을 진행하는 훅: 선택한 파일 → 배치 만들기 → 한 장씩 4개 동시 전송(재시도) → 끝내기.
 * 실패한 파일이 있으면 배치를 열어 둔 채 "다시 시도"를 기다린다(끝내기 전까지).
 */
export function useUploader(limits: UploadLimits | undefined) {
  const qc = useQueryClient()
  const [files, setFiles] = useState<File[]>([])
  const [excluded, setExcluded] = useState<Excluded[]>([])
  const [overLimit, setOverLimit] = useState(0)
  const [view, setView] = useState<UploadView>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const pausedRef = useRef(false)
  const canceledRef = useRef(false)
  const uploadFiles = useRef<File[]>([]) // 진행 중인 배치의 파일 (선택을 바꿔도 영향 없게 복사)

  /** 선택한 파일을 (기존 선택에 더해) 올릴 수 있는 것/제외할 것으로 나눈다 */
  const select = useCallback(
    (picked: File[], replace = false) => {
      if (!limits) return
      const all = replace ? picked : [...files, ...picked]
      const r = classifyFiles(all, limits)
      setFiles(r.ok)
      setExcluded(r.excluded)
      setOverLimit(r.overLimit)
    },
    [files, limits],
  )
  const clear = () => {
    setFiles([])
    setExcluded([])
    setOverLimit(0)
  }

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['uploads'] })
  }

  const runBatch = async (batchId: string, indexes: number[], prior: UploadView) => {
    const rejected = [...prior.rejected]
    const result = await runQueue(
      indexes,
      async (i) => {
        const f = uploadFiles.current[i]
        const r = await api.uploadFile(batchId, f)
        if (r.status === 'REJECTED') rejected.push({ name: f.name, reason: r.reason ?? '거절됨' })
      },
      {
        isPaused: () => pausedRef.current,
        isCanceled: () => canceledRef.current,
        onProgress: (s) =>
          setView((v) => ({ ...v, progress: { total: v.total, done: prior.progress.done + s.done, failed: s.failed, inFlight: s.inFlight }, rejected: [...rejected] })),
      },
    )
    // failures[].index는 run에 넘긴 값, 즉 파일 번호다 (다시 시도할 때 그대로 쓴다)
    const fixed = result.failures.map((f) => ({ index: f.index, name: uploadFiles.current[f.index]?.name ?? '?', error: f.error }))
    const progress = { total: prior.total, done: prior.progress.done + result.done, failed: result.failed, inFlight: 0 }
    const next: UploadView = { ...prior, progress, rejected, failures: fixed, canceled: result.canceled, phase: 'finished' }
    // 실패가 없거나 취소하면 배치를 끝낸다. 실패가 남았으면 열어 둬서 다시 시도할 수 있게 한다.
    if (!fixed.length || result.canceled) {
      await api.completeUpload(batchId, result.canceled).catch(() => {})
    }
    setView(next)
    refresh()
  }

  const start = async (memo?: string) => {
    if (!files.length || view.phase === 'running') return
    setError(null)
    pausedRef.current = false
    canceledRef.current = false
    uploadFiles.current = files
    try {
      const { batch } = await api.createUpload(files.length, memo)
      const initial: UploadView = { ...EMPTY, phase: 'running', batchId: batch.id, total: files.length, progress: { total: files.length, done: 0, failed: 0, inFlight: 0 }, startedAt: Date.now() }
      setView(initial)
      clear()
      refresh()
      await runBatch(batch.id, files.map((_, i) => i), initial)
    } catch (e) {
      setError((e as Error).message)
      setView(EMPTY)
    }
  }

  /** 전송 오류로 못 올린 파일만 같은 배치에 다시 올린다 */
  const retryFailed = async () => {
    if (!view.batchId || !view.failures.length) return
    canceledRef.current = false
    pausedRef.current = false
    const idx = view.failures.map((f) => f.index)
    const prior: UploadView = { ...view, phase: 'running', failures: [], progress: { ...view.progress, failed: 0 } }
    setView(prior)
    await runBatch(view.batchId, idx, prior)
  }

  /** 실패가 남은 채로 업로드를 끝낸다 (더 올리지 않음) */
  const finish = async () => {
    if (view.batchId) await api.completeUpload(view.batchId).catch(() => {})
    setView(EMPTY)
    refresh()
  }
  const reset = () => setView(EMPTY)
  const pause = () => {
    pausedRef.current = true
    setView((v) => (v.phase === 'running' ? { ...v, phase: 'paused' } : v))
  }
  const resume = () => {
    pausedRef.current = false
    setView((v) => (v.phase === 'paused' ? { ...v, phase: 'running' } : v))
  }
  const cancel = () => {
    canceledRef.current = true
    pausedRef.current = false
  }

  // 올리는 중에 창을 닫으면 남은 파일이 올라가지 않는다고 브라우저가 확인한다
  useEffect(() => {
    if (view.phase !== 'running' && view.phase !== 'paused') return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [view.phase])

  return { files, excluded, overLimit, view, error, select, clear, start, retryFailed, finish, reset, pause, resume, cancel }
}

/** 끌어다 놓은 항목(파일·폴더)에서 파일을 모두 모은다. 폴더는 안쪽까지 훑는다. */
export async function filesFromDrop(items: DataTransferItemList): Promise<File[]> {
  const out: File[] = []
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)))
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      // readEntries는 한 번에 100개까지만 주므로 빈 결과가 나올 때까지 반복한다
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
        if (!batch.length) break
        for (const e of batch) await walk(e)
      }
    }
  }
  const entries = [...items].filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e)
  for (const e of entries) await walk(e)
  return out
}
