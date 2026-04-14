#!/usr/bin/env python3
from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import html
import json
import os
import re
import ssl
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from pipelines.brief.upsert_index import upsert_index_file
from pipelines.common.pages import ensure_docs_base_url

try:
    import certifi  # type: ignore
except Exception:
    certifi = None

JST = ZoneInfo("Asia/Tokyo")

TRADERS_JP_INDEX_URL = "https://www.traders.co.jp/market_jp/index"
TRADERS_BOND_URL = "https://www.traders.co.jp/market_fo/bond"
TRADERS_COMMODITY_URL = "https://www.traders.co.jp/market_fo/commodity"
INVESTING_NK_FUTURES_URL = "https://www.investing.com/indices/japan-225-futures"
NIKKEI_INDEX_PROFILE_URL = "https://indexes.nikkei.co.jp/en/nkave/index/profile"

STOOQ_QUOTE_URL = "https://stooq.com/q/?s={symbol}"

DEFAULT_HEADERS = {
    "User-Agent": "market-morning-brief/1.0",
    "Accept-Language": "ja,en;q=0.8",
}

URL_RE = re.compile(r"https?://[^\s<>()（）]+")


def load_json(path: Path, default: Any) -> Any:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except Exception:
        return default


def dump_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def fetch_text(url: str, timeout: int = 25, headers: dict[str, str] | None = None) -> str:
    req = urllib.request.Request(url, headers=(headers or DEFAULT_HEADERS))
    context = None
    if certifi is not None:
        try:
            context = ssl.create_default_context(cafile=certifi.where())
        except Exception:
            context = None
    if context is None:
        context = ssl.create_default_context()

    with urllib.request.urlopen(req, timeout=timeout, context=context) as res:
        data = res.read()
        # Let Python detect encoding from headers when possible; fallback to utf-8.
        try:
            charset = res.headers.get_content_charset()  # type: ignore[attr-defined]
        except Exception:
            charset = None
    enc = charset or "utf-8"
    return data.decode(enc, errors="replace")


def fetch_json(url: str, timeout: int = 25, headers: dict[str, str] | None = None) -> Any:
    return json.loads(fetch_text(url, timeout=timeout, headers=headers))


@dataclasses.dataclass(frozen=True)
class CachedFetcher:
    cache_dir: Path | None
    offline: bool = False
    timeout: int = 25

    def _path(self, key: str, suffix: str) -> Path | None:
        if not self.cache_dir:
            return None
        safe = re.sub(r"[^a-zA-Z0-9._-]+", "_", key).strip("_")
        return self.cache_dir / f"{safe}{suffix}"

    def text(
        self,
        key: str,
        url: str,
        *,
        suffix: str = ".html",
        headers: dict[str, str] | None = None,
        timeout: int | None = None,
    ) -> str:
        path = self._path(key, suffix)
        if self.offline:
            if not path:
                raise RuntimeError("offline mode requires --cache-dir")
            return path.read_text(encoding="utf-8", errors="replace")
        text = fetch_text(url, timeout=timeout or self.timeout, headers=headers)
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        return text

    def json(
        self,
        key: str,
        url: str,
        *,
        suffix: str = ".json",
        headers: dict[str, str] | None = None,
        timeout: int | None = None,
    ) -> Any:
        return json.loads(self.text(key, url, suffix=suffix, headers=headers, timeout=timeout))


def strip_tags(s: str) -> str:
    s = re.sub(r"<script\b[^>]*>.*?</script>", " ", s, flags=re.S | re.I)
    s = re.sub(r"<style\b[^>]*>.*?</style>", " ", s, flags=re.S | re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def parse_float(s: str) -> float | None:
    s = strip_tags(s)
    s = s.replace(",", "")
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    if not m:
        return None
    try:
        return float(m.group(0))
    except Exception:
        return None


def parse_percent(s: str) -> float | None:
    s = strip_tags(s)
    s = s.replace(",", "")
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    if not m:
        return None
    try:
        return float(m.group(0))
    except Exception:
        return None


def parse_html_table_rows(html_text: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for tr in re.findall(r"<tr\b[^>]*>.*?</tr>", html_text, flags=re.S | re.I):
        cells = re.findall(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", tr, flags=re.S | re.I)
        if not cells:
            continue
        rows.append([strip_tags(c) for c in cells])
    return rows


@dataclasses.dataclass(frozen=True)
class QuoteTwoDay:
    symbol: str
    date: str
    close: float
    prev_date: str
    prev_close: float

    @property
    def pct_change(self) -> float | None:
        if not self.prev_close:
            return None
        return (self.close / self.prev_close - 1.0) * 100.0

    @property
    def change(self) -> float:
        return self.close - self.prev_close


def parse_stooq_day_month(day_month: str, now: dt.date) -> str:
    # Stooq displays like "10 Apr" without year.
    try:
        d = dt.datetime.strptime(f"{day_month} {now.year}", "%d %b %Y").date()
        # If parsed date is too far in the future, assume it's last year (year crossover around Jan).
        if d > now + dt.timedelta(days=3):
            d = dt.datetime.strptime(f"{day_month} {now.year - 1}", "%d %b %Y").date()
        return d.isoformat()
    except Exception:
        return now.isoformat()


def fetch_stooq_two_day(symbol: str, fetcher: CachedFetcher, key: str) -> QuoteTwoDay | None:
    # Stooq daily CSV now often requires an API key; parse quote page instead.
    url = STOOQ_QUOTE_URL.format(symbol=urllib.parse.quote(symbol))
    text = fetcher.text(key, url, suffix=".html", timeout=25)
    plain = strip_tags(text).replace("−", "-")
    # Example (after strip_tags): "10 Apr , 23:00 6816.89 -7.77 (-0.11%)"
    m = re.search(
        r"(\d{1,2}\s+[A-Za-z]{3})\s*,\s*(\d{1,2}:\d{2})\s+([0-9][0-9,]*\.?[0-9]*)\s+([-+]?[0-9][0-9,]*\.?[0-9]*)\s*\(([-+]?[0-9][0-9,]*\.?[0-9]*)%\)",
        plain,
    )
    if not m:
        return None
    day_month = m.group(1)
    close = parse_float(m.group(3))
    change = parse_float(m.group(4))
    pct = parse_percent(m.group(5))
    if close is None:
        return None

    prev_close = None
    if change is not None:
        prev_close = close - change
    elif pct is not None:
        denom = 1.0 + pct / 100.0
        if abs(denom) > 1e-9:
            prev_close = close / denom
    if prev_close is None:
        return None

    date_iso = parse_stooq_day_month(day_month, dt.datetime.now(JST).date())
    prev_date = ""
    try:
        prev_date = (dt.date.fromisoformat(date_iso) - dt.timedelta(days=1)).isoformat()
    except Exception:
        prev_date = ""
    return QuoteTwoDay(symbol=symbol, date=date_iso, close=close, prev_date=prev_date, prev_close=prev_close)


@dataclasses.dataclass(frozen=True)
class NikkeiClose:
    date: str
    close: float
    pct: float | None


def parse_traders_timestamp_date(html_text: str) -> str | None:
    m = re.search(r'data_table_timestamp">\s*(\d{4}-\d{2}-\d{2})\s', html_text)
    if not m:
        return None
    return m.group(1)


def extract_last_percent(text: str) -> float | None:
    matches = re.findall(r"([-+]?\d+(?:\.\d+)?)\s*%", strip_tags(text).replace("−", "-"))
    if not matches:
        return None
    try:
        return float(matches[-1])
    except Exception:
        return None


def parse_traders_index_quote(html_text: str, label: str) -> NikkeiClose | None:
    rows = parse_html_table_rows(html_text)
    for r in rows:
        if len(r) < 3:
            continue
        if label not in r[0]:
            continue
        close = parse_float(r[1])
        pct = extract_last_percent(r[2])
        if close is None:
            continue
        date = parse_traders_timestamp_date(html_text) or dt.datetime.now(JST).date().isoformat()
        return NikkeiClose(date=date, close=close, pct=pct)
    return None


@dataclasses.dataclass(frozen=True)
class TradersSector:
    name: str
    pct: float


def parse_traders_sectors(html_text: str) -> list[TradersSector]:
    # Robust parsing: scan all tables and keep rows whose first cell matches TSE 33 sector names.
    def norm(name: str) -> str:
        return name.strip().replace("･", "・")

    sector_names = {
        "水産・農林業",
        "鉱業",
        "建設業",
        "食料品",
        "繊維製品",
        "パルプ・紙",
        "化学",
        "医薬品",
        "石油・石炭製品",
        "ゴム製品",
        "ガラス・土石製品",
        "鉄鋼",
        "非鉄金属",
        "金属製品",
        "機械",
        "電気機器",
        "輸送用機器",
        "精密機器",
        "その他製品",
        "電気・ガス業",
        "陸運業",
        "海運業",
        "空運業",
        "倉庫・運輸関連業",
        "情報・通信業",
        "卸売業",
        "小売業",
        "銀行業",
        "証券、商品先物取引業",
        "証券･商品先物取引業",
        "保険業",
        "その他金融業",
        "不動産業",
        "サービス業",
    }

    rows = parse_html_table_rows(html_text)
    out: list[TradersSector] = []
    for r in rows:
        if not r:
            continue
        name = norm(r[0])
        if name not in sector_names:
            continue
        pct_val = None
        for cell in r[1:]:
            pct_val = extract_last_percent(cell)
            if pct_val is not None:
                break
        if pct_val is None:
            continue
        out.append(TradersSector(name=name, pct=float(pct_val)))
    # Deduplicate by name (keep first).
    seen: set[str] = set()
    dedup: list[TradersSector] = []
    for s in out:
        if s.name in seen:
            continue
        seen.add(s.name)
        dedup.append(s)
    return dedup


@dataclasses.dataclass(frozen=True)
class TradersSchedule:
    domestic: list[str]
    overseas: list[str]
    earnings: list[str]


def parse_traders_schedule(html_text: str) -> TradersSchedule:
    def extract_div_block(s: str, start: int) -> str | None:
        # Minimal HTML "div" block extractor using nesting count.
        m0 = re.search(r"<div\b", s[start:], flags=re.I)
        if not m0:
            return None
        i = start + m0.start()
        depth = 0
        for m in re.finditer(r"<\s*(/?)div\b", s[i:], flags=re.I):
            tag_start = i + m.start()
            tag_end = s.find(">", tag_start)
            if tag_end == -1:
                return None
            is_close = bool(m.group(1))
            if not is_close:
                depth += 1
            else:
                depth -= 1
                if depth == 0:
                    return s[i : tag_end + 1]
        return None

    # Extract the Market Schedule card block (avoid navigation menus).
    m = re.search(r'<div class="card market_schedule">', html_text)
    if not m:
        return TradersSchedule(domestic=[], overseas=[], earnings=[])
    block = extract_div_block(html_text, m.start()) or ""
    if not block:
        return TradersSchedule(domestic=[], overseas=[], earnings=[])

    def norm_list(s: str) -> str:
        parts = [p.strip() for p in s.split("、") if p.strip()]
        if len(parts) <= 12:
            return s
        return "、".join(parts[:12]) + "…"

    domestic: list[str] = []
    overseas: list[str] = []
    earnings: list[str] = []
    for m_label in re.finditer(r'<div class="card-section-label">\s*(.*?)\s*</div>', block, flags=re.S):
        label = strip_tags(m_label.group(1))
        after_label = m_label.end()
        m_body = re.search(r'<div class="card-body[^"]*">', block[after_label:], flags=re.S)
        if not m_body:
            continue
        body_start = after_label + m_body.start()
        body_block = extract_div_block(block, body_start)
        if not body_block:
            continue
        items = [strip_tags(x) for x in re.findall(r'<div class="card-text">\s*(.*?)\s*</div>', body_block, flags=re.S)]
        items = [re.sub(r"\s+", " ", it).strip() for it in items if it and it.strip()]

        target = domestic if "国内" in label else overseas if "海外" in label else domestic
        mode = "events"
        for it in items:
            if "《決算発表》" in it or "《米決算発表》" in it:
                mode = "earnings"
                continue
            if mode == "earnings":
                earnings.append(norm_list(it))
            else:
                target.append(it)

    return TradersSchedule(domestic=domestic[:8], overseas=overseas[:8], earnings=earnings[:10])


@dataclasses.dataclass(frozen=True)
class YieldQuote:
    label: str
    value: float
    change: float | None


def parse_traders_yield(html_text: str, label_contains: str) -> YieldQuote | None:
    rows = parse_html_table_rows(html_text)
    for r in rows:
        if not r:
            continue
        if label_contains in r[0]:
            # Expect: [銘柄, 利回り, 前日比, ...]
            if len(r) < 2:
                continue
            val = parse_float(r[1])
            chg = parse_float(r[2]) if len(r) >= 3 else None
            if val is None:
                continue
            return YieldQuote(label=r[0], value=val, change=chg)
    return None


@dataclasses.dataclass(frozen=True)
class CommodityQuote:
    label: str
    value: float
    pct: float | None


def parse_traders_commodity(html_text: str, label_contains: str) -> CommodityQuote | None:
    rows = parse_html_table_rows(html_text)
    for r in rows:
        if not r:
            continue
        if label_contains in r[0]:
            # Expect: [銘柄, 現在値, 前日比, 騰落率(%), ...]
            if len(r) < 2:
                continue
            val = parse_float(r[1])
            pct = parse_percent(r[3]) if len(r) >= 4 else None
            if val is None:
                continue
            return CommodityQuote(label=r[0], value=val, pct=pct)
    return None


def parse_investing_last_price(html_text: str) -> float | None:
    # New site markup tends to include instrument-price-last.
    m = re.search(r"instrument-price-last[^>]*>([0-9][0-9,]*\.?[0-9]*)<", html_text)
    if m:
        return parse_float(m.group(1))
    # Fallback: common JSON snippet `"last":12345.6`
    m2 = re.search(r"\"last\"\s*:\s*([0-9][0-9,]*\.?[0-9]*)", html_text)
    if m2:
        return parse_float(m2.group(1))
    return None


def format_signed(n: float, digits: int = 2, suffix: str = "") -> str:
    sign = "+" if n > 0 else ""
    fmt = f"{n:.{digits}f}"
    return f"{sign}{fmt}{suffix}"


def pct_from_price_prev(price: float | None, prev_close: float | None) -> float | None:
    if price is None or prev_close is None:
        return None
    if abs(prev_close) < 1e-12:
        return None
    return (price / prev_close - 1.0) * 100.0


def weekday_jp(date_iso: str) -> str:
    d = dt.date.fromisoformat(date_iso)
    w = "月火水木金土日"[d.weekday()]
    return w


def build_repeats_note(briefs_path: Path, tickers_today: list[str], tags_today: list[str]) -> list[str]:
    data = load_json(briefs_path, {"version": 1, "briefs": []})
    briefs = data.get("briefs") if isinstance(data, dict) else []
    if not isinstance(briefs, list):
        return []
    # Look back over the last 5 entries (excluding today entry which may be upserted later).
    recent = briefs[:5]
    ticker_counts: dict[str, int] = {}
    tag_counts: dict[str, int] = {}
    for b in recent:
        if not isinstance(b, dict):
            continue
        for t in (b.get("tickers") or []):
            t = str(t).strip()
            if t:
                ticker_counts[t] = ticker_counts.get(t, 0) + 1
        for tg in (b.get("tags") or []):
            tg = str(tg).strip()
            if tg:
                tag_counts[tg] = tag_counts.get(tg, 0) + 1

    parts: list[str] = []
    # Only mention repeats that also appear today.
    for t in tickers_today:
        c = ticker_counts.get(t, 0)
        if c >= 2:
            parts.append(f"{t}({c}/5)")
    for tg in tags_today:
        c = tag_counts.get(tg, 0)
        if c >= 3:
            parts.append(f"{tg}({c}/5)")
    if not parts:
        return []
    return [f"直近で繰り返し登場: {', '.join(parts[:6])}"]


def write_github_output(path: Path, outputs: dict[str, str]) -> None:
    with path.open("a", encoding="utf-8") as f:
        for k, v in outputs.items():
            if "\n" not in v:
                f.write(f"{k}={v}\n")
            else:
                marker = "EOF"
                f.write(f"{k}<<{marker}\n")
                f.write(v.rstrip("\n") + "\n")
                f.write(f"{marker}\n")


def render_sources_list(urls: list[tuple[str, str]]) -> str:
    # (label, url)
    items = []
    for label, url in urls:
        esc_label = html.escape(label)
        esc_url = html.escape(url)
        items.append(f'<li><a href="{esc_url}" target="_blank" rel="noreferrer">{esc_label}</a></li>')
    return "<ul>\n" + "\n".join(items) + "\n</ul>"


def render_html(
    date_iso: str,
    headline: str,
    synthesis: str,
    sections: list[tuple[str, list[str]]],
    sources: list[tuple[str, str]],
) -> str:
    w = weekday_jp(date_iso)
    title = f"Market Morning Brief - {date_iso}"
    source_list = render_sources_list(sources)

    def esc_with_links(text: str) -> str:
        s = str(text or "")
        out: list[str] = []
        last = 0
        for m in URL_RE.finditer(s):
            out.append(html.escape(s[last : m.start()]))
            url = s[m.start() : m.end()]
            esc = html.escape(url)
            out.append(f'<a href="{esc}" target="_blank" rel="noreferrer">{esc}</a>')
            last = m.end()
        out.append(html.escape(s[last:]))
        return "".join(out)

    def li_lines(lines: list[str]) -> str:
        out = []
        for line in lines:
            out.append(f"<li>{esc_with_links(line)}</li>")
        return "<ul>\n" + "\n".join(out) + "\n</ul>"

    rendered_sections = []
    for h, lines in sections:
        rendered_sections.append(f"<section>\n<h2>{html.escape(h)}</h2>\n{li_lines(lines)}\n</section>")

    return f"""<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{html.escape(title)}</title>
    <link rel="stylesheet" href="../assets/style.css" />
  </head>
  <body>
    <div class="wrap">
      <header>
        <h1>Market Morning Brief（本文）</h1>
        <div class="meta">{html.escape(date_iso)}（{w}）寄り前ブリーフ</div>
        <form class="gsearch" action="../search.html" method="get">
          <input type="search" name="q" placeholder="材料 / 銘柄コード / タグで検索（例: 9983, 円安, 決算）" />
        </form>
        <nav>
          <a href="../index.html">最新</a>
          <a href="../archive/index.html" aria-current="page">アーカイブ</a>
          <a href="../search.html">検索</a>
          <a href="../fundamentals/index.html">ファンダ</a>
          <a href="../watchlist/index.html">ウォッチ</a>
          <a href="../stocks/index.html">銘柄</a>
          <a href="../tags/index.html">タグ</a>
          <a href="../tdnet/index.html">適時開示</a>
          <a href="../my/index.html">マイ</a>
          <a href="../review/index.html">振り返り</a>
        </nav>
      </header>

      <main>
        <article>
          <p class="meta" style="margin-top:0">{esc_with_links(synthesis)}</p>
          <section>
            <h2>ヘッドライン</h2>
            <ul><li>{esc_with_links(headline)}</li></ul>
          </section>
          {"".join(rendered_sections)}
          <section>
            <h2>出典（リンク）</h2>
            {source_list}
          </section>
        </article>
      </main>

      <footer>自動生成</footer>
    </div>
  </body>
</html>
"""


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate daily pre-market brief (Japan stocks) into docs/ + Slack message.")
    ap.add_argument("--config", default="brief.config.json")
    ap.add_argument("--briefs", default="docs/data/briefs.json")
    ap.add_argument("--tdnet", default="docs/data/tdnet.json")
    ap.add_argument("--watchlist", default="docs/data/watchlist.json")
    ap.add_argument("--date", default="", help="JST date YYYY-MM-DD (default: today JST)")
    ap.add_argument("--cache-dir", default="", help="Optional cache directory for fetched sources (HTML/JSON).")
    ap.add_argument("--offline", action="store_true", help="Read sources from --cache-dir only (no network).")
    ap.add_argument("--print-cache-plan", action="store_true", help="Print required source URLs as JSON and exit.")
    ap.add_argument("--out", default=os.environ.get("GITHUB_OUTPUT", ""), help="GitHub Actions output file path")
    args = ap.parse_args()

    if args.offline and not args.cache_dir.strip():
        raise SystemExit("--offline requires --cache-dir")

    fetcher = CachedFetcher(
        cache_dir=(Path(args.cache_dir).expanduser() if args.cache_dir.strip() else None),
        offline=bool(args.offline),
        timeout=25,
    )

    now_jst = dt.datetime.now(JST)
    date_iso = args.date.strip() or now_jst.date().isoformat()

    cfg = load_json(Path(args.config), {})
    pages_base_url = str(cfg.get("pages_base_url") or "").strip()
    docs_base = ensure_docs_base_url(pages_base_url) or (pages_base_url.rstrip("/") + "/" if pages_base_url else "")
    page_url = f"{docs_base}archive/{date_iso}.html" if docs_base else ""

    sources: list[tuple[str, str]] = []
    if args.print_cache_plan:
        plan = {
            "traders_jp_index": TRADERS_JP_INDEX_URL,
            "traders_bond": TRADERS_BOND_URL,
            "traders_commodity": TRADERS_COMMODITY_URL,
            "investing_nk_futures": INVESTING_NK_FUTURES_URL,
            "stooq_spx": STOOQ_QUOTE_URL.format(symbol=urllib.parse.quote("^spx")),
            "stooq_ndq": STOOQ_QUOTE_URL.format(symbol=urllib.parse.quote("^ndq")),
            "stooq_usdjpy": STOOQ_QUOTE_URL.format(symbol="usdjpy"),
        }
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return 0

    # (2) Sector movers + (4) schedule/earnings from Traders.
    traders_html = ""
    sectors: list[TradersSector] = []
    schedule = TradersSchedule(domestic=[], overseas=[], earnings=[])
    try:
        traders_html = fetcher.text("traders_jp_index", TRADERS_JP_INDEX_URL, timeout=25)
        sectors = parse_traders_sectors(traders_html)
        schedule = parse_traders_schedule(traders_html)
        sources.append(("トレーダーズ・ウェブ（国内/業種/スケジュール）", TRADERS_JP_INDEX_URL))
    except Exception:
        sectors = []
        schedule = TradersSchedule(domestic=[], overseas=[], earnings=[])

    # (1) Prior trading day Nikkei 225 move (fallback: Traders main index row).
    nikkei = parse_traders_index_quote(traders_html, "日経平均") if traders_html else None

    # (3) Overnight indicators
    spx = ndq = usdjpy = None
    try:
        spx = fetch_stooq_two_day("^spx", fetcher, "stooq_spx")
        sources.append(("Stooq（S&P 500）", STOOQ_QUOTE_URL.format(symbol=urllib.parse.quote("^spx"))))
    except Exception:
        spx = None
    try:
        ndq = fetch_stooq_two_day("^ndq", fetcher, "stooq_ndq")
        sources.append(("Stooq（Nasdaq）", STOOQ_QUOTE_URL.format(symbol=urllib.parse.quote("^ndq"))))
    except Exception:
        ndq = None
    try:
        usdjpy = fetch_stooq_two_day("usdjpy", fetcher, "stooq_usdjpy")
        sources.append(("Stooq（USDJPY）", STOOQ_QUOTE_URL.format(symbol="usdjpy")))
    except Exception:
        usdjpy = None

    y10 = None
    try:
        bond_html = fetcher.text("traders_bond", TRADERS_BOND_URL, timeout=25)
        y10 = parse_traders_yield(bond_html, "アメリカ10年")
        sources.append(("トレーダーズ・ウェブ（米金利）", TRADERS_BOND_URL))
    except Exception:
        y10 = None

    wti = None
    try:
        com_html = fetcher.text("traders_commodity", TRADERS_COMMODITY_URL, timeout=25)
        wti = parse_traders_commodity(com_html, "WTI")
        sources.append(("トレーダーズ・ウェブ（商品）", TRADERS_COMMODITY_URL))
    except Exception:
        wti = None

    nk_fut = None
    try:
        fut_html = fetcher.text("investing_nk_futures", INVESTING_NK_FUTURES_URL, timeout=25)
        nk_fut = parse_investing_last_price(fut_html)
        sources.append(("Investing.com（日経225先物）", INVESTING_NK_FUTURES_URL))
    except Exception:
        nk_fut = None

    # Watchlist candidates: recent TDnet + configured watchlist.
    tdnet = load_json(Path(args.tdnet), {"version": 1, "items": []})
    td_items = tdnet.get("items") if isinstance(tdnet, dict) else []
    if not isinstance(td_items, list):
        td_items = []
    td_items = [x for x in td_items if isinstance(x, dict)]
    td_items.sort(key=lambda x: str(x.get("datetime_jst") or ""), reverse=True)

    # Map code->name from watchlist config for nicer display when available.
    wl_cfg = load_json(Path(args.watchlist), {"version": 1, "groups": []})
    code_to_name: dict[str, str] = {}
    if isinstance(wl_cfg, dict):
        for g in wl_cfg.get("groups") or []:
            if not isinstance(g, dict):
                continue
            for t in g.get("tickers") or []:
                if not isinstance(t, dict):
                    continue
                code = str(t.get("code") or "").strip()
                name = str(t.get("name") or "").strip()
                if code and name and code not in code_to_name:
                    code_to_name[code] = name

    watch_lines: list[str] = []
    watch_codes: list[str] = []
    tags: list[str] = []

    # Prefer up to 6 TDnet items (unique codes).
    seen_codes: set[str] = set()
    for it in td_items:
        code = str(it.get("code") or "").strip()
        if not code or code in seen_codes:
            continue
        seen_codes.add(code)
        title_ja = str(it.get("title_ja") or it.get("title") or "").strip()
        pdf = str(it.get("pdf_url_ja") or it.get("pdf_url") or "").strip()
        src_url = str(it.get("source_url") or "").strip()
        points = it.get("points_ja") or []
        point = ""
        if isinstance(points, list) and points:
            point = str(points[0]).strip()
        name = code_to_name.get(code, "").strip()
        label = f"{code} {name}".strip()
        # Keep the line compact; URLs go to sources section.
        desc = point or (title_ja[:60] + ("…" if len(title_ja) > 60 else ""))
        cite = pdf or src_url
        if cite:
            watch_lines.append(f"{label}: {desc}（出典: {cite}）")
        else:
            watch_lines.append(f"{label}: {desc}")
        watch_codes.append(code)
        if cite:
            sources.append((f"TDnet（{code}）", cite))
        if len(watch_lines) >= 6:
            break

    if watch_codes:
        tags.append("適時開示")

    # Fill remaining watchlist slots with macro-sensitive staples.
    macro_slots = max(0, 8 - len(watch_lines))
    macro_defaults = [
        ("9983", "ファストリ", "値がさ/指数寄与（ギャップと寄与を確認）"),
        ("8035", "東エレク", "半導体（米ハイテク動向・先物で方向確認）"),
        ("6857", "アドバンテスト", "半導体（寄りの出来高とVWAP）"),
        ("8306", "三菱UFJ", "金利（米10年/日銀材料で回転）"),
        ("7203", "トヨタ", "為替（ドル円の方向で反応）"),
        ("1605", "INPEX", "原油（WTIの方向で反応）"),
    ]
    for code, name, note in macro_defaults[:macro_slots]:
        if code in seen_codes:
            continue
        watch_lines.append(f"{code} {name}: {note}")
        watch_codes.append(code)
    if any(c in {"8035", "6857"} for c in watch_codes):
        tags.append("半導体")
    if any(c in {"8306"} for c in watch_codes):
        tags.append("金利")
    if any(c in {"7203"} for c in watch_codes):
        tags.append("円安")
    if any(c in {"1605"} for c in watch_codes):
        tags.append("原油")

    # Sector tags from Traders top movers.
    top3 = sorted(sectors, key=lambda x: x.pct, reverse=True)[:3]
    bot3 = sorted(sectors, key=lambda x: x.pct)[:3]
    if top3:
        tags.append("セクター")

    # Build repeats note (based on existing briefs index).
    repeats = build_repeats_note(Path(args.briefs), watch_codes, tags)

    # Build section lines
    sec1: list[str] = []
    if nikkei:
        pct_s = "N/A" if nikkei.pct is None else f"{format_signed(nikkei.pct, 2, '%')}"
        sec1.append(f"日経平均（{nikkei.date}）: {nikkei.close:,.2f}（{pct_s}）（出典: {TRADERS_JP_INDEX_URL}）")
        sec1.append("前日要因: 値がさ/指数寄与とセクター回転を優先して確認。")
    else:
        sec1.append("日経平均: N/A（出典取得失敗）")

    sec2: list[str] = []
    if top3:
        sec2.append(
            "上昇率上位: "
            + " / ".join([f"{s.name}（{format_signed(s.pct,2,'%')}）" for s in top3])
            + f"（出典: {TRADERS_JP_INDEX_URL}）"
        )
    else:
        sec2.append("上昇率上位: N/A")
    if bot3:
        sec2.append(
            "下落率上位: "
            + " / ".join([f"{s.name}（{format_signed(s.pct,2,'%')}）" for s in bot3])
            + f"（出典: {TRADERS_JP_INDEX_URL}）"
        )
    else:
        sec2.append("下落率上位: N/A")
    if repeats:
        sec2.extend(repeats)

    sec3: list[str] = []
    if spx and spx.pct_change is not None:
        sec3.append(
            f"S&P500（{spx.date}）: {spx.close:,.2f}（{format_signed(spx.pct_change,2,'%')}）"
            f"（出典: {STOOQ_QUOTE_URL.format(symbol=urllib.parse.quote('^spx'))}）"
        )
    else:
        sec3.append("S&P500: N/A")
    if ndq and ndq.pct_change is not None:
        sec3.append(
            f"Nasdaq（{ndq.date}）: {ndq.close:,.2f}（{format_signed(ndq.pct_change,2,'%')}）"
            f"（出典: {STOOQ_QUOTE_URL.format(symbol=urllib.parse.quote('^ndq'))}）"
        )
    else:
        sec3.append("Nasdaq: N/A")
    if usdjpy and usdjpy.pct_change is not None:
        sec3.append(
            f"USDJPY（{usdjpy.date}）: {usdjpy.close:,.3f}（{format_signed(usdjpy.pct_change,2,'%')}）"
            f"（出典: {STOOQ_QUOTE_URL.format(symbol='usdjpy')}）"
        )
    else:
        sec3.append("USDJPY: N/A")
    if y10:
        chg = "" if y10.change is None else f"（前日比 {format_signed(y10.change, 3)}）"
        sec3.append(f"米10年: {y10.value:.3f}%{chg}（出典: {TRADERS_BOND_URL}）")
    else:
        sec3.append("米10年: N/A")
    if wti:
        pct = "" if wti.pct is None else f"（{format_signed(wti.pct,2,'%')}）"
        sec3.append(f"WTI: {wti.value:.2f}{pct}（出典: {TRADERS_COMMODITY_URL}）")
    else:
        sec3.append("WTI: N/A")
    cash_for_gap = nikkei.close if nikkei else None
    if nk_fut is not None and cash_for_gap is not None:
        gap = nk_fut - float(cash_for_gap)
        sec3.append(f"日経225先物: {nk_fut:,.1f} → 現物比 {format_signed(gap,1)}（出典: {INVESTING_NK_FUTURES_URL}）")
    elif nk_fut is not None:
        sec3.append(f"日経225先物: {nk_fut:,.1f}（現物比 N/A）（出典: {INVESTING_NK_FUTURES_URL}）")
    else:
        sec3.append("日経225先物: N/A")

    sec4: list[str] = []
    if schedule.domestic:
        sec4.append("【日本】" + " / ".join(schedule.domestic[:4]) + f"（出典: {TRADERS_JP_INDEX_URL}）")
    else:
        sec4.append("【日本】N/A")
    if schedule.overseas:
        sec4.append("【海外】" + " / ".join(schedule.overseas[:4]) + f"（出典: {TRADERS_JP_INDEX_URL}）")
    else:
        sec4.append("【海外】N/A")
    if schedule.earnings:
        sec4.append("【決算/開示】" + " / ".join(schedule.earnings[:6]) + f"（出典: {TRADERS_JP_INDEX_URL}）")
    else:
        # Fallback: show TDnet as "disclosures"
        if watch_lines:
            sec4.append("【開示】" + " / ".join([w.split(":")[0] for w in watch_lines[:6]]))
        else:
            sec4.append("【決算/開示】N/A")

    sec5: list[str] = []
    sec5.extend(watch_lines[:10] if watch_lines else ["N/A"])

    # Synthesis (1–2 sentences)
    synth_parts: list[str] = []
    nikkei_pct = nikkei.pct if nikkei else None
    if nikkei_pct is not None:
        direction = "上昇" if nikkei_pct > 0 else "下落" if nikkei_pct < 0 else "横ばい"
        synth_parts.append(f"前回引けの日経平均は{direction}（{format_signed(nikkei_pct,2,'%')}）。")
    if spx and ndq and usdjpy:
        spx_dir = "↑" if (spx.pct_change or 0) > 0 else "↓" if (spx.pct_change or 0) < 0 else "→"
        ndq_dir = "↑" if (ndq.pct_change or 0) > 0 else "↓" if (ndq.pct_change or 0) < 0 else "→"
        fx_dir = "円安" if (usdjpy.pct_change or 0) > 0 else "円高" if (usdjpy.pct_change or 0) < 0 else "横ばい"
        synth_parts.append(f"オーバーナイトは米株({spx_dir}/{ndq_dir})・ドル円は{fx_dir}。")
    synth_parts.append("寄りは先物ギャップ、セクター強弱、出来高（主役）を最優先で確認。")
    synthesis = "".join(synth_parts)[:240]

    # Headline
    headline = "日経・先物ギャップとセクター回転を確認（米株/ドル円/金利/原油を点検）"

    # HTML output
    archive_path = Path("docs/archive") / f"{date_iso}.html"

    # Deduplicate sources by URL (keep earliest label).
    dedup_sources: list[tuple[str, str]] = []
    seen_urls: set[str] = set()
    for label, url in sources:
        url = (url or "").strip()
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        dedup_sources.append((label, url))

    archive_html = render_html(
        date_iso=date_iso,
        headline=headline,
        synthesis=synthesis,
        sections=[
            ("1) 前回引け（Nikkei 225）", sec1),
            ("2) 業種（東証33）", sec2),
            ("3) オーバーナイト", sec3),
            ("4) 今日の予定（JST）", sec4),
            ("5) デイトレ・ウォッチ", sec5),
        ],
        sources=dedup_sources[:40],
    )
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    archive_path.write_text(archive_html, encoding="utf-8")

    # Upsert briefs index for archive/search/ticker pages.
    summary_bullets: list[str] = []
    if nikkei:
        pct_s = "N/A" if nikkei.pct is None else f"{format_signed(nikkei.pct,2,'%')}"
        summary_bullets.append(f"日経平均({nikkei.date}): {nikkei.close:,.2f} ({pct_s})")
    if spx and ndq:
        summary_bullets.append(
            "米株: "
            + (f"S&P {format_signed(spx.pct_change or 0,2,'%')}" if spx.pct_change is not None else "S&P N/A")
            + " / "
            + (f"Nasdaq {format_signed(ndq.pct_change or 0,2,'%')}" if ndq.pct_change is not None else "Nasdaq N/A")
        )
    if nk_fut is not None and cash_for_gap is not None:
        summary_bullets.append(f"先物: {nk_fut:,.1f}（現物比 {format_signed(nk_fut - float(cash_for_gap),1)}）")
    if watch_codes:
        summary_bullets.append("注目: " + ", ".join(watch_codes[:6]))
    summary_bullets = summary_bullets[:4]

    entry = {
        "date": date_iso,
        "url": f"archive/{date_iso}.html",
        "headline": headline,
        "summary_bullets": summary_bullets,
        "tickers": watch_codes[:12],
        "tags": sorted({t for t in tags if t})[:12],
    }

    try:
        upsert_index_file(Path(args.briefs), entry)
    except Exception as e:
        sys.stderr.write(f"[warn] upsert briefs failed: {e}\n")

    # Slack-friendly summary (core)
    w = weekday_jp(date_iso)
    slack_lines: list[str] = []
    slack_lines.append(f"*Market Morning Brief（{date_iso} {w}）*")
    if nikkei:
        pct_s = "N/A" if nikkei.pct is None else f"{format_signed(nikkei.pct,2,'%')}"
        slack_lines.append(f"- *前回引け*: 日経平均 {nikkei.close:,.2f}（{pct_s}）（出典: {TRADERS_JP_INDEX_URL}）")
    else:
        slack_lines.append("- *前回引け*: N/A")
    if top3 and bot3:
        slack_lines.append(
            "- *業種*: +"
            + ", ".join([s.name for s in top3])
            + " / -"
            + ", ".join([s.name for s in bot3])
            + f"（出典: {TRADERS_JP_INDEX_URL}）"
        )
    else:
        slack_lines.append("- *業種*: N/A")
    # Overnight compact
    overnight_parts: list[str] = []
    if spx and spx.pct_change is not None:
        overnight_parts.append(f"S&P {spx.close:,.2f}({format_signed(spx.pct_change,2,'%')})")
    if ndq and ndq.pct_change is not None:
        overnight_parts.append(f"Nasdaq {ndq.close:,.2f}({format_signed(ndq.pct_change,2,'%')})")
    if usdjpy and usdjpy.pct_change is not None:
        overnight_parts.append(f"USDJPY {usdjpy.close:.3f}({format_signed(usdjpy.pct_change,2,'%')})")
    if y10:
        overnight_parts.append(f"US10Y {y10.value:.3f}%")
    if wti:
        overnight_parts.append(f"WTI {wti.value:.2f}")
    if nk_fut is not None and cash_for_gap is not None:
        overnight_parts.append(f"先物 {nk_fut:,.1f}（現物比 {format_signed(nk_fut - float(cash_for_gap),1)}）")
    overnight_srcs: list[str] = []
    if spx:
        overnight_srcs.append(STOOQ_QUOTE_URL.format(symbol=urllib.parse.quote("^spx")))
    if ndq:
        overnight_srcs.append(STOOQ_QUOTE_URL.format(symbol=urllib.parse.quote("^ndq")))
    if usdjpy:
        overnight_srcs.append(STOOQ_QUOTE_URL.format(symbol="usdjpy"))
    if y10:
        overnight_srcs.append(TRADERS_BOND_URL)
    if wti:
        overnight_srcs.append(TRADERS_COMMODITY_URL)
    if nk_fut is not None:
        overnight_srcs.append(INVESTING_NK_FUTURES_URL)
    src_note = f"（出典: {' '.join(overnight_srcs[:4])}）" if overnight_srcs else ""
    slack_lines.append("- *オーバーナイト*: " + (" / ".join(overnight_parts) if overnight_parts else "N/A") + src_note)
    # Calendar
    cal_parts: list[str] = []
    if schedule.domestic:
        cal_parts.append("日本 " + ", ".join(schedule.domestic[:2]))
    if schedule.overseas:
        cal_parts.append("海外 " + ", ".join(schedule.overseas[:2]))
    slack_lines.append(
        "- *今日の予定*: " + (" / ".join(cal_parts) if cal_parts else "N/A") + f"（出典: {TRADERS_JP_INDEX_URL}）"
    )
    # Repeats note
    if repeats:
        slack_lines.append(f"- *繰り返し*: {repeats[0].replace('直近で繰り返し登場: ', '')}")
    # Watchlist
    if watch_codes:
        slack_lines.append("- *ウォッチ*: " + ", ".join(watch_codes[:10]))
    else:
        slack_lines.append("- *ウォッチ*: N/A")
    if page_url:
        slack_lines.append(f"- *HTML*: {page_url}")
    # Note: sources are attached inline to key bullets above.

    slack_message = "\n".join(slack_lines).strip()[:3500]

    outputs = {
        "has_changes": "true",
        "date": date_iso,
        "page_url": page_url,
        "slack_message": slack_message,
    }
    if args.out:
        write_github_output(Path(args.out), outputs)
    else:
        print(json.dumps(outputs, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
