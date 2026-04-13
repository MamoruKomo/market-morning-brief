from __future__ import annotations

import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from pipelines.watchlist.snapshot import build_slack_message


class TestWatchlistSnapshotAlerts(unittest.TestCase):
    def test_open_snapshot_detects_gap_and_volume(self) -> None:
        now_jst = datetime(2026, 4, 14, 9, 30, tzinfo=ZoneInfo("Asia/Tokyo"))
        cfg = {"pages_base_url": "https://example.com/site/"}
        watch_cfg = {"version": 1, "groups": [{"sector": "テスト", "tickers": [{"code": "1234", "name": "テスト"}]}]}
        prev_close_snapshot = {
            "datetime_jst": "2026-04-13T16:00:00+09:00",
            "phase": "close",
            "items": [
                {
                    "code": "1234",
                    "name": "テスト",
                    "prev_close": 100,
                    "close": 100,
                    "volume": 1000,
                    "source_url": "https://kabutan.jp/stock/?code=1234",
                }
            ],
        }
        open_snapshot = {
            "datetime_jst": "2026-04-14T09:30:00+09:00",
            "phase": "open",
            "items": [
                {
                    "code": "1234",
                    "name": "テスト",
                    "prev_close": 100,
                    "open": 103,
                    "volume": 200,
                    "source_url": "https://kabutan.jp/stock/?code=1234",
                }
            ],
        }
        store = {"version": 1, "updated_at": None, "snapshots": [prev_close_snapshot, open_snapshot]}

        msg = build_slack_message("open", now_jst, cfg, watch_cfg, open_snapshot, store)
        self.assertIn("*ウォッチリスト*", msg)
        self.assertIn("一覧: https://example.com/site/watchlist/", msg)
        self.assertIn("*異常検知*", msg)
        self.assertIn("*ギャップ*", msg)
        self.assertIn("*出来高急増*", msg)
        self.assertIn("<https://kabutan.jp/stock/?code=1234|1234 テスト>", msg)
        self.assertIn("+3.00%", msg)

    def test_close_snapshot_detects_close_volume_spike(self) -> None:
        now_jst = datetime(2026, 4, 14, 16, 0, tzinfo=ZoneInfo("Asia/Tokyo"))
        cfg = {"pages_base_url": "https://example.com/site/"}
        watch_cfg = {"version": 1, "groups": [{"sector": "テスト", "tickers": [{"code": "1234", "name": "テスト"}]}]}

        history = {
            "datetime_jst": "2026-04-13T16:00:00+09:00",
            "phase": "close",
            "items": [{"code": "1234", "name": "テスト", "prev_close": 100, "close": 100, "volume": 1000}],
        }
        close_snapshot = {
            "datetime_jst": "2026-04-14T16:00:00+09:00",
            "phase": "close",
            "items": [{"code": "1234", "name": "テスト", "prev_close": 100, "close": 101, "volume": 2000}],
        }
        store = {"version": 1, "updated_at": None, "snapshots": [close_snapshot, history]}

        msg = build_slack_message("close", now_jst, cfg, watch_cfg, close_snapshot, store)
        self.assertIn("*異常検知*", msg)
        self.assertIn("*出来高急増*", msg)


if __name__ == "__main__":
    unittest.main()

