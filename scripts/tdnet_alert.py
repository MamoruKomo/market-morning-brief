#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import ssl
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

KABUTAN_DISCLOSURES_URL = "https://en.kabutan.com/jp/disclosures"
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
    pdf_url: str
    source_url: str


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
            "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
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


def parse_disclosures(html: str) -> list[Disclosure]:
    parser = KabutanDisclosureParser()
    parser.feed(html)

    disclosures: list[Disclosure] = []
    seen: set[str] = set()
    for href, raw_text in parser.links:
        if href in seen:
            continue
        seen.add(href)

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
        disclosures.append(
            Disclosure(
                id=href,
                code=code,
                company=company,
                title_en=title_en,
                title_ja=title_ja,
                points_ja=points_ja,
                datetime_jst=dt_jst,
                tags=tags,
                pdf_url=href,
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
    return {
        "id": d.id,
        "code": d.code,
        "company": d.company,
        "title": d.title_en,
        "title_en": d.title_en,
        "title_ja": d.title_ja,
        "points_ja": d.points_ja,
        "datetime_jst": d.datetime_jst,
        "tags": d.tags,
        "pdf_url": d.pdf_url,
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

    return changed


def build_message(new_items: list[Disclosure], pages_base_url: str) -> str:
    ts = datetime.now(JST).strftime("%Y/%m/%d %H:%M")
    header = f"*適時開示アラート*（Kabutan/TDnet） {ts} JST"
    link = pages_base_url.rstrip("/") + "/tdnet/"
    lines: list[str] = [header, f"全件ログ: {link}"]
    for d in new_items[:10]:
        tag = f" [{'/'.join(d.tags)}]" if d.tags else ""
        dt = f"{d.datetime_jst} " if d.datetime_jst else ""
        company = f"{d.company} " if d.company else ""
        title = d.title_ja or d.title_en
        lines.append(f"・{dt}{d.code} {company}{title}{tag}（PDF: {d.pdf_url}）")
    if len(new_items) > 10:
        lines.append(f"・他{len(new_items) - 10}件（続きはログ参照）")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description="Poll Kabutan TDnet disclosures and update docs/data/tdnet.json.")
    ap.add_argument("--data", default="docs/data/tdnet.json", help="TDnet JSON store path")
    ap.add_argument("--config", default="brief.config.json", help="Config JSON containing pages_base_url")
    ap.add_argument("--out", default=os.environ.get("GITHUB_OUTPUT", ""), help="GitHub Actions output file path")
    args = ap.parse_args()

    store_path = Path(args.data)
    store = normalize_store(load_tdnet_json(store_path))
    existing_ids = {str(it.get("id") or it.get("pdf_url") or "") for it in store["items"] if isinstance(it, dict)}

    html = fetch_html(KABUTAN_DISCLOSURES_URL)
    latest = parse_disclosures(html)

    is_bootstrap = len(existing_ids) == 0
    new_items = [d for d in latest if d.id not in existing_ids]
    has_changes = False
    should_notify = False

    pages_base_url = ""
    cfg_path = Path(args.config)
    if cfg_path.exists():
        try:
            cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
            pages_base_url = str(cfg.get("pages_base_url") or "").strip()
        except Exception:
            pages_base_url = ""
    if not pages_base_url:
        pages_base_url = "https://<github-username>.github.io/<repo>/"

    message = ""

    if is_bootstrap and latest:
        # Seed baseline without notifying (avoid spamming Slack on first run).
        store["items"] = [disclosure_to_item(d) for d in latest[:MAX_ITEMS]]
        has_changes = True
        new_items = []
    elif new_items:
        items: list[dict[str, Any]] = []
        # Prepend new items.
        for d in new_items:
            items.append(disclosure_to_item(d))
        # Keep existing items.
        for it in store["items"]:
            if isinstance(it, dict):
                items.append(it)
        # Dedup by id while keeping order.
        seen: set[str] = set()
        deduped: list[dict[str, Any]] = []
        for it in items:
            key = str(it.get("id") or it.get("pdf_url") or "")
            if not key or key in seen:
                continue
            seen.add(key)
            deduped.append(it)
        store["items"] = deduped[:MAX_ITEMS]
        has_changes = True
        should_notify = True
        message = build_message(new_items, pages_base_url)

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
