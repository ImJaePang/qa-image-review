-- 003: 연계 설정 변경 이력 (설계 8장, ⑦ 연계 관리)
--  누가·언제·무엇을 바꿨는지 쌓기만 한다 (수정/삭제 없음 → 수정 컬럼 없음).
--  changes: { "필드": { "from": 이전값, "to": 바꾼값 } }  (CREATE는 from 없이 to만, RETRY는 { retried, batchId })
CREATE TABLE integration_history (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  integration_id bigint      NOT NULL REFERENCES integrations(id),
  action         text        NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'ENABLE', 'DISABLE', 'RETRY')),
  changes        jsonb       NOT NULL DEFAULT '{}',
  created_by     bigint      REFERENCES users(id),   -- NULL = 시스템
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX integration_history_integration_idx ON integration_history (integration_id, id DESC);
