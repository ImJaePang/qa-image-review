# AI 생성 이미지 QA 검수 시스템

AI가 생성한 이미지를 사전 검증한 뒤, QA 담당자가 화면에서 검수(승인/반려)하는 연습용 미니 프로젝트.
기획 전문은 [docs/plan.md](docs/plan.md) 참고.

## 구조
```
frontend/   React + Vite + TypeScript + Tailwind + shadcn/ui (목 데이터로 동작)
backend/    (예정) Node.js + PostgreSQL
db/init/    스키마·시드 SQL (컨테이너 최초 기동 시 자동 실행)
docs/       기획서
```

## 실행 (프론트엔드)
```
cd frontend
npm install
npm run dev
```
데모 계정: `admin@example.com`(관리자), `qa1@example.com`(QA) / 비밀번호 `1234`

## 진행 현황
- [x] 프론트엔드 목업: 로그인/회원가입, 레이아웃(상단·좌측·우측), 배정 리스트, 신규 배정 모달, 배정 상세(이미지 검수·이력)
- [x] DB 스키마 + `docker-compose.yml` (Postgres 16, 11개 테이블 + 뷰 2개, 기동/제약 검증 완료)
- [ ] 백엔드 API (목록/상세/배정/검수), 규칙 층, 썸네일 생성
- [ ] 프론트를 실제 API로 교체, 3천 장 대응(서버 페이지네이션, 가상 스크롤)
- [ ] 모니터링 페이지(소요 시간 분석)
- [ ] (선택) 실제 모델 연동

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
- DB의 상태/판정 값은 영문 코드로 저장 (ASSIGNED/PRECHECKED/IN_REVIEW/REVIEWED/CONFIRMED, NORMAL/SUSPECT/DEFECT, APPROVED/REJECTED), 한글 표기는 화면에서 매핑
- `assignment_images`는 소속(+배정 시점의 AI 결과 run_id)만, 검수 결과는 `reviews`에 쌓고 최신 행이 현재 상태 (뷰 `review_current`)
- 사전배치 실행 기록은 `batch_jobs`, 상태 변경은 `assignment_history`에 남겨 소요 시간 분석에 사용
