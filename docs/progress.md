# 개발 진행 기록

작업을 이어서 할 때 가장 먼저 읽는 문서: 지금까지 한 일(구현 순서 체크리스트), 점검 메모, 진행 현황, 남은 후보.
프로젝트 소개와 실행 방법은 [README.md](../README.md), 설계 결정과 이유는 [design.md](design.md).

## 현재 상태 한눈에 (2026-11-21 종료 시점)
다음 세션은 이 절만 읽어도 이어서 할 수 있다. 자세한 근거는 [design.md](design.md), 사용법은 [guide.md](guide.md), 배포는 [deploy.md](deploy.md).

**한 줄 요약**: AI 생성 이미지 QA 검수 시스템. 구현 목록 1~40 완료, **41(반려 사유 관리·분석)은 API까지 완료하고 화면 2개가 남았다** — 그 두 메뉴만 지금 '준비 중' 화면이다. 그다음은 실제 서버 배포(선택)와 개선 후보.

| 항목 | 상태 |
|---|---|
| GitHub | https://github.com/ImJaePang/qa-image-review (공개). 2026-11-21 작업까지 **모두 푸시됨**(`534e7ef` 크게 보기, `ca58453` 반려 사유 관리·분석 API, 문서 정리 포함). 확인은 `git status -sb` |
| 테스트 | 백엔드 265 · 프론트 단위 83 · 화면(Playwright) 13 · 파이썬 17, 모두 통과 (명령은 README '테스트') |
| 데모 계정 | `admin@example.com`(관리자) · `qa1@example.com`(QA) / `1234` — **로컬 데모 전용**. 공개 서버는 `DEMO_MODE=false` + `ADMIN_PASSWORD`로 시작 때 정리 |
| 모델 | 기본은 목(mock). 실제 PatchCore는 `python/README.md`, 기준선 AUROC 0.683 |

**로컬에서 켜기**: 루트에서 `docker compose up -d`(DB) → `cd backend && npm run dev`(API 3000) + `npm run worker`(선택) → `cd frontend && npm run dev`(화면 5173). 또는 Docker만으로 `docker compose --profile app up -d --build`(→ http://localhost:8080). Windows가 3000을 예약해 `EACCES`면 `API_PORT=3101`을 앞에 붙인다. Docker Desktop이 꺼져 있으면 먼저 켠다.

**최근 세션(2026-11-21)에서 한 일** (progress 39~41):
- 반려 사유 선택(A안): `R` → 사유 상자(AI 원인 미리 선택) → 숫자키·`Enter`. 마이그레이션 016, 점검 이력에 사유 열
- 이미지 목록 크게 보기가 쪽을 넘어도 닫히지 않음(40)
- 반려 사유 관리·분석(41): 목업 확정(Artifact 캔버스 '반려 사유 통계·관리 목업', https://claude.ai/artifact/B3uKNfP2JkhnaZZcNrTsGV) → API·마이그레이션 017 완료. **화면은 아직**. 개발 DB에는 016·017 모두 `npm run migrate`로 적용함

**그 전 세션(2026-11-14)에서 한 일** (progress 24~38):
- 비밀번호: 임시 비밀번호 변경 강제 화면(24), 공개 서버의 초기 비밀번호 = `ADMIN_PASSWORD`(28)
- 배포: 화면+API 단일 이미지·compose·시작 스크립트(25), 데모 모드(26), 포트폴리오 캡처·README 소개(27), 운영(VPS) 구성(38)
- 테스트: 핵심 흐름 E2E(29)
- 검수 화면: 크게 보기+박스 호버(30), 검수 필터·정렬(37), 방향키 버그 수정(36)
- 메뉴: 모델 실행 이력 제거(31), 내 배정(32)·점검 이력(33)·이미지 목록(34)·대시보드(35)
- 3천 장 대응: 검수 순서 5종 + 정상 표본(37)

**기억해 둘 결정** (이유는 design.md):
- 검수 정렬 5종: 점수 낮은/높은 순, 경계에 가까운 순, 이상 영역 많은 순, 최신 수신순. **무작위는 의도적으로 뺐다**(편향은 정상 표본으로 다룬다)
- 승인 = 문제없이 사용 가능, 반려 = 사용할 수 없음 (AI 판정이 불량이어도 사람이 보고 문제없으면 승인)
- 필터 상태에서 결정한 이미지는 목록에서 바로 사라지지 않고 표시만 바뀐다(목업과 다름, 이유는 design.md)
- 원인 설명 문구 7종(`lib/domain.ts`)은 확인 완료, 그대로 사용
- 반려 사유 분석은 대시보드 카드가 아니라 별도 메뉴(모니터링 > 분석). 관리 화면에서 새로 만든 사유는 AI 원인과 연결되지 않는다(`ai_reason=false`, 미리 골라지지 않음)
- 반려 사유는 A안(반려를 누르면 펼침, AI 원인 미리 선택). 사유 목록은 DB `reject_reasons`(AI 원인 코드와 같은 코드 + `OTHER` 기타, UNKNOWN 제외). 반려는 사유 1개 이상, 기타는 코멘트 필수
- README는 공개용 소개, 개발 기록은 이 파일(CLAUDE.md가 이 파일을 먼저 읽게 안내)

**작업 방식 합의**: 화면은 **목업을 먼저 보여 주고**(Artifact) 정한 뒤 구현 · 커밋은 요청이 있을 때(진행 중 반복 요청이 있으면 계속), API와 화면을 나눠 작은 단위로 · **푸시는 사용자가 시킬 때만**(푸시 전 `.env` 추적 여부 점검) · 회사 자료 사용 금지 · 임계값 하드코딩 금지.

**알아둘 함정**:
- 화면 테스트는 같은 테스트 DB를 공유한다 → 이미지를 새로 배정하는 시나리오는 시작할 때 `freeImages`(`e2e/helpers.ts`)를 부른다
- 모달 안의 키 입력은 **캡처 단계 리스너**로 받는다(탭·버튼이 방향키를 가져감)
- 목 모델의 박스는 가짜라 호버 카드의 원인·위치가 실제 결함과 다를 수 있다
- 줄바꿈: 저장소가 `autocrlf=true`라 `LF → CRLF` 경고가 나오지만 정상이다. 파이썬으로 파일을 고칠 때 `\b` 같은 역슬래시는 원시 문자열(`r'...'`)로 쓴다(백스페이스 문자로 바뀐 적 있음)

**다음에 할 수 있는 일** (우선순위 순):
1. **반려 사유 화면 2개 만들기 (41 마무리, 목업 확정됨 — 바로 구현)**. API·응답 형태는 design.md '반려 사유 관리·분석', 테스트는 `backend/test/reject-reasons.test.mjs`
   - 설정 > 판정 > **반려 사유** (`/settings/reject-reasons`): `GET/POST /api/admin/reject-reasons`, `GET/PATCH /:code`, `POST /:code/deactivate|activate`, `DELETE /:code`, `PUT /order {codes}`. 상태 칩(사용 중/사용 안 함/전체)은 목록을 화면에서 걸러 센다. 순서는 ↑↓로 바꾸고 하단 고정 바(`변경 N건`·요약·되돌리기·순서 저장). 수정 모달은 신규/수정 겸용(코드는 신규에서만), 사용 현황·변경 이력, 왼쪽 '사용 안 함'·(가능할 때만) '삭제'. `RolesPage`/`RoleEditDialog`가 같은 정책이라 참고
   - 모니터링 > 분석 > **반려 사유 분석** (`/monitoring/reject-reasons`): `GET /api/stats/reject-reasons?days=7|30&reviewerId=`. 기간 칩·검수자 콤보, 결과 막대(그대로/일부/전부 바꿈/없음, 이름·수치 함께), 사유별 표(채택률·적중률 막대, `기타`는 적중률 '해당 없음'), 자주 바뀐 조합
   - 할 일: `api/index.ts`에 함수·타입, 두 페이지, `App.tsx` 라우트, `config/menu.ts`의 `PLACEHOLDER_PATHS`에서 두 경로 빼기, 사유 변경 뒤 `['reject-reasons']` 쿼리 무효화, E2E 1개씩, 문서(guide 사용법, README 테스트 개수)
2. **실제 서버에 올려 보기** — deploy.md 6장 순서. VPS·도메인이 필요하다. 올린 뒤 인증서·로그인·업로드·재부팅 후 자동 시작·백업/복원을 확인
3. 모델 개선·다른 모델 비교(`python/evaluate.py`로 정답과 비교), 다국어

**새 세션 시작 문구**: `docs/progress.md 읽고 이어서 해줘`

## 다음에 이어서 할 일 (여기서부터 재개)
**지금 진행 중인 큰 작업: 파일 수신 시 사전 검증.** 결정과 이유는 [docs/design.md](design.md) 8장, 개념 설명은 [docs/study-notes.md](study-notes.md).
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

- 공통 규칙(목록 페이징): 기본 20건, 목록 하단 좌측 콤보박스로 20/50/100/1000 선택, 가운데 번호(10개 묶음) 이동 (`components/common/Pagination.tsx`, `lib/paging.ts`, 서버 상한 `backend/src/paging.mjs`). 새 목록 화면은 모두 이것을 쓴다.
11. [x] 사용자 관리 1단계: 계정 상태(승인 대기/사용 중/만료/비활성)·사용기한·신청 권한. 가입은 승인 신청, 로그인 시 상태별 안내와 기한 +1년 갱신, 토큰도 매 요청 상태 확인. 마이그레이션 005 (화면 없음)
12. [x] 사용자 관리 2단계 API: `/api/admin/users` (목록·필터·건수, 수정, 일괄 처리 `bulk`: 승인/반려/비활성/재활성/만료 해제, 임시 비밀번호), 가입 시 프로필, 만료 해제 요청 `/api/auth/expiry-release-request`, 사용자 이력. 마이그레이션 006 
13. [x] 사용자 관리 화면 (설정 > 사용자 > 사용자 관리): 상태 필터(건수)·권한·검색, 상태별 열, 선택 후 일괄 승인/반려/비활성/재활성/만료 해제(전체 선택 시 100명씩 자동 분할), 수정 모달(권한·사용기한·소속·연락처·임시 비밀번호·이력). 가입 화면에 소속·연락처, 로그인 화면에 만료 해제 요청
14. [x] 사용자 관리 3단계 API: 권한(roles)·권한 코드(permissions)·메뉴(menus)·권한별 부여(role_permissions)를 DB로. 서버의 모든 권한 검사가 `isAdmin()` 대신 권한 코드(`can()`, `requirePermission`)로 바뀜. `/api/menus/mine`, `/api/admin/permissions`(조회·`PUT /admin/roles/:code/permissions`·이력), `/auth/me`에 권한 코드. 마이그레이션 007 
15. [x] 사용자 관리 3단계 화면: 설정 > 사용자 > 권한별 메뉴(권한 × 메뉴·기능 체크 표, 변경 요약·저장·되돌리기·이력). 화면 메뉴를 `/api/menus/mine`에서 받아 그리고, 화면의 `role === 'admin'` 비교를 권한 코드(`useCan`)로 교체, 권한 없는 경로는 '권한 없음' 안내

16. [x] 권한 종류 DB 전환: 고정 목록(`ROLES`·`ROLE_LABEL`) 제거, `GET /roles`·`/auth/signup-roles`, `roles.signup_selectable`(마이그레이션 008), 권한별 메뉴 표에 권한 다중 선택 필터·가로 스크롤(첫 열 고정), 접근 불가 안내

17. [x] 권한 관리: `/api/admin/roles`(만들기·수정·설명·사용 안 함/다시 사용·삭제, 이력; 마이그레이션 009), 삭제 대신 「사용 안 함」이 기본(cascade 없음, 사용자·이력 없을 때만 삭제), 화면(설정 > 사용자 > 권한 관리: 목록·통합 모달)과 권한별 메뉴 표 열 머리의 설명 툴팁

18. [x] 사유 코드 `UNKNOWN`(원인 미분류) 추가(마이그레이션 010). 실제 모델 어댑터(PatchCore, Anomalib): `MODEL_ADAPTER=patchcore`, Python 추론 서버 `python/serve.py` + 학습 `python/train.py`(사용법 `python/README.md`), 점수 0~1 변환·이상 맵 → 원본 픽셀 박스·투명 히트맵 PNG

19. [x] 신규 배정 담당자 후보를 기능 권한 `assignment.receive`(배정받기)로: `GET /api/assignees`, 배정 생성 시 서버 검증(마이그레이션 011), 권한별 메뉴 표에서 켜고 끔

20. [x] 이미지 업로드: API(`/api/uploads`, 마이그레이션 012; 배치·파일 기록, 수신 폴더 반입, 처리 현황 추적, 수천 장 대응) + 화면(데이터 > 이미지 > 이미지 업로드: 파일·폴더 끌어놓기/선택, 4장씩 동시 전송·재시도·일시 중지·취소, 업로드 이력과 파일별 처리 현황)

21. [x] 모델 평가 도구(`python/evaluate.py`, `metrics.py`): 정답 데이터로 이미지 AUROC·컷오프별 잡는 비율/오탐·박스 적중·결함 종류별·속도. 첫 결과(PatchCore): AUROC 0.683, 비율 이상(SCALE) 0.906은 잘 잡고 부품 개수(PART_COUNT) 0.563은 거의 무작위 — 연결 검증용 기준선이며 개선 후보는 design.md 9장 마지막
22. [x] 비밀값 교체 스크립트(`npm run rotate-secrets`: .env의 DB 비밀번호·JWT_SECRET을 새 값으로, 값은 출력하지 않음), 실행·초기화·교체 절차 문서화(guide 4장)

23. [x] 로그인 시도 횟수 제한: 이메일당 15분에 5번 / 주소당 30번 실패하면 15분 잠금(429 `LOCKED`), 없는 이메일도 똑같이 처리, 성공하면 초기화, 만료 해제 요청과 횟수 공유. 마이그레이션 013, `src/loginGuard.mjs`

24. [x] 임시 비밀번호 메일 발송 + 비밀번호 변경 강제: 백엔드(마이그레이션 014, `src/mail.mjs`, `POST /auth/change-password`, `MAIL_MODE`)와 화면. 임시 비밀번호로 로그인하면 변경 화면만 보이고(서버도 다른 API를 403으로 막음) 바꾸면 원래 화면으로 간다. 상단 `비밀번호 변경`으로 본인이 언제든 변경 가능, 사용자 수정 모달은 메일 발송 시 "메일로 발송했습니다"(관리자는 비밀번호를 못 봄)를 보여 준다. Playwright 시나리오 추가.

25. [x] 배포 준비: `Dockerfile`(화면 빌드+API 한 이미지), `docker-compose.yml`의 `app`·`worker`(프로필 `app`), 시작 시 마이그레이션·데모 데이터 자동 준비(`backend/scripts/docker-start.mjs`), API 서버의 화면 서빙(`FRONTEND_DIST`), `HOST`·`TRUST_PROXY`·`COOKIE_SECURE` 설정, `LICENSE`(MIT), [docs/deploy.md](deploy.md). 전체 스택을 격리 환경에서 띄워 로그인·파일 API·워커까지 확인.

26. [x] 공개용 데모 정리: `DEMO_MODE`(기본: 운영 모드가 아니면 켬, compose는 켬). 켜면 로그인 화면에 데모 계정 안내·기본 입력값을 보이고 시작 시 데모 배정 1건(qa1, 의심·불량 40장)을 만든다. 끄면(공개 서버) 빈 칸으로 시작하고 안내·배정 없음. 화면은 로그인 전 `GET /api/config`로 읽는다. 두 모드를 Docker로 확인.

28. [x] 공개 서버의 초기 비밀번호: `DEMO_MODE=false`면 시작할 때 비밀번호가 아직 `1234`인 계정을 찾아 관리자는 `.env`의 `ADMIN_PASSWORD`(12자 이상)로 교체하고 나머지 데모 계정은 비활성화+무작위 비밀번호로 만든다. 설정이 없거나 약하면 서버가 시작을 거부한다. 다시 시작해도 덮어쓰지 않는다. 로컬 데모(`DEMO_MODE=true`)는 `1234` 그대로. `src/bootstrap.mjs`, `npm run bootstrap-admin`. 컨테이너로 거부·적용·재시작을 확인.

29. [x] 핵심 흐름 E2E(Playwright `e2e/review-flow.spec.ts`): 관리자 배정 → QA 점검 시작 → 승인/반려 → 점검 완료 → 관리자 확인 완료.

27. [x] 포트폴리오용 화면 캡처(`captures/2026-11-14_v1.0-portfolio`, 11장: 로그인·배정·검수(라이트/다크)·신규 배정·소요 시간·규칙·사용자·권한별 메뉴·연계·업로드)와 README 맨 위 소개

30. [x] 검수 이미지 **크게 보기**(`Z`/이미지 클릭: 휠 확대·드래그 이동·더블클릭 맞춤/2배·원본 크기 1:1, 그 자리에서 승인/반려)와 **박스 호버 설명**(번호 배지만 상시, 올리면 한글 원인·점수·설명·위치 카드, 오른쪽 목록과 함께 강조). 목업을 Artifact로 먼저 보여 주고 확정. 원인 설명 문구 7종은 `lib/domain.ts`의 초안(사용자 확인 대기)

31. [x] 「모델 실행 이력」 메뉴 제거(마이그레이션 015): 화면을 만든 적 없고 소요 시간 분석이 모델 처리 시간을 이미 보여 줌

32. [x] **내 배정**(`/review/my-assignments`): `GET /api/assignments?mine=true`, 배정 리스트 화면을 재사용(신규 배정 버튼 없음)

33. [x] **점검 이력**(`/review/history`): `GET /api/review-history` — 검수 기록(번복 포함, `isCurrent`/'번복됨'), 내 기록/전체(배정 관리 권한), 결과 칩·검색·페이징

34. [x] **이미지 목록**(`/data/images`): `GET /api/image-list`(+상세) — 판정 칩(건수)·배정 여부·정렬·검색, 행을 누르면 보기 전용 확대. 열람 범위는 파일 API와 같은 기준

35. [x] **대시보드**(`/home/dashboard`): `GET /api/dashboard` — 내 검수 대기, 미배정 검수 대상, AI 판정 분포, 배정 현황, 검수 진행, 최근 7일 막대 차트(표로 보기). 이로써 '준비 중' 화면이 없다

36. [x] 버그 수정: 검수 화면에서 탭 버튼에 포커스가 있으면 ←/→ 이미지 이동이 안 되던 문제(캡처 단계 리스너). E2E에 방향키 검증 추가

37. [x] **검수 화면 필터·정렬**과 **신규 배정 옵션**: 검수 목록 위에 결과 칩(전체·미검토·승인·반려, 건수)·AI 판정 콤보박스·정렬 콤보박스(배정 순서 + 5종), 승인/반려 안내 문구. 배정할 때 **검수 순서**(점수 낮은/높은 순·경계에 가까운 순·이상 영역 많은 순·최신 수신순; 무작위는 사용자 결정으로 제외)와 **정상 표본 비율**(정상은 무작위 일부만, 의심·불량은 전부). 서버: `src/imageOrder.mjs`, `GET /assignments/:code/images?sort&filter&verdict`, `image-counts`, 필터·정렬 기준의 `next-unreviewed`. 목업을 Artifact로 먼저 보여 주고 확정

38. [x] 운영(VPS) 배포 준비: `docker-compose.prod.yml`(Caddy HTTPS 프록시, 공개 설정 고정), `deploy/Caddyfile`, `.env.production.example`, 기본 compose의 DB·앱 포트를 127.0.0.1로, deploy.md 6장(서버 올리기·운영·백업·점검표). 로컬(`DOMAIN=localhost`)에서 전체를 띄워 검증했고 **실제 서버·도메인에서는 아직 안 올려 봤다**

39. [x] **반려 사유 선택** (2026-11-21): 반려(`R`)하면 사유 상자가 열리고 AI가 찾은 원인이 미리 골라져 있다. 숫자키로 고치고 `Enter` 확정·`Esc` 취소, 사유 없이는 반려 불가, `기타`는 코멘트 필수. 크게 보기에서도 같은 상자. 점검 이력에 '반려 사유' 열. 마이그레이션 016(`reject_reasons` 표, `reviews.reasons`), `GET /api/reject-reasons`. 목업(A안/B안)을 Artifact로 먼저 보여 주고 A안으로 확정
40. [x] **이미지 목록 크게 보기가 쪽을 넘어도 유지** (2026-11-21, `534e7ef`): 쪽 끝에서 다음/이전이면 옆 쪽을 불러와 이어 본다, 위치는 전체 기준(`n / 전체`). 동작만 바뀌어 목업 생략. `lib/pagedNav.ts`(+단위 테스트), E2E는 쪽 크기를 5로 바꿔 경계를 만든다
41. [~] **반려 사유 관리·분석** (2026-11-21): 목업 확정 → **API 완료**(`ca58453`, 마이그레이션 017, 테스트 11개) → **화면 남음**(아래 '다음에 할 수 있는 일' 1번)

남은 후보(필요할 때): **실제 서버에 올려 보기**(deploy.md 6장 순서), 백업 복원 시험·자동화, 모델 개선·다른 모델 비교(평가 도구 있음), 다국어(design.md 6장).

### 점검 메모 (2026-11-04)
전체 점검 결과(2026-11-04 시점, 현재 개수는 아래 테스트 절): 백엔드 테스트 208개·프론트 50개·파이썬 17개 모두 통과, `tsc -b`·`vite build` 성공. 정리할 작은 항목:
- 프론트 린트(`npm run lint`, oxlint): 경고 0 (2026-11-05 정리, 바뀐 5곳은 Playwright 화면 테스트로 확인). 모달·폼을 불러온 값으로 채우던 `useEffect`+`setState`를 "렌더 중에 키가 바뀐 때만 한 번 채우기"로 바꿨고(UserEditDialog, RoleEditDialog, IntegrationFormDialog, RulesPage, MenusPage), shadcn 생성 폴더 `components/ui`는 `only-export-components` 규칙을 껐다. 브라우저 동작 확인은 아직 안 함.
- 번들 분할 완료(2026-11-05): 화면 본문 9개를 `React.lazy`로 나눠 첫 번들이 770KB → 373KB(gzip 241 → 118KB). 본문을 받는 동안에는 상단·좌측 메뉴를 유지하고 본문만 '불러오는 중…'. 이 점검 항목은 모두 정리됨.
- 화면 자동 테스트(Playwright) 12개 (2026-11-14): 폼 5곳, 임시 비밀번호→변경 강제, 배정~확인 완료 핵심 흐름(내 배정·방향키·점검 이력 포함), 박스 호버·확대 화면, 이미지 목록, 대시보드, 검수 필터·정렬·정상 표본. 이미지를 새로 배정하는 시나리오는 시작할 때 `freeImages`(테스트 서버 전용 경로)로 미배정 이미지를 같은 상태로 되돌린다.
- (2026-11-14) `npm test`(vitest)가 `e2e/` 폴더를 읽어 실패하던 문제를 `vite.config.ts`의 `test.exclude`로 고쳤다.

새 세션 시작: `docs/progress.md 읽고 이어서 해줘` 한 줄이면 된다 (CLAUDE.md가 progress.md → design.md 순서로 읽도록 안내함).

자세한 설계와 이유는 [docs/design.md](design.md) 참고.

## 진행 현황
- [x] 프론트엔드 목업: 로그인/회원가입, 레이아웃(상단·좌측·우측), 배정 리스트, 신규 배정 모달, 배정 상세(이미지 검수·이력)
- [x] DB 스키마 + `docker-compose.yml` (Postgres 16, 최초 11개 테이블 + 뷰 2개로 시작, 마이그레이션 014까지 적용 후 28개 테이블(`schema_migrations` 포함) + 뷰 2개)
- [x] JSON → DB 적재 스크립트: `cd backend && npm install && npm run load-mock` (3천 장 적재 검증, 재실행해도 중복 없음)
- [x] 목 이미지/모델 결과 생성 스크립트: `node backend/scripts/generate-mock.mjs --count 3000` → `data/images/`(git 제외), `results.jsonl`은 5장 JSON 계약 + originalPath/durationMs
- [x] 백엔드 API (Fastify): 인증, 배정 목록/상세/신규/상태 변경/점검 내용, 이미지 페이지 조회, 검수 저장, 파일 서빙 (`cd backend && npm run dev`, 포트 3000)
- [x] 규칙 관리 API(새 버전 쌓기·미리보기·재판정·되돌리기), 썸네일 생성 (화면 포함)
- [x] 프론트를 실제 API로 교체, 3천 장 대응 (서버 페이지네이션 + 가상 스크롤 + 낙관적 업데이트). 3천 장 배정 생성→점검→검수 흐름을 브라우저로 확인 (당시에는 사전배치 단계가 있었고 이후 ⑥에서 제거) (`captures/2026-11-02_v0.2-api-connected`)
- [x] 모니터링 페이지(소요 시간 분석): 담당자별 검수 속도, 배정별 소요, 모델 처리 시간, 수신 배치 기록 (`/monitoring/time`, 관리자 전용)
- [x] 파일 수신 사전 검증 1단계: 마이그레이션 체계(`npm run migrate`), 수신 상태 컬럼, 연계/수신 배치 테이블, 모델 어댑터 계약 검증 + 목 어댑터
- [x] 파일 수신 사전 검증 2단계: 폴더 스캔(안정 판정, 매직바이트, 해시 연결), 순차 추론, 실패 격리, 워커 (`npm run worker`)
- [x] 워커 단일 실행 잠금(advisory lock), 시작 시 고아 파일·PROCESSING 정리
- [x] 파일 수신 사전 검증 후속 (위 구현 순서 4~9: 파일 API, 실제 이미지 생성, 썸네일, 검수 화면 보기 모드, PRECHECKED 제거, 연계 관리)
- [x] 실제 모델 연동 (PatchCore 어댑터 + Python 추론 서버, 평가 도구로 기준선 측정)
- [x] 사용자·권한·메뉴 관리, 규칙 관리, 이미지 업로드, 비밀값 교체 (위 구현 순서 10~22)
