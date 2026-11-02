import { copyFile, mkdir, rename, unlink } from 'node:fs/promises'
import { dirname, relative, sep } from 'node:path'

/** 파일 이동. 다른 드라이브면 rename이 실패하므로 복사 후 삭제로 대체한다. */
export async function moveFile(from, to) {
  await mkdir(dirname(to), { recursive: true })
  try {
    await rename(from, to)
  } catch (err) {
    if (err.code !== 'EXDEV') throw err
    await copyFile(from, to)
    await unlink(from)
  }
}

/** DB에 저장하는 경로: filesDir 기준 상대 경로, 구분자는 항상 / */
export const toStoredPath = (filesDir, abs) => relative(filesDir, abs).split(sep).join('/')
