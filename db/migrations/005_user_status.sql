-- 사용자 계정 상태·사용기한·신청 권한 (설계 9장 1단계)
--  status: PENDING(가입 승인 대기) / ACTIVE(사용 중) / EXPIRED(사용기한 만료) / DISABLED(비활성)
--  expires_at: 사용기한. 로그인할 때마다 로그인 시각 + 1년으로 밀어 장기 미사용 계정을 막는다. 관리자가 임의로 정할 수도 있다.
--  requested_role: 가입할 때 신청한 권한. 실제 권한(role)은 관리자가 승인하며 정한다.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'researcher', 'qa'));

ALTER TABLE users
  ADD COLUMN status         text NOT NULL DEFAULT 'ACTIVE'
    CONSTRAINT users_status_check CHECK (status IN ('PENDING', 'ACTIVE', 'EXPIRED', 'DISABLED')),
  ADD COLUMN requested_role text
    CONSTRAINT users_requested_role_check CHECK (requested_role IN ('researcher', 'qa')),
  ADD COLUMN expires_at     timestamptz,
  ADD COLUMN last_login_at  timestamptz,
  ADD COLUMN expiry_release_requested_at timestamptz;   -- 만료된 사용자가 해제를 요청한 시각 (2단계에서 사용)

-- 기존 계정은 모두 사용 중이며, 기한은 지금부터 1년
UPDATE users SET expires_at = now() + interval '1 year';
-- 앞으로 새로 만드는 계정은 승인 전까지 쓸 수 없다
ALTER TABLE users ALTER COLUMN status SET DEFAULT 'PENDING';
CREATE INDEX users_status_idx ON users (status);
