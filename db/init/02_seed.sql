-- 기본 데이터: 데모 계정과 기본 판정 규칙 (비밀번호는 bcrypt 해시로 저장)
INSERT INTO users (name, email, password_hash, role) VALUES
  ('관리자', 'admin@example.com', crypt('1234', gen_salt('bf')), 'admin'),
  ('김검수', 'qa1@example.com',   crypt('1234', gen_salt('bf')), 'qa'),
  ('이점검', 'qa2@example.com',   crypt('1234', gen_salt('bf')), 'qa'),
  ('박확인', 'qa3@example.com',   crypt('1234', gen_salt('bf')), 'qa');

INSERT INTO rules (name, version, params) VALUES
  ('score-threshold', 1, '{"normalMin": 0.9, "suspectMin": 0.5}');
