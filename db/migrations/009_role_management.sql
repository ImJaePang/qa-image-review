-- 009: 권한(역할) 관리 - 설명, 사용 여부(삭제 대신 비활성), 변경 이력, 메뉴/권한 코드
ALTER TABLE roles ADD COLUMN description text;                       -- 선택 입력 (권한 관리 화면에서만 보인다)
ALTER TABLE roles ADD COLUMN is_active boolean NOT NULL DEFAULT true; -- false = 사용 안 함: 새 가입·승인·권한 변경에서 빠지고 기존 사용자는 그대로
ALTER TABLE roles ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE role_history (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_code  text NOT NULL,                       -- 삭제된 뒤에도 이력은 남기므로 FK를 걸지 않는다
  action     text NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DEACTIVATE', 'ACTIVATE', 'DELETE')),
  detail     jsonb NOT NULL DEFAULT '{}',          -- 바뀐 항목 {필드: {from, to}}
  created_by bigint REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX role_history_idx ON role_history (role_code, id DESC);

-- 메뉴: 설정 > 사용자 > 권한 관리 (사용자 관리 다음, 권한별 메뉴 앞)
UPDATE permissions SET sort_order = 54 WHERE code = 'menu.manage';
UPDATE menus SET sort_order = 54 WHERE path = '/settings/menus';
INSERT INTO permissions (code, kind, label, sort_order) VALUES ('role.manage', 'MENU', '권한 관리', 53);
INSERT INTO menus (path, top_key, top_label, group_label, label, sort_order, permission_code)
  VALUES ('/settings/roles', 'settings', '설정', '사용자', '권한 관리', 53, 'role.manage');
INSERT INTO role_permissions (role_code, permission_code) VALUES ('admin', 'role.manage');
