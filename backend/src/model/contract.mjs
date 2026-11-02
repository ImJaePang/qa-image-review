// 모델 출력 계약 (기획서 5장). 어떤 모델 어댑터든 이 형식으로 결과를 돌려줘야 하고,
// 워커는 DB에 넣기 전에 assertValidResult로 검사한다 (계약을 어기면 그 이미지는 실패 처리).

export const REASON_CODES = [
  'COMPOSITE_EDGE',
  'SHAPE_DISTORTION',
  'LIGHTING_MISMATCH',
  'TEXTURE_ANOMALY',
  'SCALE_ANOMALY',
  'PART_COUNT_MISMATCH',
]

const isInt = (v) => Number.isInteger(v)
const isScore = (v) => typeof v === 'number' && v >= 0 && v <= 1

/** 계약 위반 목록을 돌려준다 (비어 있으면 정상) */
export function validateResult(r) {
  const errors = []
  if (!r || typeof r !== 'object') return ['결과가 객체가 아님']

  for (const k of ['imageId', 'fileName', 'modelVersion', 'heatmapUrl']) {
    if (typeof r[k] !== 'string' || !r[k]) errors.push(`${k}: 비어 있지 않은 문자열이어야 함`)
  }
  if (!isInt(r.width) || r.width <= 0) errors.push('width: 양의 정수여야 함')
  if (!isInt(r.height) || r.height <= 0) errors.push('height: 양의 정수여야 함')
  if (!isScore(r.overallScore)) errors.push('overallScore: 0~1 숫자여야 함')
  if (r.durationMs != null && (!isInt(r.durationMs) || r.durationMs < 0)) errors.push('durationMs: 0 이상 정수여야 함')

  if (!Array.isArray(r.boxes)) {
    errors.push('boxes: 배열이어야 함')
  } else {
    r.boxes.forEach((b, i) => {
      const p = `boxes[${i}]`
      if (![b?.x, b?.y, b?.width, b?.height].every(isInt)) errors.push(`${p}: x,y,width,height는 정수(원본 픽셀)여야 함`)
      else {
        if (b.width <= 0 || b.height <= 0) errors.push(`${p}: 크기는 양수여야 함`)
        // 좌표는 원본 이미지 픽셀 기준이므로 이미지 밖으로 나가면 계약 위반
        if (b.x < 0 || b.y < 0 || b.x + b.width > r.width || b.y + b.height > r.height) errors.push(`${p}: 이미지 범위를 벗어남`)
      }
      if (!isScore(b?.score)) errors.push(`${p}.score: 0~1 숫자여야 함`)
      if (!REASON_CODES.includes(b?.reasonCode)) errors.push(`${p}.reasonCode: 알 수 없는 사유 코드 (${b?.reasonCode})`)
    })
  }
  return errors
}

export function assertValidResult(r) {
  const errors = validateResult(r)
  if (errors.length) throw new Error(`모델 출력이 계약(5장)을 어김: ${errors.join('; ')}`)
  return r
}
