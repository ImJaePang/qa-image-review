-- 008: 권한 종류를 코드가 아니라 roles 테이블이 정한다 (사용자 관리 3단계 후속)
--  signup_selectable: 가입 화면에서 신청할 수 있는 권한인지 (관리자는 신청 불가). 새 권한을 만들 때 이 값으로 노출 여부를 정한다.
ALTER TABLE roles ADD COLUMN signup_selectable boolean NOT NULL DEFAULT false;
UPDATE roles SET signup_selectable = true WHERE code IN ('researcher', 'qa');

-- 신청 권한의 고정 CHECK(researcher/qa)를 roles 참조로 바꾼다. 신청 가능 여부는 API가 signup_selectable로 검사한다.
ALTER TABLE users DROP CONSTRAINT users_requested_role_check;
ALTER TABLE users ADD CONSTRAINT users_requested_role_fkey FOREIGN KEY (requested_role) REFERENCES roles(code);
