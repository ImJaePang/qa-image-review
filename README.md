# AI 생성 이미지 QA 검수 시스템

AI가 생성한 이미지를 사전 검증한 뒤, QA 담당자가 화면에서 검수(승인/반려)하는 연습용 미니 프로젝트.
기획 전문은 [docs/plan.md](docs/plan.md) 참고.

## 구조
```
frontend/   React + Vite + TypeScript + Tailwind + shadcn/ui (목 데이터로 동작)
backend/    (예정) Node.js + PostgreSQL
db/         (예정) 스키마 SQL
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
- [ ] DB 스키마 설계 → `docker-compose.yml` + 초기화 SQL
- [ ] 백엔드 API (목록/상세/배정/검수), 규칙 층, 썸네일 생성
- [ ] 프론트를 실제 API로 교체, 3천 장 대응(서버 페이지네이션, 가상 스크롤)
- [ ] 모니터링 페이지(소요 시간 분석)
- [ ] (선택) 실제 모델 연동

## 결정 사항
- 저장소는 프론트/백엔드를 함께 두는 모노레포
- DB는 PostgreSQL (직접 운영, Docker)
- 검수 결과(`reviews`)는 별도 테이블, 쌓기만 하는 기록. 소요 시간은 서버가 저장한 시각(`decided_at`, 상태 이력)으로 계산
- 강조색은 진한 연두색
- 회사 데이터는 절대 사용하지 않음
