"""PatchCore 추론 서버: 백엔드 어댑터(backend/src/model/patchcore.mjs)가 띄우고 stdin/stdout으로 대화한다.

프로토콜(한 줄 = JSON 하나):
  시작 시   → {"event":"ready"}                      (모델을 다 불러온 뒤 한 번)
  요청      ← {"id","imageKey","fileName","filePath","outputDir"}
  응답      → {"id","ok":true,"result":{5장 계약 객체}}  또는 {"id","ok":false,"error":"..."}
stdout은 프로토콜 전용이다. 라이브러리가 찍는 글은 모두 stderr로 돌린다.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

# 프로토콜용 stdout을 따로 잡아 두고, 그 뒤 print()는 stderr로 가게 한다
PROTO = sys.stdout
sys.stdout = sys.stderr

import torch  # noqa: E402
from PIL import Image  # noqa: E402

import postprocess as pp  # noqa: E402
from model_io import load_model, predict_raw  # noqa: E402


def send(obj: dict) -> None:
    PROTO.write(json.dumps(obj, ensure_ascii=False) + "\n")
    PROTO.flush()


def infer_one(model, meta: dict, device: str, req: dict) -> dict:
    started = time.time()
    img = Image.open(req["filePath"])
    img.load()
    img = img.convert("RGB")
    width, height = img.size  # 박스 좌표의 기준: 원본 이미지 픽셀
    size = (meta["inputSize"]["height"], meta["inputSize"]["width"])
    raw, amap = predict_raw(model, img, device, size)
    cal = meta["calibration"]  # 이미지 점수용
    map_cal = meta["mapCalibration"]  # 이상 맵(박스·히트맵)용

    boxes = pp.boxes_from_map(amap, map_cal, width, height, box_threshold=meta["boxThreshold"])
    heat_rel = f"/heatmaps/{req['imageKey']}.png"
    heat_file = Path(req["outputDir"]) / heat_rel.lstrip("/")
    heat_file.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pp.heatmap_rgba(amap, map_cal), "RGBA").save(heat_file)

    return {
        "imageId": req["imageKey"],
        "fileName": req["fileName"],
        "width": width,
        "height": height,
        "modelVersion": meta["modelVersion"],
        "overallScore": pp.score_from_raw(raw, cal),
        "heatmapUrl": heat_rel,
        "boxes": boxes,
        "durationMs": int((time.time() - started) * 1000),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True, type=Path)
    a = ap.parse_args()
    meta = json.loads((a.model_dir / "meta.json").read_text(encoding="utf-8"))
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = load_model(a.model_dir, meta, device)
    print(f"모델 로드 완료: {meta['modelVersion']} ({device})")
    send({"event": "ready"})

    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        try:
            send({"id": req["id"], "ok": True, "result": infer_one(model, meta, device, req)})
        except Exception as e:  # noqa: BLE001  한 장의 실패가 서버를 죽이지 않게 한다
            send({"id": req["id"], "ok": False, "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()
