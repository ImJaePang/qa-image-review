-- 004: 판정 규칙 변경 이력 (규칙 관리 API)
--  규칙(rules)은 수정하지 않고 새 버전을 쌓는다. 여기에는 누가·언제 버전을 만들고, 켜고 끄고, 재판정했는지를 쌓기만 한다.
--  detail: CREATE {params}, ENABLE/DISABLE {}, REJUDGE {scope, rejudged, changed}
CREATE TABLE rule_history (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_id    bigint      NOT NULL REFERENCES rules(id),
  action     text        NOT NULL CHECK (action IN ('CREATE', 'ENABLE', 'DISABLE', 'REJUDGE')),
  detail     jsonb       NOT NULL DEFAULT '{}',
  created_by bigint      REFERENCES users(id),   -- NULL = 시스템
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rule_history_rule_idx ON rule_history (rule_id, id DESC);
