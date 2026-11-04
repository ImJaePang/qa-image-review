# AI 생성 이미지 QA 검수 시스템

AI가 생성한 이미지를 사전 검증한 뒤, QA 담당자가 화면에서 검수(승인/반려)하는 연습용 미니 프로젝트.
기획 전문은 [docs/plan.md](docs/plan.md), **지금까지 구현된 것과 사용 방법은 [docs/guide.md](docs/guide.md)** 참고.

## 구조
```
frontend/   React + Vite + TypeScript + Tailwind + shadcn/ui (목 데이터로 동작)
backend/    (예정) Node.js + PostgreSQL
db/init/    스키마·시드 SQL (컨테이너 최초 기동 시 자동 실행)
db/migrations/  이후 변경 SQL (번호순, `npm run migrate`로 적용, 적용 이력은 schema_migrations)
docs/       기획서(plan.md), 설계·진행 기록(design.md)
```

## 실행 (프론트엔드)
```
cd frontend
npm install
npm run dev
```
데모 계정: `admin@example.com`(관리자), `qa1@example.com`(QA) / 비밀번호 `1234`

## 다음에 이어서 할 일 (여기서부터 재개)
**지금 진행 중인 큰 작업: 파일 수신 시 사전 검증.** 결정과 이유는 [docs/design.md](docs/design.md) 8장, 개념 설명은 [docs/study-notes.md](docs/study-notes.md).
요약: 폴더 감시(inbox → processing → done/failed, 파일 이동) → 별도 워커가 1장씩 순차 추론 → 판정. 사전배치(PRECHECKED) 상태는 없앴다(⑥ 완료). 같은 파일 재수신은 막지 않고 새 행으로 쌓되 `origin_image_id`로 연결.

구현 순서 (각 단계마다 테스트 통과 후 커밋, 결정과 이유는 design.md 9장):
1. [x] DB 마이그레이션 + 모델 어댑터 계약/목 구현 (3ef6f0d)
2. [x] `scanOnce`/`processOne`/`runCycle` + 워커 (`npm run worker`) (c6d3efc)
3. [x] ① 워커 단일 실행 잠금 + 시작 시 고아 파일·PROCESSING 정리
4. [x] ② 이미지 ID 기반 파일 API (`/api/images/:key/thumb|preview|original|heatmap`), 이미지 단위 권한, 보안/캐시 헤더. 기존 `/files` 제거
5. [x] ③ ComfyUI로 실제 원본 이미지 생성 스크립트 (300~500장, 정답 박스 포함). ComfyUI는 `H:\jjal\ComfyUI\ComfyUI_windows_portable` (`run_comfyui.bat`, 포트 8188), 모델은 `ComfyUI\models`
6. [x] ④ 썸네일·미리보기(webp) 생성 (비율 유지) — 추론 후 `thumb_path`/`preview_path` 채움. 이미 수신된 이미지는 `npm run make-derivatives`
7. [x] ⑤ 검수 화면: 보기 모드 토글(미리보기/원본 고정, 이웃 미리 받기) + 마지막 검수자·시각 표시 (`reviewerName`/`reviewedAt`은 API에 이미 있음)
8. [x] ⑥ PRECHECKED 제거 (마이그레이션 002, 백엔드 `TRANSITIONS`·신규 배정 `ingest_status='DONE'` 조건, 프론트 4단계, 소요 시간 화면의 사전배치 → 수신 배치, 테스트)
9. [x] ⑦ 관리자 `연계 관리` 화면 (설정 > 연계 > 연계 관리): 연계 목록·요약 건수, 추가·수정·켜기/끄기, 변경 이력, 실패 건 재시도. 마이그레이션 003, `/api/integrations`, `ingest/retry.mjs`

확정된 선택(2026-11-02): 공통 컬럼은 기존 테이블에도 소급(쌓기 전용 제외), 재수신 행은 신규 배정에서 함께 담기 허용(화면에 "재수신" 표시), 마이그레이션은 SQL 파일 순서 적용, 원본 열람 기록은 불필요.

10. [x] 규칙 관리 (`/api/rules`: 새 버전 쌓기, 미리보기, 재판정, 되돌리기, 이력. 마이그레이션 004) + 화면(설정 > 판정 > 임계값/규칙)

11. [x] 사용자 관리 1단계: 계정 상태(승인 대기/사용 중/만료/비활성)·사용기한·신청 권한. 가입은 승인 신청, 로그인 시 상태별 안내와 기한 +1년 갱신, 토큰도 매 요청 상태 확인. 마이그레이션 005 (화면 없음)

그 다음: 사용자 관리 2단계(사용자 관리 화면·만료 해제 요청)와 3단계(권한·메뉴 테이블, 메뉴 관리 화면, API 권한 검사 전환, 연구원 업로드) — 설계 9장. 실제 모델 어댑터 검토(Anomalib 후보, 라이선스 확인 먼저). 이후 계획(가입 승인·사용자/메뉴 관리·다국어)은 design.md 6장.

새 세션 시작: `README.md 읽고 이어서 해줘` 한 줄이면 된다 (CLAUDE.md가 README → design.md 순서로 읽도록 안내함).

자세한 설계와 이유는 [docs/design.md](docs/design.md) 참고.

## 진행 현황
- [x] 프론트엔드 목업: 로그인/회원가입, 레이아웃(상단·좌측·우측), 배정 리스트, 신규 배정 모달, 배정 상세(이미지 검수·이력)
- [x] DB 스키마 + `docker-compose.yml` (Postgres 16, 11개 테이블 + 뷰 2개, 기동/제약 검증 완료)
- [x] JSON → DB 적재 스크립트: `cd backend && npm install && npm run load-mock` (3천 장 적재 검증, 재실행해도 중복 없음)
- [x] 목 이미지/모델 결과 생성 스크립트: `node backend/scripts/generate-mock.mjs --count 3000` → `data/images/`(git 제외), `results.jsonl`은 5장 JSON 계약 + originalPath/durationMs
- [x] 백엔드 API (Fastify): 인증, 배정 목록/상세/신규/상태 변경/점검 내용, 이미지 페이지 조회, 검수 저장, 파일 서빙 (`cd backend && npm run dev`, 포트 3000)
- [x] 규칙 관리 API(새 버전 쌓기·미리보기·재판정·되돌리기), 썸네일 생성 (화면 포함)
- [x] 프론트를 실제 API로 교체, 3천 장 대응 (서버 페이지네이션 + 가상 스크롤 + 낙관적 업데이트). 3천 장 배정 생성→사전배치→점검→검수 흐름을 브라우저로 확인 (`captures/2026-11-02_v0.2-api-connected`)
- [x] 모니터링 페이지(소요 시간 분석): 담당자별 검수 속도, 배정별 소요, 모델 처리 시간, 수신 배치 기록 (`/monitoring/time`, 관리자 전용)
- [x] 파일 수신 사전 검증 1단계: 마이그레이션 체계(`npm run migrate`), 수신 상태 컬럼, 연계/수신 배치 테이블, 모델 어댑터 계약 검증 + 목 어댑터
- [x] 파일 수신 사전 검증 2단계: 폴더 스캔(안정 판정, 매직바이트, 해시 연결), 순차 추론, 실패 격리, 워커 (`npm run worker`)
- [x] 워커 단일 실행 잠금(advisory lock), 시작 시 고아 파일·PROCESSING 정리
- [ ] 파일 수신 사전 검증 후속 (위 구현 순서 4~9)
- [ ] (선택) 실제 모델 연동

## 전체 실행 (개발)
```
docker compose up -d                          # DB
cd backend && npm install && npm run migrate     # 스키마 변경분 적용 (이미 적용된 것은 건너뜀)
npm run load-mock                             # 최초 1회: 목 데이터 생성(generate-mock) 후 적재
npm run dev                                   # API, 포트 3000 (.env의 JWT_SECRET 필요)
npm run worker                                # (선택) 파일 수신 워커: data/images/ingest/inbox 에 이미지를 넣으면 5초 주기로 수신·추론
cd ../frontend && npm run dev                 # 화면, 포트 5173 (/api는 API_PORT(기본 3000)로 프록시)
# 윈도우가 3000을 예약해 EACCES가 나면: API_PORT=3101 을 앞에 붙여 backend/frontend를 모두 실행
```
처음이면 `npm run generate-mock`을 먼저 실행해 `data/images/`를 만든다.
엔드포인트 요약은 [docs/design.md](docs/design.md) 3-1장.

## 테스트
```
cd backend && npm test      # 백엔드 테스트 138개 (API 통합, 파일 API, 연계 관리, 규칙 관리, 사본 생성, 마이그레이션, 모델 계약·목 어댑터) (DB 컨테이너 필요, 전용 DB qa_review_test를 매번 새로 만든다)
cd frontend && npm test     # 단위 테스트 (영문 코드↔한글 매핑 등)
cd frontend && npx tsc -b   # 타입 체크
```
개발 DB(`qa_review`)는 테스트가 건드리지 않는다. 화면(브라우저) 자동 테스트는 아직 없다.

## DB 실행
```
cp .env.example .env     # 비밀번호 수정
docker compose up -d      # 최초 기동 시 db/init/*.sql 자동 적용
docker compose down -v    # 스키마를 바꿔 다시 적용할 때 (데이터 삭제)
```

## 결정 사항
- 저장소는 프론트/백엔드를 함께 두는 모노레포
- DB는 PostgreSQL (직접 운영, Docker)
- 검수 결과(`reviews`)는 별도 테이블, 쌓기만 하는 기록. 소요 시간은 서버가 저장한 시각(`decided_at`, 상태 이력)으로 계산
- 강조색은 진한 연두색
- 회사 데이터는 절대 사용하지 않음
- DB의 상태/판정 값은 영문 코드로 저장 (ASSIGNED/IN_REVIEW/REVIEWED/CONFIRMED, NORMAL/SUSPECT/DEFECT, APPROVED/REJECTED), 한글 표기는 화면에서 매핑
- `assignment_images`는 소속(+배정 시점의 AI 결과 run_id)만, 검수 결과는 `reviews`에 쌓고 최신 행이 현재 상태 (뷰 `review_current`)
- 수신 배치 기록은 `ingest_batches`, 상태 변경은 `assignment_history`에 남겨 소요 시간 분석에 사용 (`batch_jobs`는 폐기된 사전배치의 과거 기록 보존용)
