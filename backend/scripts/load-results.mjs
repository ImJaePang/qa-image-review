// results.jsonl(5장 JSON 계약) -> images, model_runs, detections, verdicts 적재
// 사용: npm run load-mock   (루트 .env의 POSTGRES_* 사용, DB 컨테이너가 떠 있어야 함)
//   옵션: --dir data/images  --rule score-threshold  --batch 500
// 이미 있는 image_key는 건너뛴다 (여러 번 실행해도 중복 적재되지 않음).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import pg from 'pg'
import { judge, reasonsOf } from '../src/rules.mjs'

const { values: opt } = parseArgs({
  options: {
    dir: { type: 'string', default: '../data/images' },
    rule: { type: 'string', default: 'score-threshold' },
    batch: { type: 'string', default: '500' },
  },
})
const BATCH = Number(opt.batch)
const dir = resolve(opt.dir)

const rows = readFileSync(resolve(dir, 'results.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))

const e = process.env
const client = new pg.Client({
  host: e.POSTGRES_HOST ?? 'localhost',
  port: Number(e.POSTGRES_PORT ?? 5432),
  user: e.POSTGRES_USER,
  password: e.POSTGRES_PASSWORD,
  database: e.POSTGRES_DB,
})

// 여러 행을 한 번에 넣기 위한 VALUES 플레이스홀더 생성
function values(data, cols) {
  const params = []
  const text = data
    .map((row) => '(' + cols.map((_, i) => `$${params.push(row[i])}`).join(',') + ')')
    .join(',')
  return { text, params }
}

await client.connect()
try {
  await client.query('BEGIN')

  const ruleRes = await client.query(
    'SELECT id, version, params FROM rules WHERE name = $1 AND enabled ORDER BY version DESC LIMIT 1',
    [opt.rule],
  )
  if (!ruleRes.rowCount) throw new Error(`활성 규칙 없음: ${opt.rule}`)
  const rule = ruleRes.rows[0]
  console.log(`규칙: ${opt.rule} v${rule.version} ${JSON.stringify(rule.params)}`)

  const existing = new Set((await client.query('SELECT image_key FROM images')).rows.map((r) => r.image_key))
  const todo = rows.filter((r) => !existing.has(r.imageId))
  console.log(`전체 ${rows.length}장, 신규 ${todo.length}장, 건너뜀 ${rows.length - todo.length}장`)

  const stat = { NORMAL: 0, SUSPECT: 0, DEFECT: 0 }
  let boxCount = 0
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH)

    const img = values(
      chunk.map((r) => [r.imageId, r.fileName, r.width, r.height, r.originalPath]),
      ['k', 'f', 'w', 'h', 'p'],
    )
    const imgIds = (
      await client.query(
        `INSERT INTO images (image_key, file_name, width, height, original_path) VALUES ${img.text} RETURNING id, image_key`,
        img.params,
      )
    ).rows
    const idByKey = new Map(imgIds.map((r) => [r.image_key, r.id]))

    const run = values(
      chunk.map((r) => [idByKey.get(r.imageId), r.modelVersion, r.overallScore, r.heatmapUrl, r.durationMs ?? null]),
      [1, 2, 3, 4, 5],
    )
    const runRows = (
      await client.query(
        `INSERT INTO model_runs (image_id, model_version, overall_score, heatmap_path, duration_ms) VALUES ${run.text} RETURNING id, image_id`,
        run.params,
      )
    ).rows
    const runByImage = new Map(runRows.map((r) => [r.image_id, r.id]))

    const det = []
    const ver = []
    for (const r of chunk) {
      const runId = runByImage.get(idByKey.get(r.imageId))
      for (const b of r.boxes) det.push([runId, b.x, b.y, b.width, b.height, b.score, b.reasonCode])
      const result = judge(r.overallScore, rule.params)
      stat[result]++
      ver.push([runId, rule.id, result, JSON.stringify(reasonsOf(r.boxes))])
    }
    if (det.length) {
      const d = values(det, [1, 2, 3, 4, 5, 6, 7])
      await client.query(
        `INSERT INTO detections (run_id, x, y, width, height, score, reason_code) VALUES ${d.text}`,
        d.params,
      )
    }
    const v = values(ver, [1, 2, 3, 4])
    await client.query(`INSERT INTO verdicts (run_id, rule_id, result, reasons) VALUES ${v.text}`, v.params)
    boxCount += det.length
    console.log(`  ${Math.min(i + BATCH, todo.length)} / ${todo.length}`)
  }

  await client.query('COMMIT')
  console.log(`적재 완료: 박스 ${boxCount}개, 판정 정상 ${stat.NORMAL} / 의심 ${stat.SUSPECT} / 불량 ${stat.DEFECT}`)
} catch (err) {
  await client.query('ROLLBACK')
  console.error('실패, 롤백함:', err.message)
  process.exitCode = 1
} finally {
  await client.end()
}
