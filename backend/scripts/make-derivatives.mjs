// 이미 수신된(DONE) 이미지 중 사본(thumb/preview)이 없는 것에 사본을 만든다. (design.md 9장 ④)
// 사용: npm run make-derivatives   (DB 컨테이너 필요)  옵션: --limit 1000 --force(사본이 있어도 다시 만듦)
// 여러 번 실행해도 안전하다: 사본이 없는 건만 처리하고, 만들지 못한 건은 NULL로 남아 원본으로 대체 서빙된다.
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import pg from 'pg'
import { config } from '../src/config.mjs'
import { makeDerivatives } from '../src/ingest/derive.mjs'
import { safeResolve } from '../src/routes/files.mjs'

const { values: opt } = parseArgs({ options: { limit: { type: 'string', default: '100000' }, force: { type: 'boolean', default: false } } })
const client = new pg.Client(config.db)
await client.connect()

const { rows } = await client.query(
  `SELECT id, image_key, original_path FROM images
    WHERE ingest_status = 'DONE' AND ($2::boolean OR thumb_path IS NULL OR preview_path IS NULL)
    ORDER BY id LIMIT $1`,
  [Number(opt.limit), opt.force],
)
console.log(`대상 ${rows.length}장`)

let ok = 0
let failed = 0
const t0 = Date.now()
for (const r of rows) {
  const srcAbs = safeResolve(config.filesDir, r.original_path)
  const d = srcAbs && (await makeDerivatives({ srcAbs, filesDir: config.filesDir, imageKey: r.image_key }))
  if (!d) {
    failed++
    console.warn(`실패: ${r.image_key} (${r.original_path})`)
    continue
  }
  await client.query('UPDATE images SET thumb_path = $2, preview_path = $3 WHERE id = $1', [r.id, d.thumbPath, d.previewPath])
  if (++ok % 500 === 0) console.log(`  ${ok}/${rows.length}`)
}
console.log(`완료: 성공 ${ok}, 실패 ${failed}, ${((Date.now() - t0) / 1000).toFixed(1)}초 (${resolve(config.filesDir, 'derived')})`)
await client.end()
