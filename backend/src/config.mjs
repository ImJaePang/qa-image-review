import { resolve } from 'node:path'

const e = process.env
if (!e.JWT_SECRET || e.JWT_SECRET.length < 16) throw new Error('JWT_SECRET이 없거나 너무 짧습니다 (.env 확인)')

export const config = {
  port: Number(e.API_PORT ?? 3000),
  jwtSecret: e.JWT_SECRET,
  isProd: e.NODE_ENV === 'production',
  // 듣는 주소: 로컬 개발은 127.0.0.1(기본), 컨테이너 안에서는 HOST=0.0.0.0
  host: e.HOST ?? '127.0.0.1',
  // 리버스 프록시(nginx, 호스팅 서비스) 뒤에서만 true: 접속 주소를 X-Forwarded-For에서 읽는다 (로그인 잠금이 주소별로 정확히 동작).
  // 프록시 없이 true로 두면 요청자가 주소를 위조해 잠금을 피할 수 있으므로 기본은 false.
  trustProxy: e.TRUST_PROXY === 'true',
  // 로그인 쿠키의 Secure 속성: 기본은 운영(production)에서 켠다. HTTPS 없이 로컬에서 운영 모드를 시험할 때만 COOKIE_SECURE=false
  cookieSecure: e.COOKIE_SECURE === undefined ? e.NODE_ENV === 'production' : e.COOKIE_SECURE === 'true',
  // 빌드한 화면(frontend/dist) 위치. 지정하면 API 서버가 화면도 함께 내려준다 (단일 컨테이너 배포용). 비우면 API만.
  frontendDist: e.FRONTEND_DIST ? resolve(e.FRONTEND_DIST) : undefined,
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
  // 메일: off(기본, 발송 안 함) / log(개발용, 서버 로그에 출력) / smtp(실제 발송). 운영(production)에서는 log를 쓸 수 없다.
  mail: {
    mode: e.MAIL_MODE ?? 'off',
    from: e.MAIL_FROM ?? 'QA 검수 시스템 <no-reply@localhost>',
    smtp: { host: e.SMTP_HOST, port: Number(e.SMTP_PORT ?? 587), secure: e.SMTP_SECURE === 'true', user: e.SMTP_USER, pass: e.SMTP_PASS },
  },
  ruleName: e.RULE_NAME ?? 'score-threshold',
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
