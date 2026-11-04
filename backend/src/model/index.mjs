// 설정(MODEL_ADAPTER)에 따라 모델 어댑터를 고른다. 새 모델은 여기에 한 줄 추가.
import { join, resolve } from 'node:path'
import { createMockAdapter } from './mock.mjs'
import { createPatchcoreAdapter } from './patchcore.mjs'

const PYTHON_DIR = resolve(import.meta.dirname, '../../../python')

/** @param name 어댑터 이름  @param opts 환경 설정 { patchcoreModelDir, pythonBin } (없으면 기본값) */
export function loadAdapter(name = 'mock', opts = {}) {
  if (name === 'mock') return createMockAdapter()
  if (name === 'patchcore') {
    const pythonBin = opts.pythonBin ?? join(PYTHON_DIR, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
    return createPatchcoreAdapter({
      modelDir: opts.patchcoreModelDir ?? join(PYTHON_DIR, 'artifacts', 'patchcore'),
      command: pythonBin,
      args: [join(PYTHON_DIR, 'serve.py')],
    })
  }
  throw new Error(`알 수 없는 MODEL_ADAPTER: ${name}`)
}
