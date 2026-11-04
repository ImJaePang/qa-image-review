-- 006: 사용자 프로필(소속·연락처)과 사용자 변경 이력 (사용자 관리 2단계 API)
--  프로필은 users와 1:1 별도 테이블: 항목이 늘면 여기에 열만 추가한다 (users를 건드리지 않는다).
CREATE TABLE user_profiles (
  user_id         bigint PRIMARY KEY REFERENCES users(id),
  company         text,   -- 업체
  department      text,   -- 부서
  job_title       text,   -- 직급
  phone           text,   -- 연락처
  company_address text,   -- 업체 주소
  updated_by      bigint REFERENCES users(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO user_profiles (user_id) SELECT id FROM users;

--  detail: SIGNUP {requestedRole}, APPROVE {role, requestedRole}, REJECT {}, ENABLE/DISABLE {}, EXPIRE {} (시스템),
--          EXPIRY_REQUEST {}, EXPIRY_RELEASE {from,to}, ROLE {from,to}, EXPIRES {from,to}, PROFILE {필드:{from,to}}, PASSWORD_RESET {}
CREATE TABLE user_history (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint      NOT NULL REFERENCES users(id),
  action     text        NOT NULL CHECK (action IN ('SIGNUP', 'APPROVE', 'REJECT', 'ENABLE', 'DISABLE', 'EXPIRE', 'EXPIRY_REQUEST', 'EXPIRY_RELEASE', 'ROLE', 'EXPIRES', 'PROFILE', 'PASSWORD_RESET')),
  detail     jsonb       NOT NULL DEFAULT '{}',
  created_by bigint      REFERENCES users(id),   -- NULL = 본인 또는 시스템
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_history_user_idx ON user_history (user_id, id DESC);
