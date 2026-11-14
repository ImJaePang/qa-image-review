// 대시보드 화면의 순수 계산 (단위 테스트 대상)

/** 비율(%)을 정수로. 전체가 0이면 0 */
export const percentOf = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0)

/** 진행률 표시: 하나라도 했는데 반올림하면 0%가 되는 경우는 '1% 미만'으로 (0%로 보이면 아무것도 안 한 것처럼 읽힌다) */
export function percentLabel(part: number, total: number) {
  const p = percentOf(part, total)
  return part > 0 && p === 0 ? '1% 미만' : `${p}%`
}

/** 세로 눈금의 최댓값: 값이 들어가는 가장 작은 '깔끔한' 수 (1·2·5 × 10^n). 값이 0이면 최소 4 */
export function niceMax(value: number) {
  if (value <= 4) return 4
  const pow = 10 ** Math.floor(Math.log10(value))
  for (const m of [1, 2, 5, 10]) if (value <= m * pow) return m * pow
  return 10 * pow
}

/** 눈금 값들: 0부터 max까지 같은 간격으로 count+1개 */
export const ticks = (max: number, count = 4) => Array.from({ length: count + 1 }, (_, i) => (max / count) * i)

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토']

/** '2026-11-14' → '11/14 (토)'. 날짜 문자열을 그대로 해석하므로 시간대에 흔들리지 않는다 */
export function dayLabel(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${m}/${d} (${DAY_KO[dow]})`
}

/** 막대 높이 비율(0~1). max가 0이면 0 */
export const barRatio = (value: number, max: number) => (max > 0 ? Math.min(value / max, 1) : 0)
