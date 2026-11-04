# python/ — PatchCore 추론·학습 (실제 모델 어댑터)

백엔드(Node)의 `MODEL_ADAPTER=patchcore` 어댑터(`backend/src/model/patchcore.mjs`)가 `serve.py`를 자식 프로세스로 띄워
JSON Lines로 대화한다. 출력은 기획서 5장 계약 그대로(점수 0~1, **높을수록 정상**, 박스는 원본 픽셀, 사유는 `UNKNOWN`).

## 설치 (이 폴더 안의 가상환경에만 설치된다. 폴더를 지우면 정리됨)
```
cd python
python -m venv .venv
.venv\Scripts\python -m pip install torch==2.11.0 torchvision==0.26.0 --index-url https://download.pytorch.org/whl/cu128   # NVIDIA GPU(CUDA). GPU가 없으면 index-url 없이 설치(CPU)
.venv\Scripts\python -m pip install -r requirements.txt
```

## 학습 (정상 이미지로만; 회사 데이터 금지)
```
set PYTHONUTF8=1
.venv\Scripts\python train.py --data ..\data\images\real --n-train 120
```
- `data/images/real/ground_truth.jsonl`의 정상(isDefect=false) 중 `--n-train`장으로 학습, 나머지 정상으로 점수 기준을 계산한다(약 4분, RTX 4060 Ti).
- 결과 `artifacts/patchcore/{model.ckpt, meta.json, train_files.txt}` (git에 올리지 않음). `meta.json`의 `modelVersion`이 판정 기록에 남는다.
  버전 = 백본 + 입력 크기 + 학습 파일 해시 + 점수 기준·박스 설정 해시(`-c….`).
- 점수 기준만 다시 계산: `train.py --data … --calibrate-only` (모델은 그대로, 버전의 마지막 해시가 바뀐다).

## 실행
```
cd backend
set MODEL_ADAPTER=patchcore
npm run worker
```
(선택) `.env`의 `PATCHCORE_MODEL_DIR`(학습 폴더), `PYTHON_BIN`(파이썬 실행 파일).

## 평가 (정답 데이터로 모델 성능 재기)
```
.venv\Scripts\python evaluate.py --data ..\data\imageseal
.venv\Scripts\python evaluate.py --data ..\data\imageseal --box-threshold 0.35 --report-name eval_box0.35   # 박스 기준만 바꿔 비교 (재학습 불필요)
```
- 결함 이미지 전부 + **학습에 쓰지 않은** 정상 이미지로 이미지 단위 AUROC, 컷오프별 잡는 비율/오탐, 박스 적중(IoU 기준 여러 개), 정상의 오탐 박스, 결함 종류별 결과, 속도를 낸다. 결과: `artifacts/patchcore/<이름>_report.json`, `<이름>_images.csv`.
- 지표 계산(`metrics.py`)은 모델과 무관한 순수 함수라 다른 모델을 연결해도 같은 기준으로 비교할 수 있다.
- 판정 규칙의 경계값은 정하지 않는다(DB 규칙의 몫). 대신 컷오프 표로 "얼마나 잡히고 오탐이 얼마인지" 본다.

## 테스트
- 지표·후처리(점수 변환·박스·히트맵): `.venv\Scripts\python -m unittest test_metrics test_postprocess`
- 어댑터 프로토콜: `cd backend && npm test` (가짜 서버 사용, 파이썬 불필요)

## 점수 변환
`심각도 = clip((원점수 − lo) / (hi − lo), 0, 1)`, 계약 점수 = `1 − 심각도`. `lo` = 정상 검증 점수의 중앙값, `hi` = `lo + 2×(95백분위 − lo)`
(정상의 95백분위가 0.5). 이상 맵은 가우시안으로 번져 최댓값이 이미지 점수보다 낮아서 기준을 따로 둔다(`mapCalibration`).
정상/의심/불량 경계는 여기서 정하지 않고 DB 규칙(`rules`)이 정한다.

## 라이선스 주의
anomalib은 Apache-2.0. 백본(wide_resnet50_2) 사전학습 가중치는 ImageNet 기반으로 상업 이용 조건 미확인 → 비상업 연습 범위에서만 사용. MVTec 데이터는 쓰지 않는다.
