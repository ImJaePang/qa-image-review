"""postprocess 단위 테스트 (모델 없이 실행): python -m unittest test_postprocess"""
import unittest

import numpy as np

import postprocess as pp


class Calibrate(unittest.TestCase):
    def test_normal_median_is_score_1_and_p95_is_half(self):
        normal = list(np.linspace(1.0, 2.0, 101))  # 중앙값 1.5, 95백분위 1.95
        cal = pp.calibrate(normal)
        self.assertAlmostEqual(cal["lo"], 1.5)
        self.assertEqual(pp.score_from_raw(1.5, cal), 1.0)
        self.assertEqual(pp.score_from_raw(1.95, cal), 0.5)
        self.assertEqual(pp.score_from_raw(99, cal), 0.0)  # 범위 밖은 0~1로 자른다
        self.assertEqual(pp.score_from_raw(-5, cal), 1.0)

    def test_needs_two_points_and_handles_constant(self):
        with self.assertRaises(ValueError):
            pp.calibrate([1.0])
        cal = pp.calibrate([2.0, 2.0, 2.0])
        self.assertGreater(cal["hi"], cal["lo"])  # 0으로 나누지 않는다


class Boxes(unittest.TestCase):
    cal = {"lo": 0.0, "hi": 1.0}

    def test_box_in_original_pixels_and_inside_image(self):
        m = np.zeros((10, 20))  # 모델 해상도 20x10
        m[2:5, 4:8] = 0.9  # 가로 4~8, 세로 2~5
        boxes = pp.boxes_from_map(m, self.cal, orig_w=200, orig_h=100)
        self.assertEqual(len(boxes), 1)
        b = boxes[0]
        self.assertEqual((b["x"], b["y"], b["width"], b["height"]), (40, 20, 40, 30))  # 10배 확대
        self.assertEqual(b["score"], 0.1)  # 1 - 0.9
        self.assertEqual(b["reasonCode"], "UNKNOWN")
        self.assertTrue(b["x"] + b["width"] <= 200 and b["y"] + b["height"] <= 100)

    def test_no_anomaly_no_boxes(self):
        self.assertEqual(pp.boxes_from_map(np.full((8, 8), 0.1), self.cal, 80, 80), [])

    def test_ignores_tiny_regions_and_orders_worst_first(self):
        m = np.zeros((100, 100))
        m[10, 10] = 1.0  # 1픽셀: min_area_ratio(0.0005*10000=5) 미만 → 무시
        m[20:30, 20:30] = 0.6
        m[60:70, 60:70] = 0.95
        boxes = pp.boxes_from_map(m, self.cal, 100, 100)
        self.assertEqual([b["score"] for b in boxes], [0.05, 0.4])

    def test_max_boxes(self):
        m = np.zeros((100, 100))
        for i in range(8):
            m[i * 12 : i * 12 + 6, 10:20] = 0.8
        self.assertEqual(len(pp.boxes_from_map(m, self.cal, 100, 100, max_boxes=3)), 3)

    def test_edge_clamped(self):
        m = np.zeros((10, 10))
        m[8:10, 8:10] = 1.0
        b = pp.boxes_from_map(m, self.cal, 105, 105)[0]  # 배율 10.5: 올림 때문에 밖으로 나가기 쉬운 경우
        self.assertTrue(b["x"] + b["width"] <= 105 and b["y"] + b["height"] <= 105)


class Heatmap(unittest.TestCase):
    def test_rgba_transparent_where_normal_and_downscaled(self):
        m = np.zeros((1000, 2000))
        m[500:600, 1000:1200] = 1.0
        out = pp.heatmap_rgba(m, {"lo": 0.0, "hi": 1.0}, max_side=500)
        self.assertEqual(out.dtype, np.uint8)
        self.assertEqual(max(out.shape[:2]), 500)
        self.assertEqual(out[0, 0, 3], 0)  # 정상 부분은 투명
        self.assertGreater(out[137, 275, 3], 100)


if __name__ == "__main__":
    unittest.main()
