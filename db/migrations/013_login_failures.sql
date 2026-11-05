-- 013: 로그인 시도 횟수 제한 - 실패 횟수를 DB에 둔다 (서버를 다시 켜도 유지, 여러 서버가 같이 써도 일관)
--  scope: EMAIL(같은 이메일로 반복) / IP(같은 접속 주소에서 여러 이메일로 반복)
--  key  : scope가 EMAIL이면 소문자 이메일, IP이면 접속 주소. 계정이 없는 이메일도 똑같이 센다(존재 여부 노출 방지).
--  failures / window_started_at : 현재 구간의 실패 횟수와 구간 시작 시각. 구간이 지나면 1부터 다시 센다.
--  locked_until : 이 시각까지 로그인 시도를 받지 않는다. 비밀번호 검사 전에 확인하므로 맞는 비밀번호도 거부된다.
CREATE TABLE login_failures (
  scope             text        NOT NULL CHECK (scope IN ('EMAIL', 'IP')),
  key               text        NOT NULL,
  failures          int         NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at    timestamptz NOT NULL DEFAULT now(),
  locked_until      timestamptz,
  PRIMARY KEY (scope, key)
);
CREATE INDEX login_failures_last_idx ON login_failures (last_failed_at);
