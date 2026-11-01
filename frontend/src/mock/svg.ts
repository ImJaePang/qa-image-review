// 목 이미지/히트맵 생성기: 외부 파일 없이 SVG data URI로 "AI 생성 이미지"와 가짜 히트맵을 만든다.
import type { Detection } from '@/lib/types'

export const W = 1920
export const H = 1080

export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const toUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

export function makeImage(seed: number, label: string, boxes: Detection[]) {
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
  // 결함: 해당 영역에 톤이 어긋난 패치를 덧그린다
  const defects = boxes
    .map(
      (b) =>
        `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="hsl(${(hue + 140) % 360},35%,${40 + r() * 20}%)" opacity="0.55" filter="url(#soft)"/>`,
    )
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
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
</svg>`
  return toUri(svg)
}

export function makeHeatmap(boxes: Detection[], seed: number) {
  const r = rng(seed + 99)
  const blobs = boxes
    .map((b) => {
      const cx = b.x + b.width / 2
      const cy = b.y + b.height / 2
      const strength = 1 - b.score // 점수가 낮을수록 진하게
      return `<ellipse cx="${cx}" cy="${cy}" rx="${b.width * 0.85}" ry="${b.height * 0.85}" fill="url(#h)" opacity="${0.55 + strength * 0.45}"/>`
    })
    .join('')
  // 정상 이미지에도 약한 배경 노이즈를 둔다
  const noise = Array.from(
    { length: 3 },
    () => `<ellipse cx="${r() * W}" cy="${r() * H}" rx="160" ry="110" fill="url(#h)" opacity="0.12"/>`,
  ).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs><radialGradient id="h"><stop offset="0" stop-color="#ff1a1a" stop-opacity="0.95"/><stop offset="0.5" stop-color="#ffb400" stop-opacity="0.6"/><stop offset="1" stop-color="#ffe600" stop-opacity="0"/></radialGradient></defs>
${noise}${blobs}</svg>`
  return toUri(svg)
}
