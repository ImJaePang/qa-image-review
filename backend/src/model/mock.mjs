// 목 모델 어댑터: 실제 추론 없이 파일 내용(sha256)으로 결정적인 가짜 결과를 만든다.
// 같은 파일이면 항상 같은 결과이므로 테스트와 재수신 시나리오에 쓸 수 있다.
//
// 어댑터 인터페이스 (실제 모델도 이 모양을 따른다):
//   adapter.modelVersion : string
//   adapter.infer({ imageKey, fileName, filePath, outputDir }) -> Promise<5장 계약 객체>
//     - 히트맵 등 산출 파일은 outputDir 아래에 쓰고, heatmapUrl은 outputDir 기준 경로로 돌려준다.
//     - 실패하면 예외를 던진다 (워커가 그 이미지를 FAILED로 기록).
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { CAUSE_CODES, assertValidResult } from './contract.mjs'

const round2 = (v) => Math.round(v * 100) / 100

// 시드 고정 난수 (mulberry32)
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** SVG는 헤더의 width/height(없으면 1920x1080), 그 밖의 형식은 실제로 디코딩해 크기를 얻는다 (박스 좌표의 기준이 되는 원본 픽셀 크기) */
async function sizeOf(buf) {
  const head = buf.subarray(0, 2048).toString('utf8')
  if (head.includes('<svg')) {
    const w = /<svg[^>]*\swidth="(\d+)"/.exec(head)?.[1]
    const h = /<svg[^>]*\sheight="(\d+)"/.exec(head)?.[1]
    return { width: w ? Number(w) : 1920, height: h ? Number(h) : 1080 }
  }
  const m = await sharp(buf).metadata() // 디코딩 불가면 예외 → 워커가 그 이미지를 FAILED로 기록
  return { width: m.width, height: m.height }
}

function heatmapSvg(width, height, boxes) {
  const blobs = boxes
    .map((b) => `<ellipse cx="${b.x + b.width / 2}" cy="${b.y + b.height / 2}" rx="${b.width * 0.85}" ry="${b.height * 0.85}" fill="url(#h)" opacity="${0.55 + (1 - b.score) * 0.45}"/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<defs><radialGradient id="h"><stop offset="0" stop-color="#ff1a1a" stop-opacity="0.95"/><stop offset="0.5" stop-color="#ffb400" stop-opacity="0.6"/><stop offset="1" stop-color="#ffe600" stop-opacity="0"/></radialGradient></defs>
${blobs}</svg>
`
}

/** @param opts.modelVersion 기록될 모델 버전  opts.defectRatio 박스가 생기는 비율 */
export function createMockAdapter({ modelVersion = 'mock-v1', defectRatio = 0.3 } = {}) {
  return {
    modelVersion,
    async infer({ imageKey, fileName, filePath, outputDir }) {
      const started = Date.now()
      const buf = await readFile(filePath)
      const hash = createHash('sha256').update(buf).digest()
      const r = rng(hash.readUInt32BE(0))
      const { width, height } = await sizeOf(buf)

      const boxes = []
      let overall = 0.9 + r() * 0.09
      if (r() < defectRatio) {
        const n = 1 + Math.floor(r() * 2)
        for (let i = 0; i < n; i++) {
          const w = Math.min(width, 120 + Math.floor(r() * 220))
          const h = Math.min(height, 90 + Math.floor(r() * 160))
          boxes.push({
            x: Math.floor(r() * (width - w)),
            y: Math.floor(r() * (height - h)),
            width: w,
            height: h,
            score: round2(0.15 + r() * 0.6),
            reasonCode: CAUSE_CODES[Math.floor(r() * CAUSE_CODES.length)],
          })
        }
        overall = Math.min(...boxes.map((b) => b.score))
        if (r() < 0.4) overall = Math.min(0.89, overall + 0.3) // 일부는 의심 구간으로
      }

      const heatmapUrl = `/heatmaps/${imageKey}.svg`
      const heatmapFile = join(outputDir, heatmapUrl)
      await mkdir(dirname(heatmapFile), { recursive: true })
      await writeFile(heatmapFile, heatmapSvg(width, height, boxes))

      return assertValidResult({
        imageId: imageKey,
        fileName,
        width,
        height,
        modelVersion,
        overallScore: round2(overall),
        heatmapUrl,
        boxes,
        durationMs: Date.now() - started,
      })
    },
  }
}
