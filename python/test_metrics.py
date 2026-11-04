"""metrics 단위 테스트: python -m unittest test_metrics"""
import unittest

import numpy as np

import metrics as m


class Auroc(unittest.TestCase):
    def test_perfect_random_and_ties(self):
        self.assertEqual(m.auroc([0.9, 0.8], [0.1, 0.2]), 1.0)
        self.assertEqual(m.auroc([0.1, 0.2], [0.9, 0.8]), 0.0)
        self.assertEqual(m.auroc([0.5, 0.5], [0.5, 0.5]), 0.5)  # 전부 동점 = 무작위
        self.assertAlmostEqual(m.auroc([1, 3], [2, 4]), 0.25)  # 쌍 4개 중 (3>2)만 맞음
        self.assertIsNone(m.auroc([], [1]))


class Boxes(unittest.TestCase):
    A = {"x": 0, "y": 0, "width": 10, "height": 10}

    def test_iou(self):
        self.assertEqual(m.iou(self.A, self.A), 1.0)
        self.assertEqual(m.iou(self.A, {"x": 20, "y": 20, "width": 5, "height": 5}), 0.0)
        # 겹침 5x10=50, 합집합 100+100-50=150
        self.assertAlmostEqual(m.iou(self.A, {"x": 5, "y": 0, "width": 10, "height": 10}), 50 / 150)

    def test_center_inside(self):
        self.assertTrue(m.center_inside({"x": 2, "y": 2, "width": 2, "height": 2}, self.A))
        self.assertFalse(m.center_inside({"x": 30, "y": 30, "width": 2, "height": 2}, self.A))

    def test_matching_is_one_to_one(self):
        gts = [self.A, {"x": 100, "y": 100, "width": 10, "height": 10}]
        preds = [self.A, {"x": 1, "y": 1, "width": 10, "height": 10}]  # 둘 다 첫 정답과 겹침: 하나만 맞는 것으로
        hit, ok = m.match_boxes(preds, gts, 0.3)
        self.assertEqual(hit, [True, False])
        self.assertEqual(ok, [True, False])

    def test_threshold(self):
        hit, _ = m.match_boxes([{"x": 5, "y": 0, "width": 10, "height": 10}], [self.A], 0.5)
        self.assertEqual(hit, [False])  # IoU 0.33 < 0.5


class Mask(unittest.TestCase):
    def test_scaled_to_map(self):
        mask = m.gt_mask((10, 20), [{"x": 100, "y": 50, "width": 100, "height": 50}], orig_w=200, orig_h=100)
        self.assertEqual(mask.sum(), 5 * 10)  # 맵에서 가로 10칸 x 세로 5칸
        self.assertTrue(mask[5:10, 10:20].all())


class Tables(unittest.TestCase):
    def test_cutoff_table(self):
        t = m.cutoff_table([0.2, 0.6, 0.95], [0.9, 0.99, 1.0, 0.4], [0.5, 0.9])
        self.assertEqual(t[0], {"cutoff": 0.5, "caught": 1 / 3, "falseAlarm": 0.25})
        self.assertAlmostEqual(t[1]["caught"], 2 / 3)
        self.assertAlmostEqual(t[1]["falseAlarm"], 0.25)

    def test_best_f1_separable(self):
        r = m.best_f1([5, 6, 7], [1, 2, 3])
        self.assertEqual(r["f1"], 1.0)
        self.assertEqual(r["threshold"], 5.0)

    def test_summarize(self):
        self.assertEqual(m.summarize([])["n"], 0)
        self.assertEqual(m.summarize([1, 2, 3])["median"], 2.0)


if __name__ == "__main__":
    unittest.main()
