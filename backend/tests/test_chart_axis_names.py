import unittest

import pandas as pd

from app.services.chart_generator import generate_echarts_option


class TestChartAxisNames(unittest.TestCase):
    def test_bar_has_axis_names(self):
        df = pd.DataFrame({"日期": ["2025-01-01", "2025-01-02"], "付费金额": [10, 20]})
        opt = generate_echarts_option(df, {"type": "bar", "x": "日期", "y": "付费金额", "agg": "sum", "title": "t"})
        self.assertEqual((opt.get("xAxis") or {}).get("name"), "日期")
        self.assertTrue(((opt.get("yAxis") or {}).get("name") or "").startswith("求和("))

    def test_time_line_has_axis_names(self):
        df = pd.DataFrame({"时间": ["2025-01-01", "2025-01-02"], "值": [1, 2]})
        opt = generate_echarts_option(df, {"type": "line", "x": "时间", "y": "值", "agg": "sum"})
        self.assertEqual((opt.get("xAxis") or {}).get("name"), "时间")
        self.assertTrue(((opt.get("yAxis") or {}).get("name") or "").endswith("(值)"))

    def test_histogram_has_axis_names(self):
        df = pd.DataFrame({"金额": [1, 2, 3, 4, 5]})
        opt = generate_echarts_option(df, {"type": "histogram", "x": "金额"})
        self.assertEqual((opt.get("xAxis") or {}).get("name"), "金额")
        self.assertEqual((opt.get("yAxis") or {}).get("name"), "计数")

