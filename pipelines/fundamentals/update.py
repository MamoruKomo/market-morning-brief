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


JST = ZoneInfo("Asia/Tokyo")
KABUTAN_FUNDAMENTALS_URL = "https://kabutan.jp/stock/?code={code}"


@dataclass(frozen=True)
class Fetcher:
    cache_dir: Path | None
    offline: bool = False

    def _path(self, key: str) -> Path | None:
        if not self.cache_dir:
            return None
        safe = re.sub(r"[^a-zA-Z0-9._-]+", "_", key).strip("_")
        return self.cache_dir / f"{safe}.html"

    def html(self, key: str, url: str) -> str:
        path = self._path(key)
        if self.offline:
            if not path:
                raise RuntimeError("offline mode requires --cache-dir")
            return path.read_text(encoding="utf-8", errors="replace")

        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "market-morning-brief/1.0 (+GitHub Actions)",
                "Accept-Language": "ja,en;q=0.8",
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
            raw = res.read()
            try:
                charset = res.headers.get_content_charset()  # type: ignore[attr-defined]
            except Exception:
                charset = None
        text = raw.decode(charset or "utf-8", errors="replace")
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        return text


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
    return normalize_spaces(" ".join(parser.parts))


def normalize_spaces(text: Any) -> str:
    return " ".join(str(text or "").split()).strip()


def parse_float(value: str) -> float | None:
    s = normalize_spaces(value).replace(",", "")
    if not s or s in {"—", "-", "N/A"}:
        return None
    m = re.search(r"[-+]?\d+(?:\.\d+)?", s)
    if not m:
        return None
    try:
        return float(m.group(0))
    except Exception:
        return None


METRIC_PATTERNS: dict[str, list[re.Pattern[str]]] = {
    "roe": [re.compile(r"ROE[^0-9-+]*([-+]?\d+(?:\.\d+)?)\s*%")],
    "roa": [re.compile(r"ROA[^0-9-+]*([-+]?\d+(?:\.\d+)?)\s*%")],
    "roic": [re.compile(r"ROIC[^0-9-+]*([-+]?\d+(?:\.\d+)?)\s*%")],
    "operating_margin": [
        re.compile(r"営業利益率[^0-9-+]*([-+]?\d+(?:\.\d+)?)\s*%"),
        re.compile(r"Operating\s+Margin[^0-9-+]*([-+]?\d+(?:\.\d+)?)\s*%", re.IGNORECASE),
    ],
    "net_margin": [
        re.compile(r"(?:純利益率|純益率)[^0-9-+]*([-+]?\d+(?:\.\d+)?)\s*%"),
        re.compile(r"Net\s+Margin[^0-9-+]*([-+]?\d+(?:\.\d+)?)\s*%", re.IGNORECASE),
    ],
    "equity_ratio": [
        re.compile(r"自己資本比率[^0-9-+]*([-+]?\d+(?:\.\d+)?)\s*%"),
        re.compile(r"Equity\s+Ratio[^0-9-+]*([-+]?\d+(?:\.\d+)?)\s*%", re.IGNORECASE),
    ],
    "dividend_yield": [
        re.compile(r"(?:予想)?配当利回り[^0-9-+]*([-+]?\d+(?:\.\d+)?)\s*%"),
        re.compile(r"Dividend\s+Yield[^0-9-+]*([-+]?\d+(?:\.\d+)?)\s*%", re.IGNORECASE),
    ],
    "per": [
        re.compile(r"(?:予想)?PER[^0-9-+]*([-+]?\d+(?:\.\d+)?)\s*(?:倍|x)?"),
        re.compile(r"P/E\s+Ratio[^0-9-+]*([-+]?\d+(?:\.\d+)?)", re.IGNORECASE),
    ],
    "pbr": [
        re.compile(r"PBR[^0-9-+]*([-+]?\d+(?:\.\d+)?)\s*(?:倍|x)?"),
        re.compile(r"P/B\s+Ratio[^0-9-+]*([-+]?\d+(?:\.\d+)?)", re.IGNORECASE),
    ],
    "sales_growth_yoy": [
        re.compile(r"売上(?:高)?伸び率[^0-9-+]*([-+]?\d+(?:\.\d+)?)\s*%"),
        re.compile(r"Sales\s+Growth[^0-9-+]*([-+]?\d+(?:\.\d+)?)\s*%", re.IGNORECASE),
    ],
}


def extract_metrics(text: str) -> dict[str, float]:
    out: dict[str, float] = {}
    t = normalize_spaces(text)
    for key, patterns in METRIC_PATTERNS.items():
        for pat in patterns:
            m = pat.search(t)
            if not m:
                continue
            v = parse_float(m.group(1))
            if v is None:
                continue
            # Basic sanity filters (avoid capturing dates, etc.)
            if key in {"roe", "roa", "roic", "operating_margin", "net_margin", "equity_ratio", "dividend_yield", "sales_growth_yoy"}:
                if v < -1000 or v > 1000:
                    continue
            if key in {"per", "pbr"}:
                if abs(v) > 10000:
                    continue
            out[key] = float(v)
            break
    return out


def load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
    except Exception:
        return default


def dump_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def flatten_watchlist(cfg: dict[str, Any]) -> list[dict[str, str]]:
    groups = cfg.get("groups") if isinstance(cfg.get("groups"), list) else []
    out: list[dict[str, str]] = []
    for group in groups:
        if not isinstance(group, dict):
            continue
        sector = normalize_spaces(group.get("sector") or "")
        tickers = group.get("tickers") if isinstance(group.get("tickers"), list) else []
        for t in tickers:
            if not isinstance(t, dict):
                continue
            code = normalize_spaces(t.get("code") or "")
            if not code:
                continue
            out.append(
                {
                    "code": code,
                    "name": normalize_spaces(t.get("name") or ""),
                    "name_en": normalize_spaces(t.get("name_en") or ""),
                    "sector": sector,
                }
            )
    seen: set[str] = set()
    deduped: list[dict[str, str]] = []
    for it in out:
        code = it.get("code") or ""
        if not code or code in seen:
            continue
        seen.add(code)
        deduped.append(it)
    return deduped


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
    ap = argparse.ArgumentParser(description="Fetch fundamentals for watchlist tickers and write docs/data/fundamentals.json.")
    ap.add_argument("--watchlist", default="docs/data/watchlist.json")
    ap.add_argument("--out-json", default="docs/data/fundamentals.json")
    ap.add_argument("--cache-dir", default="", help="Optional cache directory for fetched HTML.")
    ap.add_argument("--offline", action="store_true", help="Read HTML from --cache-dir only.")
    ap.add_argument("--out", default=os.environ.get("GITHUB_OUTPUT", ""), help="GitHub Actions output file path")
    args = ap.parse_args()

    if args.offline and not args.cache_dir.strip():
        raise SystemExit("--offline requires --cache-dir")

    watch_cfg = load_json(Path(args.watchlist), {"version": 1, "groups": []})
    tickers = flatten_watchlist(watch_cfg if isinstance(watch_cfg, dict) else {})

    fetcher = Fetcher(cache_dir=(Path(args.cache_dir).expanduser() if args.cache_dir.strip() else None), offline=bool(args.offline))

    now_jst = datetime.now(JST)
    items: list[dict[str, Any]] = []
    for t in tickers:
        code = t.get("code") or ""
        url = KABUTAN_FUNDAMENTALS_URL.format(code=urllib.parse.quote(code))
        html = fetcher.html(f"kabutan_{code}", url)
        text = html_to_text(html)
        metrics = extract_metrics(text)
        items.append(
            {
                "code": code,
                "name": t.get("name") or "",
                "name_en": t.get("name_en") or "",
                "sector": t.get("sector") or "",
                "asof_date": now_jst.strftime("%Y-%m-%d"),
                "source_url": url,
                "metrics": metrics,
            }
        )

    out_path = Path(args.out_json)
    new_data = {"version": 1, "updated_at": now_jst.isoformat(timespec="seconds"), "items": items}
    old_text = out_path.read_text(encoding="utf-8") if out_path.exists() else ""
    new_text = json.dumps(new_data, ensure_ascii=False, indent=2) + "\n"
    changed = old_text != new_text
    if changed:
        dump_json(out_path, new_data)

    outputs = {"has_changes": "true" if changed else "false"}
    if args.out:
        write_github_output(Path(args.out), outputs)
    else:
        print(json.dumps(outputs, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

