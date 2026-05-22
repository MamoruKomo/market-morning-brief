from __future__ import annotations

import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from pipelines.tdnet.alert import Disclosure, FetchUnavailable, build_message, main, parse_disclosures


class TestTdnetSlackMessageFormat(unittest.TestCase):
    def test_build_message_uses_jp_name_and_pdf_link(self) -> None:
        d = Disclosure(
            id="kabutan:9983:1401202604130000",
            code="9983",
            company="Fast Retailing Co., Ltd.",
            title_en="Notice concerning share repurchase",
            title_ja="自己株式取得に関するお知らせ",
            points_ja=["自己株式（取得/消却/方針）の条件を確認"],
            datetime_jst="2026-04-13T09:00:00+09:00",
            tags=["自己株"],
            doc_id_family="1401202604130000",
            doc_id_ja="140120260413000000",
            doc_id_en="140120260413000002",
            pdf_url_ja="https://tdnet-pdf.kabutan.jp/20260413/140120260413000000.pdf",
            pdf_url_en="https://tdnet-pdf.kabutan.jp/20260413/140120260413000002.pdf",
            source_url="https://en.kabutan.com/jp/disclosures",
        )
        msg = build_message([d], "https://example.com/site/", {"9983": "ファストリ"})
        self.assertIn("*適時開示", msg)
        self.assertIn("一覧: https://kabutan.jp/disclosures/", msg)
        self.assertIn("*ファストリ（9983）*: 自己株式取得に関するお知らせ【自己株】", msg)
        self.assertIn("<https://www.release.tdnet.info/inbs/140120260413000000.pdf|PDF>", msg)
        self.assertIn("<https://kabutan.jp/stock/?code=9983|株探>", msg)
        self.assertIn("<https://example.com/site/tdnet/index.html?q=9983|ログ>", msg)


class TestTdnetKabutanListParser(unittest.TestCase):
    def test_parse_disclosures_consolidates_jp_en_pair(self) -> None:
        html = """
        <html><body>
          <table>
            <tr>
              <td><a href="/stock/?code=485A">485A</a></td>
              <td>ＰｏｗｅｒＸ</td>
              <td>東証Ｇ</td>
              <td>その他</td>
              <td><a href="/disclosures/pdf/20260115/140120260115534702/">Notice Regarding the Results of Third-Party Allotment</a></td>
              <td>26/01/15 18:40</td>
            </tr>
            <tr>
              <td><a href="/stock/?code=485A">485A</a></td>
              <td>ＰｏｗｅｒＸ</td>
              <td>東証Ｇ</td>
              <td>その他</td>
              <td><a href="/disclosures/pdf/20260115/140120260115534700/">第三者割当増資の結果に関するお知らせ</a></td>
              <td>26/01/15 18:40</td>
            </tr>
          </table>
        </body></html>
        """
        disclosures = parse_disclosures(html)
        self.assertEqual(len(disclosures), 1)
        d = disclosures[0]
        self.assertEqual(d.id, "kabutan:485A:1401202601155347")
        self.assertEqual(d.code, "485A")
        self.assertEqual(d.company, "ＰｏｗｅｒＸ")
        self.assertEqual(d.doc_id_family, "1401202601155347")
        self.assertEqual(d.doc_id_ja, "140120260115534700")
        self.assertEqual(d.doc_id_en, "140120260115534702")
        self.assertEqual(d.title_ja, "第三者割当増資の結果に関するお知らせ")
        self.assertIn("Notice Regarding", d.title_en)
        self.assertEqual(d.pdf_url_ja, "https://tdnet-pdf.kabutan.jp/20260115/140120260115534700.pdf")
        self.assertEqual(d.pdf_url_en, "https://tdnet-pdf.kabutan.jp/20260115/140120260115534702.pdf")


class TestTdnetFetchFailure(unittest.TestCase):
    def test_main_skips_when_source_is_unavailable(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            data_path = root / "tdnet.json"
            config_path = root / "brief.config.json"
            watchlist_path = root / "watchlist.json"
            data_path.write_text('{"version":1,"last_checked_jst":null,"items":[]}\n', encoding="utf-8")
            config_path.write_text('{"pages_base_url":"https://example.com/site/"}\n', encoding="utf-8")
            watchlist_path.write_text('{"version":1,"groups":[]}\n', encoding="utf-8")

            buf = StringIO()
            argv = [
                "tdnet_alert.py",
                "--data",
                str(data_path),
                "--config",
                str(config_path),
                "--watchlist",
                str(watchlist_path),
            ]
            with patch("sys.argv", argv), patch(
                "pipelines.tdnet.alert.fetch_html", side_effect=FetchUnavailable("HTTP Error 405")
            ), redirect_stdout(buf):
                self.assertEqual(main(), 0)

            self.assertIn('"source_unavailable": true', buf.getvalue())
