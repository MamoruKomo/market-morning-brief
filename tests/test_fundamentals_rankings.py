from __future__ import annotations

import unittest

from pipelines.fundamentals.rankings import compute_hidden_gems, compute_rankings
from pipelines.fundamentals.update import extract_metrics, html_to_text


class TestFundamentalsParsing(unittest.TestCase):
    def test_extract_metrics_from_simple_html(self) -> None:
        html = """
        <html><body>
          <div>ROE 12.34%</div>
          <div>ROA 5.67%</div>
          <div>ROIC 9.00%</div>
          <div>営業利益率 20.5%</div>
          <div>純利益率 10.1%</div>
          <div>自己資本比率 55.0%</div>
          <div>予想PER 15.2 倍</div>
          <div>PBR 1.10 倍</div>
          <div>予想配当利回り 2.30%</div>
          <div>売上伸び率 8.4%</div>
        </body></html>
        """
        text = html_to_text(html)
        metrics = extract_metrics(text)
        self.assertAlmostEqual(metrics["roe"], 12.34, places=2)
        self.assertAlmostEqual(metrics["roa"], 5.67, places=2)
        self.assertAlmostEqual(metrics["roic"], 9.0, places=2)
        self.assertAlmostEqual(metrics["operating_margin"], 20.5, places=2)
        self.assertAlmostEqual(metrics["net_margin"], 10.1, places=2)
        self.assertAlmostEqual(metrics["equity_ratio"], 55.0, places=2)
        self.assertAlmostEqual(metrics["per"], 15.2, places=2)
        self.assertAlmostEqual(metrics["pbr"], 1.10, places=2)
        self.assertAlmostEqual(metrics["dividend_yield"], 2.30, places=2)
        self.assertAlmostEqual(metrics["sales_growth_yoy"], 8.4, places=2)


class TestFundamentalsRankings(unittest.TestCase):
    def test_compute_rankings_top_sort(self) -> None:
        items = [
            {"code": "1111", "name": "A", "sector": "S1", "metrics": {"roe": 5.0, "per": 20.0}},
            {"code": "2222", "name": "B", "sector": "S1", "metrics": {"roe": 10.0, "per": 15.0}},
            {"code": "3333", "name": "C", "sector": "S2", "metrics": {"roe": 7.5, "per": 0.0}},
        ]
        rankings = compute_rankings(items, top_n=2)
        self.assertEqual([r["code"] for r in rankings["roe"]], ["2222", "3333"])
        # PER is "low is better" and filters out <= 0
        self.assertEqual([r["code"] for r in rankings["per"]], ["2222", "1111"])

    def test_hidden_gems_deterministic(self) -> None:
        items = [
            {"code": "1111", "name": "A", "sector": "S1", "metrics": {"roe": 5.0, "sales_growth_yoy": 20.0, "pbr": 1.5}},
            {"code": "2222", "name": "B", "sector": "S1", "metrics": {"roe": 10.0, "sales_growth_yoy": 5.0, "pbr": 0.8}},
            {"code": "3333", "name": "C", "sector": "S2", "metrics": {"roe": 7.5, "sales_growth_yoy": 15.0, "pbr": 2.2}},
        ]
        res = compute_hidden_gems(items, date_iso="2026-04-13", top_n=2)
        self.assertEqual(res["date"], "2026-04-13")
        self.assertIn("pair", res)
        self.assertIn("items", res)
        self.assertEqual(len(res["items"]), 2)
        # Ensure stable ordering for this seed/date.
        top_codes = [it["code"] for it in res["items"]]
        self.assertEqual(top_codes, ["2222", "3333"])
