/** 초 → 사람이 읽는 시간. null/undefined는 '-' */
export function fmtDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '-'
  const s = Math.round(seconds)
  if (seconds < 10) return `${Math.round(seconds * 10) / 10}초`
  if (s < 60) return `${s}초`
  if (s < 3600) {
    const m = Math.floor(s / 60)
    const r = s % 60
    return r ? `${m}분 ${r}초` : `${m}분`
  }
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return m ? `${h}시간 ${m}분` : `${h}시간`
}

/** 밀리초 → '120ms' / '1.5초' */
export function fmtMs(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return '-'
  return ms >= 1000 ? `${Math.round(ms / 100) / 10}초` : `${Math.round(ms)}ms`
}
