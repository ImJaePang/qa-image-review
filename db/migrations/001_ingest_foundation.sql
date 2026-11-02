-- 001: 파일 수신 사전 검증의 기반 (설계 8장)
--  * 공통 컬럼 규칙 소급: id / 등록자(created_by) / 등록일시(created_at) / 수정자(updated_by) / 수정일시(updated_at)
--    - 수정일시는 공통 트리거가 자동 갱신, 수정자는 API가 채운다 (NULL = 시스템).
--    - 쌓기만 하는 테이블(reviews, assignment_history, model_runs, detections, verdicts)과
--      소속만 나타내는 assignment_images, 곧 대체될 batch_jobs에는 수정 컬럼을 두지 않는다.
--  * images에 수신/추론 상태 컬럼 추가, 신설 테이블 integrations(연계), ingest_batches(수신 배치).
-- 기존 데이터는 그대로 두고 덧붙이기만 한다 (이미 적재된 이미지는 수신 완료 DONE으로 취급).

-- ───────────── 공통: 수정일시 자동 갱신 ─────────────
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ───────────── 연계 설정 / 수신 배치 ─────────────
CREATE TABLE integrations (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        text        NOT NULL CHECK (kind IN ('FOLDER')),   -- 이후 'DB' 등 추가
  name        text        NOT NULL UNIQUE,
  config      jsonb       NOT NULL DEFAULT '{}',                 -- 종류별 설정 (폴더 경로, 패턴, 주기 ...)
  enabled     boolean     NOT NULL DEFAULT true,
  created_by  bigint      REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  bigint      REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 수신 배치 = 스캔 1회에 발견된 파일 묶음
CREATE TABLE ingest_batches (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  integration_id  bigint      NOT NULL REFERENCES integrations(id),
  total_count     int         NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  processed_count int         NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  failed_count    int         NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  started_at      timestamptz NOT NULL DEFAULT now(),   -- 소요 시간 분석의 원천 (서버 시각)
  finished_at     timestamptz,
  created_by      bigint      REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      bigint      REFERENCES users(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ingest_batches_integration_idx ON ingest_batches (integration_id, started_at DESC);

-- ───────────── images: 수신/추론 상태 ─────────────
ALTER TABLE images
  ALTER COLUMN width  DROP NOT NULL,   -- 수신 직후(추론 전)에는 크기를 모를 수 있다
  ALTER COLUMN height DROP NOT NULL,
  ADD COLUMN sha256          text,                                   -- 같은 내용 판별용 (막는 용도가 아님)
  ADD COLUMN source_name     text,                                   -- 수신 당시 원래 파일명 (보존)
  ADD COLUMN source_path     text,                                   -- 파일의 현재 위치 (inbox → processing → done/failed 이동)
  ADD COLUMN ingest_status   text        NOT NULL DEFAULT 'DONE'
    CONSTRAINT images_ingest_status_check CHECK (ingest_status IN ('PENDING', 'PROCESSING', 'DONE', 'FAILED')),
  ADD COLUMN error           text,
  ADD COLUMN received_at     timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN origin_image_id bigint      REFERENCES images(id),      -- 같은 해시의 가장 처음 수신 행 (처음 수신은 NULL)
  ADD COLUMN batch_id        bigint      REFERENCES ingest_batches(id),
  ADD COLUMN created_by      bigint      REFERENCES users(id),
  ADD COLUMN updated_by      bigint      REFERENCES users(id),
  ADD COLUMN updated_at      timestamptz NOT NULL DEFAULT now();

-- 이미 적재된 이미지는 수신·추론이 끝난 것으로 본다
UPDATE images SET source_name = file_name, received_at = created_at;
-- 앞으로 새로 들어오는 행의 기본값은 대기
ALTER TABLE images ALTER COLUMN ingest_status SET DEFAULT 'PENDING';

ALTER TABLE images
  ADD CONSTRAINT images_done_has_size CHECK (ingest_status <> 'DONE' OR (width IS NOT NULL AND height IS NOT NULL)),
  ADD CONSTRAINT images_origin_not_self CHECK (origin_image_id IS NULL OR origin_image_id <> id);

CREATE INDEX images_sha256_idx  ON images (sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX images_origin_idx  ON images (origin_image_id) WHERE origin_image_id IS NOT NULL;
CREATE INDEX images_batch_idx   ON images (batch_id) WHERE batch_id IS NOT NULL;
-- 워커가 대기 건을 오래된 순으로 집는 쿼리용 (FOR UPDATE SKIP LOCKED)
CREATE INDEX images_pending_idx ON images (received_at, id) WHERE ingest_status = 'PENDING';

-- ───────────── 기존 테이블에 공통 컬럼 소급 ─────────────
ALTER TABLE users
  ADD COLUMN created_by bigint REFERENCES users(id),
  ADD COLUMN updated_by bigint REFERENCES users(id),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE rules
  ADD COLUMN created_by bigint REFERENCES users(id),
  ADD COLUMN updated_by bigint REFERENCES users(id),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- assignments는 created_by, updated_at이 이미 있다
ALTER TABLE assignments
  ADD COLUMN updated_by bigint REFERENCES users(id);

-- ───────────── 수정일시 트리거 ─────────────
CREATE TRIGGER users_set_updated_at          BEFORE UPDATE ON users          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER images_set_updated_at         BEFORE UPDATE ON images         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER rules_set_updated_at          BEFORE UPDATE ON rules          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER assignments_set_updated_at    BEFORE UPDATE ON assignments    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER integrations_set_updated_at   BEFORE UPDATE ON integrations   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER ingest_batches_set_updated_at BEFORE UPDATE ON ingest_batches FOR EACH ROW EXECUTE FUNCTION set_updated_at();
