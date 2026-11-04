-- 012: 이미지 업로드 - 누가·언제·무엇을 올렸는지 DB에 기록한다 (수신 폴더로 들어간 뒤 처리 결과까지 이어서 추적)
--  upload_batches = 한 번의 업로드 작업(수천 장도 하나의 배치로 묶고, 화면은 나눠서 전송)
--  upload_files   = 파일 1개. 서버가 받아 수신 폴더에 둔 파일은 RECEIVED, 이미지가 아니거나 너무 큰 파일은 REJECTED(이유 기록).
--  upload_files.image_id : 수신 폴더 스캔이 이 파일을 images로 등록하면 채워진다(stored_name으로 연결). 비어 있으면 아직 수신 대기.
CREATE TABLE upload_batches (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  integration_id bigint      NOT NULL REFERENCES integrations(id),   -- 어느 수신 폴더 연계로 들어가는지
  created_by     bigint      NOT NULL REFERENCES users(id),
  expected_count int         NOT NULL CHECK (expected_count >= 0),    -- 화면이 올리려고 한 장수
  memo           text,
  status         text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DONE', 'CANCELED')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz
);
CREATE INDEX upload_batches_idx ON upload_batches (id DESC);
CREATE INDEX upload_batches_user_idx ON upload_batches (created_by, id DESC);

CREATE TABLE upload_files (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id      bigint      NOT NULL REFERENCES upload_batches(id) ON DELETE CASCADE,
  original_name text        NOT NULL,                                -- 사용자가 올린 파일 이름 (화면 표시용)
  stored_name   text        UNIQUE,                                  -- 수신 폴더에 둔 이름(up<id>__…). REJECTED는 없음
  size_bytes    bigint      NOT NULL DEFAULT 0,
  sha256        text,
  status        text        NOT NULL CHECK (status IN ('RECEIVED', 'REJECTED')),
  reason        text,                                                -- REJECTED 이유
  image_id      bigint      REFERENCES images(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX upload_files_batch_idx ON upload_files (batch_id, id);
CREATE INDEX upload_files_image_idx ON upload_files (image_id) WHERE image_id IS NOT NULL;

-- 이미지 업로드는 화면(메뉴)이 생겼으므로 '준비 중' 기능 권한이 아니라 메뉴 권한으로 올린다: 데이터 > 이미지 > 이미지 업로드
UPDATE permissions SET kind = 'MENU', label = '이미지 업로드', description = NULL, sort_order = 31 WHERE code = 'image.upload';
UPDATE permissions SET sort_order = 32 WHERE code = 'model_run.view';
UPDATE menus SET sort_order = 32 WHERE path = '/data/model-runs';
INSERT INTO menus (path, top_key, top_label, group_label, label, sort_order, permission_code)
  VALUES ('/data/upload', 'data', '데이터', '이미지', '이미지 업로드', 31, 'image.upload');

-- 업로드 이력을 남의 것까지 볼 수 있는 기능 권한 (기본: 관리자만). 없으면 내가 올린 것만 보인다.
INSERT INTO permissions (code, kind, label, description, sort_order) VALUES
  ('upload.view_all', 'FUNCTION', '모든 업로드 이력 보기', '다른 사람이 올린 이미지의 업로드 이력과 처리 현황도 볼 수 있다', 104);
INSERT INTO role_permissions (role_code, permission_code) VALUES ('admin', 'upload.view_all');
