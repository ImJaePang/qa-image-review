-- 011: 기능 권한 assignment.receive(배정받기) - 신규 배정의 담당자로 고를 수 있는 권한
--  지금까지는 '권한이 qa인 사용자'가 담당자 후보로 코드에 고정되어 있었다. 이제는 권한별 메뉴 표에서 켜고 끈다.
INSERT INTO permissions (code, kind, label, description, sort_order) VALUES
  ('assignment.receive', 'FUNCTION', '배정받기', '신규 배정을 만들 때 담당자(검수자)로 고를 수 있다', 103);
-- 기존 동작 유지: QA 권한에 기본 부여
INSERT INTO role_permissions (role_code, permission_code) VALUES ('qa', 'assignment.receive');
