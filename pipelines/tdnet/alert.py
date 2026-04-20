#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

try:
    import certifi  # type: ignore
except Exception:  # pragma: no cover
    certifi = None

KABUTAN_DISCLOSURES_URL = "https://kabutan.jp/disclosures/"
TDNET_PDF_BASE_URL = "https://www.release.tdnet.info/inbs/"
JST = ZoneInfo("Asia/Tokyo")
MAX_ITEMS = 5000


MONTHS = {
    "Jan": 1,
    "Feb": 2,
    "Mar": 3,
    "Apr": 4,
    "May": 5,
    "Jun": 6,
    "Jul": 7,
    "Aug": 8,
    "Sep": 9,
    "Oct": 10,
    "Nov": 11,
    "Dec": 12,
}


DATE_RE = re.compile(
    r"(?P<dow>Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+"
    r"(?P<mon>[A-Za-z]{3})\s+(?P<day>\d{1,2}),\s+(?P<year>\d{4})\s+"
    r"(?P<hour>\d{1,2}):(?P<minute>\d{2})\s+(?P<ampm>am|pm)\s+JST",
)


CODE_RE = re.compile(r"^(?P<code>\d{3,4}[A-Z]?)\s+(?P<rest>.+)$")
CODE_ONLY_RE = re.compile(r"^\d{3,4}[A-Z]?$")
TDNET_DOC_ID_RE = re.compile(r"(?P<id>\d{18})")
KABUTAN_LIST_DT_RE = re.compile(
    r"(?P<yy>\d{2})/(?P<mon>\d{2})/(?P<day>\d{2})\s+(?P<hour>\d{2}):(?P<minute>\d{2})",
)


def normalize_spaces(text: str) -> str:
    return " ".join(str(text or "").split()).strip()


TITLE_BOUNDARY_TOKENS = (
    "[delayed]",
    "（Correction）",
    "(Correction)",
    " Notice ",
    " Notice",
    " Announcement ",
    " Announcement",
    " Financial Results",
    " Earnings",
)


def split_company_and_subject(title: str) -> tuple[str, str]:
    s = normalize_spaces(title)
    if not s:
        return "", ""
    lower = s.lower()

    boundary: int | None = None
    for token in TITLE_BOUNDARY_TOKENS:
        idx = lower.find(token.lower())
        if idx == -1:
            continue
        if boundary is None or idx < boundary:
            boundary = idx

    if boundary is None:
        return "", s

    company = s[:boundary].strip(" -–—()（）")
    subject = s[boundary:].lstrip()
    return company, subject


BODY_TRANSLATION_RULES: list[tuple[str, str]] = [
    (r"\bresults\s+of\s+the\s+tender\s+offer\b", "公開買付（TOB）の結果"),
    (r"\btender\s+offer\b", "公開買付（TOB）"),
    (r"\bchange\s+in\s+the\s+status\s+of\s+major\s+shareholders\b", "主要株主の異動"),
    (r"\bother\s+affiliated\s+companies\b", "その他の関係会社"),
    (r"\bconsolidated\s+financial\s+results\b", "連結決算"),
    (r"\bfinancial\s+results\b", "決算"),
    (r"\bfinancial\s+report\b", "財務報告"),
    (r"\bdividend\s+forecast\b", "配当予想"),
    (r"\bdividend\b", "配当"),
    (r"\bshare\s+repurchase\b", "自己株式取得"),
    (r"\bdisposal\s+of\s+treasury\s+shares\b", "自己株式処分"),
    (r"\btreasury\s+shares\b", "自己株式"),
    (r"\bforecast\b", "予想"),
    (r"\brevisions?\b", "修正"),
    (r"\bcorrection\b", "訂正"),
]


def translate_subject_to_ja(subject_en: str, tags: list[str]) -> str:
    s = normalize_spaces(subject_en)
    prefix = ""
    if "訂正" in tags:
        prefix += "（訂正）"
    if "遅延" in tags:
        prefix += "（遅延）"

    # Remove markers already represented in tags/prefix.
    s = re.sub(r"^\[delayed\]\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"^\(correction\)\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"^（correction）\s*", "", s, flags=re.IGNORECASE)

    m = re.match(r"^(notice\s+(?:concerning|regarding|of)|announcement\s+of|announcement)\s+(?P<body>.+)$", s, re.IGNORECASE)
    body = m.group("body") if m else s
    kind = (m.group(1).lower() if m else "")

    suffix = ""
    if kind.startswith("notice concerning") or kind.startswith("notice regarding"):
        suffix = "に関するお知らせ"
    elif kind.startswith("notice of"):
        suffix = "のお知らせ"
    elif kind.startswith("announcement"):
        suffix = "の発表"

    for pat, repl in BODY_TRANSLATION_RULES:
        body = re.sub(pat, repl, body, flags=re.IGNORECASE)

    body = normalize_spaces(body).lstrip("：:-—– ")
    return normalize_spaces(prefix + body + suffix)


POINTS_BY_TAG: dict[str, str] = {
    "決算": "決算関連（決算短信/説明資料）を確認",
    "業績修正": "業績予想/ガイダンスの修正（上方/下方・理由）を確認",
    "配当": "配当予想/方針（増配/減配/無配）を確認",
    "自己株": "自己株式（取得/消却/方針）の条件を確認",
    "TOB": "TOB（価格/期間/目的）を確認",
    "増資/売出": "増資/売出（希薄化・需給インパクト）を確認",
    "M&A": "M&A/子会社化など（スキーム/条件）を確認",
    "人事": "役員人事/体制変更の内容を確認",
    "借入": "借入/資金調達（条件/返済）を確認",
    "自己株処分": "自己株式の処分（需給/希薄化）を確認",
    "SO": "ストックオプション（希薄化/条件）を確認",
    "遅延": "開示遅延（追補の有無）に注意",
    "訂正": "訂正開示（差分）を確認",
}


def build_points_ja(title_en: str, tags: list[str]) -> list[str]:
    points: list[str] = []

    for tag in tags:
        msg = POINTS_BY_TAG.get(tag)
        if msg and msg not in points:
            points.append(msg)

    t = title_en.lower()
    if "impact" in t and "業績への影響（定量/定性）を確認" not in points:
        points.append("業績への影響（定量/定性）を確認")
    if "conversion" in t and "株式数の変化（転換/希薄化）を確認" not in points:
        points.append("株式数の変化（転換/希薄化）を確認")

    if not points:
        points.append("PDFで重要点（数字/条件）を確認")

    return points[:3]


def classify_tags(text: str) -> list[str]:
    t = text.lower()
    tags: list[str] = []

    def add(tag: str) -> None:
        if tag not in tags:
            tags.append(tag)

    # JP keywords (best-effort)
    s = normalize_spaces(text)
    if re.search(r"[一-龯ぁ-んァ-ン]", s):
        if "決算" in s or "短信" in s or "決算説明" in s:
            add("決算")
        if "業績予想" in s or "業績予想の修正" in s or "予想修正" in s or "ガイダンス" in s:
            add("業績修正")
        if "配当" in s or "株主還元" in s:
            add("配当")
        if "自己株式" in s or "自己株" in s or "自社株" in s:
            add("自己株")
        if ("処分" in s or "売却" in s) and ("自己株式" in s or "自己株" in s):
            add("自己株処分")
        if "公開買付" in s or "ＴＯＢ" in s or "TOB" in s:
            add("TOB")
        if "第三者割当" in s or "公募" in s or "売出" in s or "募集" in s:
            add("増資/売出")
        if "子会社" in s or "M&A" in s or "買収" in s or ("株式" in s and "取得" in s):
            add("M&A")
        if "役員" in s or "人事" in s or "代表取締役" in s:
            add("人事")
        if "借入" in s or "社債" in s or "資金調達" in s:
            add("借入")
        if "ストックオプション" in s:
            add("SO")
        if "遅延" in s:
            add("遅延")
        if "訂正" in s:
            add("訂正")

    if "financial results" in t or "earnings" in t:
        add("決算")
    if "financial report" in t:
        add("決算")
    if "revisions" in t or "forecast" in t or "guidance" in t:
        add("業績修正")
    if "dividend" in t:
        add("配当")
    if "repurchase" in t or "buyback" in t or "own shares" in t:
        add("自己株")
    if "tender offer" in t:
        add("TOB")
    if "secondary offering" in t or "issuance of new shares" in t or "offering" in t:
        add("増資/売出")
    if "acquisition" in t and "shares" in t:
        add("M&A")
    if "personnel" in t or "director" in t:
        add("人事")
    if "borrowing" in t or "loan" in t:
        add("借入")
    if "disposal of treasury shares" in t:
        add("自己株処分")
    if "stock options" in t:
        add("SO")
    if "[delayed]" in t or "delayed" in t:
        add("遅延")
    if "correction" in t:
        add("訂正")

    return tags


def format_dt_jst_from_match(m: re.Match[str]) -> str:
    mon = MONTHS.get(m.group("mon"))
    if not mon:
        return ""
    year = int(m.group("year"))
    day = int(m.group("day"))
    hour = int(m.group("hour"))
    minute = int(m.group("minute"))
    ampm = m.group("ampm").lower()
    if ampm == "pm" and hour != 12:
        hour += 12
    if ampm == "am" and hour == 12:
        hour = 0
    # Represent as ISO-like JST string.
    return f"{year:04d}-{mon:02d}-{day:02d}T{hour:02d}:{minute:02d}:00+09:00"


def clean_headline(raw: str) -> str:
    s = " ".join(raw.split())
    s = s.replace("Disclosures(EN)", "").strip()
    s = DATE_RE.sub("", s).strip()
    return s


@dataclass(frozen=True)
class Disclosure:
    id: str
    code: str
    company: str
    title_en: str
    title_ja: str
    points_ja: list[str]
    datetime_jst: str
    tags: list[str]
    doc_id_family: str
    doc_id_ja: str
    doc_id_en: str
    pdf_url_ja: str
    pdf_url_en: str
    source_url: str


@dataclass(frozen=True)
class KabutanListRow:
    code: str
    company: str
    title: str
    datetime_jst: str
    doc_id: str
    kabutan_pdf_url: str


def parse_kabutan_list_datetime_jst(text: str) -> str:
    s = normalize_spaces(text)
    m = KABUTAN_LIST_DT_RE.search(s)
    if not m:
        return ""
    yy = int(m.group("yy"))
    year = 2000 + yy
    mon = int(m.group("mon"))
    day = int(m.group("day"))
    hour = int(m.group("hour"))
    minute = int(m.group("minute"))
    return f"{year:04d}-{mon:02d}-{day:02d}T{hour:02d}:{minute:02d}:00+09:00"


def build_kabutan_pdf_url(yyyymmdd: str, doc_id: str) -> str:
    ymd = normalize_spaces(yyyymmdd)
    doc = normalize_spaces(doc_id)
    if not ymd or not doc:
        return ""
    return f"https://tdnet-pdf.kabutan.jp/{ymd}/{doc}.pdf"


def make_kabutan_family_key(code: str, doc_id: str) -> str:
    c = normalize_spaces(code)
    doc = normalize_spaces(doc_id)
    family = doc[:16] if len(doc) >= 16 else doc
    return f"kabutan:{c}:{family}"


class KabutanDisclosureParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._in_target_a = False
        self._current_href: str | None = None
        self._current_text: list[str] = []
        self.links: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        href = dict(attrs).get("href") or ""
        if "tdnet-pdf.kabutan.jp" not in href:
            return
        if href.startswith("//"):
            href = "https:" + href
        self._in_target_a = True
        self._current_href = href
        self._current_text = []

    def handle_data(self, data: str) -> None:
        if self._in_target_a:
            self._current_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "a":
            return
        if not self._in_target_a:
            return
        href = self._current_href or ""
        text = " ".join(" ".join(self._current_text).split()).strip()
        if href and text:
            self.links.append((href, text))
        self._in_target_a = False
        self._current_href = None
        self._current_text = []


def fetch_html(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "market-morning-brief/1.0 (+GitHub Actions)",
            "Accept-Language": "ja-JP,ja;q=0.9",
        },
    )
    context = None
    if certifi is not None:
        try:
            context = ssl.create_default_context(cafile=certifi.where())
        except Exception:
            context = None
    if context is None:
        context = ssl.create_default_context()

    with urllib.request.urlopen(req, timeout=30, context=context) as res:
        return res.read().decode("utf-8", errors="replace")


def extract_tdnet_doc_id(value: str) -> str:
    s = normalize_spaces(value)
    if not s:
        return ""
    # Common forms:
    # - https://tdnet-pdf.kabutan.jp/YYYYMMDD/<id>.pdf
    # - https://www.release.tdnet.info/inbs/<id>.pdf
    # - https://kabutan.jp/disclosures/pdf/YYYYMMDD/<id>/
    m = re.search(r"/(?P<id>\d{18})\.pdf", s)
    if m:
        return m.group("id")
    m = re.search(r"/pdf/\d{8}/(?P<id>\d{18})/?", s)
    if m:
        return m.group("id")
    m2 = TDNET_DOC_ID_RE.search(s)
    return m2.group("id") if m2 else ""


def build_tdnet_pdf_url(value: str) -> str:
    doc_id = extract_tdnet_doc_id(value)
    if not doc_id:
        return ""
    return f"{TDNET_PDF_BASE_URL}{doc_id}.pdf"


class KabutanDisclosuresTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._in_tr = False
        self._in_td = False
        self._in_a = False
        self._a_href = ""
        self._a_text: list[str] = []
        self._td_text: list[str] = []
        self._td_links: list[tuple[str, str]] = []
        self._cells: list[dict[str, Any]] = []
        self.rows: list[KabutanListRow] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._in_tr = True
            self._cells = []
            return
        if not self._in_tr:
            return
        if tag == "td":
            self._in_td = True
            self._td_text = []
            self._td_links = []
            return
        if tag == "a" and self._in_td:
            href = dict(attrs).get("href") or ""
            if href.startswith("//"):
                href = "https:" + href
            self._in_a = True
            self._a_href = href
            self._a_text = []

    def handle_data(self, data: str) -> None:
        if self._in_a:
            self._a_text.append(data)
        elif self._in_td:
            self._td_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._in_a:
            text = normalize_spaces(" ".join(self._a_text))
            href = normalize_spaces(self._a_href)
            if href and text and self._in_td:
                self._td_links.append((href, text))
            self._in_a = False
            self._a_href = ""
            self._a_text = []
            return
        if tag == "td" and self._in_td:
            text = normalize_spaces(" ".join(self._td_text))
            self._cells.append({"text": text, "links": list(self._td_links)})
            self._in_td = False
            self._td_text = []
            self._td_links = []
            return
        if tag == "tr" and self._in_tr:
            self._in_tr = False
            self._flush_row()
            self._cells = []

    def _flush_row(self) -> None:
        if not self._cells:
            return

        code = ""
        code_cell_idx: int | None = None
        title = ""
        disclosure_href = ""
        dt_text = ""
        company = ""

        for idx, cell in enumerate(self._cells):
            for href, text in cell.get("links") or []:
                href_s = normalize_spaces(href)
                if "stock/?code=" in href_s and CODE_ONLY_RE.match(text):
                    code = text
                    code_cell_idx = idx
                if "/disclosures/pdf/" in href_s or href_s.startswith("/disclosures/pdf/"):
                    title = text
                    disclosure_href = href_s

            cell_text = normalize_spaces(cell.get("text") or "")
            if not dt_text and KABUTAN_LIST_DT_RE.search(cell_text):
                dt_text = cell_text

        if code_cell_idx is not None and len(self._cells) > code_cell_idx + 1:
            company = normalize_spaces(self._cells[code_cell_idx + 1].get("text") or "")

        if not (code and title and disclosure_href):
            return

        doc_id = extract_tdnet_doc_id(disclosure_href)
        if not doc_id:
            return
        yyyymmdd_match = re.search(r"/pdf/(?P<ymd>\d{8})/", disclosure_href)
        yyyymmdd = yyyymmdd_match.group("ymd") if yyyymmdd_match else ""
        kabutan_pdf = build_kabutan_pdf_url(yyyymmdd, doc_id)
        dt_jst = parse_kabutan_list_datetime_jst(dt_text)
        if not dt_jst:
            return

        self.rows.append(
            KabutanListRow(
                code=code,
                company=company,
                title=title,
                datetime_jst=dt_jst,
                doc_id=doc_id,
                kabutan_pdf_url=kabutan_pdf,
            )
        )


def parse_disclosures(html: str) -> list[Disclosure]:
    # Prefer kabutan.jp disclosures table and consolidate JP/EN pairs by doc_id family.
    table_parser = KabutanDisclosuresTableParser()
    table_parser.feed(html)
    rows = table_parser.rows

    if not rows:
        # Fallback to older EN list parsing (direct tdnet-pdf links).
        parser = KabutanDisclosureParser()
        parser.feed(html)

        disclosures: list[Disclosure] = []
        seen: set[str] = set()
        for href, raw_text in parser.links:
            if href in seen:
                continue
            seen.add(href)

            pdf_en = normalize_spaces(href)
            pdf_ja = normalize_spaces(build_tdnet_pdf_url(href))
            headline = clean_headline(raw_text)
            m_code = CODE_RE.match(headline)
            if not m_code:
                continue
            code = m_code.group("code")
            raw_title = m_code.group("rest").strip()
            company, subject = split_company_and_subject(raw_title)
            title_en = normalize_spaces(subject or raw_title)

            m_dt = DATE_RE.search(raw_text)
            dt_jst = format_dt_jst_from_match(m_dt) if m_dt else ""

            tags = classify_tags(raw_text)
            title_ja = translate_subject_to_ja(title_en, tags)
            points_ja = build_points_ja(title_en, tags)

            doc_id = extract_tdnet_doc_id(href)
            family = doc_id[:16] if len(doc_id) >= 16 else doc_id
            disclosures.append(
                Disclosure(
                    id=make_kabutan_family_key(code, doc_id or href),
                    code=code,
                    company=company,
                    title_en=title_en,
                    title_ja=title_ja,
                    points_ja=points_ja,
                    datetime_jst=dt_jst,
                    tags=tags,
                    doc_id_family=family,
                    doc_id_ja=extract_tdnet_doc_id(pdf_ja),
                    doc_id_en=extract_tdnet_doc_id(pdf_en),
                    pdf_url_ja=pdf_ja,
                    pdf_url_en=pdf_en,
                    source_url=KABUTAN_DISCLOSURES_URL,
                )
            )

        disclosures.sort(key=lambda d: (d.datetime_jst or "", d.id), reverse=True)
        return disclosures

    groups: dict[tuple[str, str], list[KabutanListRow]] = {}
    for r in rows:
        family = r.doc_id[:16] if len(r.doc_id) >= 16 else r.doc_id
        groups.setdefault((r.code, family), []).append(r)

    disclosures: list[Disclosure] = []
    for (code, family), grp in groups.items():
        grp_sorted = sorted(grp, key=lambda x: x.doc_id)
        ja_row = next((r for r in grp_sorted if has_japanese(r.title)), None)
        en_row = next((r for r in grp_sorted if not has_japanese(r.title)), None)
        primary = ja_row or en_row or grp_sorted[0]

        title_ja = normalize_spaces(ja_row.title if ja_row else "")
        title_en = normalize_spaces(en_row.title if en_row else "")

        if not title_ja and has_japanese(primary.title):
            title_ja = normalize_spaces(primary.title)
        if not title_en and not has_japanese(primary.title):
            title_en = normalize_spaces(primary.title)

        tags_source = title_ja or title_en or primary.title
        tags = classify_tags(tags_source)
        if not title_ja:
            title_ja = translate_subject_to_ja(title_en or primary.title, tags)
        points_ja = build_points_ja(title_en or title_ja, tags)

        doc_id_ja = ja_row.doc_id if ja_row else primary.doc_id
        doc_id_en = en_row.doc_id if en_row else ""
        pdf_ja = normalize_spaces(ja_row.kabutan_pdf_url if ja_row else primary.kabutan_pdf_url)
        pdf_en = normalize_spaces(en_row.kabutan_pdf_url if en_row else "")

        disclosures.append(
            Disclosure(
                id=make_kabutan_family_key(code, primary.doc_id),
                code=code,
                company=normalize_spaces(primary.company),
                title_en=title_en,
                title_ja=title_ja,
                points_ja=points_ja,
                datetime_jst=normalize_spaces(primary.datetime_jst),
                tags=tags,
                doc_id_family=family,
                doc_id_ja=doc_id_ja,
                doc_id_en=doc_id_en,
                pdf_url_ja=pdf_ja,
                pdf_url_en=pdf_en,
                source_url=KABUTAN_DISCLOSURES_URL,
            )
        )

    disclosures.sort(key=lambda d: (d.datetime_jst or "", d.id), reverse=True)
    return disclosures


def load_tdnet_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "last_checked_jst": None, "items": []}
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_store(data: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(data, dict):
        return {"version": 1, "last_checked_jst": None, "items": []}
    items = data.get("items")
    if not isinstance(items, list):
        items = []
    return {"version": int(data.get("version") or 1), "last_checked_jst": data.get("last_checked_jst"), "items": items}


def disclosure_to_item(d: Disclosure) -> dict[str, Any]:
    # Kabutan-hosted PDFs are often an English-rendered mirror. Use TDnet official as "Japanese default".
    pdf_kabutan_ja = normalize_spaces(d.pdf_url_ja)
    pdf_kabutan_en = normalize_spaces(d.pdf_url_en)
    pdf_tdnet = normalize_spaces(build_tdnet_pdf_url(d.doc_id_ja or d.doc_id_en))
    pdf_ja = pdf_tdnet or pdf_kabutan_ja
    pdf_primary = pdf_ja or pdf_kabutan_en
    title_fallback = normalize_spaces(d.title_en) or normalize_spaces(d.title_ja)
    return {
        "id": d.id,
        "code": d.code,
        "company": d.company,
        "title": title_fallback,
        "title_en": d.title_en,
        "title_ja": d.title_ja,
        "points_ja": d.points_ja,
        "datetime_jst": d.datetime_jst,
        "tags": d.tags,
        "doc_id_family": d.doc_id_family,
        "doc_id_ja": d.doc_id_ja,
        "doc_id_en": d.doc_id_en,
        # Primary PDF link used by UI/Slack.
        "pdf_url": pdf_primary,
        # Explicit fields (for UI buttons / future enrichment).
        "pdf_url_kabutan": pdf_kabutan_ja or pdf_kabutan_en,
        "pdf_url_tdnet": pdf_tdnet,
        # Backward compatible fields (older UI expects these).
        "pdf_url_ja": pdf_ja,
        "pdf_url_en": pdf_kabutan_en,
        "source_url": d.source_url,
    }


def backfill_item_fields(item: dict[str, Any]) -> bool:
    changed = False

    tags = item.get("tags")
    if not isinstance(tags, list):
        tags = []
        item["tags"] = tags
        changed = True
    tags = [str(t) for t in tags if t]
    # Add missing tags heuristically from the title (best-effort).
    title_for_tags = normalize_spaces(item.get("title_en") or item.get("title") or "")
    if title_for_tags:
        for t in classify_tags(title_for_tags):
            if t not in tags:
                tags.append(t)
                changed = True
    item["tags"] = tags

    raw_title = normalize_spaces(item.get("title_en") or item.get("title") or "")
    title_en = normalize_spaces(item.get("title_en") or "")
    company = normalize_spaces(item.get("company") or "")

    if not title_en and raw_title:
        if not company:
            company2, subject2 = split_company_and_subject(raw_title)
            if company2:
                item["company"] = company2
                company = company2
                changed = True
            title_en = normalize_spaces(subject2 or raw_title)
        else:
            title_en = raw_title
        item["title_en"] = title_en
        item["title"] = title_en
        changed = True

    if title_en and normalize_spaces(item.get("title") or "") != title_en:
        item["title"] = title_en
        changed = True

    if title_en:
        computed_ja = translate_subject_to_ja(title_en, tags)
        if normalize_spaces(item.get("title_ja") or "") != computed_ja:
            item["title_ja"] = computed_ja
            changed = True

        computed_points = build_points_ja(title_en, tags)
        existing_points = item.get("points_ja")
        if not isinstance(existing_points, list):
            existing_points = []
        existing_points = [normalize_spaces(p) for p in existing_points if normalize_spaces(p)]
        if existing_points != computed_points:
            item["points_ja"] = computed_points
            changed = True
    else:
        points_ja = item.get("points_ja")
        if not isinstance(points_ja, list):
            points_ja = []
        item["points_ja"] = [normalize_spaces(p) for p in points_ja if normalize_spaces(p)]

    if company and normalize_spaces(item.get("company") or "") != company:
        item["company"] = company
        changed = True

    # PDFs (JP preferred; keep EN optional). Backfill only missing fields.
    pdf_url = normalize_spaces(item.get("pdf_url") or "")
    pdf_kabutan = normalize_spaces(item.get("pdf_url_kabutan") or "")
    pdf_tdnet = normalize_spaces(item.get("pdf_url_tdnet") or "")
    pdf_url_ja = normalize_spaces(item.get("pdf_url_ja") or "")
    pdf_url_en = normalize_spaces(item.get("pdf_url_en") or "")
    item_id = normalize_spaces(item.get("id") or "")

    def is_kabutan(u: str) -> bool:
        return "tdnet-pdf.kabutan.jp" in normalize_spaces(u)

    def is_tdnet(u: str) -> bool:
        return "release.tdnet.info/inbs/" in normalize_spaces(u)

    if not pdf_kabutan:
        if is_kabutan(pdf_url_ja):
            pdf_kabutan = pdf_url_ja
        elif is_kabutan(pdf_url_en):
            pdf_kabutan = pdf_url_en
        elif is_kabutan(pdf_url):
            pdf_kabutan = pdf_url
        elif is_kabutan(item_id):
            pdf_kabutan = item_id

    if pdf_kabutan and not normalize_spaces(item.get("pdf_url_kabutan") or ""):
        item["pdf_url_kabutan"] = pdf_kabutan
        changed = True

    if not pdf_tdnet:
        doc_id = extract_tdnet_doc_id(pdf_url_ja or pdf_url_en or pdf_kabutan or pdf_url or item_id)
        candidate = build_tdnet_pdf_url(doc_id) if doc_id else ""
        if candidate:
            pdf_tdnet = candidate

    if pdf_tdnet and not normalize_spaces(item.get("pdf_url_tdnet") or ""):
        item["pdf_url_tdnet"] = pdf_tdnet
        changed = True

    if not pdf_url_ja:
        pdf_url_ja = pdf_kabutan or pdf_tdnet or pdf_url
        if pdf_url_ja:
            item["pdf_url_ja"] = pdf_url_ja
            changed = True

    if not pdf_url and (pdf_url_ja or pdf_tdnet or pdf_url_en or pdf_kabutan):
        item["pdf_url"] = pdf_url_ja or pdf_tdnet or pdf_url_en or pdf_kabutan
        changed = True

    # 日本語PDFをデフォルトにする（旧データの移行）。
    # - `pdf_url_ja` は TDnet公式を優先
    # - `pdf_url`（旧UI/Slack互換）も同じに揃える
    if pdf_tdnet:
        if normalize_spaces(item.get("pdf_url_ja") or "") != pdf_tdnet:
            item["pdf_url_ja"] = pdf_tdnet
            changed = True

        cur_primary = normalize_spaces(item.get("pdf_url") or "")
        if (not cur_primary) or is_kabutan(cur_primary):
            item["pdf_url"] = pdf_tdnet
            changed = True

    return changed


def load_watchlist_name_map(path: Path) -> dict[str, str]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    groups = data.get("groups")
    if not isinstance(groups, list):
        return {}
    out: dict[str, str] = {}
    for g in groups:
        if not isinstance(g, dict):
            continue
        tickers = g.get("tickers")
        if not isinstance(tickers, list):
            continue
        for t in tickers:
            if not isinstance(t, dict):
                continue
            code = normalize_spaces(t.get("code") or "")
            name = normalize_spaces(t.get("name") or "")
            if code and name and code not in out:
                out[code] = name
    return out


def truncate(text: str, max_len: int) -> str:
    s = normalize_spaces(text)
    if len(s) <= max_len:
        return s
    return s[: max_len - 1] + "…"


def has_japanese(text: str) -> bool:
    s = normalize_spaces(text)
    if not s:
        return False
    return re.search(r"[一-龯ぁ-んァ-ン]", s) is not None


def build_message(new_items: list[Disclosure], pages_base_url: str, name_map: dict[str, str]) -> str:
    ts = datetime.now(JST).strftime("%Y/%m/%d %H:%M")
    header = f"*適時開示（ウォッチ）* {ts} JST"
    lines: list[str] = [header, f"一覧: {KABUTAN_DISCLOSURES_URL}"]

    tag_priority = [
        "決算",
        "業績修正",
        "配当",
        "自己株",
        "TOB",
        "増資/売出",
        "M&A",
        "人事",
        "借入",
        "訂正",
        "遅延",
    ]

    def pick_tag(tags: list[str]) -> str:
        for t in tag_priority:
            if t in tags:
                return t
        return tags[0] if tags else ""

    for d in new_items[:10]:
        jp_name = normalize_spaces(name_map.get(d.code) or "")
        company = normalize_spaces(d.company)
        name = jp_name or company or d.code
        display = f"{name}（{d.code}）" if name and name != d.code else f"{d.code}"
        item_link = f"https://kabutan.jp/stock/?code={urllib.parse.quote(d.code)}"

        title_ja = normalize_spaces(d.title_ja)
        title_en = normalize_spaces(d.title_en)
        point = normalize_spaces(d.points_ja[0]) if d.points_ja else ""

        if title_ja and has_japanese(title_ja):
            summary_core = title_ja
        else:
            # Ensure the summary is Japanese when possible (fallback to points_ja).
            summary_core = point or title_ja or title_en or "（要約なし）"

        tag = pick_tag(d.tags)
        tag_part = f"【{tag}】" if tag else ""
        summary = truncate(summary_core, 20) + tag_part

        pdf_primary = normalize_spaces(build_tdnet_pdf_url(d.doc_id_ja or d.doc_id_en)) or normalize_spaces(d.pdf_url_ja)
        pdf_part = f" <{pdf_primary}|PDF>" if pdf_primary else ""

        log_part = ""
        base = normalize_spaces(pages_base_url)
        if base:
            base2 = base if base.endswith("/") else base + "/"
            log_url = f"{base2}tdnet/index.html?q={urllib.parse.quote(d.code)}"
            log_part = f" · <{log_url}|ログ>"

        lines.append(f"- *{display}*: {summary}{pdf_part} · <{item_link}|株探>{log_part}")
    if len(new_items) > 10:
        lines.append(f"- 他{len(new_items) - 10}件（続きはログ参照）")
    return "\n".join(lines)


def load_pages_base_url(path: Path) -> str:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return ""
    if not isinstance(data, dict):
        return ""
    url = normalize_spaces(data.get("pages_base_url") or "")
    return url


def item_family_key(item: dict[str, Any]) -> str:
    raw_id = normalize_spaces(item.get("id") or "")
    if raw_id.startswith("kabutan:"):
        return raw_id
    code = normalize_spaces(item.get("code") or "")
    if not code:
        return raw_id or normalize_spaces(item.get("pdf_url") or "")
    doc_id = normalize_spaces(item.get("doc_id_ja") or item.get("doc_id_en") or "")
    if not doc_id:
        doc_id = extract_tdnet_doc_id(
            normalize_spaces(
                item.get("pdf_url_ja")
                or item.get("pdf_url_en")
                or item.get("pdf_url_kabutan")
                or item.get("pdf_url")
                or raw_id,
            )
        )
    if doc_id:
        return make_kabutan_family_key(code, doc_id)
    return raw_id or normalize_spaces(item.get("pdf_url") or "")


def main() -> int:
    ap = argparse.ArgumentParser(description="Poll Kabutan TDnet disclosures and update docs/data/tdnet.json.")
    ap.add_argument("--data", default="docs/data/tdnet.json", help="TDnet JSON store path")
    ap.add_argument("--config", default="brief.config.json", help="Config JSON containing pages_base_url")
    ap.add_argument("--watchlist", default="docs/data/watchlist.json", help="Optional watchlist JSON for JP names")
    ap.add_argument("--out", default=os.environ.get("GITHUB_OUTPUT", ""), help="GitHub Actions output file path")
    args = ap.parse_args()

    store_path = Path(args.data)
    store = normalize_store(load_tdnet_json(store_path))
    existing_items: list[dict[str, Any]] = [it for it in store["items"] if isinstance(it, dict)]
    existing_keys = {item_family_key(it) for it in existing_items if item_family_key(it)}
    existing_by_key = {item_family_key(it): it for it in existing_items if item_family_key(it)}

    html = fetch_html(KABUTAN_DISCLOSURES_URL)
    latest = parse_disclosures(html)

    is_bootstrap = len(existing_keys) == 0
    new_items = [d for d in latest if d.id not in existing_keys]
    has_changes = False
    should_notify = False

    message = ""

    if is_bootstrap and latest:
        # Seed baseline without notifying (avoid spamming Slack on first run).
        store["items"] = [disclosure_to_item(d) for d in latest[:MAX_ITEMS]]
        has_changes = True
        new_items = []
    elif latest:
        store_changed = False
        for d in latest[:200]:
            new_it = disclosure_to_item(d)
            old_it = existing_by_key.get(new_it.get("id") or "")
            if not old_it:
                continue
            for k in ("company", "title_ja", "title_en", "pdf_url_ja", "pdf_url_en", "pdf_url_tdnet", "pdf_url"):
                if normalize_spaces(old_it.get(k) or "") != normalize_spaces(new_it.get(k) or ""):
                    store_changed = True
                    break
            if store_changed:
                break

        if new_items or store_changed:
            merged: list[dict[str, Any]] = []
            seen: set[str] = set()
            for d in latest:
                it = disclosure_to_item(d)
                key = normalize_spaces(it.get("id") or "")
                if not key or key in seen:
                    continue
                seen.add(key)
                merged.append(it)
            for it in existing_items:
                key = item_family_key(it)
                if not key or key in seen:
                    continue
                seen.add(key)
                merged.append(it)
            store["items"] = merged[:MAX_ITEMS]
            has_changes = True

        if new_items:
            name_map = load_watchlist_name_map(Path(args.watchlist))
            watch_codes = set(name_map.keys())
            watch_items = [d for d in new_items if d.code in watch_codes]
            if watch_items:
                should_notify = True
                pages_base_url = load_pages_base_url(Path(args.config))
                message = build_message(watch_items, pages_base_url, name_map)

    # Backfill / migrate existing items (JP title + points, company split, etc.)
    backfilled = False
    for it in store["items"]:
        if isinstance(it, dict) and backfill_item_fields(it):
            backfilled = True

    if backfilled:
        has_changes = True

    if has_changes:
        store["last_checked_jst"] = datetime.now(JST).isoformat(timespec="seconds")
        store_path.parent.mkdir(parents=True, exist_ok=True)
        store_path.write_text(json.dumps(store, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.out:
        out_path = Path(args.out)
        # Append to existing GITHUB_OUTPUT file.
        outputs: dict[str, str] = {
            "has_changes": "true" if has_changes else "false",
            "should_notify": "true" if should_notify else "false",
            "new_count": str(len(new_items)),
            "message": message,
        }
        with out_path.open("a", encoding="utf-8") as f:
            for k, v in outputs.items():
                if "\n" not in v:
                    f.write(f"{k}={v}\n")
                else:
                    marker = "EOF"
                    f.write(f"{k}<<{marker}\n")
                    f.write(v.rstrip("\n") + "\n")
                    f.write(f"{marker}\n")
    else:
        # For local run.
        print(json.dumps({"has_changes": has_changes, "new_count": len(new_items)}, ensure_ascii=False))
        if message:
            print(message)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
