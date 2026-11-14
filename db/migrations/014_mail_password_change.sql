-- 014: 임시 비밀번호 메일 발송 + 비밀번호 변경 강제
--  users.must_change_password : 임시 비밀번호로 바뀐 계정은 true. 사용자가 비밀번호를 바꾸기 전에는 서버가 다른 API를 막는다.
--  user_history PASSWORD_CHANGE : 본인이 비밀번호를 바꾼 기록 (비밀번호 자체는 남기지 않는다)
--  mail_log : 메일 발송 기록. 받는 사람·종류·성공 여부만 남기고 본문(임시 비밀번호가 들어 있음)은 저장하지 않는다.
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

ALTER TABLE user_history DROP CONSTRAINT user_history_action_check;
ALTER TABLE user_history ADD CONSTRAINT user_history_action_check CHECK (action IN
  ('SIGNUP', 'APPROVE', 'REJECT', 'ENABLE', 'DISABLE', 'EXPIRE', 'EXPIRY_REQUEST', 'EXPIRY_RELEASE', 'ROLE', 'EXPIRES', 'PROFILE', 'PASSWORD_RESET', 'PASSWORD_CHANGE'));

CREATE TABLE mail_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind       text        NOT NULL,                                        -- 예: TEMP_PASSWORD
  user_id    bigint      REFERENCES users(id),
  to_address text        NOT NULL,
  mode       text        NOT NULL CHECK (mode IN ('log', 'smtp')),
  status     text        NOT NULL CHECK (status IN ('SENT', 'FAILED')),
  error      text,
  created_by bigint      REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mail_log_idx ON mail_log (id DESC);
