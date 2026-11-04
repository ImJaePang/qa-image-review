"""PatchCore 학습: 정상 이미지로 메모리 뱅크를 만들고, 정상 검증 이미지로 점수 기준(calibrate)을 정해 meta.json에 기록한다.

사용:  .venv\\Scripts\\python train.py --data ..\\data\\images\\real [--n-train 120] [--out artifacts\\patchcore]
- 입력: <data>/ground_truth.jsonl (isDefect=false인 행만 정상으로 쓴다) + <data>/original/<fileName>
- 학습에 쓴 정상 이미지는 평가에 다시 쓰지 않는다. 나머지 정상 이미지가 점수 기준 계산용(검증)이다.
- 결과: <out>/model.ckpt, <out>/meta.json (modelVersion, 점수 기준, 박스 후처리 설정, 학습 파일 목록 해시 …)
회사 데이터는 사용하지 않는다 (이 프로젝트가 직접 만든 연습 이미지만).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image

import postprocess as pp
from model_io import load_model, predict_raw, to_input

BACKBONE = "wide_resnet50_2"


def load_normals(data: Path) -> list[str]:
    names = []
    for line in (data / "ground_truth.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if not row.get("isDefect"):
            names.append(row["fileName"])
    return sorted(names)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--out", type=Path, default=Path("artifacts/patchcore"))
    ap.add_argument("--n-train", type=int, default=120)
    ap.add_argument("--height", type=int, default=320)
    ap.add_argument("--width", type=int, default=576)
    ap.add_argument("--coreset", type=float, default=0.1)
    ap.add_argument("--box-threshold", type=float, default=0.5, help="심각도가 이 값 이상인 영역에 박스를 그린다")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--calibrate-only", action="store_true", help="학습은 건너뛰고 저장된 모델의 점수 기준·박스 설정만 다시 계산한다")
    a = ap.parse_args()

    from anomalib.models import Patchcore

    normals = load_normals(a.data)
    rnd = random.Random(a.seed)
    rnd.shuffle(normals)
    if a.calibrate_only:
        train = (a.out / "train_files.txt").read_text(encoding="utf-8").split()
        val = sorted(set(normals) - set(train))
    else:
        train, val = sorted(normals[: a.n_train]), sorted(normals[a.n_train :])
    if len(val) < 10:
        raise SystemExit(f"검증용 정상 이미지가 너무 적습니다 ({len(val)}장). --n-train을 줄이세요.")
    print(f"정상 {len(normals)}장 → 학습 {len(train)}장, 점수 기준(검증) {len(val)}장")

    out = a.out
    out.mkdir(parents=True, exist_ok=True)
    device = "cuda" if torch.cuda.is_available() else "cpu"

    size = (a.height, a.width)
    if a.calibrate_only:
        old = json.loads((out / "meta.json").read_text(encoding="utf-8"))
        a.height, a.width, a.coreset = old["inputSize"]["height"], old["inputSize"]["width"], old["coresetRatio"]
        size = (a.height, a.width)
        model = load_model(out, old, device)
    else:
        # anomalib의 Lightning 학습 루프 대신 직접 돌린다: 정상 이미지의 패치 특징을 모으고(training 모드) → 코어셋으로 줄인다(fit)
        model = Patchcore(backbone=BACKBONE, layers=("layer2", "layer3"), pre_trained=True, coreset_sampling_ratio=a.coreset, pre_processor=False, post_processor=False, evaluator=False, visualizer=False)
        model = model.to(device)
        model.model.train()
        t0 = time.time()
        with torch.no_grad():
            for i, n in enumerate(train, 1):
                model.model(to_input(Image.open(a.data / "original" / n), device, size))
                if i % 20 == 0 or i == len(train):
                    print(f"  특징 수집 {i}/{len(train)}")
            model.fit()
        print(f"학습 {time.time() - t0:.0f}초 (메모리 뱅크 {tuple(model.model.memory_bank.shape)})")
        torch.save({"state_dict": model.state_dict()}, out / "model.ckpt")
        model.eval()


    # 정상 검증 이미지로 0~1 변환 기준을 정한다. 이상 맵은 가우시안으로 번져 있어 최댓값이 이미지 점수보다 낮으므로 기준을 따로 둔다.
    scores, map_peaks = [], []
    for n in val:
        raw, amap = predict_raw(model, Image.open(a.data / "original" / n).convert("RGB"), device, size)
        scores.append(raw)
        map_peaks.append(float(amap.max()))
    cal = pp.calibrate(scores)
    map_cal = pp.calibrate(map_peaks)
    print(f"이미지 점수 기준: lo={cal['lo']:.4f} hi={cal['hi']:.4f} (정상 검증 범위 {min(scores):.4f}~{max(scores):.4f})")
    print(f"이상 맵 기준:     lo={map_cal['lo']:.4f} hi={map_cal['hi']:.4f} (정상 검증 최댓값 범위 {min(map_peaks):.4f}~{max(map_peaks):.4f})")

    digest = hashlib.sha256("\n".join(train).encode()).hexdigest()[:8]
    post = hashlib.sha256(json.dumps([cal, map_cal, a.box_threshold], sort_keys=True).encode()).hexdigest()[:4]  # 점수 기준·박스 설정이 바뀌면 버전도 바뀐다
    meta = {
        "modelVersion": f"patchcore-{BACKBONE}-{a.height}x{a.width}-{digest}-c{post}",
        "backbone": BACKBONE,
        "inputSize": {"height": a.height, "width": a.width},
        "coresetRatio": a.coreset,
        "calibration": cal,
        "mapCalibration": map_cal,
        "boxThreshold": a.box_threshold,
        "trainCount": len(train),
        "calibrationCount": len(val),
        "trainFilesSha256": hashlib.sha256("\n".join(train).encode()).hexdigest(),
        "trainedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "versions": {"torch": torch.__version__, "numpy": np.__version__},
    }
    try:
        import anomalib

        meta["versions"]["anomalib"] = anomalib.__version__
    except Exception:  # noqa: BLE001
        pass
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "train_files.txt").write_text("\n".join(train) + "\n", encoding="utf-8")
    print(f"완료: {out / 'meta.json'}  (modelVersion = {meta['modelVersion']})")


if __name__ == "__main__":
    main()
