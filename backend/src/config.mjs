import { resolve } from 'node:path'

const e = process.env
if (!e.JWT_SECRET || e.JWT_SECRET.length < 16) throw new Error('JWT_SECRET이 없거나 너무 짧습니다 (.env 확인)')

export const config = {
  port: Number(e.API_PORT ?? 3000),
  jwtSecret: e.JWT_SECRET,
  isProd: e.NODE_ENV === 'production',
  // 이미지/히트맵 파일 위치 (generate-mock.mjs 출력 폴더)
  filesDir: resolve(e.FILES_DIR ?? resolve(import.meta.dirname, '../../data/images')),
  db: {
    host: e.POSTGRES_HOST ?? 'localhost',
    port: Number(e.POSTGRES_PORT ?? 5432),
    user: e.POSTGRES_USER,
    password: e.POSTGRES_PASSWORD,
    database: e.POSTGRES_DB,
  },
}
