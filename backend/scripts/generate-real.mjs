// ComfyUI로 실제 원본 이미지(PNG)를 만든다. (design.md 9장 ③)
//   1) 정상 이미지: Z-Image-Turbo 텍스트→이미지
//   2) 생성 오류 이미지: 정상 이미지의 사각형 영역만 망가뜨리고, 그 사각형을 정답 박스로 기록 (6종, DEFECTS 참고)
//      인페인팅 3종은 ComfyUI 마스크 인페인팅, 합성 3종은 sharp. 박스 밖 픽셀은 정상 이미지와 동일하다.
// 사용: ComfyUI를 켠 뒤(포트 8188)  cd backend && node scripts/generate-real.mjs --count 20
// 출력: data/images/real/original/real_0001.png, base/(오류 이미지의 원래 정상본), ground_truth.jsonl
// 주의: 참고 이미지 없이 텍스트 프롬프트만 쓴다. 회사 자료·특정 실제 기종명은 넣지 않는다.
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
import sharp from 'sharp'

const { values: opt } = parseArgs({
  options: {
    count: { type: 'string', default: '20' },
    'defect-ratio': { type: 'string', default: '0.3' },
    seed: { type: 'string', default: '1000' }, // 이미지 i의 시드 = seed + i
    out: { type: 'string', default: resolve(import.meta.dirname, '../../data/images/real') },
    width: { type: 'string', default: '1344' },
    height: { type: 'string', default: '768' },
    lora: { type: 'string', default: 'Z-Image-Fun-Lora-Distill-2603_UDCAI_ComfyUI.safetensors' }, // 증류 LoRA 파일명 (예: Z-Image-Fun-Lora-Distill-2603_UDCAI_ComfyUI.safetensors)
    'lora-strength': { type: 'string', default: '1' },
    steps: { type: 'string', default: '4' },
    comfy: { type: 'string', default: process.env.COMFY_URL ?? 'http://127.0.0.1:8188' },
  },
})
const COUNT = Number(opt.count)
const DEFECT_RATIO = Number(opt['defect-ratio'])
const W = Number(opt.width)
const H = Number(opt.height)
const OUT = resolve(opt.out)
const COMFY = opt.comfy.replace(/\/$/, '')
const STEPS = Number(opt.steps)
const MODEL_TAG = 'z-image-turbo-bf16' + (opt.lora ? '+distill-lora' : '')

// ---- 프롬프트 재료 (일반 표현만) ----
const SUBJECTS = [
  'a modern main battle tank',
  'a modern armored personnel carrier',
  'a modern infantry fighting vehicle',
  'a modern self-propelled howitzer',
  'a wheeled armored vehicle',
]
const VIEWS = ['front three-quarter view', 'side view', 'rear three-quarter view', 'low angle front view', 'slightly elevated side view']
const PLACES = [
  'on a dirt training ground with distant tree line',
  'parked inside a large maintenance hangar',
  'on a gravel road beside an open field',
  'in a vehicle depot yard with concrete ground',
  'on a muddy track in light rain',
]
const LIGHTS = ['bright midday sun', 'overcast soft light', 'golden evening light', 'cloudy morning light']
const PAINTS = ['olive green paint', 'tan desert paint', 'dark green and brown camouflage paint', 'gray paint']

// 생성 오류 종류 6가지 (기획서 5장 reasonCode).
//  - inpaint: ComfyUI 마스크 인페인팅으로 영역을 망가뜨림 (프롬프트 text)
//  - composite: sharp로 직접 합성 (GPU 불필요, 정답이 확실)
const DEFECTS = [
  { code: 'TEXTURE_ANOMALY', mode: 'inpaint', text: 'a large patch of garbled melted smeared texture, noisy blotchy surface that clearly does not match the metal' },
  { code: 'SHAPE_DISTORTION', mode: 'inpaint', text: 'a strongly warped deformed melted part with bent impossible geometry' },
  { code: 'PART_COUNT_MISMATCH', mode: 'inpaint', text: 'an extra duplicated part such as a second gun barrel or extra hatch or extra road wheel in the wrong place' },
  { code: 'COMPOSITE_EDGE', mode: 'composite' }, // 다른 위치에서 잘라 낸 조각을 경계가 드러나게 붙임
  { code: 'LIGHTING_MISMATCH', mode: 'composite' }, // 영역의 밝기·색온도만 주변과 다르게
  { code: 'SCALE_ANOMALY', mode: 'composite' }, // 차량 일부를 비정상 크기로 확대해 붙임
]
const INPAINT_DENOISE = 0.95

// ---- 재현 가능한 난수 (mulberry32) ----
const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (r, a) => a[Math.floor(r() * a.length)]
const snap = (n) => Math.round(n / 8) * 8 // 잠재 공간(8px) 경계에 맞춤

// ---- ComfyUI 클라이언트 ----
const clientId = `gen-real-${process.pid}`
async function queue(workflow) {
  const res = await fetch(`${COMFY}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`ComfyUI가 워크플로우를 거부했다: ${JSON.stringify(body.node_errors ?? body.error ?? body).slice(0, 600)}`)
  return body.prompt_id
}
async function waitImage(promptId, timeoutMs = 300_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const h = (await (await fetch(`${COMFY}/history/${promptId}`)).json())[promptId]
    if (h?.status?.status_str === 'error') throw new Error(`ComfyUI 실행 오류: ${JSON.stringify(h.status.messages).slice(0, 600)}`)
    const img = h && Object.values(h.outputs ?? {}).flatMap((o) => o.images ?? [])[0]
    if (img) {
      const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type })
      return Buffer.from(await (await fetch(`${COMFY}/view?${q}`)).arrayBuffer())
    }
    await new Promise((r) => setTimeout(r, 700))
  }
  throw new Error('ComfyUI 응답 대기 시간 초과')
}
async function upload(buf, name) {
  const fd = new FormData()
  fd.append('image', new Blob([buf], { type: 'image/png' }), name)
  fd.append('overwrite', 'true')
  const res = await fetch(`${COMFY}/upload/image`, { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`업로드 실패: ${res.status}`)
  return (await res.json()).name
}

// 공통: 모델 로드 (Z-Image-Turbo 표준 구성)
const loaders = () => ({
  1: { class_type: 'UNETLoader', inputs: { unet_name: 'z_image_turbo_bf16.safetensors', weight_dtype: 'default' } },
  2: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_3_4b.safetensors', type: 'lumina2', device: 'default' } },
  3: { class_type: 'VAELoader', inputs: { vae_name: 'ae.safetensors' } },
  ...(opt.lora ? { 20: { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: opt.lora, strength_model: Number(opt['lora-strength']) } } } : {}),
  4: { class_type: 'ModelSamplingAuraFlow', inputs: { model: [opt.lora ? '20' : '1', 0], shift: 3 } },
})
const sampler = (seed, latent, denoise) => ({
  8: {
    class_type: 'KSampler',
    inputs: { model: ['4', 0], seed, steps: STEPS, cfg: 1, sampler_name: 'euler', scheduler: 'simple', positive: ['5', 0], negative: ['6', 0], latent_image: latent, denoise },
  },
})
const prompts = (text) => ({
  5: { class_type: 'CLIPTextEncode', inputs: { text, clip: ['2', 0] } },
  6: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['5', 0] } },
})

const txt2img = (text, seed) => ({
  ...loaders(),
  ...prompts(text),
  7: { class_type: 'EmptySD3LatentImage', inputs: { width: W, height: H, batch_size: 1 } },
  ...sampler(seed, ['7', 0], 1),
  9: { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
  10: { class_type: 'PreviewImage', inputs: { images: ['9', 0] } },
})

const inpaint = (text, seed, imageName, box, denoise) => ({
  ...loaders(),
  ...prompts(text),
  11: { class_type: 'LoadImage', inputs: { image: imageName } },
  12: { class_type: 'VAEEncode', inputs: { pixels: ['11', 0], vae: ['3', 0] } },
  13: { class_type: 'SolidMask', inputs: { value: 0, width: W, height: H } },
  14: { class_type: 'SolidMask', inputs: { value: 1, width: box.width, height: box.height } },
  15: { class_type: 'MaskComposite', inputs: { destination: ['13', 0], source: ['14', 0], x: box.x, y: box.y, operation: 'add' } },
  16: { class_type: 'SetLatentNoiseMask', inputs: { samples: ['12', 0], mask: ['15', 0] } },
  ...sampler(seed, ['16', 0], denoise),
  9: { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
  17: { class_type: 'ImageCompositeMasked', inputs: { destination: ['11', 0], source: ['9', 0], x: 0, y: 0, resize_source: false, mask: ['15', 0] } },
  10: { class_type: 'PreviewImage', inputs: { images: ['17', 0] } },
})

// ---- 직접 합성 (sharp) ----
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** 차량이 있을 만한 중앙 띠에서 box와 겹치지 않는 같은 크기의 조각 위치를 고른다 */
function pickSource(r, box, w, h) {
  for (let t = 0; t < 20; t++) {
    const x = Math.round(W * 0.15 + r() * (W * 0.7 - w))
    const y = Math.round(H * 0.3 + r() * (H * 0.45 - h))
    if (x >= 0 && y >= 0 && x + w <= W && y + h <= H && !overlaps({ x, y, width: w, height: h }, box)) return { x, y }
  }
  return { x: 0, y: 0 }
}

async function compositeDefect(img, code, box, r) {
  const { x, y, width, height } = box
  const crop = (left, top, w, h) => sharp(img).extract({ left, top, width: w, height: h })
  let patch
  if (code === 'COMPOSITE_EDGE') {
    const s = pickSource(r, box, width, height)
    // 조각 테두리에 밝은 윤곽을 남겨 붙인 경계가 보이게 한다
    const edge = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="none" stroke="white" stroke-opacity="0.55" stroke-width="3"/></svg>`,
    )
    patch = await sharp(await crop(s.x, s.y, width, height).toBuffer()).composite([{ input: edge }]).png().toBuffer()
  } else if (code === 'LIGHTING_MISMATCH') {
    const bright = r() < 0.5
    // 밝기는 크게, 색은 옅게: 색조를 세게 얹으면 한눈에 가짜로 보인다
    const tone = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${bright ? '#ffc880' : '#6e8cff'}" fill-opacity="0.14"/></svg>`,
    )
    patch = await sharp(await crop(x, y, width, height).modulate({ brightness: bright ? 1.45 : 0.6, saturation: 0.9 }).toBuffer())
      .composite([{ input: tone }])
      .png()
      .toBuffer()
  } else {
    // SCALE_ANOMALY: 작은 조각을 box 크기로 키워 붙인다 (디테일이 비정상적으로 커짐)
    const w = Math.round(width / 2.5)
    const h = Math.round(height / 2.5)
    const s = pickSource(r, box, w, h)
    patch = await crop(s.x, s.y, w, h).resize(width, height, { kernel: 'lanczos3' }).png().toBuffer()
  }
  return sharp(img).composite([{ input: patch, left: x, top: y }]).png().toBuffer()
}

// ---- 메인 ----
async function main() {
  try {
    await fetch(`${COMFY}/system_stats`)
  } catch {
    throw new Error(`ComfyUI에 연결할 수 없다 (${COMFY}). 먼저 켜 둘 것.`)
  }
  for (const d of ['original', 'base']) mkdirSync(join(OUT, d), { recursive: true })
  const gtPath = join(OUT, 'ground_truth.jsonl')
  if (!existsSync(gtPath)) writeFileSync(gtPath, '')
  const done = new Set(readFileSync(gtPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).imageId))

  const t0 = Date.now()
  for (let i = 1; i <= COUNT; i++) {
    const imageId = `real_${String(i).padStart(4, '0')}`
    if (done.has(imageId)) continue // 이어서 실행 가능
    const seed = Number(opt.seed) + i
    const r = rng(seed)
    const subject = pick(r, SUBJECTS)
    const prompt = `Photograph of ${subject}, ${pick(r, PAINTS)}, ${pick(r, VIEWS)}, ${pick(r, PLACES)}, ${pick(r, LIGHTS)}, realistic, sharp focus, high detail`
    const isDefect = r() < DEFECT_RATIO

    const t1 = Date.now()
    let img = await waitImage(await queue(txt2img(prompt, seed)))
    const boxes = []
    if (isDefect) {
      writeFileSync(join(OUT, 'base', `${imageId}.png`), img)
      const n = 1 + Math.floor(r() * 3) // 1~3개
      for (let k = 0; k < n; k++) {
        const d = pick(r, DEFECTS)
        let box
        for (let t = 0; t < 20; t++) {
          const width = snap(160 + r() * 240)
          const height = snap(128 + r() * 160)
          // 차량이 대개 가운데에 있으므로 박스 중심을 중앙 영역에 둔다
          const x = Math.max(0, Math.min(W - width, snap(W * 0.2 + r() * W * 0.6 - width / 2)))
          const y = Math.max(0, Math.min(H - height, snap(H * 0.38 + r() * H * 0.34 - height / 2)))
          box = { x, y, width, height }
          if (!boxes.some((b) => overlaps(b, box))) break // 정답 박스끼리 겹치지 않게
        }
        if (boxes.some((b) => overlaps(b, box))) break
        if (d.mode === 'inpaint') {
          const name = await upload(img, `${imageId}_step${k}.png`)
          img = await waitImage(await queue(inpaint(`${prompt}, with ${d.text}`, seed + 7919 * (k + 1), name, box, INPAINT_DENOISE)))
        } else {
          img = await compositeDefect(img, d.code, box, r)
        }
        boxes.push({ ...box, reasonCode: d.code })
      }
    }
    writeFileSync(join(OUT, 'original', `${imageId}.png`), img)
    appendFileSync(
      gtPath,
      JSON.stringify({ imageId, fileName: `${imageId}.png`, width: W, height: H, seed, prompt, generator: MODEL_TAG, isDefect, boxes }) + '\n',
    )
    const sec = ((Date.now() - t1) / 1000).toFixed(1)
    console.log(`[${i}/${COUNT}] ${imageId} ${isDefect ? `오류 ${boxes.length}곳 (${boxes.map((b) => b.reasonCode).join(',')})` : '정상'} ${sec}s`)
  }
  console.log(`완료: ${((Date.now() - t0) / 60000).toFixed(1)}분, 출력 ${OUT}`)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
