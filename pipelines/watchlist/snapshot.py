#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import ssl
from concurrent.futures import ThreadPoolExecutor, as_completed
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


JST = ZoneInfo("Asia/Tokyo")
KABUTAN_STOCK_URL = "https://en.kabutan.com/jp/stocks/{code}/"
MAX_SNAPSHOTS_DEFAULT = 2000
GAP_ALERT_PCT = 2.0
OPEN_VOL_ALERT_RATIO = 0.15
CLOSE_VOL_ALERT_RATIO = 1.8
ALERT_TOP_N = 5


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


@dataclass(frozen=True)
class KabutanQuote:
    code: str
    stock_date: str
    asof_datetime_jst: str
    last: float | None
    open: float | None
    prev_close: float | None
    volume: int | None


def normalize_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def num(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)) and float(value) == float(value):
        return float(value)
    s = normalize_text(value).replace(",", "")
    if not s or s.upper() == "N/A":
        return None
    try:
        return float(s)
    except Exception:
        return None


def num_int(value: Any) -> int | None:
    n = num(value)
    if n is None:
        return None
    try:
        return int(n)
    except Exception:
        return None


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        if data:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    parser = TextExtractor()
    parser.feed(html)
    return normalize_text(" ".join(parser.parts))


def fetch_text(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "market-morning-brief/1.0 (+GitHub Actions)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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

    with urllib.request.urlopen(req, timeout=15, context=context) as res:
        return res.read().decode("utf-8", errors="replace")

STOCK_DATE_RE = re.compile(r"Stock Price\s+(?P<mon>[A-Za-z]{3})\s+(?P<day>\d{1,2}),\s+(?P<year>\d{4})", re.IGNORECASE)
LAST_PRICE_RE = re.compile(
    r"(?P<price>[0-9,]+(?:\.[0-9]+)?)\s+JPY\s+[+\-]?[0-9,]+(?:\.[0-9]+)?\s+\([+\-]?[0-9.]+%\)\s+"
    r"(?P<mon>[A-Za-z]{3})\s+(?P<day>\d{1,2}),\s+"
    r"(?P<hour>\d{1,2}):(?P<minute>\d{2})\s+(?P<ampm>am|pm)\s+JST",
    re.IGNORECASE,
)
OPEN_RE = re.compile(
    r"Opening\s+[A-Za-z]{3}\s+\d{1,2},\s+\d{1,2}:\d{2}\s+(?:am|pm)\s+"
    r"(?P<open>[0-9,]+(?:\.[0-9]+)?)\s+JPY\s+[0-9,.]+\s+USD",
    re.IGNORECASE,
)
PREV_CLOSE_RE = re.compile(
    r"Previous Close\s+[A-Za-z]{3}\s+\d{1,2}\s+(?P<prev>[0-9,]+(?:\.[0-9]+)?)\s+JPY\s+[0-9,.]+\s+USD",
    re.IGNORECASE,
)
VOLUME_RE = re.compile(r"Volume\s+(?P<vol>[0-9,]+)\s+Trading Value", re.IGNORECASE)


def parse_kabutan_date(date_str: str) -> str:
    m = re.match(r"(?P<mon>[A-Za-z]{3})\s+(?P<day>\d{1,2}),\s+(?P<year>\d{4})", normalize_text(date_str))
    if not m:
        return ""
    mon = MONTHS.get(m.group("mon").title())
    if not mon:
        return ""
    return f"{int(m.group('year')):04d}-{mon:02d}-{int(m.group('day')):02d}"


def parse_kabutan_asof_datetime(stock_date: str, mon: str, day: str, hour: str, minute: str, ampm: str) -> str:
    year = int(stock_date.split("-")[0]) if stock_date else datetime.now(JST).year
    mon_num = MONTHS.get(mon.title())
    if not mon_num:
        return ""
    h = int(hour)
    if ampm.lower() == "pm" and h != 12:
        h += 12
    if ampm.lower() == "am" and h == 12:
        h = 0
    return f"{year:04d}-{mon_num:02d}-{int(day):02d}T{h:02d}:{int(minute):02d}:00+09:00"


def extract_stock_section(text: str) -> str:
    m = re.search(r"Stock Price\s+(?P<body>.*?)\s+PTS Stock Price", text, re.IGNORECASE)
    return m.group("body") if m else text


def fetch_kabutan_quote(code: str) -> KabutanQuote | None:
    url = KABUTAN_STOCK_URL.format(code=urllib.parse.quote(code))
    html = fetch_text(url)
    text = html_to_text(html)

    m_date = STOCK_DATE_RE.search(text)
    stock_date = ""
    if m_date:
        mon = m_date.group("mon").title()
        mon_num = MONTHS.get(mon)
        if mon_num:
            stock_date = f"{int(m_date.group('year')):04d}-{mon_num:02d}-{int(m_date.group('day')):02d}"

    section = extract_stock_section(text)
    m_open = OPEN_RE.search(section)
    m_prev = PREV_CLOSE_RE.search(section)
    m_vol = VOLUME_RE.search(section)
    m_last = LAST_PRICE_RE.search(text)

    open_px = num(m_open.group("open")) if m_open else None
    prev_close = num(m_prev.group("prev")) if m_prev else None
    volume = num_int(m_vol.group("vol")) if m_vol else None
    last_px = num(m_last.group("price")) if m_last else None

    asof_dt = ""
    if stock_date and m_last:
        asof_dt = parse_kabutan_asof_datetime(
            stock_date,
            m_last.group("mon"),
            m_last.group("day"),
            m_last.group("hour"),
            m_last.group("minute"),
            m_last.group("ampm"),
        )

    if not stock_date:
        # Fallback: use "today" in JST for freshness checks / UI.
        stock_date = datetime.now(JST).strftime("%Y-%m-%d")

    return KabutanQuote(
        code=code,
        stock_date=stock_date,
        asof_datetime_jst=asof_dt,
        last=last_px,
        open=open_px,
        prev_close=prev_close,
        volume=volume,
    )


def fetch_kabutan_quote_safe(code: str) -> KabutanQuote | None:
    try:
        return fetch_kabutan_quote(code)
    except Exception:
        return None


def load_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_store(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        return {"version": 1, "updated_at": None, "snapshots": []}
    snapshots = data.get("snapshots")
    if not isinstance(snapshots, list):
        snapshots = []
    return {
        "version": int(data.get("version") or 1),
        "updated_at": data.get("updated_at"),
        "snapshots": snapshots,
    }


def flatten_watchlist(cfg: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    groups = cfg.get("groups")
    if not isinstance(groups, list):
        return out
    for group in groups:
        if not isinstance(group, dict):
            continue
        sector = normalize_text(group.get("sector") or "")
        tickers = group.get("tickers")
        if not isinstance(tickers, list):
            continue
        for t in tickers:
            if not isinstance(t, dict):
                continue
            code = normalize_text(t.get("code") or "")
            if not code:
                continue
            out.append(
                {
                    "code": code,
                    "name": normalize_text(t.get("name") or ""),
                    "name_en": normalize_text(t.get("name_en") or ""),
                    "sector": sector,
                }
            )
    # Dedup by code; keep first occurrence.
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for it in out:
        code = str(it.get("code") or "")
        if not code or code in seen:
            continue
        seen.add(code)
        deduped.append(it)
    return deduped


def fmt_int(n: int | None) -> str:
    if n is None:
        return "—"
    return f"{n:,}"


def fmt_price(n: float | None) -> str:
    if n is None:
        return "—"
    if n >= 1000:
        return f"{n:,.0f}"
    return f"{n:,.2f}"


def compute_delta(price: float | None, prev_close: float | None) -> tuple[float | None, float | None]:
    if price is None or prev_close is None or prev_close == 0:
        return None, None
    d = price - prev_close
    p = (d / prev_close) * 100
    return d, p


def median(values: list[int]) -> float | None:
    xs = [int(v) for v in values if isinstance(v, int) and v > 0]
    if not xs:
        return None
    xs.sort()
    n = len(xs)
    mid = n // 2
    if n % 2 == 1:
        return float(xs[mid])
    return (xs[mid - 1] + xs[mid]) / 2.0


def iter_snapshots(store: dict[str, Any]) -> list[dict[str, Any]]:
    snaps = store.get("snapshots")
    if not isinstance(snaps, list):
        return []
    out: list[dict[str, Any]] = []
    for s in snaps:
        if isinstance(s, dict):
            out.append(s)
    out.sort(key=lambda s: normalize_text(s.get("datetime_jst") or ""), reverse=True)
    return out


def find_prev_close_snapshot(store: dict[str, Any], current_date: str) -> dict[str, Any] | None:
    for s in iter_snapshots(store):
        if normalize_text(s.get("phase") or "") != "close":
            continue
        dt = normalize_text(s.get("datetime_jst") or "")
        if not dt:
            continue
        day = dt[:10]
        if day and day < current_date:
            return s
    return None


def build_close_volume_history(
    store: dict[str, Any], codes: set[str], current_date: str, max_days: int
) -> dict[str, list[int]]:
    hist: dict[str, list[int]] = {c: [] for c in codes}
    for s in iter_snapshots(store):
        if normalize_text(s.get("phase") or "") != "close":
            continue
        dt = normalize_text(s.get("datetime_jst") or "")
        if not dt:
            continue
        day = dt[:10]
        if not day or day >= current_date:
            continue

        items = s.get("items")
        if not isinstance(items, list):
            continue
        for it in items:
            if not isinstance(it, dict):
                continue
            code = normalize_text(it.get("code") or "")
            if not code or code not in hist:
                continue
            if len(hist[code]) >= max_days:
                continue
            vol = num_int(it.get("volume"))
            if vol is None or vol <= 0:
                continue
            hist[code].append(vol)
    return hist


def build_slack_message(
    phase: str,
    now_jst: datetime,
    cfg: dict[str, Any],
    watchlist_cfg: dict[str, Any],
    snapshot: dict[str, Any],
    store: dict[str, Any],
) -> str:
    pages_base_url = normalize_text(cfg.get("pages_base_url") or "")
    link = pages_base_url.rstrip("/") + "/watchlist/"

    label = "寄り" if phase == "open" else "引け"
    ts = now_jst.strftime("%Y/%m/%d %H:%M")
    header = f"*ウォッチリスト*（{label}） {ts} JST"

    items_by_code: dict[str, dict[str, Any]] = {}
    for it in snapshot.get("items") if isinstance(snapshot.get("items"), list) else []:
        if isinstance(it, dict):
            code = normalize_text(it.get("code") or "")
            if code:
                items_by_code[code] = it

    lines: list[str] = [header, f"一覧: {link}"]

    current_date = normalize_text(snapshot.get("datetime_jst") or "")[:10]
    codes = set(items_by_code.keys())

    prev_close = find_prev_close_snapshot(store, current_date) if current_date else None
    prev_close_vol: dict[str, int] = {}
    if isinstance(prev_close, dict):
        for it in prev_close.get("items") if isinstance(prev_close.get("items"), list) else []:
            if not isinstance(it, dict):
                continue
            c = normalize_text(it.get("code") or "")
            if c and c in codes:
                v = num_int(it.get("volume"))
                if v is not None and v > 0:
                    prev_close_vol[c] = v

    close_hist = build_close_volume_history(store, codes, current_date, max_days=20) if current_date else {}

    gap_alerts: list[tuple[float, str, str, float, float, float, str]] = []
    vol_alerts: list[tuple[float, str, str, int, int, str]] = []
    for code, it in items_by_code.items():
        name = normalize_text(it.get("name") or "")
        url = normalize_text(it.get("source_url") or f"https://kabutan.jp/stock/?code={urllib.parse.quote(code)}")
        prev = num(it.get("prev_close"))
        price = num(it.get(phase))
        vol = num_int(it.get("volume"))

        if phase == "open" and price is not None and prev is not None and prev > 0:
            _, p = compute_delta(price, prev)
            if p is not None and abs(p) >= GAP_ALERT_PCT:
                gap_alerts.append((abs(p), code, name, p, price, prev, url))

        if vol is None or vol <= 0:
            continue
        base_vol = None
        if phase == "open":
            base_vol = prev_close_vol.get(code)
        else:
            base = median(close_hist.get(code, [])) if close_hist else None
            if base is not None and base > 0:
                base_vol = int(base)
            else:
                base_vol = prev_close_vol.get(code)

        if base_vol is None or base_vol <= 0:
            continue
        ratio = vol / float(base_vol)
        if phase == "open" and ratio >= OPEN_VOL_ALERT_RATIO:
            vol_alerts.append((ratio, code, name, vol, base_vol, url))
        if phase == "close" and ratio >= CLOSE_VOL_ALERT_RATIO:
            vol_alerts.append((ratio, code, name, vol, base_vol, url))

    gap_alerts.sort(key=lambda x: x[0], reverse=True)
    vol_alerts.sort(key=lambda x: x[0], reverse=True)

    if gap_alerts or vol_alerts:
        lines.append("*異常検知*")
        if phase == "open" and gap_alerts:
            lines.append(f"*ギャップ*（|%|≥{GAP_ALERT_PCT:.0f}%）")
            for _, code, name, p, price, prev, url in gap_alerts[:ALERT_TOP_N]:
                disp = f"{code} {name}".strip()
                lines.append(f"・<{url}|{disp}> {p:+.2f}%（{fmt_price(price)} / 前日 {fmt_price(prev)}）")
        if vol_alerts:
            if phase == "open":
                lines.append(f"*出来高急増*（前日比≥{int(OPEN_VOL_ALERT_RATIO*100)}%）")
            else:
                lines.append(f"*出来高急増*（平常比≥{CLOSE_VOL_ALERT_RATIO:.1f}x）")
            for ratio, code, name, vol, base, url in vol_alerts[:ALERT_TOP_N]:
                disp = f"{code} {name}".strip()
                lines.append(f"・<{url}|{disp}> {fmt_int(vol)}（{ratio:.2f}x / 基準 {fmt_int(base)}）")

    groups = watchlist_cfg.get("groups") if isinstance(watchlist_cfg.get("groups"), list) else []
    for group in groups:
        if not isinstance(group, dict):
            continue
        sector = normalize_text(group.get("sector") or "")
        tickers = group.get("tickers") if isinstance(group.get("tickers"), list) else []

        sector_pcts: list[float] = []
        sector_lines: list[str] = []
        for t in tickers:
            if not isinstance(t, dict):
                continue
            code = normalize_text(t.get("code") or "")
            if not code:
                continue
            it = items_by_code.get(code) or {}

            name = normalize_text(it.get("name") or t.get("name") or "")
            prev_close = num(it.get("prev_close"))
            price = num(it.get(phase))
            volume = num_int(it.get("volume"))
            d, p = compute_delta(price, prev_close)
            if p is not None:
                sector_pcts.append(p)

            delta_txt = "—"
            if d is not None and p is not None:
                sign = "+" if d > 0 else ""
                delta_txt = f"{sign}{d:,.0f} ({p:+.2f}%)"

            price_txt = fmt_price(price)
            vol_txt = fmt_int(volume)
            sector_lines.append(f"・{code} {name} {price_txt}（{delta_txt}） 出来高 {vol_txt}")

        if not sector_lines:
            continue

        avg_pct = sum(sector_pcts) / len(sector_pcts) if sector_pcts else 0.0
        lines.append(f"*{sector or '—'}*（平均 {avg_pct:+.2f}%）")
        lines.extend(sector_lines)

    return "\n".join(lines)


def upsert_snapshot(store: dict[str, Any], snapshot: dict[str, Any], max_snapshots: int) -> tuple[dict[str, Any], bool]:
    snapshots = store.get("snapshots")
    if not isinstance(snapshots, list):
        snapshots = []

    phase = normalize_text(snapshot.get("phase") or "")
    dt = normalize_text(snapshot.get("datetime_jst") or "")
    key = f"{dt[:10]}:{phase}"

    replaced = False
    changed = False
    out: list[dict[str, Any]] = []
    for s in snapshots:
        if not isinstance(s, dict):
            continue
        s_phase = normalize_text(s.get("phase") or "")
        s_dt = normalize_text(s.get("datetime_jst") or "")
        s_key = f"{s_dt[:10]}:{s_phase}"
        if s_key == key:
            replaced = True
            # Replace only if this one is newer.
            if s_dt and dt and s_dt >= dt:
                out.append(s)
            else:
                out.append(snapshot)
                changed = True
        else:
            out.append(s)

    if not replaced:
        out.append(snapshot)
        changed = True

    out.sort(key=lambda s: normalize_text(s.get("datetime_jst") or ""), reverse=True)
    store["snapshots"] = out[:max_snapshots]
    return store, changed


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


def main() -> int:
    ap = argparse.ArgumentParser(description="Create watchlist snapshot (open/close) and append to docs JSON store.")
    ap.add_argument("--phase", choices=["open", "close"], required=True)
    ap.add_argument("--config", default="brief.config.json", help="Config JSON containing pages_base_url")
    ap.add_argument("--watchlist", default="docs/data/watchlist.json", help="Watchlist config JSON path")
    ap.add_argument("--store", default="docs/data/watchlist_snapshots.json", help="Snapshot store JSON path")
    ap.add_argument("--max-snapshots", type=int, default=MAX_SNAPSHOTS_DEFAULT)
    ap.add_argument("--allow-stale", action="store_true", help="Write snapshot even if all quotes are stale (debug/demo)")
    ap.add_argument("--debug", action="store_true", help="Print debug info to stderr (local only)")
    ap.add_argument("--out", default=os.environ.get("GITHUB_OUTPUT", ""), help="GitHub Actions output file path")
    args = ap.parse_args()

    now_jst = datetime.now(JST)
    today = now_jst.strftime("%Y-%m-%d")

    cfg_path = Path(args.config)
    cfg = load_json(cfg_path, {}) if cfg_path.exists() else {}
    watch_path = Path(args.watchlist)
    watch_cfg = load_json(watch_path, {"version": 1, "groups": []})
    tickers = flatten_watchlist(watch_cfg)

    if not tickers:
        outputs = {
            "has_changes": "false",
            "should_notify": "false",
            "phase": args.phase,
            "message": "",
        }
        if args.out:
            write_github_output(Path(args.out), outputs)
        else:
            print(json.dumps(outputs, ensure_ascii=False))
        return 0

    phase = args.phase
    items: list[dict[str, Any]] = []
    dates_seen: list[str] = []
    fresh_count = 0

    # Fetch quotes concurrently to stay within GitHub Actions time limits.
    max_workers = min(10, max(4, len(tickers)))
    quotes_by_code: dict[str, KabutanQuote] = {}
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futs = {}
        for t in tickers:
            code = normalize_text(t.get("code") or "")
            if not code:
                continue
            futs[ex.submit(fetch_kabutan_quote_safe, code)] = code

        for fut in as_completed(futs):
            code = futs[fut]
            q = fut.result()
            if q is not None:
                quotes_by_code[code] = q

    for idx, t in enumerate(tickers):
        code = normalize_text(t.get("code") or "")
        if not code:
            continue
        quote = quotes_by_code.get(code)
        if quote is None:
            continue

        dates_seen.append(quote.stock_date)
        if args.debug and idx == 0:
            import sys

            sys.stderr.write(f"[debug] quote={quote}\n")
        if quote.stock_date == today:
            fresh_count += 1

        item: dict[str, Any] = {
            "code": code,
            "name": normalize_text(t.get("name") or ""),
            "name_en": normalize_text(t.get("name_en") or ""),
            "sector": normalize_text(t.get("sector") or ""),
            "prev_close": quote.prev_close,
            "volume": quote.volume,
            "source_url": f"https://kabutan.jp/stock/?code={urllib.parse.quote(code)}",
            "kabutan_url": KABUTAN_STOCK_URL.format(code=urllib.parse.quote(code)),
            "asof_date": quote.stock_date,
            "asof_datetime_jst": quote.asof_datetime_jst,
        }
        if phase == "open":
            item["open"] = quote.open
        else:
            item["close"] = quote.last
        items.append(item)

    # Skip if all quotes are stale (weekend/holiday or data delay).
    if fresh_count == 0 and not args.allow_stale:
        outputs = {
            "has_changes": "false",
            "should_notify": "false",
            "phase": phase,
            "message": "",
        }
        if args.out:
            write_github_output(Path(args.out), outputs)
        else:
            print(json.dumps(outputs, ensure_ascii=False))
        return 0

    store_path = Path(args.store)
    store = normalize_store(load_json(store_path, {"version": 1, "updated_at": None, "snapshots": []}))
    market_date = today
    if dates_seen:
        counts: dict[str, int] = {}
        for d in dates_seen:
            if not d:
                continue
            counts[d] = counts.get(d, 0) + 1
        if counts:
            # Prefer the most common date; when tied, pick the latest date.
            market_date = sorted(counts.items(), key=lambda x: (x[1], x[0]), reverse=True)[0][0]

    snapshot = {
        "datetime_jst": f"{market_date}T{now_jst.strftime('%H:%M:%S')}+09:00",
        "phase": phase,
        "items": items,
    }

    store["updated_at"] = now_jst.isoformat(timespec="seconds")
    store, changed = upsert_snapshot(store, snapshot, max_snapshots=int(args.max_snapshots))

    message = build_slack_message(phase, now_jst, cfg, watch_cfg, snapshot, store)

    if changed:
        store_path.parent.mkdir(parents=True, exist_ok=True)
        store_path.write_text(json.dumps(store, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    outputs = {
        "has_changes": "true" if changed else "false",
        "should_notify": "true" if changed else "false",
        "phase": phase,
        "message": message if changed else "",
    }
    if args.out:
        write_github_output(Path(args.out), outputs)
    else:
        print(json.dumps({"has_changes": changed, "phase": phase}, ensure_ascii=False))
        if message:
            print(message)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
