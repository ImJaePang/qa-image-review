import { resolve } from 'node:path'

const e = process.env
if (!e.JWT_SECRET || e.JWT_SECRET.length < 16) throw new Error('JWT_SECRET이 없거나 너무 짧습니다 (.env 확인)')

export const config = {
  port: Number(e.API_PORT ?? 3000),
  jwtSecret: e.JWT_SECRET,
  isProd: e.NODE_ENV === 'production',
  // 이미지/히트맵 파일 위치 (generate-mock.mjs 출력 폴더)
  filesDir: resolve(e.FILES_DIR ?? resolve(import.meta.dirname, '../../data/images')),
  // 파일 수신 연계의 허용 루트: 연계가 쓰는 폴더는 모두 이 아래여야 한다. 완료 파일을 파일 API(/api/images/:key/...)로 서빙하려면 filesDir 아래에 둔다.
  ingestRoot: resolve(e.INGEST_ROOT ?? resolve(e.FILES_DIR ?? resolve(import.meta.dirname, '../../data/images'), 'ingest')),
  ruleName: e.RULE_NAME ?? 'score-threshold',
  modelAdapter: e.MODEL_ADAPTER ?? 'mock',
  db: {
    host: e.POSTGRES_HOST ?? 'localhost',
    port: Number(e.POSTGRES_PORT ?? 5432),
    user: e.POSTGRES_USER,
    password: e.POSTGRES_PASSWORD,
    database: e.POSTGRES_DB,
  },
}
