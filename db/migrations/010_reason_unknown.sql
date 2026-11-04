-- 010: 사유 코드 UNKNOWN(원인 미분류) 추가
--  이상 탐지 모델(PatchCore 등)은 '어디가 이상한지'는 알려주지만 '왜'인지는 구분하지 못한다.
--  원인을 지어내 채우지 않도록 계약(기획서 5장)에 UNKNOWN을 더한다.
ALTER TABLE detections DROP CONSTRAINT detections_reason_code_check;
ALTER TABLE detections ADD CONSTRAINT detections_reason_code_check CHECK (reason_code IN (
  'COMPOSITE_EDGE', 'SHAPE_DISTORTION', 'LIGHTING_MISMATCH',
  'TEXTURE_ANOMALY', 'SCALE_ANOMALY', 'PART_COUNT_MISMATCH', 'UNKNOWN'));
