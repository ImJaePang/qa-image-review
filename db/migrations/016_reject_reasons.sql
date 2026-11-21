-- 016: 반려 사유
--  반려할 때 사유를 하나 이상 고른다(서버가 강제). 사유 목록은 코드에 고정하지 않고 이 표에서 관리한다.
--  코드는 AI 원인 코드(detections.reason_code)와 같게 맞춰, 나중에 'AI가 말한 원인 ↔ 사람이 고른 사유'를 비교할 수 있게 한다.
--  UNKNOWN(원인 미분류)은 사람이 고를 사유가 아니므로 빼고, 대신 OTHER(기타, 코멘트 필수)를 둔다.
CREATE TABLE reject_reasons (
  code             text    PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  label            text    NOT NULL,
  sort_order       int     NOT NULL DEFAULT 0,
  requires_comment boolean NOT NULL DEFAULT false, -- 고르면 코멘트를 반드시 적어야 하는 사유(기타)
  active           boolean NOT NULL DEFAULT true   -- 사용 안 함: 선택지에서만 빠지고 기존 기록은 유지
);
INSERT INTO reject_reasons (code, label, sort_order, requires_comment) VALUES
  ('COMPOSITE_EDGE',      '합성 경계 이상',    1, false),
  ('SHAPE_DISTORTION',    '형태/구조 왜곡',    2, false),
  ('LIGHTING_MISMATCH',   '조명·음영 불일치',  3, false),
  ('TEXTURE_ANOMALY',     '질감 이상',         4, false),
  ('SCALE_ANOMALY',       '비율/스케일 이상',  5, false),
  ('PART_COUNT_MISMATCH', '부품 개수 불일치',  6, false),
  ('OTHER',               '기타',              7, true);

-- 검수 한 건에 고른 사유 코드들. 승인에는 사유가 없다.
--  (이 마이그레이션 전에 저장된 반려는 사유가 비어 있으므로 '반려면 1개 이상'은 DB 제약이 아니라 서버가 검사한다)
ALTER TABLE reviews ADD COLUMN reasons text[] NOT NULL DEFAULT '{}';
ALTER TABLE reviews ADD CONSTRAINT reviews_reasons_only_rejected CHECK (status = 'REJECTED' OR cardinality(reasons) = 0);

CREATE OR REPLACE VIEW review_current AS
SELECT DISTINCT ON (assignment_id, image_id)
       assignment_id, image_id, reviewer_id, status, comment, decided_at, reasons
FROM reviews
ORDER BY assignment_id, image_id, decided_at DESC, id DESC;
