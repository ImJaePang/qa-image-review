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
  // 이미지 업로드 한 번(배치)에 올릴 수 있는 최대 장수. 파일은 한 장씩 나눠 전송하므로 수천 장도 가능하다.
  uploadMaxBatchFiles: Number(e.UPLOAD_MAX_BATCH_FILES ?? 10000),
  // 로그인 시도 횟수 제한: 구간(windowSec) 안에 이메일당 maxFailures번 / 접속 주소당 ipMaxFailures번 실패하면 lockSec 동안 잠근다
  loginLimit: {
    maxFailures: Number(e.LOGIN_MAX_FAILURES ?? 5),
    ipMaxFailures: Number(e.LOGIN_IP_MAX_FAILURES ?? 30),
    windowSec: Number(e.LOGIN_WINDOW_SEC ?? 900),
    lockSec: Number(e.LOGIN_LOCK_SEC ?? 900),
  },
  ruleName:e.RULE_NAME ?? 'score-threshold',
  modelAdapter: e.MODEL_ADAPTER ?? 'mock',
  // MODEL_ADAPTER=patchcore일 때: 학습 결과 폴더와 파이썬 실행 파일 (없으면 python/ 아래 기본값)
  patchcoreModelDir: e.PATCHCORE_MODEL_DIR || undefined,
  pythonBin: e.PYTHON_BIN || undefined,
  db: {
    host: e.POSTGRES_HOST ?? 'localhost',
    port: Number(e.POSTGRES_PORT ?? 5432),
    user: e.POSTGRES_USER,
    password: e.POSTGRES_PASSWORD,
    database: e.POSTGRES_DB,
  },
}
