// 연계 관리 화면용 순수 함수 (화면과 분리해 단위 테스트한다)
import type { IntegrationHistoryItem } from '@/api'

export const FIELD_LABEL: Record<string, string> = {
  name: '이름',
  watchDir: '감시 폴더',
  processingDir: '처리 중 폴더',
  doneDir: '완료 폴더',
  failedDir: '실패 폴더',
  extensions: '파일 확장자',
  maxFileMB: '파일 크기 상한(MB)',
  scanIntervalSec: '스캔 주기(초)',
}
const show = (v: unknown) => (Array.isArray(v) ? v.join(' ') : String(v))

/** 이력 한 건을 사람이 읽는 줄로 바꾼다 */
export function describeHistory(h: Pick<IntegrationHistoryItem, 'action' | 'changes'>): string[] {
  switch (h.action) {
    case 'CREATE':
      return ['연계를 추가했습니다']
    case 'ENABLE':
      return ['사용을 켰습니다']
    case 'DISABLE':
      return ['사용을 껐습니다']
    case 'RETRY':
      return [`실패 ${h.changes.retried}건을 다시 처리하도록 되돌렸습니다`]
    case 'UPDATE': {
      const lines: string[] = []
      if (h.changes.name) lines.push(`${FIELD_LABEL.name}: ${h.changes.name.from} → ${h.changes.name.to}`)
      for (const [k, v] of Object.entries(h.changes.config ?? {}) as [string, { from: unknown; to: unknown }][])
        lines.push(`${FIELD_LABEL[k] ?? k}: ${show(v.from)} → ${show(v.to)}`)
      return lines
    }
  }
}

/** "png jpg, .WEBP" → ['.png', '.jpg', '.webp'] (공백·쉼표 구분, 점이 없으면 붙인다, 소문자) */
export function parseExtensions(s: string): string[] {
  return s
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((e) => (e.startsWith('.') ? e : `.${e}`).toLowerCase())
}
