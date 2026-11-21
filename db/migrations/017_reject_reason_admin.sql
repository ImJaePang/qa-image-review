-- 017: 반려 사유 관리 화면과 '반려 사유 분석' 통계
--  - ai_reason: AI 모델이 내는 원인 코드(detections.reason_code)와 같은 코드인 사유. 화면의 'AI 원인과 연결' 표시용.
--    관리 화면에서 새로 만든 사유는 false(모델이 그 원인을 내지 않으므로 반려 상자에 미리 골라지지 않는다).
--  - 삭제 대신 '사용 안 함'(active=false)이 기본. 진짜 삭제는 반려에 쓰인 적도, 변경 이력도 없을 때만. 이력은 FK 없이 남긴다.
ALTER TABLE reject_reasons ADD COLUMN ai_reason boolean NOT NULL DEFAULT false;
ALTER TABLE reject_reasons ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
UPDATE reject_reasons SET ai_reason = true
 WHERE code IN ('COMPOSITE_EDGE', 'SHAPE_DISTORTION', 'LIGHTING_MISMATCH', 'TEXTURE_ANOMALY', 'SCALE_ANOMALY', 'PART_COUNT_MISMATCH');

CREATE TABLE reject_reason_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reason_code text NOT NULL,                       -- 삭제된 뒤에도 이력은 남기므로 FK를 걸지 않는다
  action      text NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'REORDER', 'DEACTIVATE', 'ACTIVATE', 'DELETE')),
  detail      jsonb NOT NULL DEFAULT '{}',          -- 바뀐 항목 {필드: {from, to}}
  created_by  bigint REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reject_reason_history_idx ON reject_reason_history (reason_code, id DESC);

-- 메뉴: 모니터링 > 분석 > 반려 사유 분석 (소요 시간 분석 다음). 소요 시간 분석을 볼 수 있는 권한에 함께 준다.
INSERT INTO permissions (code, kind, label, sort_order) VALUES ('reject_stats.view', 'MENU', '반려 사유 분석', 41);
INSERT INTO menus (path, top_key, top_label, group_label, label, sort_order, permission_code)
  VALUES ('/monitoring/reject-reasons', 'monitoring', '모니터링', '분석', '반려 사유 분석', 41, 'reject_stats.view');
INSERT INTO role_permissions (role_code, permission_code)
  SELECT role_code, 'reject_stats.view' FROM role_permissions WHERE permission_code = 'monitoring.view';

-- 메뉴: 설정 > 판정 > 반려 사유 (임계값/규칙 다음). 뒤의 설정 메뉴는 한 칸씩 민다.
UPDATE permissions SET sort_order = sort_order + 1 WHERE kind = 'MENU' AND sort_order >= 51;
UPDATE menus SET sort_order = sort_order + 1 WHERE sort_order >= 51;
INSERT INTO permissions (code, kind, label, sort_order) VALUES ('reject_reason.manage', 'MENU', '반려 사유', 51);
INSERT INTO menus (path, top_key, top_label, group_label, label, sort_order, permission_code)
  VALUES ('/settings/reject-reasons', 'settings', '설정', '판정', '반려 사유', 51, 'reject_reason.manage');
INSERT INTO role_permissions (role_code, permission_code) VALUES ('admin', 'reject_reason.manage');
