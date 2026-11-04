// 모델 계약(5장) 검증과 목 어댑터 동작
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateResult, assertValidResult } from '../src/model/contract.mjs'
import { createMockAdapter } from '../src/model/mock.mjs'

const valid = () => ({
  imageId: 'img_0001',
  fileName: 'tank_0001.png',
  width: 1920,
  height: 1080,
  modelVersion: 'mock-v1',
  overallScore: 0.42,
  heatmapUrl: '/heatmaps/img_0001.png',
  boxes: [{ x: 340, y: 220, width: 180, height: 120, score: 0.31, reasonCode: 'LIGHTING_MISMATCH' }],
})

test('계약 예시(기획서 5장)는 통과한다', () => {
  assert.deepEqual(validateResult(valid()), [])
})

test('계약 위반을 모두 잡는다', () => {
  const cases = [
    [(r) => delete r.modelVersion, /modelVersion/],
    [(r) => (r.overallScore = 1.2), /overallScore/],
    [(r) => (r.width = 0), /width/],
    [(r) => (r.boxes = null), /boxes/],
    [(r) => (r.boxes[0].reasonCode = 'NOT_A_REASON'), /reasonCode/],
    [(r) => (r.boxes[0].x = 1800), /범위를 벗어남/], // 1800 + 180 > 1920
    [(r) => (r.boxes[0].width = 0), /크기는 양수/],
    [(r) => (r.boxes[0].x = 10.5), /정수/], // 좌표는 원본 픽셀(정수)
    [(r) => (r.boxes[0].score = -0.1), /score/],
  ]
  for (const [mutate, pattern] of cases) {
    const r = valid()
    mutate(r)
    assert.match(validateResult(r).join(' | '), pattern)
    assert.throws(() => assertValidResult(r), /계약/)
  }
  assert.deepEqual(validateResult(null), ['결과가 객체가 아님'])
})

function tmpFile(content) {
  const dir = mkdtempSync(join(tmpdir(), 'qa-model-'))
  const filePath = join(dir, 'in.svg')
  writeFileSync(filePath, content)
  return { dir, filePath }
}

test('목 어댑터: 계약을 지키는 결과를 만들고 히트맵 파일을 쓴다', async () => {
  const { dir, filePath } = tmpFile('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect/></svg>')
  const out = mkdtempSync(join(tmpdir(), 'qa-out-'))
  const r = await createMockAdapter({ modelVersion: 'mock-x' }).infer({ imageKey: 'img_9', fileName: 'a.png', filePath, outputDir: out })
  assert.deepEqual(validateResult(r), [])
  assert.equal(r.modelVersion, 'mock-x')
  assert.equal(r.imageId, 'img_9')
  assert.deepEqual([r.width, r.height], [800, 600]) // 파일 헤더에서 읽은 원본 크기
  assert.ok(existsSync(join(out, r.heatmapUrl)))
  assert.match(readFileSync(join(out, r.heatmapUrl), 'utf8'), /<svg/)
  assert.ok(dir)
})

test('목 어댑터: 같은 내용이면 점수·박스가 같고, 내용이 다르면 달라질 수 있다', async () => {
  const out = mkdtempSync(join(tmpdir(), 'qa-out-'))
  const adapter = createMockAdapter({ defectRatio: 1 }) // 항상 박스 생성
  const run = (content) => adapter.infer({ imageKey: 'k', fileName: 'f.png', filePath: tmpFile(content).filePath, outputDir: out })
  const a1 = await run('<svg>AAA</svg>')
  const a2 = await run('<svg>AAA</svg>')
  const b = await run('<svg>BBB</svg>')
  const strip = ({ durationMs, ...rest }) => rest
  assert.deepEqual(strip(a1), strip(a2))
  assert.ok(a1.boxes.length >= 1)
  assert.notDeepEqual(strip(a1), strip(b))
})

test('목 어댑터: 읽을 수 없는 파일은 예외로 실패를 알린다', async () => {
  const out = mkdtempSync(join(tmpdir(), 'qa-out-'))
  await assert.rejects(
    createMockAdapter().infer({ imageKey: 'k', fileName: 'f.png', filePath: join(out, 'none.svg'), outputDir: out }),
    /ENOENT/,
  )
})

test('사유 코드 UNKNOWN(원인 미분류)은 계약상 유효하다 — 위치만 알려주는 모델용', () => {
  const r = valid()
  r.boxes[0].reasonCode = 'UNKNOWN'
  assert.deepEqual(validateResult(r), [])
  r.boxes[0].reasonCode = 'SOMETHING_ELSE'
  assert.match(validateResult(r).join(' | '), /알 수 없는 사유 코드/)
})
