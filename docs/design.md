# 설계·진행 기록

기획서(`plan.md`) 이후 대화에서 정해진 사항과 현재 구현 상태를 정리한 문서. 새 작업을 시작할 때 먼저 읽는다.
마지막 갱신: 2026-11-02

## 1. 현재 구현 상태

| 영역 | 상태 | 비고 |
|---|---|---|
| 프론트엔드 | 실제 API 연동 완료 | `src/mock` 제거. 3천 장 배정 흐름을 브라우저로 확인 |
| DB | 스키마 완료 | Postgres 16 + Docker, 기동/제약 검증 완료. 데이터는 시드(계정, 규칙)뿐 |
| 백엔드 | API 완료 | Fastify 5 + pg |
| 목 이미지/모델 결과 생성 | 완료 | `backend/scripts/generate-mock.mjs`. 시드 고정, 3천 장 약 1초, 20MB |
| DB 적재 | 완료 | `backend/scripts/load-results.mjs`. rules 테이블의 활성 최신 규칙으로 판정하고 `rule_id` 기록. 이미 있는 image_key는 건너뜀(멱등), 전체 한 트랜잭션. 3천 장: 정상 2081 / 의심 471 / 불량 448 |

## 2. 프론트엔드 (`frontend/`)

### 스택
Vite 8 + React 19 + TypeScript(7) + Tailwind v4 + shadcn/ui(Base UI 기반) + React Router + Zustand + TanStack Query.
경로 별칭 `@` → `src`. 강조색은 진한 연두(`index.css`의 `--primary`, 라이트 `oklch(0.58 0.19 135)` / 다크 `oklch(0.76 0.2 135)`).

### 화면 구성
- 로그인 전: `/login`, `/signup`. 미로그인 접근 시 로그인으로 이동.
- 로그인 후 레이아웃: 상단(로고, 상위메뉴, 사용자/역할, 다크모드 전환, 로그아웃) / 좌측(선택한 상위메뉴의 중메뉴·소메뉴) / 우측(소메뉴 화면).
- 메뉴는 `src/config/menu.ts` 한 곳에서 관리 (상위 → 중 → 소). 구현된 화면은 `/review/assignments`뿐이고 나머지는 `Placeholder`.
- 배정 리스트: 상태 요약 카드, 검색, 상태 필터, 페이지네이션. 행 클릭 → 상세 모달(`?id=` 쿼리로 열림).
- 신규 배정 모달(관리자만): 배정명, 담당자, 마감일, 대상 AI 판정, 이미지 수 → 미배정 이미지 자동 선택.
- 상세 모달 탭: 개요 / 이미지 검수 / 점검 내용·이력.
  - 이미지 검수: 점수 낮은 순 목록, 박스·히트맵 오버레이(둘 다/히트맵/박스/끄기, 투명도), 사유 코드 뱃지, 승인/반려, 단축키 `←` `→` `A` `R` `H`.
  - 모달 vs 탭은 모달 안 탭으로 결정. 수천 장 연속 검수 시에는 전용 페이지(`/review/assignments/:id`)로 옮기는 안을 보류 중 (컴포넌트 그대로 이동 가능).

### 상태 흐름과 권한
배정 → 사전배치 → 점검중 → 점검완료 → 확인완료

| 현재 상태 | 다음 단계 버튼 | 가능한 사람 |
|---|---|---|
| 배정 | 사전배치 실행 | 관리자 |
| 사전배치 | 점검 시작 | 담당자, 관리자 |
| 점검중 | 점검 완료 (미검토 이미지가 남으면 거부) | 담당자, 관리자 |
| 점검완료 | 확인 완료 | 관리자 |

이미지 검수(승인/반려)는 `점검중` 상태에서 담당자(또는 관리자)만 가능.

### API 연동 구조
- `src/api/client.ts`: fetch 래퍼(같은 출처 `/api`, 쿠키 세션, 에러는 `{message}` → `ApiError`). 401을 받으면 인증 스토어가 로그아웃 상태로 전환.
- `src/api/mappers.ts`: 서버 영문 코드 ↔ 화면 한글 값 변환 한 곳. 화면 코드는 한글 값만 다룬다.
- `src/api/index.ts`: `api` 객체(함수 시그니처는 Promise 기반). 개발 중 Vite가 `/api`를 백엔드(3000)로 프록시.
- `src/stores/auth.ts`: 서버 세션(httpOnly 쿠키) 기반. 앱 시작 시 `/auth/me`로 확인(`ready`). 비밀번호나 계정을 브라우저에 저장하지 않는다.
- 회원가입 화면의 역할 선택은 제거했다 (서버가 항상 `qa`로 만든다).
- `src/lib/domain.ts`: 사유 코드 한글 라벨. 판정은 서버가 `rules` 기준으로 내려준다.
- 이미지 검수 패널: 전체 장수만큼 가상 행을 잡고(`@tanstack/react-virtual`), 보이는 행·현재 이미지가 속한 50장 단위 페이지만 `useQueries`로 불러온다(3천 장에서 DOM 행 약 20~30개). 열 때 첫 미검토로 이동하고, 승인/반려 뒤에는 바로 다음이 미검토면 그대로 이동, 아니면 서버에 다음 미검토 위치를 묻는다. 승인/반려는 낙관적 업데이트 후 실패하면 되돌림.

### 알려진 한계
- 이미지 검수 도구 모음이 좁은 화면에서 두 줄로 내려간다.
- 검수 완료 여부는 서버가 최종 판단하지만, 점검 완료 버튼의 사전 안내는 화면의 건수 기준이다.
- 목록은 썸네일 생성 전이라 원본 SVG를 그대로 쓴다.
- 서버 에러 메시지가 한글 문장이다 (다국어 시 에러 코드 방식으로 변경 필요, 6장).

### 테스트 현황
- 백엔드: `backend/test/api.test.mjs`(인증, 배정 생성~확인 완료 흐름, 권한, 검수 번복, 다음 미검토, 파일 접근), `monitoring.test.mjs`(시각을 직접 넣어 소요 시간 계산 검증: 자리 비움 제외, 담당자 간 간섭 없음, 기준 변경, null 처리, p95), `rules.test.mjs`(판정 경계값). 41개.
- 프론트: `src/api/mappers.test.ts`, `src/lib/format.test.ts`(시간 표기). 10개. 서버 코드와 화면 값이 어긋나면 먼저 깨지게 하는 용도.
- 없는 것: 화면(브라우저) 자동 테스트, 컴포넌트 테스트, 부하 테스트. 화면은 지금까지 수동 스크립트로 확인했고 저장소에는 없다.
- 변경 영향 파악 순서: `npx tsc -b`(타입 불일치) → `npm test` 두 곳 → 필요 시 화면 확인.

## 3. DB (`db/init/`)

실행: `docker compose up -d` (최초 기동 때 `01_schema.sql`, `02_seed.sql` 자동 실행). 스키마 변경 반영은 `docker compose down -v` 후 재기동(데이터 삭제됨).

### 테이블

| 테이블 | 용도 |
|---|---|
| `users` | 계정. 역할 `admin` / `qa`. 비밀번호는 bcrypt 해시(pgcrypto) |
| `images` | 이미지 한 장. 원본/미리보기/썸네일 경로. 외부 노출용 `image_key`(예: img_0001) |
| `model_runs` | 모델 1회 실행. 모델 버전, 전체 점수, 히트맵 경로, 처리 시간(`duration_ms`) |
| `detections` | 실행당 이상 영역 박스. 좌표는 원본 픽셀 기준, 점수, 사유 코드 |
| `rules` | 판정 규칙. `params` jsonb(`{"normalMin":0.9,"suspectMin":0.5}`), 버전 |
| `verdicts` | 실행 결과 + 규칙 → 판정(NORMAL/SUSPECT/DEFECT). 어떤 규칙 버전인지 `rule_id` 기록 |
| `assignments` | 배정 1건. 상태, 담당자, 마감일, 점검 내용. `code`(AS-0001)는 id에서 자동 생성 |
| `assignment_images` | 배정↔이미지 소속 + 배정 시점의 AI 결과(`run_id`) + 정렬 순서 |
| `assignment_history` | 상태 변경/처리 이력(from/to, 행위자, 시각). 단계별 소요 시간의 원천 |
| `reviews` | 검수 결과. **쌓기만 하는 기록**(번복 시 행 추가), 최신 행이 현재 상태 |
| `batch_jobs` | 사전배치(AI 사전 검증) 실행 기록. 시작/종료, 처리 수, 실패 수, 에러 |

뷰: `review_current`(이미지별 최신 검수 상태), `assignment_summary`(배정 리스트용 장수·판정 분포·검수 진행).

### 값 코드 (영문 저장, 한글은 화면에서 매핑)
- 배정 상태: `ASSIGNED`(배정) `PRECHECKED`(사전배치) `IN_REVIEW`(점검중) `REVIEWED`(점검완료) `CONFIRMED`(확인완료)
- 판정: `NORMAL`(정상) `SUSPECT`(의심) `DEFECT`(불량)
- 검수: `APPROVED`(승인) `REJECTED`(반려) — 행이 없으면 미검토
- 사유 코드: 기획서 4장 6종 그대로 (`COMPOSITE_EDGE` 등)

### 설계 결정과 이유
- **`reviews`를 별도 테이블로**: 한 배정에 3천 장 규모이고, 재점검으로 같은 이미지가 다시 배정될 수 있으며, 번복 횟수 같은 분석이 필요해서. 미검토는 행이 없는 것으로 표현해 3천 행을 미리 만들지 않는다.
- **`assignment_images.run_id`**: 모델을 다시 돌려도 "검수자가 그때 본 결과"가 보존되도록.
- **소요 시간은 서버가 저장한 시각으로 계산** (클라이언트 측정값 불신, 자리를 비운 시간이 섞이는 문제 때문):
  - 배정 단위 평균 = (점검중→점검완료 시각, `assignment_history`) ÷ 검수한 이미지 수.
  - 이미지별 작업 속도 = 같은 담당자의 연속된 `reviews.decided_at` 간격. 약 5분 이상 벌어진 구간은 자리를 비운 것으로 보고 제외(기준은 쿼리에서 조정).
  - 사전배치 시간 = `batch_jobs`, 모델 1장 시간 = `model_runs.duration_ms`.
- **인덱스**: `assignment_images(assignment_id, position)`, `reviews(assignment_id, image_id, decided_at DESC)`, `detections(run_id)` 등 3천 장 집계를 염두에 둠.

## 3-1. 백엔드 API (`backend/src`)

Fastify 5, ORM 없이 `pg` 직접 사용. 입력은 라우트별 JSON Schema로 검증. 에러 응답은 `{ message }`.
인증: 로그인 시 JWT를 httpOnly 쿠키(`token`, 12시간)로 발급, `Authorization: Bearer`도 허용. 이미지는 `<img>`가 쿠키를 자동 전송하도록 이 방식을 택했다. 프론트는 Vite 프록시로 같은 출처에서 호출할 것(CORS 불필요).

| 메서드 경로 | 설명 | 권한 |
|---|---|---|
| POST /api/auth/login, signup, logout / GET /api/auth/me | 가입은 항상 qa 역할 | - |
| GET /api/users | 담당자 선택용 | 로그인 |
| GET /api/assignments?status&q&page&pageSize | 목록 + 상태별 건수 | 로그인 |
| GET /api/assignments/:code | 상세(건수, 이력, 점검 내용). 이미지는 제외 | 로그인 |
| GET /api/unassigned-counts | 미배정 이미지 수(판정별) | 로그인 |
| POST /api/assignments | 신규 배정. 미배정 이미지 자동 선택, 순서는 점수 낮은 순 | 관리자 |
| POST /api/assignments/:code/status {to} | 정해진 다음 단계로만. 점검 완료는 미검토가 남으면 거부 | 단계별(아래) |
| PUT /api/assignments/:code/note | 점검 내용 저장 | 담당자·관리자 |
| GET /api/assignments/:code/images?filter&verdict&page&pageSize | 서버 페이지네이션(최대 200). filter: all/unreviewed/approved/rejected | 로그인 |
| PUT /api/assignments/:code/images/:imageKey/review | 승인/반려 저장. 점검중일 때만 | 담당자·관리자 |
| GET /api/monitoring/time?gapMinutes=5 | 소요 시간 분석(담당자별·배정별·모델·사전배치). 자리 비움 기준 1~120분 | 관리자 |
| GET /api/images/:imageKey/thumb|preview|original|heatmap | 이미지·히트맵 파일(이미지 ID 기반, 경로 비노출). 관리자 전부, QA는 자기 배정 이미지만, `ingest_status=DONE`만. `Cache-Control: private` + ETag(304), nosniff, SVG는 CSP sandbox | 로그인 |

- 단계별 권한은 2장 표와 같다 (사전배치 실행·확인 완료는 관리자, 점검 시작·완료는 담당자 또는 관리자).
- 사전배치는 지금은 실제 추론 없이 `batch_jobs`에 성공 기록만 남긴다 (모델 결과는 이미 적재됨). 실제 모델 연동 시 이 부분을 어댑터로 교체.
- 검수 저장은 직전과 같은 내용이면 행을 추가하지 않는다 (소요 시간 분석 노이즈 방지). 판정을 바꾸면 행 추가.
- 신규 배정은 `pg_advisory_xact_lock`으로 직렬화해 두 배정이 같은 이미지를 집지 않게 한다.
- 이미지 항목: 5장 계약 필드 + `verdict`, `reasons`, `thumbUrl/previewUrl/heatmapUrl`, `review{status: NONE|APPROVED|REJECTED}`. 썸네일 생성 전에는 원본 URL을 그대로 돌려준다.
- 상태·판정 값은 영문 코드로 응답한다. 한글 매핑은 프론트 몫.
- 검증: `backend/test/`의 통합 테스트(`npm test`)가 권한·상태 전이·검수·페이지네이션·파일 접근을 확인한다. 테스트 전용 DB를 매번 새로 만들어 스키마·시드를 적용하므로 개발 DB와 섞이지 않는다.
- `GET /api/assignments/:code/next-unreviewed?after=N`: N번째 뒤의 첫 미검토 위치(없으면 처음부터, 전부 검토했으면 null). 이어서 검수할 때 화면이 첫 미검토로 바로 이동하는 데 쓴다.
- 알려진 한계: 로그인 시도 횟수 제한 없음, npm audit에 `@fastify/static`의 glob 의존성 관련 moderate 경고 1건(와일드카드 기능을 쓰지 않음).

### 소요 시간 분석 계산 기준 (`routes/monitoring.mjs`)
- **담당자별 이미지당 시간**: 같은 담당자·같은 배정에서 연속된 `reviews.decided_at` 간격. 기준(기본 5분) 초과 간격은 자리 비움으로 보고 평균/실작업 시간에서 제외하고 "자리 비움 구간" 수로 따로 센다. 다른 담당자의 검수가 사이에 끼어도 서로의 간격에 영향이 없다(담당자·배정 단위로 계산).
- **번복**: 같은 이미지를 다시 판정한 행도 하나의 작업 간격으로 계산하고, 건수는 `번복 = 판정 횟수 - 이미지 수`로 따로 보여 준다.
- **배정별**: (점검 시작 ~ 점검 완료 시각, `assignment_history`) ÷ 검수한 이미지 수 = 평균/장. 실작업/장은 자리 비움을 뺀 값. 배정~확인은 ASSIGNED ~ CONFIRMED. 아직 끝나지 않은 단계는 null.
- **모델**: `model_runs.duration_ms`의 평균/p95/최대(버전별). **사전배치**: `batch_jobs` 시작·종료 시각, 끝나지 않은 건은 null.
- 첫 검수는 직전 기준이 없어 간격에 포함되지 않는다. 점검 시작 직후 첫 이미지를 보는 시간은 배정별 평균(점검 시작 기준)에만 반영된다.
- 한계: 한 번에 많은 이미지를 승인하는 일괄 처리가 생기면 간격이 매우 짧게 잡힌다. 현재 화면에는 일괄 처리가 없다.

## 4. 개발 환경 메모
- 저장소: 루트 하나에 프론트/백엔드/DB를 함께 두는 모노레포 (혼자 진행, JSON 계약 공유, compose 하나로 기동).
- `.env`는 git 제외, `.env.example`만 커밋. 개발용 DB 비밀번호는 로컬 `.env`에만 있다.
- Windows에서 `git add` 시 LF→CRLF 경고는 정상.
- shadcn은 Base UI 기반이라 Radix와 API가 다르다 (예: `Select`는 `items` 속성으로 라벨 매핑, `ToggleGroup`은 `multiple`과 배열 `value`, `Slider`의 `onValueChange`는 숫자 또는 배열).
- UI 검증은 playwright-core + 로컬 Chrome 헤드리스로 했다 (저장소에는 포함하지 않음).

## 5. 열린 질문 (입사 후 확인 필요, 기획서 10장 참고)
- 실제 모델의 전달 형태, 출력 형식, 배치 실행 주체와 GPU 환경
- 검증 기준(임계값, 규칙)의 소유자와 저장 위치
- 원본 이미지 포맷/규모, 변환(webp) 정책
- 기술 스택 확정 여부

## 6. 이후 계획 (기본 기능 완성 뒤에 진행, 지금은 기록만)

기본 흐름(배정 → 검수 → 확인, 모니터링)이 끝난 다음에 다룬다. 아래는 아이디어 단계이고 설계는 그때 정한다.

### 관리자 기능
- **가입 승인**: 지금은 가입하면 바로 `qa`로 로그인된다. 가입 시 `PENDING` 상태로 두고 관리자가 승인해야 로그인되게 한다 (`users.status` 컬럼 추가 검토).
- **사용자 관리**: 목록, 역할 변경, 비활성화/삭제, 비밀번호 초기화.
- **권한별 메뉴 개방**: 역할(또는 개별 사용자)마다 볼 수 있는 메뉴를 관리자가 켜고 끈다. 지금은 `frontend/src/config/menu.ts`에 고정되어 있으므로 메뉴 정의를 DB로 옮기고(예: `menus`, `role_menus` 테이블) 서버가 메뉴 트리를 내려주는 구조로 바꿔야 한다. 메뉴 접근 제한은 화면에서 숨기는 것만으로는 부족하고 API에서도 권한을 확인해야 한다.
- **메뉴 관리**: 메뉴 항목의 연결 화면(경로), 열기/닫기(활성), 순서를 관리자 화면에서 조정.
- 역할이 admin/qa 두 개뿐인 현재 구조(`users.role`의 CHECK 제약)는 위 기능을 위해 역할 테이블 + 권한 코드 방식으로 확장이 필요할 수 있다.

### 다국어(i18n)
- 가능하다. 프론트의 한글 문자열을 번역 키로 빼고(예: react-i18next) 언어별 JSON을 두는 방식이 일반적이다. 사용자별 언어 설정은 `users.language`에 저장.
- 이미 유리한 점: DB의 상태/판정/사유 값이 영문 코드이고 한글은 화면에서만 매핑한다. 서버 에러 메시지(`{ message }`)는 지금 한글 문장이므로, 다국어 시에는 에러 코드를 내려주고 프론트에서 번역하도록 바꿔야 한다.
- 날짜·숫자 형식(`Intl`)과 글자 폭 차이로 인한 레이아웃 점검도 필요하다.
- 사용자가 입력한 데이터(배정명, 코멘트)는 번역 대상이 아니다.
- 문자열을 코드에 직접 쓰는 양이 늘수록 나중에 뽑아내는 비용이 커진다. 새 화면을 만들 때 문자열을 한 곳(`src/lib/labels` 등)에 모아두면 이후 전환이 쉽다.

## 7. 캡처 기록
`captures/<날짜>_<버전명>/`에 화면 캡처를 보관한다 (git 추적 여부는 사용자가 결정).
- `2026-11-02_v0.1-mock-ui`: 목 데이터 기반 프론트 목업 8장 (로그인, 회원가입, 배정 리스트, 신규 배정, 상세 3탭, 다크 모드).
- `2026-11-02_v0.2-api-connected`: 실제 API 연동 후 화면 9장 (빈 목록, 3천 장 신규 배정, 사전배치, 이미지 검수·가상 스크롤·새로고침 후 유지, 진행률).
- `2026-11-02_v0.3-resume-review`: 이어서 검수(첫 미검토로 열기), 멀리 스크롤 후 해당 페이지만 로드.
- `2026-11-02_v0.4-time-analysis`: 소요 시간 분석 화면 (QA 접근 차단, 5분 기준, 15분 기준 비교).

## 8. 결정: 파일 수신 시 사전 검증 (구현 예정, 2026-11-02)

**배경**: 신규 배정은 "AI 판정이 의심/불량인 것"을 골라 담으므로 배정 시점에 AI 결과가 이미 있어야 한다. 지금의 `사전배치`(배정 후 실행)는 이 순서와 맞지 않는다.

### 확정된 결정
- 연계로 들어오는 **파일만** 받는다. 상대 DB는 지금 필요 없다 (실제 환경을 모르므로 보류). 흐름은 "폴더 감시 → 내 DB에 기록 → 순차 추론 → 검수 → 내 DB 갱신".
- 파일은 **이동** 방식이다 (`inbox → processing → done / failed`). 복사는 혼란만 키운다.
- 수신 즉시 **순차 배치로 사전 검증(추론)** 한다. 새 흐름: 수신 → 추론 → 판정 → 배정 → 점검 → 확인.
- **상태 흐름에서 `사전배치`(PRECHECKED)는 빠진다.** (배정 → 점검중 → 점검완료 → 확인완료, 4단계)
- 신규 배정은 추론이 끝난 이미지만 대상으로 한다 (대기·실패 이미지 제외).
- 모델 호출부는 **어댑터**로 분리하고 출력은 5장 JSON 계약으로 고정한다. 현재의 목 생성기가 첫 번째(가짜) 구현이 된다.
- 규칙(임계값)만 바뀌면 추론 없이 재판정한다. 모델을 바꿔 다시 돌리는 것은 같은 방식으로 새로 수신해 처리한다 (아래 중복 정책).
- 감시는 **주기 스캔**(기본 5초, 설정 가능) + 복사 중인 파일은 크기·수정시각이 2회 연속 같을 때만 수신. 워커는 API와 **별도 프로세스**(`npm run worker`), 동시성 기본 1. 설정은 DB에 두고 워커가 매 주기 읽는다.
- 작업 큐는 별도 브로커 없이 DB 테이블 (`FOR UPDATE SKIP LOCKED`). 워커가 죽어 `PROCESSING`에 멈춘 건은 시작 시 `PENDING`으로 되돌린다.
- 테스트를 위해 `scanOnce()`(폴더 1회 훑기)와 `processOne()`(대기 1건 처리)를 타이머와 분리해 만든다. 임시 폴더 + 목 어댑터 + 실패 주입 어댑터로 검증.

### 같은 파일이 다시 들어올 때 (중복 정책)
- **막지 않는다.** 모델 버전이 바뀐 뒤 재검증처럼 같은 파일을 다시 검증하고 싶을 수 있다.
- 수신할 때마다 `images`에 **새 행을 insert** 한다. 새 행은 자기 경로, 추론 결과, 검수 결과를 따로 가진다. 그래서 이미 검수 중인 이미지에 영향이 없다.
- 같은 내용인지는 파일 **해시(sha256)** 로 안다 (파일 이름은 믿을 수 없다). 새 행은 `origin_image_id`(자기 참조 외래키)로 같은 해시의 **가장 처음 수신 행**을 가리킨다. 처음 수신한 것은 NULL. 해시는 막는 용도가 아니라 연결·표시용이다.
- 같은 이름의 파일이 이동 중 충돌하지 않게, 이동 후 파일명은 `image_key`(고유값)로 정한다. 원래 파일명은 `source_name`에 보존.
- 신규 배정이 같은 원본의 여러 행을 한꺼번에 담을지는 구현 때 결정 (기본: 허용, 화면에 "재수신" 표시).

### 관리자 메뉴 `연계 관리` — 설정·추가 화면 (모니터링이 아님)
사용자 의도: 연계를 **설정하고 추가하는** 화면. 진행 현황 상세는 모니터링 메뉴의 몫이고, 여기서는 연계별 현재 상태만 요약해서 보여준다.
- 구조: 연계 목록 + 추가/수정/삭제/켜기·끄기. 연계 하나 = 종류(현재 `FOLDER`, 이후 `DB` 등) + 이름 + 종류별 설정 + 사용 여부. 신설 테이블 `integrations` (설정은 `config jsonb`).
- 폴더 연계 설정 항목: 감시 폴더, 완료/실패 폴더, 파일 패턴(확장자), 스캔 주기, 한 번에 처리할 장수, 일시정지/재개.
- 목록에 연계별 요약 상태: 최근 수신 시각, 대기/처리중/완료/실패 건수, 실패 건 재시도 버튼.
- 보안: 관리자 전용, 경로는 허용 루트(`INGEST_ROOT`) 하위만 허용, 심볼릭 링크 불추적, 파일 앞부분(매직바이트)으로 이미지 확인, 크기 상한, 설정 변경 이력(누가·언제·무엇) 기록.
- 화면 구성(목록/상세 폼/이력)은 구현 단계에서 목업을 먼저 만들어 사용자와 정한다.
- 결과 내보내기(검수 결과를 outbox 폴더에 JSON/CSV로 쓰기)는 자리만 두고 나중에 `integrations` 종류 하나로 추가한다.

### 배치의 단위
- "수신 배치" = 스캔 1회에 발견된 파일 묶음. 신설 `ingest_batches`(전체/처리/실패 수, 시작·종료 시각). 기존 `batch_jobs`는 배정 단위라 이 역할로 쓸 수 없어 대체한다. 소요 시간 분석의 사전배치 항목은 이쪽을 기준으로 바꾼다.

### DB·코드 영향 (변경 시 같이 고칠 곳)
- `images`: `sha256`, `source_name`, `source_path`, `ingest_status`(PENDING/PROCESSING/DONE/FAILED), `error`, `received_at`, `origin_image_id`, `batch_id` 추가. 신설: `ingest_batches`, `integrations`, 설정 변경 이력. 마이그레이션 스크립트 방식으로 적용.
- `assignments.status` CHECK에서 `PRECHECKED` 제거 (기존 PRECHECKED 데이터는 ASSIGNED로 이전), `batch_jobs` 대체.
- 서버 `TRANSITIONS`와 신규 배정 조건(`ingest_status='DONE'`만), 프론트 상태 단계 표시·요약 카드(5칸 → 4칸), `mappers.ts`, 소요 시간 화면의 "사전배치" 카드·표, 관련 테스트(`monitoring.test.mjs`의 PRECHECKED 이력·batch_jobs 시나리오, `api.test.mjs`의 배정 흐름).

### 순서 (①은 완료, 아래 "1단계 구현 메모" 참고)
① 마이그레이션 + 모델 어댑터 인터페이스 + 목 구현 → ② `scanOnce`/`processOne` + 워커 프로세스 + 테스트 → ③ PRECHECKED 제거 (백엔드·프론트·테스트) → ④ 연계 관리 화면. 각 단계마다 테스트가 통과한 상태에서 커밋한다.

### 공통 컬럼 (미정, 의견만 정리)
사용자가 생각한 공통 컬럼: `id`, 등록자, 등록일시, 수정자, 수정일시. 상속(`INHERITS`)은 제약·인덱스가 따라가지 않아 쓰지 않는 것을 권장. 대신 새 테이블에 같은 컬럼 이름을 규칙으로 적용하고, `수정일시`는 공통 트리거 함수 하나로 자동 갱신, `수정자`는 API가 채운다. 쌓기만 하는 테이블(`reviews`, `assignment_history`, `model_runs`)에는 수정 컬럼을 두지 않는다. 기존 테이블에 소급할지는 구현 ① 때 결정.

### GPU 메모 (개발 PC: RTX 4060 Ti 16GB)
이상 탐지·분류 CNN/ViT급은 충분. 7B급 멀티모달은 양자화해야 가능. 실제 모델 확정 후 재산정 필요. 이미지 디코딩/디스크 읽기도 병목이 될 수 있다. 워커는 컨테이너 밖에서 직접 실행하는 편이 GPU 설정이 간단하다.

### 1단계 구현 메모 (2026-11-02)
- **마이그레이션**: `db/migrations/NNN_*.sql`을 `backend/src/migrate.mjs`가 번호순으로 적용하고 `schema_migrations`에 이력을 남긴다. 파일 하나 = 트랜잭션 하나. 새 환경은 `docker compose up -d`(init SQL) 뒤에 `npm run migrate`. 테스트 DB도 같은 방식으로 만든다. init SQL(01, 02)은 건드리지 않고 변경은 모두 마이그레이션으로 쌓는다.
- **001 내용**: `images`에 수신/추론 컬럼 추가(`width`/`height`는 NULL 허용, 단 `DONE`이면 필수 — CHECK), 기존 이미지는 `DONE`·`source_name=file_name`으로 이전, 새 행 기본값은 `PENDING`. `integrations`, `ingest_batches` 신설. 대기 건 조회용 부분 인덱스(`images_pending_idx`).
- **공통 컬럼 소급**: `users`, `rules`, `images`, `assignments`에 `created_by`/`updated_by`/`updated_at` 보강(이미 있는 것은 유지). `updated_at`은 `set_updated_at()` 트리거가 자동 갱신, `updated_by`는 API가 채우며 NULL은 시스템. 제외: 쌓기 전용(`reviews`, `assignment_history`, `model_runs`, `detections`, `verdicts`), 소속 테이블(`assignment_images`), 대체 예정인 `batch_jobs`. 기존 API 코드는 아직 `updated_by`를 채우지 않는다 (3단계 이후 정리).
- **`images.original_path`**: 아직 NOT NULL. 수신 시 현재 파일 위치로 채우고, 파일이 inbox → processing → done으로 옮겨지면 `source_path`와 함께 갱신하는 방식을 2단계에서 정한다.
- **모델 어댑터** (`backend/src/model/`): `contract.mjs`(5장 계약 검증 `validateResult`/`assertValidResult`, 박스가 이미지 밖이면 위반), `mock.mjs`(`createMockAdapter`: 파일 내용 sha256으로 시드를 정해 같은 파일이면 같은 결과). 인터페이스는 `adapter.modelVersion`, `adapter.infer({imageKey, fileName, filePath, outputDir}) → 계약 객체`, 실패는 예외. `scripts/generate-mock.mjs`는 그대로 두었다 (이미 적재된 3천 장의 재현성 유지).
- `scripts/load-results.mjs`는 새 기본값(PENDING) 때문에 `ingest_status='DONE'`, `source_name`을 명시해서 넣는다.

### 2단계 구현 메모 (2026-11-02)
코드는 `backend/src/ingest/`, 워커 진입점은 `backend/src/worker.mjs`(`npm run worker`), 테스트는 `test/ingest.test.mjs`.
- **폴더 구조**: 허용 루트(`INGEST_ROOT`, 기본 `<FILES_DIR>/ingest`) 아래에 `inbox`(감시) → `processing`(수신되어 처리 대기·처리 중) → `done` / `failed`. 루트를 FILES_DIR 아래에 둬서 완료 파일을 파일 API로 서빙한다(②에서 이미지 ID 기반으로 바뀌어 inbox·failed 파일은 URL로 받을 수 없다).
- **`scanOnce({pool, integration, root, filesDir, seen})`**: 일반 파일 + 허용 확장자만 후보(`lstat`이라 심볼릭 링크 제외). `seen`(호출자가 유지하는 Map)에 직전 `크기:수정시각`이 같으면 안정으로 보고 수신 → 첫 관찰 때는 기억만 한다(=최소 2회 스캔). 수신 순서: 크기 상한·빈 파일·매직바이트 검사 → sha256 → 한 트랜잭션에서 images INSERT(임시 키) → `rcv_<id 6자리>`로 키 확정 → 파일 이동 → COMMIT. 이동 실패면 행도 롤백, COMMIT 실패면 파일을 되돌린다. 검사 불합격은 `failed`로 옮기고 `FAILED` 행을 남긴다(수신 시도를 기록으로 보이게). 같은 해시는 항상 **처음 수신 행**을 `origin_image_id`로 가리킨다(사슬 아님).
- **`processOne({pool, adapter, root, filesDir, ruleName})`**: `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)`로 한 건을 PROCESSING으로 집는다(오래된 수신 순). 성공: `model_runs`(모델 버전·처리 시간), `detections`, `verdicts`(규칙은 rules의 활성 최신 버전, `rule_id` 기록)를 저장하고 파일을 `done`으로 이동, 크기를 채워 DONE. 실패(어댑터 예외, 계약 위반, imageId 불일치, 파일 없음): `failed`로 이동 + FAILED + 사유(500자), 모델 결과는 저장하지 않음. 배치 카운터(`processed_count`, `failed_count`)를 올리고 전부 끝나면 `finished_at`. 활성 규칙이 없거나 연계 설정을 못 읽는 것은 이미지 탓이 아니므로 이미지를 PENDING으로 두고 예외를 올린다.
- **`runCycle`**: 켜진 FOLDER 연계마다 `scanIntervalSec`이 지났으면 스캔(연계 하나의 오류는 `errors`에 모으고 다른 연계·추론을 막지 않음) → 대기 이미지를 `maxPerCycle`(기본 20)장까지 처리. 시각은 `now` 인자로 받아 테스트에서 시간을 흉내 낸다. 워커는 시작 시 `recoverStuck`(PROCESSING → PENDING)을 1회 하고, 연계가 하나도 없으면 기본 폴더 연계를 만든다. SIGINT/SIGTERM에는 진행 중인 1장까지만 마치고 종료.
- **설정**: `INGEST_ROOT`, `RULE_NAME`(기본 score-threshold), `MODEL_ADAPTER`(기본 mock, `src/model/index.mjs`). 연계 폴더 설정은 `folder-config.mjs`가 검증한다(절대 경로·루트 이탈·폴더 중복 거부).
- **알려진 한계**: 실패 건 재시도와 설정 변경 이력은 연계 관리 화면 단계에서 다룬다. 새로 수신·추론된 이미지는 아직 신규 배정 조건(`ingest_status='DONE'`)이 명시되어 있지 않다(⑥에서 명시). 스캐너 중복과 고아 파일은 아래 "워커 단일 실행과 시작 시 정리"로 해소했다.

### 워커 단일 실행과 시작 시 정리 (2026-11-02, ①)
- **결정**: 워커는 하나만 실행한다. 폴더당 워커 1개가 일반적인 구성이고, 사고로 둘이 뜨는 경우(실행해 두고 잊음, 재시작 겹침)를 막는 것이 목적이다.
- **방식**: `ingest/lock.mjs`가 PostgreSQL advisory lock(`pg_try_advisory_lock(hashtext('qa-review:ingest-worker'))`)을 잡는다. 못 잡으면 안내 후 종료 코드 1. 잠금은 DB 연결에 묶여 프로세스가 죽거나 연결이 끊기면 DB가 자동으로 푼다(잠금 파일의 찌꺼기 문제 없음). 잠금을 쥔 연결은 워커가 끝날 때까지 풀에 돌려주지 않으며, 연결이 끊겨 잠금을 잃으면 `onLost`로 알려 워커가 멈춘다(다른 워커와 겹치지 않게).
- **범위**: 워커 전체에 잠금 하나(모든 폴더 연계를 한 워커가 담당 → 폴더마다 스캐너 1개가 함께 보장됨). 폴더별 워커 분리가 필요해지면 키를 연계 id로 나눈다.
- **순서가 중요**: 잠금을 잡은 뒤에 정리 작업을 한다. 잠금 없이 정리하면 다른 워커가 처리 중인 `PROCESSING` 건을 대기로 되돌려 같은 이미지가 두 번 추론된다.
- **시작 시 정리** (`ingest/recover.mjs`, 시작 시 1회): (1) `PROCESSING` → `PENDING`. (2) `processing` 폴더의 파일 이름(= image_key)을 한 번의 쿼리(`= ANY`)로 DB와 대조해, 행이 없는 파일(수신 중 이동 직후 COMMIT 전에 죽은 고아)을 감시 폴더로 되돌려 다음 스캔에서 다시 수신한다. 단일 워커 + 시작 시점이라 수신 도중인 파일이 없으므로 "오래된 파일만" 같은 시간 조건이 필요 없다. 감시 폴더에 같은 이름이 있으면 덮어쓰지 않고 `-2`를 붙인다. 폴더 부재/설정 오류는 그 연계만 오류로 기록한다. 3천 장에서도 쿼리 1회.
- 주기적 점검 방식(워커 실행 중에도 고아를 찾기)은 보류. 고아는 드문 사고이고 시작 시 정리로 충분하다고 판단했다. 필요해지면 "DB에 행이 없고 수정 후 N분 경과" 조건으로 `runCycle`에 추가한다.

## 9. 결정: 파일 접근, 원본/미리보기, 생성 이미지, 검수자 표시 (2026-11-02, 구현 예정)

### 파일 접근을 이미지 ID 기반 API로 (②)
- **문제**: 지금 `/files/<경로>`는 디스크 폴더 구조를 그대로 URL에 노출하고 권한이 "로그인 여부"뿐이다. `data/images/ingest/inbox`, `failed`(검증 전·불합격 파일)도 이름을 알면 로그인한 누구나 받을 수 있다.
- **결정**: 경로 대신 이미지 ID로 요청한다. 서버가 DB에서 파일 위치를 찾아 내려주므로 URL에서 경로 추측·`../` 우회가 불가능하다.
  `GET /api/images/:imageKey/thumb | preview | original | heatmap`
- **권한**: 관리자는 전부, QA 담당자는 자기에게 배정된 배정에 속한 이미지만. `ingest_status='DONE'`이 아닌 이미지는 거부. 요청마다 인덱스 쿼리 1회(`assignment_images(image_id)` 인덱스 존재). 구현 뒤 3천 장에서 실제 지연을 재 본다.
- **헤더**: `Cache-Control: private` + `ETag`(정적 서빙이 자동으로 주던 캐시 헤더를 직접 붙여야 한다. 빼먹으면 이미지를 볼 때마다 전체를 다시 받는다), `X-Content-Type-Options: nosniff`, SVG는 직접 열었을 때 스크립트가 돌지 않도록 `Content-Security-Policy: sandbox`. 원본은 스트림으로 전송(큰 파일을 메모리에 올리지 않음).
- **사본이 없을 때**: `thumb`/`preview`가 아직 없으면 원본으로 대신 내려준다(생성 단계 전 호환). 기존 `/files`는 제거하고 목 이미지·히트맵도 같은 API로 서빙한다. 이미지 목록 응답의 `thumbUrl/previewUrl/heatmapUrl`을 새 주소로 바꾼다.
- **원본 열람 기록은 만들지 않는다**(사용자 결정). 중요한 기록은 검수 저장 시점이다.

### 원본/미리보기/썸네일 (④, ⑤)
| 종류 | 용도 | 비고 |
|---|---|---|
| thumb | 목록 | 작은 webp. 토글과 무관하게 항상 썸네일 |
| preview | 검수 화면 | 줄인 webp(긴 변 약 2560px 후보). **비율 유지 필수** (박스 좌표는 원본 픽셀 기준이라 잘라내거나 여백을 넣으면 오버레이가 어긋난다) |
| original | 정밀 확인 | 원본 그대로. 판정은 항상 원본 기준 |
- **검수 화면 보기 모드 토글**: `미리보기`(기본) / `원본 고정`. 원본 고정에서는 현재 이미지의 다음 1~2장을 미리 받는다(전체를 받지 않음). 이미 본 것은 브라우저 캐시. 모드는 브라우저 저장(사용자 편의 설정). 추후 후보: 미리보기에서 확대(줌)할 때만 원본으로 교체. 사본은 `processOne`이 추론 후 `thumb_path`/`preview_path`를 채우는 방식(`sharp` 도입 예정, 포맷·변환 정책은 기획서 10장 질문이라 확정 전).

### 검수자·시각 표시 (⑤)
- 데이터는 이미 있다: 검수 저장 시 `reviews`에 행 추가(검수자는 로그인 정보, 시각은 DB 시각), API 이미지 응답에 `reviewerName`/`reviewedAt`. **화면의 검수 패널이 아직 표시하지 않을 뿐**이다. "마지막 검수: 김검수 · 11-02 14:03"을 표시하고 번복 이력(한 이미지의 변경 기록) 보기를 후보로 둔다.
- `images` 행을 UPDATE해 검수자를 덮어쓰는 방식은 채택하지 않는다: 재점검으로 같은 이미지가 여러 배정에 들어갈 수 있고, 덮어쓰면 번복 이력과 소요 시간 분석이 사라진다. 현재의 "쌓기만 하는 reviews + 최신 행이 현재 상태"를 유지한다.

### ComfyUI로 실제 원본 이미지 생성 (③)
- 목적: SVG 목 이미지로는 검증할 수 없는 것(수 MB PNG, 실제 디코딩·축소·webp 인코딩 시간, 원본 토글 체감 속도, PNG/JPEG 수신 경로)을 실제 파일로 검증. 연습 데이터는 직접 만든 것만 쓴다는 규칙에 맞다(회사 자료 아님. 사용 모델의 라이선스는 공개·배포 때 확인).
- 환경(확인함): `H:\jjal\ComfyUI\ComfyUI_windows_portable`, `run_comfyui.bat`, 포트 **8188**(옵션 없음, 기본값), 출력 폴더 `H:\jjal\output`. 모델은 `ComfyUI\models`가 본체(`webui\models`는 Forge용, 일부 하드링크). 체크포인트: Z-Image-Turbo bf16, Animagine XL 3.1, CyberRealistic V4.1, 그 밖에 MOSS-Image, Wan2.1. 속도(벤치마크 문서): Z-Image-Turbo 832×1216에서 약 22초, 증류 LoRA 4스텝이면 약 10초. 인페인팅용 컨트롤넷은 없다.
- 계획: ComfyUI 로컬 HTTP API(워크플로우 API JSON)로 스크립트 일괄 생성, 300~500장부터. 결함 이미지는 정상 이미지의 일부 영역을 img2img/재생성으로 바꿔 만들고 그 영역을 정답 박스로 기록(나중에 실제 이상 탐지 모델 평가에 사용). 3천 장 SVG 목 데이터는 부하 테스트용으로 유지.

### ② 구현 메모 (2026-11-03)
- `routes/files.mjs`: `GET /api/images/:imageKey/:kind`. `imageKey`는 `[A-Za-z0-9_-]`만 허용(스키마 검증). DB 경로는 `safeResolve`로 `filesDir` 밖이면 거부(DB가 오염돼도 방어). 미존재·`ingest_status<>'DONE'`은 404, 권한 없음은 403.
- `heatmap`은 이미지의 **가장 최근 model_run** 것을 내려준다(목록의 `heatmapUrl`은 배정 시점 run 기준이라, 재실행이 생기면 둘이 달라질 수 있다 — 재판정/재실행 기능을 만들 때 다시 볼 것).
- `Cache-Control: private, max-age=300` + 약한 ETag(크기+mtime). 5분간은 DB 조회 없이 브라우저 캐시, 이후 If-None-Match로 304. 접근 권한을 회수해도 최대 5분은 캐시본이 보일 수 있다(수용).
- 목록 응답에 `originalUrl` 추가(⑤ 원본 고정 모드용). `@fastify/static` 의존성 제거.
- 3천 장 요청 지연 측정은 아직 안 했다(권한 쿼리 1~2회/요청).

### ④ 구현 메모 (2026-11-03)
- `ingest/derive.mjs`: `sharp`로 `derived/thumb|preview/<imageKey>.webp` 생성. thumb 긴 변 320px(q70), preview 긴 변 2560px(q82), `fit: inside` + `withoutEnlargement`(비율 유지, 작은 이미지는 키우지 않음), EXIF 회전 적용. 크기·품질은 기획서 10장 질문(포맷·변환 정책)이 확정되기 전의 잠정값(`DERIVE` 상수).
- `processOne`이 추론 성공 뒤, 원본을 done으로 옮기기 전에 사본을 만들고 DB 갱신과 같은 트랜잭션에서 경로를 저장한다. DB 저장이 실패하면 사본도 지운다.
- **사본 생성 실패는 수신 실패가 아니다**: 경로를 NULL로 두고 DONE 처리 → 파일 API가 원본으로 대신 내려준다(결과 객체의 `derived: false`로 확인 가능). 판정은 원본 기준이므로 사본 문제로 검수를 막지 않는다.
- 이미 수신된 이미지는 `npm run make-derivatives`(사본 없는 DONE 건만, 재실행 안전). 개발 DB의 목 SVG 3천 장: 실패 0, 약 333초(GPU 생성 병행 중 측정).
- 박스 좌표는 원본 픽셀 기준이므로, 화면은 사본이 아니라 `images.width/height`(원본 크기)를 기준으로 오버레이를 계산해야 한다(⑤에서 확인할 것).

### ③ 구현 결과 (2026-11-03)
- `backend/scripts/generate-real.mjs`로 300장 생성(72분, 실패 0): 정상 203 + 오류 97(32%). 오류 박스 분포: 6종이 각 26~33개로 고르게 나옴. 출력 `data/images/real/`(git 제외, 752MB): `original/`(검수 대상 PNG 1344×768), `base/`(오류 이미지의 정상본), `ground_truth.jsonl`(시드·프롬프트·정답 박스·오류 종류).
- 모델: Z-Image-Turbo bf16 + 증류 LoRA(Z-Image-Fun-Lora-Distill-2603) 4스텝. 정상 11~16초/장. 인페인팅 전용 모델(Fun-Controlnet-Union)은 "주변과 자연스럽게 섞는" 용도라 의도적으로 눈에 띄는 오류를 만들려는 목적과 맞지 않아 쓰지 않았다.
- 오류 생성: TEXTURE_ANOMALY·SHAPE_DISTORTION·PART_COUNT_MISMATCH = 마스크 인페인팅(ComfyUI), COMPOSITE_EDGE·LIGHTING_MISMATCH·SCALE_ANOMALY = sharp 합성. 박스 밖은 정상본과 동일.
- **품질 평가(오류가 너무 티 나는지/미묘한지)는 아직 하지 않았다** — 사용자 판단 보류. 강도 조정은 스크립트의 `INPAINT_DENOISE`와 `compositeDefect`의 상수로 한다.
- 다음: 이 PNG를 수신 폴더(inbox)에 넣어 워커가 실제로 처리하는지 확인(PNG 수신 경로, 사본 생성 시간 실측).
