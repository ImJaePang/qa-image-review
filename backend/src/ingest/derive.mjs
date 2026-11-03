// 썸네일·미리보기(webp) 생성 (design.md 9장 ④).
//  - 비율 유지(fit: inside)와 확대 금지: 박스 좌표는 원본 픽셀 기준이라 잘라내거나 여백을 넣으면 오버레이가 어긋난다.
//    화면은 원본 크기(width/height)를 기준으로 박스를 그리므로, 사본은 같은 비율이면 된다.
//  - EXIF 회전은 적용한다(rotate). 원본은 건드리지 않는다.
//  - 사본 생성 실패는 수신 실패가 아니다: 경로를 비워 두면 파일 API가 원본으로 대신 내려준다.
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { toStoredPath } from './fsutil.mjs'

// 크기·품질은 기획서 10장 질문(포맷·변환 정책)이 확정되기 전의 잠정값
export const DERIVE = {
  thumb: { size: 320, quality: 70 },
  preview: { size: 2560, quality: 82 },
}

const dirOf = (filesDir, kind) => join(filesDir, 'derived', kind)

/**
 * @returns {Promise<{thumbPath: string, previewPath: string} | null>} filesDir 기준 상대 경로. 실패하면 null(만든 파일은 지운다)
 */
export async function makeDerivatives({ srcAbs, filesDir, imageKey }) {
  const out = {}
  try {
    for (const kind of ['thumb', 'preview']) {
      const dir = dirOf(filesDir, kind)
      await mkdir(dir, { recursive: true })
      const dest = join(dir, `${imageKey}.webp`)
      const { size, quality } = DERIVE[kind]
      await sharp(srcAbs)
        .rotate()
        .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toFile(dest)
      out[`${kind}Path`] = toStoredPath(filesDir, dest)
    }
    return out
  } catch {
    await removeDerivatives({ filesDir, imageKey })
    return null
  }
}

export async function removeDerivatives({ filesDir, imageKey }) {
  for (const kind of ['thumb', 'preview']) await rm(join(dirOf(filesDir, kind), `${imageKey}.webp`), { force: true })
}
