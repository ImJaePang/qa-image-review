// 테스트 공통 준비: 개발 DB와 분리된 테스트 전용 DB를 만들고 작은 데이터를 채운다.
// 이 파일을 import하는 순간 환경변수를 테스트용으로 바꾸므로, 앱 코드는 반드시 이 뒤에 import한다.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import pg from 'pg'

const TEST_DB = 'qa_review_test'
process.env.POSTGRES_DB = TEST_DB
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret'
const filesDir = mkdtempSync(join(tmpdir(), 'qa-files-'))
process.env.FILES_DIR = filesDir

const conn = {
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
}

// 점수별 이미지 12장: 정상 6 / 의심 3 / 불량 3 (규칙 v1: 0.9 / 0.5)
export const FIXTURE_SCORES = [0.95, 0.93, 0.92, 0.91, 0.99, 0.97, 0.8, 0.7, 0.6, 0.4, 0.3, 0.2]

/** 테스트 DB를 새로 만들고 스키마·시드·샘플 데이터를 넣는다. 개발 DB는 건드리지 않는다. */
export async function resetTestDb() {
  const admin = new pg.Client({ ...conn, database: 'postgres' })
  await admin.connect()
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`)
  await admin.query(`CREATE DATABASE ${TEST_DB}`)
  await admin.end()

  const db = new pg.Client({ ...conn, database: TEST_DB })
  await db.connect()
  const initDir = resolve(import.meta.dirname, '../../db/init')
  for (const f of ['01_schema.sql', '02_seed.sql']) await db.query(readFileSync(join(initDir, f), 'utf8'))

  for (const [i, score] of FIXTURE_SCORES.entries()) {
    const key = `img_${String(i + 1).padStart(4, '0')}`
    const img = await db.query(
      `INSERT INTO images (image_key, file_name, width, height, original_path) VALUES ($1, $2, 1920, 1080, $3) RETURNING id`,
      [key, `tank_${i + 1}.png`, `originals/${key}.svg`],
    )
    const run = await db.query(
      `INSERT INTO model_runs (image_id, model_version, overall_score, heatmap_path, duration_ms)
       VALUES ($1, 'test-v1', $2, $3, 100) RETURNING id`,
      [img.rows[0].id, score, `/heatmaps/${key}.svg`],
    )
    if (score < 0.9) {
      await db.query(
        `INSERT INTO detections (run_id, x, y, width, height, score, reason_code) VALUES ($1, 100, 100, 50, 50, $2, 'TEXTURE_ANOMALY')`,
        [run.rows[0].id, score],
      )
    }
    const result = score >= 0.9 ? 'NORMAL' : score >= 0.5 ? 'SUSPECT' : 'DEFECT'
    await db.query(`INSERT INTO verdicts (run_id, rule_id, result, reasons) VALUES ($1, 1, $2, '[]')`, [run.rows[0].id, result])
  }
  await db.end()

  // 파일 서빙 테스트용
  mkdirSync(join(filesDir, 'originals'))
  writeFileSync(join(filesDir, 'originals', 'img_0001.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
}

export async function startApp() {
  const { buildApp } = await import('../src/app.mjs')
  const app = await buildApp()
  await app.ready()
  return app
}

/** 로그인하고 이후 요청에 붙일 쿠키 헤더를 돌려준다 */
export async function loginAs(app, email, password = '1234') {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })
  const token = res.cookies.find((c) => c.name === 'token')?.value
  return { res, headers: token ? { cookie: `token=${token}` } : {} }
}

export const call = async (app, method, url, headers, payload) => {
  const res = await app.inject({ method, url, headers: headers ?? {}, payload })
  let body = null
  try {
    body = res.body ? JSON.parse(res.body) : null
  } catch {
    body = res.body
  }
  return { status: res.statusCode, body }
}
