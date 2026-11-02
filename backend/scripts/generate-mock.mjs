// 목 이미지/모델 결과 생성 스크립트 (외부 의존성 없음)
//
// 사용: node backend/scripts/generate-mock.mjs [--count 3000] [--out data/images] [--seed 2026] [--defect-ratio 0.3]
//
// 출력 (기본 data/images/, git 제외):
//   originals/img_0001.svg        가짜 "AI 생성 이미지" (원본)
//   heatmaps/img_0001.svg         가짜 히트맵
//   results.jsonl                 한 줄에 이미지 1장, 기획서 5장 JSON 계약
//
// 계약 필드(imageId, fileName, width, height, modelVersion, overallScore, heatmapUrl, boxes) 외에
// 적재 편의를 위한 선택 필드 originalPath, durationMs를 추가한다. 판정(NORMAL/SUSPECT/DEFECT)은
// 여기서 만들지 않는다 (규칙 층의 일, 임계값은 rules 테이블).
// 회사 데이터는 쓰지 않고 전부 직접 생성한 값이다.

import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values: opt } = parseArgs({
  options: {
    count: { type: 'string', default: '3000' },
    out: { type: 'string', default: 'data/images' },
    seed: { type: 'string', default: '2026' },
    'defect-ratio': { type: 'string', default: '0.3' },
    'model-version': { type: 'string', default: 'mock-v1' },
  },
})

const COUNT = Number(opt.count)
const SEED = Number(opt.seed)
const DEFECT_RATIO = Number(opt['defect-ratio'])
const MODEL_VERSION = opt['model-version']
const OUT = resolve(opt.out)

const W = 1920
const H = 1080
const REASONS = [
  'COMPOSITE_EDGE',
  'SHAPE_DISTORTION',
  'LIGHTING_MISMATCH',
  'TEXTURE_ANOMALY',
  'SCALE_ANOMALY',
  'PART_COUNT_MISMATCH',
]
const SUBJECTS = ['tank', 'howitzer', 'apc', 'truck']

// 시드 고정 난수 (mulberry32): 같은 인자면 항상 같은 결과
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

const round2 = (v) => Math.round(v * 100) / 100

function makeImageSvg(seed, label, boxes) {
  const r = rng(seed)
  const hue = 30 + Math.floor(r() * 40)
  const tx = 560 + Math.floor(r() * 300)
  const ty = 520 + Math.floor(r() * 60)
  const hills = Array.from({ length: 6 }, (_, i) => {
    const cx = i * 380 + r() * 100
    return `<ellipse cx="${cx}" cy="${560 + r() * 60}" rx="${280 + r() * 160}" ry="${60 + r() * 50}" fill="hsl(${hue + 20},25%,${28 + r() * 8}%)"/>`
  }).join('')
  const wheels = Array.from(
    { length: 7 },
    (_, i) => `<circle cx="${tx + 60 + i * 80}" cy="${ty + 250}" r="38" fill="#2b2b26" stroke="#1a1a17" stroke-width="6"/>`,
  ).join('')
  // 결함: 해당 영역에 톤이 어긋난 패치를 덧그린다 (박스 = 정답 위치)
  const defects = boxes
    .map(
      (b) =>
        `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="hsl(${(hue + 140) % 360},35%,${40 + r() * 20}%)" opacity="0.55" filter="url(#soft)"/>`,
    )
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(205,45%,${62 + r() * 10}%)"/><stop offset="1" stop-color="hsl(40,40%,82%)"/></linearGradient>
<linearGradient id="gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},30%,38%)"/><stop offset="1" stop-color="hsl(${hue},30%,22%)"/></linearGradient>
<filter id="soft"><feGaussianBlur stdDeviation="6"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
${hills}
<rect y="640" width="${W}" height="440" fill="url(#gr)"/>
<ellipse cx="${tx + 330}" cy="${ty + 290}" rx="420" ry="26" fill="#000" opacity="0.25"/>
<rect x="${tx}" y="${ty + 150}" width="660" height="130" rx="30" fill="hsl(${hue + 55},18%,30%)"/>
<rect x="${tx + 40}" y="${ty + 40}" width="580" height="130" rx="24" fill="hsl(${hue + 55},20%,38%)"/>
<rect x="${tx + 190}" y="${ty - 60}" width="250" height="110" rx="22" fill="hsl(${hue + 55},20%,42%)"/>
<rect x="${tx + 420}" y="${ty - 28}" width="400" height="26" rx="10" fill="hsl(${hue + 55},15%,26%)"/>
${wheels}
${defects}
<text x="40" y="1040" font-family="monospace" font-size="34" fill="#fff" opacity="0.55">${label}</text>
</svg>
`
}

function makeHeatmapSvg(seed, boxes) {
  const r = rng(seed + 99)
  const blobs = boxes
    .map((b) => {
      const cx = b.x + b.width / 2
      const cy = b.y + b.height / 2
      const strength = 1 - b.score // 점수가 낮을수록 진하게
      return `<ellipse cx="${cx}" cy="${cy}" rx="${b.width * 0.85}" ry="${b.height * 0.85}" fill="url(#h)" opacity="${0.55 + strength * 0.45}"/>`
    })
    .join('')
  const noise = Array.from(
    { length: 3 },
    () => `<ellipse cx="${r() * W}" cy="${r() * H}" rx="160" ry="110" fill="url(#h)" opacity="0.12"/>`,
  ).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs><radialGradient id="h"><stop offset="0" stop-color="#ff1a1a" stop-opacity="0.95"/><stop offset="0.5" stop-color="#ffb400" stop-opacity="0.6"/><stop offset="1" stop-color="#ffe600" stop-opacity="0"/></radialGradient></defs>
${noise}${blobs}</svg>
`
}

// 박스가 이미지 밖으로 나가지 않도록 보정 (원본 픽셀 기준)
function makeBox(r) {
  const width = 120 + Math.floor(r() * 220)
  const height = 90 + Math.floor(r() * 160)
  const x = 500 + Math.floor(r() * (W - 1000 - width + 400))
  const y = 380 + Math.floor(r() * (H - 380 - height - 260))
  return {
    x: Math.max(0, Math.min(x, W - width)),
    y: Math.max(0, Math.min(y, H - height)),
    width,
    height,
    score: round2(0.15 + r() * 0.6),
    reasonCode: REASONS[Math.floor(r() * REASONS.length)],
  }
}

function main() {
  const r = rng(SEED)
  mkdirSync(join(OUT, 'originals'), { recursive: true })
  mkdirSync(join(OUT, 'heatmaps'), { recursive: true })
  const jsonl = createWriteStream(join(OUT, 'results.jsonl'))

  let defects = 0
  let suspects = 0
  for (let i = 0; i < COUNT; i++) {
    const n = i + 1
    const key = `img_${String(n).padStart(4, '0')}`
    const fileName = `${SUBJECTS[i % SUBJECTS.length]}_${String(n).padStart(4, '0')}.png`

    const boxes = []
    let overall = 0.9 + r() * 0.09
    if (r() < DEFECT_RATIO) {
      const nb = 1 + Math.floor(r() * 2)
      for (let k = 0; k < nb; k++) boxes.push(makeBox(r))
      overall = Math.min(...boxes.map((b) => b.score))
      if (r() < 0.4) overall = Math.min(0.89, overall + 0.3) // 일부는 의심 구간으로
      defects++
      if (overall >= 0.5) suspects++
    }

    writeFileSync(join(OUT, 'originals', `${key}.svg`), makeImageSvg(n + SEED, fileName, boxes))
    writeFileSync(join(OUT, 'heatmaps', `${key}.svg`), makeHeatmapSvg(n + SEED, boxes))

    const result = {
      imageId: key,
      fileName,
      width: W,
      height: H,
      modelVersion: MODEL_VERSION,
      overallScore: round2(overall),
      heatmapUrl: `/heatmaps/${key}.svg`,
      boxes,
      // 적재 편의용 선택 필드 (계약 외)
      originalPath: `originals/${key}.svg`,
      durationMs: 80 + Math.floor(r() * 120),
    }
    jsonl.write(JSON.stringify(result) + '\n')
  }
  jsonl.end()
  console.log(`생성 완료: ${COUNT}장 -> ${OUT}`)
  console.log(`  박스가 있는 이미지 ${defects}장 (그중 점수 0.5 이상 의심권 ${suspects}장)`)
}

main()
