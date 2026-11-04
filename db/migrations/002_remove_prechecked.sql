-- 002: 사전배치(PRECHECKED) 단계 제거 (설계 8장)
--  * 이미지는 수신 시점에 이미 추론·판정되므로 배정 뒤의 '사전배치' 단계가 필요 없다.
--    새 흐름: 배정(ASSIGNED) → 점검중(IN_REVIEW) → 점검완료(REVIEWED) → 확인완료(CONFIRMED)
--  * 이 단계에 멈춰 있던 배정은 점검을 시작할 수 있는 ASSIGNED로 되돌린다 (사전배치는 기록만 남기던 단계라 잃는 정보가 없다).
--  * assignment_history의 과거 PRECHECKED 기록은 그대로 둔다 (그때 실제로 있었던 사실).
--  * batch_jobs 테이블은 지우지 않는다: 과거 사전배치 실행 기록 보존용이며 더 이상 기록하지 않는다.
UPDATE assignments SET status = 'ASSIGNED' WHERE status = 'PRECHECKED';

ALTER TABLE assignments DROP CONSTRAINT IF EXISTS assignments_status_check;
ALTER TABLE assignments ADD CONSTRAINT assignments_status_check
  CHECK (status IN ('ASSIGNED', 'IN_REVIEW', 'REVIEWED', 'CONFIRMED'));

COMMENT ON TABLE batch_jobs IS '(폐기) 사전배치 실행 기록. 사전배치 단계 제거(002) 후에는 기록하지 않는다. 과거 기록 보존용';
