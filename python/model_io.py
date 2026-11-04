"""학습(train.py)과 추론(serve.py)이 같이 쓰는 모델 입출력: 전처리, 체크포인트 불러오기, 이미지 한 장 추론."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
from PIL import Image
from torchvision.transforms import v2

MEAN, STD = [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]  # ImageNet 사전학습 백본이 기대하는 정규화


def to_input(img: Image.Image, device: str, size: tuple[int, int]) -> torch.Tensor:
    t = v2.functional.to_image(img.convert("RGB"))
    t = v2.functional.to_dtype(t, torch.float32, scale=True).unsqueeze(0)
    t = v2.functional.resize(t, list(size), antialias=True)
    t = v2.functional.normalize(t, MEAN, STD)
    return t.to(device)


@torch.no_grad()
def predict_raw(model, img: Image.Image, device: str, size: tuple[int, int]) -> tuple[float, np.ndarray]:
    """이미지 한 장 → (이미지 원점수, 이상 맵[모델 입력 해상도, 원점수]). 점수는 클수록 이상."""
    out = model.model(to_input(img, device, size))
    return float(out.pred_score.reshape(-1)[0].item()), out.anomaly_map[0, 0].float().cpu().numpy()


def load_model(model_dir: Path, meta: dict, device: str):
    """train.py가 저장한 체크포인트로 모델을 복원한다 (메모리 뱅크 포함)."""
    from anomalib.models import Patchcore

    size = (meta["inputSize"]["height"], meta["inputSize"]["width"])
    model = Patchcore(
        backbone=meta["backbone"],
        layers=("layer2", "layer3"),
        pre_trained=False,  # 가중치는 체크포인트에서 복원 (인터넷 다운로드 불필요)
        coreset_sampling_ratio=meta["coresetRatio"],
        pre_processor=False,
        post_processor=False,
        evaluator=False,
        visualizer=False,
    )
    ckpt = torch.load(model_dir / "model.ckpt", map_location="cpu", weights_only=False)  # 우리가 만든 파일만 읽는다
    state = ckpt["state_dict"]
    bank = state.get("model.memory_bank")
    if bank is not None:
        model.model.memory_bank = bank.clone()  # 초기 빈 버퍼와 크기가 달라 load_state_dict가 거부하므로 먼저 맞춘다
    model.load_state_dict(state)
    return model.to(device).eval()
