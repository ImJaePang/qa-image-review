// FOLDER 연계 설정을 검증하고 절대 경로로 풀어 준다.
// 보안: 모든 폴더는 허용 루트(INGEST_ROOT) 하위여야 한다. 절대 경로, '..' 이탈은 거부.
import { isAbsolute, relative, resolve } from 'node:path'

export const DEFAULT_FOLDER_CONFIG = {
  watchDir: 'inbox',
  processingDir: 'processing', // 수신되어 처리 대기·처리 중인 파일
  doneDir: 'done',
  failedDir: 'failed',
  extensions: ['.png', '.jpg', '.jpeg', '.webp', '.svg'],
  maxFileMB: 50,
  scanIntervalSec: 5,
}

const DIR_KEYS = ['watchDir', 'processingDir', 'doneDir', 'failedDir']

export function resolveFolderConfig(config, root) {
  const c = { ...DEFAULT_FOLDER_CONFIG, ...(config ?? {}) }
  const rootAbs = resolve(root)

  const dirs = {}
  for (const k of DIR_KEYS) {
    const v = c[k]
    if (typeof v !== 'string' || !v.trim()) throw new Error(`${k}: 폴더 이름이 필요합니다`)
    if (isAbsolute(v)) throw new Error(`${k}: 절대 경로는 쓸 수 없습니다 (허용 루트 기준 상대 경로)`)
    const abs = resolve(rootAbs, v)
    const rel = relative(rootAbs, abs)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`${k}: 허용 루트 밖이거나 루트 자체입니다`)
    dirs[k] = abs
  }
  if (new Set(Object.values(dirs)).size !== DIR_KEYS.length) throw new Error('감시/처리중/완료/실패 폴더는 서로 달라야 합니다')

  if (!Array.isArray(c.extensions) || !c.extensions.length || !c.extensions.every((e) => /^\.[a-z0-9]+$/i.test(e)))
    throw new Error('extensions: ".png" 같은 확장자 배열이 필요합니다')
  if (!(Number(c.maxFileMB) > 0)) throw new Error('maxFileMB: 0보다 커야 합니다')
  if (!(Number(c.scanIntervalSec) >= 1)) throw new Error('scanIntervalSec: 1 이상이어야 합니다')

  return {
    ...dirs,
    extensions: new Set(c.extensions.map((e) => e.toLowerCase())),
    maxBytes: Math.floor(Number(c.maxFileMB) * 1024 * 1024),
    scanIntervalSec: Number(c.scanIntervalSec),
  }
}
