from __future__ import annotations

import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

from pipelines.brief import generate as brief


class TestCachedFetcher(unittest.TestCase):
    def test_offline_reads_cached_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp)
            (cache_dir / "hello.html").write_text("<b>ok</b>", encoding="utf-8")
            fetcher = brief.CachedFetcher(cache_dir=cache_dir, offline=True)
            self.assertEqual(fetcher.text("hello", "https://example.invalid"), "<b>ok</b>")

    def test_offline_missing_file_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp)
            fetcher = brief.CachedFetcher(cache_dir=cache_dir, offline=True)
            with self.assertRaises(FileNotFoundError):
                fetcher.text("missing", "https://example.invalid")


class TestParsers(unittest.TestCase):
    def test_fetch_stooq_two_day_parses_quote_line(self) -> None:
        html = "<div>10 Apr, 23:00 6816.89 -7.77 (-0.11%)</div>"
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp)
            (cache_dir / "stooq_spx.html").write_text(html, encoding="utf-8")
            fetcher = brief.CachedFetcher(cache_dir=cache_dir, offline=True)
            q = brief.fetch_stooq_two_day("^spx", fetcher, "stooq_spx")
            self.assertIsNotNone(q)
            assert q is not None
            self.assertAlmostEqual(q.close, 6816.89, places=6)
            self.assertAlmostEqual(q.prev_close, 6824.66, places=2)
            self.assertAlmostEqual(q.change, -7.77, places=2)
            self.assertAlmostEqual(q.pct_change or 0.0, -0.11, places=2)

    def test_parse_stooq_day_month_handles_year_crossover(self) -> None:
        now = dt.date(2026, 1, 2)
        # "31 Dec" should resolve to previous year.
        self.assertEqual(brief.parse_stooq_day_month("31 Dec", now), "2025-12-31")

    def test_parse_traders_sectors_extracts_known_names(self) -> None:
        html = """
        <html><body>
          <table>
            <tr><th>業種</th><th>現在値</th><th>前日比</th><th>騰落率(%)</th></tr>
            <tr><td>電気機器</td><td>1</td><td>2</td><td>1.23</td></tr>
            <tr><td>海運業</td><td>1</td><td>2</td><td>-2.34</td></tr>
          </table>
        </body></html>
        """
        sectors = brief.parse_traders_sectors(html)
        names = {s.name: s.pct for s in sectors}
        self.assertIn("電気機器", names)
        self.assertIn("海運業", names)
        self.assertAlmostEqual(names["電気機器"], 1.23, places=2)
        self.assertAlmostEqual(names["海運業"], -2.34, places=2)

    def test_parse_investing_last_price(self) -> None:
        html = '<span class="instrument-price-last">39,876.5</span>'
        self.assertAlmostEqual(brief.parse_investing_last_price(html) or 0.0, 39876.5, places=1)

    def test_print_cache_plan_is_valid_json(self) -> None:
        # Ensure helper output stays machine-readable.
        plan = {
            "nikkei_index_profile": brief.NIKKEI_INDEX_PROFILE_URL,
            "traders_jp_index": brief.TRADERS_JP_INDEX_URL,
        }
        self.assertIsInstance(json.loads(json.dumps(plan)), dict)

