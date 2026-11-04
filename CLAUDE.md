# 프로젝트 안내 (Claude용)

AI 생성 이미지 QA 검수 시스템 연습 프로젝트. 사용자는 한국어로 대화한다.

작업 시작 전에 읽을 것: `README.md`(진행 현황, 다음 할 일) → `docs/design.md`(설계 결정과 이유) → 필요 시 `docs/plan.md`(기획 원문).

## 규칙
- 회사 데이터/자료는 절대 사용하지 않는다 (군수 관련 보안). 연습 데이터는 직접 만든 것만.
- 판정 임계값을 코드에 하드코딩하지 않는다 (`rules` 테이블/설정). 판정 시 모델 버전과 규칙 버전을 항상 기록한다.
- 모델 호출부는 어댑터로 분리하고 출력 형식(기획서 5장 JSON 계약)을 고정한다.
- 박스 좌표는 원본 이미지 픽셀 기준으로 저장한다.
- DB의 상태/판정 값은 영문 코드, 한글은 화면에서 매핑한다.
- 소요 시간 분석은 서버가 저장한 시각(`reviews.decided_at`, `assignment_history`, `ingest_batches`)으로 계산한다.
- 커밋/푸시는 사용자가 요청할 때만 한다. `.env`는 커밋하지 않는다.

## 명령
- 프론트: `cd frontend && npm run dev` (타입 체크 `npx tsc -b`, 빌드 `npx vite build`)
- DB: 루트에서 `docker compose up -d` / `docker compose down` (`-v`는 데이터 삭제)
