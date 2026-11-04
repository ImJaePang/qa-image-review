-- 007: 권한(역할)·권한 코드·메뉴를 DB로 관리 (사용자 관리 3단계)
--  권한 판단의 단일 근거: role_permissions (권한 × 권한 코드).
--  메뉴는 각자 권한 코드 하나에 묶이고(menus.permission_code), 그 코드를 가진 권한의 사용자에게만 보인다.
--  서버(API)도 같은 표로 검사한다 → 화면에서 숨기기만 하는 것이 아니다.
--  permissions.kind: MENU = 메뉴 접근, FUNCTION = 메뉴와 별개의 동작(배정 만들기, 모든 이미지 열람, 이미지 업로드 …)

CREATE TABLE roles (
  code       text PRIMARY KEY,
  label      text NOT NULL,
  sort_order int  NOT NULL DEFAULT 0,
  is_system  boolean NOT NULL DEFAULT false   -- true = 삭제·코드 변경 불가
);
INSERT INTO roles (code, label, sort_order, is_system) VALUES
  ('admin', '관리자', 1, true), ('researcher', '연구원', 2, false), ('qa', 'QA', 3, false);

-- users.role의 고정 CHECK를 roles 참조로 바꾼다 (권한 종류를 DB에서 늘릴 수 있게)
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_fkey FOREIGN KEY (role) REFERENCES roles(code);

CREATE TABLE permissions (
  code        text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('MENU', 'FUNCTION')),
  label       text NOT NULL,
  description text,
  sort_order  int  NOT NULL DEFAULT 0
);
INSERT INTO permissions (code, kind, label, sort_order) VALUES
  ('dashboard.view',      'MENU', '대시보드', 10),
  ('assignment.view',     'MENU', '배정 리스트', 20),
  ('my_assignment.view',  'MENU', '내 배정', 21),
  ('history.view',        'MENU', '점검 이력', 22),
  ('image_list.view',     'MENU', '이미지 목록', 30),
  ('model_run.view',      'MENU', '모델 실행 이력', 31),
  ('monitoring.view',     'MENU', '소요 시간 분석', 40),
  ('rule.manage',         'MENU', '임계값/규칙', 50),
  ('integration.manage',  'MENU', '연계 관리', 51),
  ('user.manage',         'MENU', '사용자 관리', 52),
  ('menu.manage',         'MENU', '권한별 메뉴', 53);
INSERT INTO permissions (code, kind, label, description, sort_order) VALUES
  ('assignment.manage', 'FUNCTION', '배정 만들기 · 확인 완료 처리', '신규 배정을 만들고, 점검 완료된 배정을 확인 완료로 바꾸며, 남의 배정도 처리할 수 있다', 100),
  ('image.view_all',    'FUNCTION', '모든 이미지 열람', '배정되지 않은 이미지·남에게 배정된 이미지의 원본과 미리보기도 볼 수 있다', 101),
  ('image.upload',      'FUNCTION', '이미지 업로드', '수신 폴더에 이미지를 올린다 (준비 중)', 102);

CREATE TABLE menus (
  path            text PRIMARY KEY,                 -- 화면 경로 (예: /settings/users)
  top_key         text NOT NULL,                    -- 상단 메뉴
  top_label       text NOT NULL,
  group_label     text NOT NULL,                    -- 좌측 중메뉴
  label           text NOT NULL,                    -- 소메뉴
  sort_order      int  NOT NULL DEFAULT 0,
  permission_code text NOT NULL REFERENCES permissions(code)
);
INSERT INTO menus (path, top_key, top_label, group_label, label, sort_order, permission_code) VALUES
  ('/home/dashboard',          'home',       '홈',      '현황',   '대시보드',       10, 'dashboard.view'),
  ('/review/assignments',      'review',     '검수 관리', '배정',   '배정 리스트',    20, 'assignment.view'),
  ('/review/my-assignments',   'review',     '검수 관리', '배정',   '내 배정',        21, 'my_assignment.view'),
  ('/review/history',          'review',     '검수 관리', '점검',   '점검 이력',      22, 'history.view'),
  ('/data/images',             'data',       '데이터',   '이미지', '이미지 목록',    30, 'image_list.view'),
  ('/data/model-runs',         'data',       '데이터',   '모델',   '모델 실행 이력', 31, 'model_run.view'),
  ('/monitoring/time',         'monitoring', '모니터링', '분석',   '소요 시간 분석', 40, 'monitoring.view'),
  ('/settings/rules',          'settings',   '설정',     '판정',   '임계값/규칙',    50, 'rule.manage'),
  ('/settings/integrations',   'settings',   '설정',     '연계',   '연계 관리',      51, 'integration.manage'),
  ('/settings/users',          'settings',   '설정',     '사용자', '사용자 관리',    52, 'user.manage'),
  ('/settings/menus',          'settings',   '설정',     '사용자', '권한별 메뉴',    53, 'menu.manage');

CREATE TABLE role_permissions (
  role_code       text NOT NULL REFERENCES roles(code),
  permission_code text NOT NULL REFERENCES permissions(code),
  PRIMARY KEY (role_code, permission_code)
);
-- 기본값: 관리자 = 전부, 연구원 = 보기 + 모델 이력 + 모든 이미지 열람 + 업로드, QA = 보기
INSERT INTO role_permissions (role_code, permission_code) SELECT 'admin', code FROM permissions;
INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('researcher', 'dashboard.view'), ('researcher', 'assignment.view'), ('researcher', 'my_assignment.view'), ('researcher', 'history.view'),
  ('researcher', 'image_list.view'), ('researcher', 'model_run.view'), ('researcher', 'image.view_all'), ('researcher', 'image.upload'),
  ('qa', 'dashboard.view'), ('qa', 'assignment.view'), ('qa', 'my_assignment.view'), ('qa', 'history.view'), ('qa', 'image_list.view');

-- 권한 변경 이력: 누가·언제·어느 권한에 무엇을 켜고 껐는지 (쌓기 전용)
CREATE TABLE permission_history (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_code       text   NOT NULL REFERENCES roles(code),
  permission_code text   NOT NULL REFERENCES permissions(code),
  action          text   NOT NULL CHECK (action IN ('GRANT', 'REVOKE')),
  created_by      bigint REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX permission_history_idx ON permission_history (id DESC);
