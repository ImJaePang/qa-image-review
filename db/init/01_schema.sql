-- AI 생성 이미지 QA 검수 시스템 스키마 (PostgreSQL 16)
-- 컨테이너 최초 기동 시 /docker-entrypoint-initdb.d 에서 파일명 순서대로 실행된다.
--
-- 규칙
--  * 상태/판정/사유 값은 영문 코드로 저장한다 (화면 표시용 한글은 프론트/API에서 매핑).
--  * 시각은 모두 timestamptz, 서버(DB)가 찍는다. 소요 시간 분석은 이 값들로 계산한다.
--  * 모델 출력(model_runs/detections)과 판정(verdicts)은 분리한다. 규칙만 바꿔 재판정 가능.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────── 사용자 ─────────────
CREATE TABLE users (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name           text        NOT NULL,
  email          text        NOT NULL UNIQUE,
  password_hash  text        NOT NULL,
  role           text        NOT NULL CHECK (role IN ('admin', 'qa')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ───────────── 이미지 / 모델 결과 ─────────────
CREATE TABLE images (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  image_key     text        NOT NULL UNIQUE,          -- 예: img_0001 (외부에 노출되는 식별자)
  file_name     text        NOT NULL,
  width         int         NOT NULL CHECK (width > 0),
  height        int         NOT NULL CHECK (height > 0),
  original_path text        NOT NULL,                 -- 원본은 보존, 판정은 원본 기준
  preview_path  text,                                 -- 화면용 사본 (webp 등)
  thumb_path    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE model_runs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  image_id      bigint      NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  model_version text        NOT NULL,                 -- 항상 기록 (재판정/비교용)
  overall_score numeric(4,3) NOT NULL CHECK (overall_score BETWEEN 0 AND 1),
  heatmap_path  text,
  duration_ms   int,                                  -- 모델 1장 처리 시간 (모니터링)
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_runs_image_idx ON model_runs (image_id, created_at DESC);

CREATE TABLE detections (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id       bigint       NOT NULL REFERENCES model_runs(id) ON DELETE CASCADE,
  x            int          NOT NULL,                 -- 좌표는 원본 이미지 픽셀 기준
  y            int          NOT NULL,
  width        int          NOT NULL CHECK (width > 0),
  height       int          NOT NULL CHECK (height > 0),
  score        numeric(4,3) NOT NULL CHECK (score BETWEEN 0 AND 1),
  reason_code  text         NOT NULL CHECK (reason_code IN (
    'COMPOSITE_EDGE', 'SHAPE_DISTORTION', 'LIGHTING_MISMATCH',
    'TEXTURE_ANOMALY', 'SCALE_ANOMALY', 'PART_COUNT_MISMATCH'))
);
CREATE INDEX detections_run_idx ON detections (run_id);

-- ───────────── 판정 규칙 / 판정 ─────────────
CREATE TABLE rules (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text        NOT NULL,
  version     int         NOT NULL DEFAULT 1,
  params      jsonb       NOT NULL,                   -- 예: {"normalMin":0.9,"suspectMin":0.5}
  enabled     boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);

CREATE TABLE verdicts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id      bigint      NOT NULL REFERENCES model_runs(id) ON DELETE CASCADE,
  rule_id     bigint      NOT NULL REFERENCES rules(id),  -- 어떤 규칙 버전으로 판정했는지
  result      text        NOT NULL CHECK (result IN ('NORMAL', 'SUSPECT', 'DEFECT')),
  reasons     jsonb       NOT NULL DEFAULT '[]',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, rule_id)
);
CREATE INDEX verdicts_result_idx ON verdicts (result);

-- ───────────── 배정 ─────────────
CREATE TABLE assignments (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code            text GENERATED ALWAYS AS ('AS-' || lpad(id::text, 4, '0')) STORED UNIQUE,
  title           text        NOT NULL,
  assignee_id     bigint      NOT NULL REFERENCES users(id),
  created_by      bigint      NOT NULL REFERENCES users(id),
  status          text        NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN (
    'ASSIGNED',      -- 배정
    'PRECHECKED',    -- 사전배치
    'IN_REVIEW',     -- 점검중
    'REVIEWED',      -- 점검완료
    'CONFIRMED')),   -- 확인완료
  due_date        date        NOT NULL,
  inspection_note text        NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assignments_status_idx   ON assignments (status);
CREATE INDEX assignments_assignee_idx ON assignments (assignee_id, status);

-- 배정에 어떤 이미지가 들어 있는지 (소속만 담당, 한 배정에 수천 장)
CREATE TABLE assignment_images (
  assignment_id bigint NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  image_id      bigint NOT NULL REFERENCES images(id),
  run_id        bigint NOT NULL REFERENCES model_runs(id),  -- 배정 시점에 검수자가 보는 AI 결과
  position      int    NOT NULL,                            -- 검수 화면 정렬 순서
  PRIMARY KEY (assignment_id, image_id)
);
CREATE INDEX assignment_images_order_idx ON assignment_images (assignment_id, position);
CREATE INDEX assignment_images_image_idx ON assignment_images (image_id);

-- 상태 변경/처리 이력: 단계별 소요 시간 분석의 원천
CREATE TABLE assignment_history (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assignment_id bigint      NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  from_status   text,
  to_status     text,
  action        text        NOT NULL,                  -- 예: '점검 시작', '점검 내용 저장'
  actor_id      bigint      REFERENCES users(id),      -- NULL = 시스템
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assignment_history_idx ON assignment_history (assignment_id, at);

-- ───────────── 검수 결과 (쌓기만 하는 기록) ─────────────
-- 판정을 바꾸면 행을 추가한다. 가장 최근 행이 현재 상태, 행이 없으면 미검토.
CREATE TABLE reviews (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assignment_id bigint      NOT NULL,
  image_id      bigint      NOT NULL,
  reviewer_id   bigint      NOT NULL REFERENCES users(id),
  status        text        NOT NULL CHECK (status IN ('APPROVED', 'REJECTED')),
  comment       text        NOT NULL DEFAULT '',
  decided_at    timestamptz NOT NULL DEFAULT now(),    -- 서버가 저장하는 시각 기준
  FOREIGN KEY (assignment_id, image_id) REFERENCES assignment_images (assignment_id, image_id) ON DELETE CASCADE
);
CREATE INDEX reviews_latest_idx   ON reviews (assignment_id, image_id, decided_at DESC);
CREATE INDEX reviews_reviewer_idx ON reviews (reviewer_id, decided_at);

-- ───────────── 사전배치(AI 사전 검증) 실행 기록 ─────────────
CREATE TABLE batch_jobs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assignment_id   bigint      NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  model_version   text        NOT NULL,
  status          text        NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  total_count     int         NOT NULL DEFAULT 0,
  processed_count int         NOT NULL DEFAULT 0,
  failed_count    int         NOT NULL DEFAULT 0,
  started_at      timestamptz,
  finished_at     timestamptz,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX batch_jobs_assignment_idx ON batch_jobs (assignment_id, created_at DESC);

-- ───────────── 조회용 뷰 ─────────────
-- 이미지별 현재 검수 상태 (최신 review 한 건)
CREATE VIEW review_current AS
SELECT DISTINCT ON (assignment_id, image_id)
       assignment_id, image_id, reviewer_id, status, comment, decided_at
FROM reviews
ORDER BY assignment_id, image_id, decided_at DESC, id DESC;

-- 배정 목록 화면용: 장수, AI 판정 분포, 검수 진행
CREATE VIEW assignment_summary AS
SELECT a.id,
       a.code,
       a.title,
       a.status,
       a.due_date,
       a.created_at,
       u.name AS assignee_name,
       count(ai.image_id)                                   AS total_images,
       count(*) FILTER (WHERE v.result = 'NORMAL')          AS normal_count,
       count(*) FILTER (WHERE v.result = 'SUSPECT')         AS suspect_count,
       count(*) FILTER (WHERE v.result = 'DEFECT')          AS defect_count,
       count(rc.image_id)                                   AS reviewed_count
FROM assignments a
JOIN users u               ON u.id = a.assignee_id
LEFT JOIN assignment_images ai ON ai.assignment_id = a.id
LEFT JOIN LATERAL (
  SELECT result FROM verdicts WHERE run_id = ai.run_id ORDER BY created_at DESC LIMIT 1
) v ON true
LEFT JOIN review_current rc ON rc.assignment_id = ai.assignment_id AND rc.image_id = ai.image_id
GROUP BY a.id, u.name;
