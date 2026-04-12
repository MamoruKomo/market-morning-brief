#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


KABUTAN_DISCLOSURES_URL = "https://en.kabutan.com/jp/disclosures"
JST = ZoneInfo("Asia/Tokyo")


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


def classify_tags(text: str) -> list[str]:
    t = text.lower()
    tags: list[str] = []

    def add(tag: str) -> None:
        if tag not in tags:
            tags.append(tag)

    if "financial results" in t or "earnings" in t:
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
    title: str
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
    with urllib.request.urlopen(req, timeout=30) as res:
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
        title = m_code.group("rest").strip()

        m_dt = DATE_RE.search(raw_text)
        dt_jst = format_dt_jst_from_match(m_dt) if m_dt else ""

        tags = classify_tags(raw_text)
        disclosures.append(
            Disclosure(
                id=href,
                code=code,
                title=title,
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


def build_message(new_items: list[Disclosure], pages_base_url: str) -> str:
    ts = datetime.now(JST).strftime("%Y/%m/%d %H:%M")
    header = f"*適時開示アラート*（Kabutan/TDnet） {ts} JST"
    link = pages_base_url.rstrip("/") + "/tdnet/"
    lines: list[str] = [header, f"全件ログ: {link}"]
    for d in new_items[:10]:
        tag = f" [{'/'.join(d.tags)}]" if d.tags else ""
        dt = f"{d.datetime_jst} " if d.datetime_jst else ""
        lines.append(f"・{dt}{d.code} {d.title}{tag}（PDF: {d.pdf_url}）")
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
        store["items"] = [
            {
                "id": d.id,
                "code": d.code,
                "company": "",
                "title": d.title,
                "datetime_jst": d.datetime_jst,
                "tags": d.tags,
                "pdf_url": d.pdf_url,
                "source_url": d.source_url,
            }
            for d in latest[:2000]
        ]
        store["last_checked_jst"] = datetime.now(JST).isoformat(timespec="seconds")
        store_path.parent.mkdir(parents=True, exist_ok=True)
        store_path.write_text(json.dumps(store, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        has_changes = True
        should_notify = False
        new_items = []
    elif new_items:
        items: list[dict[str, Any]] = []
        # Prepend new items.
        for d in new_items:
            items.append(
                {
                    "id": d.id,
                    "code": d.code,
                    "company": "",
                    "title": d.title,
                    "datetime_jst": d.datetime_jst,
                    "tags": d.tags,
                    "pdf_url": d.pdf_url,
                    "source_url": d.source_url,
                }
            )
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
        store["items"] = deduped[:2000]
        store["last_checked_jst"] = datetime.now(JST).isoformat(timespec="seconds")
        store_path.parent.mkdir(parents=True, exist_ok=True)
        store_path.write_text(json.dumps(store, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        has_changes = True
        should_notify = True
        message = build_message(new_items, pages_base_url)

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
