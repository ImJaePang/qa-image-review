"""모델 평가 지표 (순수 함수, 모델과 무관). 어떤 모델이든 같은 정답 데이터로 비교할 수 있게 분리했다.

점수 방향 주의: 여기의 `anomaly` 점수는 **클수록 이상**(원점수). 계약 점수(높을수록 정상)는 `cutoff_table`에서만 쓴다.
박스는 {"x","y","width","height"} (원본 픽셀)."""
from __future__ import annotations

import numpy as np
from scipy.stats import rankdata


def auroc(pos, neg) -> float | None:
    """결함(pos)이 정상(neg)보다 점수가 높을 확률 (동점은 0.5). 한쪽이 비면 None. 0.5 = 무작위, 1.0 = 완벽."""
    pos, neg = np.asarray(pos, dtype=float), np.asarray(neg, dtype=float)
    if pos.size == 0 or neg.size == 0:
        return None
    ranks = rankdata(np.concatenate([pos, neg]))
    u = ranks[: pos.size].sum() - pos.size * (pos.size + 1) / 2
    return float(u / (pos.size * neg.size))


def iou(a: dict, b: dict) -> float:
    ax2, ay2, bx2, by2 = a["x"] + a["width"], a["y"] + a["height"], b["x"] + b["width"], b["y"] + b["height"]
    iw, ih = min(ax2, bx2) - max(a["x"], b["x"]), min(ay2, by2) - max(a["y"], b["y"])
    if iw <= 0 or ih <= 0:
        return 0.0
    inter = iw * ih
    return inter / (a["width"] * a["height"] + b["width"] * b["height"] - inter)


def center_inside(pred: dict, gt: dict) -> bool:
    cx, cy = pred["x"] + pred["width"] / 2, pred["y"] + pred["height"] / 2
    return gt["x"] <= cx <= gt["x"] + gt["width"] and gt["y"] <= cy <= gt["y"] + gt["height"]


def match_boxes(preds: list[dict], gts: list[dict], iou_thr: float) -> tuple[list[bool], list[bool]]:
    """예측과 정답 박스를 IoU 큰 쌍부터 일대일로 맞춘다. 반환: (정답별 찾았나, 예측별 맞았나)"""
    pairs = sorted(((iou(p, g), pi, gi) for pi, p in enumerate(preds) for gi, g in enumerate(gts)), reverse=True)
    gt_hit, pred_ok = [False] * len(gts), [False] * len(preds)
    for v, pi, gi in pairs:
        if v < iou_thr:
            break
        if not gt_hit[gi] and not pred_ok[pi]:
            gt_hit[gi] = pred_ok[pi] = True
    return gt_hit, pred_ok


def gt_mask(shape: tuple[int, int], gts: list[dict], orig_w: int, orig_h: int) -> np.ndarray:
    """정답 박스를 이상 맵 해상도의 0/1 마스크로 만든다 (박스 안쪽 전체를 이상으로 본다 — 거친 근사)."""
    mh, mw = shape
    m = np.zeros(shape, dtype=bool)
    for g in gts:
        x0, x1 = int(np.floor(g["x"] * mw / orig_w)), int(np.ceil((g["x"] + g["width"]) * mw / orig_w))
        y0, y1 = int(np.floor(g["y"] * mh / orig_h)), int(np.ceil((g["y"] + g["height"]) * mh / orig_h))
        m[max(0, y0) : min(mh, y1), max(0, x0) : min(mw, x1)] = True
    return m


def cutoff_table(defect_scores, normal_scores, cutoffs) -> list[dict]:
    """계약 점수(높을수록 정상)를 컷오프로 나눌 때 결함을 잡는 비율과 정상을 잘못 잡는 비율.
    점수 < 컷오프이면 '이상'으로 본다. 판정 규칙의 경계값을 정하기 전에 얼마나 잡히고 얼마나 오탐인지 보는 표."""
    d, n = np.asarray(defect_scores, dtype=float), np.asarray(normal_scores, dtype=float)
    return [
        {"cutoff": float(c), "caught": float((d < c).mean()) if d.size else None, "falseAlarm": float((n < c).mean()) if n.size else None}
        for c in cutoffs
    ]


def best_f1(defect_anomaly, normal_anomaly) -> dict | None:
    """원점수 기준으로 F1이 가장 큰 컷오프 하나 (참고용: 정답을 본 뒤 고른 값이라 낙관적이다)."""
    d, n = np.asarray(defect_anomaly, dtype=float), np.asarray(normal_anomaly, dtype=float)
    if d.size == 0 or n.size == 0:
        return None
    best = None
    for t in np.unique(np.concatenate([d, n])):
        tp, fp, fn = int((d >= t).sum()), int((n >= t).sum()), int((d < t).sum())
        f1 = 2 * tp / (2 * tp + fp + fn) if tp else 0.0
        if best is None or f1 > best["f1"]:
            best = {"threshold": float(t), "f1": float(f1), "recall": tp / d.size, "precision": tp / (tp + fp) if tp + fp else 0.0}
    return best


def summarize(values) -> dict:
    v = np.asarray(values, dtype=float)
    if v.size == 0:
        return {"n": 0}
    return {"n": int(v.size), "mean": float(v.mean()), "median": float(np.median(v)), "p95": float(np.percentile(v, 95)), "max": float(v.max())}
