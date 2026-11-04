"""PatchCore 출력(이상 점수·이상 맵)을 기획서 5장 계약(0~1 점수, 원본 픽셀 박스, 히트맵 PNG)으로 바꾸는 순수 함수들.

점수 방향은 백엔드 규칙과 같다: **높을수록 정상**(1.0 = 정상 이미지 수준, 0에 가까울수록 불량).
  심각도(severity) = clip((원점수 - lo) / (hi - lo), 0, 1),  계약 점수 = 1 - severity
  lo/hi는 학습 때 정상 검증 이미지의 점수 분포로 정해 meta.json에 기록한다 (calibrate).
판정 임계값(정상/의심/불량 경계)은 여기가 아니라 DB의 규칙(rules)이 정한다. 여기의 box_threshold 등은
'어디에 박스를 그릴지'를 정하는 모델 후처리 설정이며 모델 버전(meta.json)에 함께 기록된다.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage

REASON_UNKNOWN = "UNKNOWN"  # PatchCore는 위치만 알려주고 원인은 구분하지 못한다


def calibrate(normal_scores: list[float]) -> dict:
    """정상 검증 이미지의 원점수로 0~1 변환 기준을 만든다.
    lo = 정상 점수의 중앙값(= 심각도 0), hi = lo + 2*(95백분위 - lo)  → 정상의 95백분위가 심각도 0.5가 된다."""
    s = np.asarray(normal_scores, dtype=float)
    if s.size < 2:
        raise ValueError("정상 검증 점수가 2개 이상 필요합니다")
    lo = float(np.median(s))
    p95 = float(np.percentile(s, 95))
    span = 2.0 * (p95 - lo)
    if span <= 1e-9:  # 점수가 전부 같은 극단적 경우
        span = max(abs(lo) * 0.1, 1e-6)
    return {"lo": lo, "hi": lo + span}


def severity(raw, cal: dict):
    """원점수(숫자 또는 배열) → 심각도 0~1"""
    return np.clip((np.asarray(raw, dtype=float) - cal["lo"]) / (cal["hi"] - cal["lo"]), 0.0, 1.0)


def score_from_raw(raw: float, cal: dict) -> float:
    """계약의 점수(높을수록 정상), 소수 둘째 자리"""
    return round(float(1.0 - severity(raw, cal)), 2)


def boxes_from_map(
    anomaly_map: np.ndarray,
    cal: dict,
    orig_w: int,
    orig_h: int,
    box_threshold: float = 0.5,
    min_area_ratio: float = 0.0005,
    max_boxes: int = 5,
) -> list[dict]:
    """이상 맵(모델 해상도, 원점수)에서 심각도가 box_threshold 이상인 연결 영역마다 외접 박스를 만든다.
    좌표는 **원본 이미지 픽셀**(정수)로 환산해 이미지 밖으로 나가지 않게 자른다. 심각도 높은 순으로 최대 max_boxes개."""
    sev = severity(anomaly_map, cal)
    mh, mw = sev.shape
    labels, n = ndimage.label(sev >= box_threshold)
    if n == 0:
        return []
    found = []
    sx, sy = orig_w / mw, orig_h / mh
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        region = labels[sl] == i
        if region.sum() < min_area_ratio * mh * mw:
            continue
        peak = float(sev[sl][region].max())
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        x = max(0, int(np.floor(x0 * sx)))
        y = max(0, int(np.floor(y0 * sy)))
        w = min(orig_w - x, int(np.ceil((x1 - x0) * sx)))
        h = min(orig_h - y, int(np.ceil((y1 - y0) * sy)))
        if w <= 0 or h <= 0:
            continue
        found.append({"x": x, "y": y, "width": w, "height": h, "score": round(1.0 - peak, 2), "reasonCode": REASON_UNKNOWN})
    found.sort(key=lambda b: b["score"])  # 점수 낮은(= 더 불량) 것부터
    return found[:max_boxes]


def heatmap_rgba(anomaly_map: np.ndarray, cal: dict, max_side: int = 512) -> np.ndarray:
    """화면에서 원본 위에 겹쳐 보는 투명 PNG용 RGBA 배열(uint8). 심각도가 낮은 곳은 투명, 높을수록 노랑→빨강, 불투명.
    크기는 긴 변이 max_side 이하(원본 크기로 늘려 보여 주므로 작아도 된다)."""
    sev = severity(anomaly_map, cal)
    h, w = sev.shape
    k = max_side / max(h, w)
    if k < 1:
        sev = ndimage.zoom(sev, k, order=1)
    sev = np.clip(sev, 0.0, 1.0)
    out = np.zeros((*sev.shape, 4), dtype=np.uint8)
    out[..., 0] = 255
    out[..., 1] = (255 * (1.0 - sev)).astype(np.uint8)  # 노랑(255,255,0) → 빨강(255,0,0)
    out[..., 3] = (sev * 200).astype(np.uint8)
    return out
