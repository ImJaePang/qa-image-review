"""PatchCore 평가: 정답(ground_truth.jsonl)이 있는 이미지로 이미지 단위 구분력, 박스 위치 정확도, 오탐, 속도를 잰다.

사용:  .venv\\Scripts\\python evaluate.py --data ..\\data\\images\\real [--model-dir artifacts\\patchcore]
평가 대상
  - 결함 이미지: ground_truth의 isDefect=true 전부 (학습에는 정상만 쓰므로 모두 처음 보는 이미지)
  - 정상 이미지: **학습에 쓰지 않은** 정상(train_files.txt에 없는 것). 이 정상들은 점수 기준(calibrate) 계산에는 쓰였지만
    AUROC는 점수의 순서만 보므로 영향이 없고, 컷오프 표와 박스 오탐은 약간 낙관적일 수 있다.
판정 규칙의 경계값(정상/의심/불량)은 DB 규칙이 정하므로 여기서 정하지 않는다. 대신 컷오프별로 얼마나 잡히고 오탐이 얼마인지 표로 보여 준다.
결과는 콘솔과 <model-dir>/eval_report.json, eval_images.csv(이미지별 점수·박스 수)에 저장된다.
"""
from __future__ import annotations

import argparse
import csv
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image

import metrics as mt
import postprocess as pp
from model_io import load_model, predict_raw

RNG = np.random.default_rng(0)


def load_gt(data: Path) -> list[dict]:
    rows = [json.loads(l) for l in (data / "ground_truth.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    return rows


def pct(v) -> str:
    return "-" if v is None else f"{v * 100:.1f}%"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--model-dir", type=Path, default=Path("artifacts/patchcore"))
    ap.add_argument("--iou", type=float, nargs="+", default=[0.1, 0.3], help="박스를 '찾았다'고 보는 IoU 기준(여러 개)")
    ap.add_argument("--cutoffs", type=float, nargs="+", default=[0.5, 0.6, 0.7, 0.8, 0.9, 0.95])
    ap.add_argument("--box-threshold", type=float, default=None, help="박스를 그릴 심각도 기준을 임시로 바꿔 본다 (기본: 모델의 meta.json 값). 재학습 없이 민감도 변화를 볼 수 있다")
    ap.add_argument("--report-name", default="eval", help="저장 파일 이름 접두사 (eval → eval_report.json). 여러 설정을 비교할 때 다르게 준다")
    ap.add_argument("--limit", type=int, default=0, help="빠른 확인용: 결함·정상 각각 이 장수까지만")
    a = ap.parse_args()

    import torch

    meta = json.loads((a.model_dir / "meta.json").read_text(encoding="utf-8"))
    train = set((a.model_dir / "train_files.txt").read_text(encoding="utf-8").split())
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = load_model(a.model_dir, meta, device)
    size = (meta["inputSize"]["height"], meta["inputSize"]["width"])
    cal, map_cal = meta["calibration"], meta["mapCalibration"]
    box_thr = a.box_threshold if a.box_threshold is not None else meta["boxThreshold"]

    gt = load_gt(a.data)
    defects = [r for r in gt if r["isDefect"]]
    normals = [r for r in gt if not r["isDefect"] and r["fileName"] not in train]
    if a.limit:
        defects, normals = defects[: a.limit], normals[: a.limit]
    print(f"모델 {meta['modelVersion']} ({device})\n평가 이미지: 결함 {len(defects)}장, 정상 {len(normals)}장 (학습에 쓰지 않은 것)")

    recs: list[dict] = []
    pix_pos: list[np.ndarray] = []
    pix_neg: list[np.ndarray] = []
    ms: list[float] = []
    for r in defects + normals:
        img = Image.open(a.data / "original" / r["fileName"]).convert("RGB")
        t0 = time.time()
        raw, amap = predict_raw(model, img, device, size)
        ms.append((time.time() - t0) * 1000)
        w, h = img.size
        boxes = pp.boxes_from_map(amap, map_cal, w, h, box_threshold=box_thr)
        mask = mt.gt_mask(amap.shape, r["boxes"], w, h)
        flat, mflat = amap.ravel(), mask.ravel()
        if mflat.any():
            pix_pos.append(RNG.choice(flat[mflat], size=min(3000, int(mflat.sum())), replace=False))
        neg = flat[~mflat]
        pix_neg.append(RNG.choice(neg, size=min(3000, neg.size), replace=False))
        recs.append({"file": r["fileName"], "isDefect": r["isDefect"], "raw": raw, "score": pp.score_from_raw(raw, cal), "boxes": boxes, "gt": r["boxes"]})

    D = [x for x in recs if x["isDefect"]]
    N = [x for x in recs if not x["isDefect"]]
    report: dict = {"modelVersion": meta["modelVersion"], "boxThreshold": box_thr, "counts": {"defect": len(D), "normal": len(N)}}

    # 1) 이미지 단위 구분력
    report["imageAuroc"] = mt.auroc([x["raw"] for x in D], [x["raw"] for x in N])
    report["bestF1"] = mt.best_f1([x["raw"] for x in D], [x["raw"] for x in N])
    report["cutoffTable"] = mt.cutoff_table([x["score"] for x in D], [x["score"] for x in N], a.cutoffs)
    report["scoreDistribution"] = {"defect": mt.summarize([x["score"] for x in D]), "normal": mt.summarize([x["score"] for x in N])}

    # 2) 위치(박스): 정답 박스를 찾은 비율, 예측 박스의 정밀도, 정상 이미지의 오탐 박스
    loc = {}
    for thr in a.iou:
        found = total = ok = pred_total = 0
        centered = 0
        for x in D:
            hit, pred_ok = mt.match_boxes(x["boxes"], x["gt"], thr)
            found += sum(hit)
            total += len(x["gt"])
            ok += sum(pred_ok)
            pred_total += len(x["boxes"])
            centered += sum(any(mt.center_inside(p, g) for p in x["boxes"]) for g in x["gt"])
        loc[str(thr)] = {"gtBoxRecall": found / total if total else None, "boxPrecision": ok / pred_total if pred_total else None, "gtCenterHit": centered / total if total else None}
    report["localization"] = loc
    report["falseBoxesPerNormal"] = float(np.mean([len(x["boxes"]) for x in N])) if N else None
    report["normalWithAnyBox"] = float(np.mean([len(x["boxes"]) > 0 for x in N])) if N else None
    report["boxesPerDefect"] = float(np.mean([len(x["boxes"]) for x in D])) if D else None
    report["pixelAuroc"] = mt.auroc(np.concatenate(pix_pos), np.concatenate(pix_neg)) if pix_pos else None

    # 3) 결함 종류별
    reasons: dict = {}
    for x in D:
        for rc in {g["reasonCode"] for g in x["gt"]}:
            reasons.setdefault(rc, []).append(x)
    by_reason = {}
    for rc, xs in sorted(reasons.items()):
        gts = [(x, g) for x in xs for g in x["gt"] if g["reasonCode"] == rc]
        thr = a.iou[0]
        hit_n = sum(any(mt.iou(p, g) >= thr for p in x["boxes"]) for x, g in gts)
        by_reason[rc] = {"images": len(xs), "auroc": mt.auroc([x["raw"] for x in xs], [x["raw"] for x in N]), "medianScore": float(np.median([x["score"] for x in xs])), f"boxHit@IoU{thr}": hit_n / len(gts)}
    report["byReason"] = by_reason
    report["speedMs"] = mt.summarize(ms[1:] or ms)  # 첫 장은 CUDA 준비 때문에 느려서 뺀다

    # 저장
    (a.model_dir / f"{a.report_name}_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    with open(a.model_dir / f"{a.report_name}_images.csv", "w", newline="", encoding="utf-8-sig") as f:
        wr = csv.writer(f)
        wr.writerow(["file", "isDefect", "score", "boxes", "gtBoxes"])
        for x in recs:
            wr.writerow([x["file"], int(x["isDefect"]), x["score"], len(x["boxes"]), len(x["gt"])])

    # 출력
    print("\n== 이미지 단위: 결함과 정상을 가르는 능력 ==")
    print(f"AUROC {report['imageAuroc']:.3f}   (0.5=무작위, 1.0=완벽)")
    if report["bestF1"]:
        b = report["bestF1"]
        print(f"F1 최대점(참고용, 낙관적): F1 {b['f1']:.2f} / 결함 재현율 {pct(b['recall'])} / 정밀도 {pct(b['precision'])}")
    print("컷오프(점수 < 컷오프면 이상)별: 결함을 잡는 비율 / 정상을 잘못 잡는 비율")
    for row in report["cutoffTable"]:
        print(f"  {row['cutoff']:.2f}   잡음 {pct(row['caught']):>6}   오탐 {pct(row['falseAlarm']):>6}")
    print("\n== 위치(박스) ==")
    for thr, v in loc.items():
        print(f"IoU≥{thr}: 정답 박스 찾음 {pct(v['gtBoxRecall'])}, 예측 박스 정밀도 {pct(v['boxPrecision'])}, 정답 중심 안 적중 {pct(v['gtCenterHit'])}")
    print(f"결함 이미지당 예측 박스 {report['boxesPerDefect']:.2f}개 / 정상 이미지당 오탐 박스 {report['falseBoxesPerNormal']:.2f}개 (박스가 하나라도 생긴 정상 {pct(report['normalWithAnyBox'])})")
    if report["pixelAuroc"] is not None:
        print(f"픽셀 단위 AUROC {report['pixelAuroc']:.3f} (정답 박스 안쪽 전체를 이상으로 본 거친 근사)")
    print("\n== 결함 종류별 (AUROC / 점수 중앙값 / 박스 적중) ==")
    for rc, v in by_reason.items():
        hk = [k for k in v if k.startswith("boxHit")][0]
        print(f"  {rc:<20} {v['images']:>3}장  AUROC {v['auroc']:.3f}  점수 {v['medianScore']:.2f}  박스 {pct(v[hk])}")
    s = report["speedMs"]
    print(f"\n속도: 이미지당 평균 {s['mean']:.0f}ms (중앙값 {s['median']:.0f}ms, p95 {s['p95']:.0f}ms)")
    print(f"저장: {a.model_dir / (a.report_name + '_report.json')}, {a.model_dir / (a.report_name + '_images.csv')}")


if __name__ == "__main__":
    main()
