from __future__ import annotations

import unittest

from pipelines.tdnet.alert import Disclosure, build_message


class TestTdnetSlackMessageFormat(unittest.TestCase):
    def test_build_message_uses_jp_name_and_pdf_link(self) -> None:
        d = Disclosure(
            id="https://example.invalid/tdnet.pdf",
            code="9983",
            company="Fast Retailing Co., Ltd.",
            title_en="Notice concerning share repurchase",
            title_ja="自己株式取得に関するお知らせ",
            points_ja=["自己株式（取得/消却/方針）の条件を確認"],
            datetime_jst="2026-04-13T09:00:00+09:00",
            tags=["自己株"],
            pdf_url_ja="https://www.release.tdnet.info/inbs/140120260413000000.pdf",
            pdf_url_en="https://tdnet-pdf.kabutan.jp/140120260413000000.pdf",
            source_url="https://en.kabutan.com/jp/disclosures",
        )
        msg = build_message([d], "https://example.com/site/", {"9983": "ファストリ"})
        self.assertIn("*適時開示*", msg)
        self.assertIn("全件ログ: https://example.com/site/tdnet/", msg)
        self.assertIn("ファストリ（9983） — 自己株式取得に関するお知らせ", msg)
        self.assertIn("PDF: https://www.release.tdnet.info/inbs/140120260413000000.pdf", msg)
