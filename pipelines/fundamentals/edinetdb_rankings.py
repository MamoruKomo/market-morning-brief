#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import time
import urllib.parse
import urllib.request
from json import JSONDecodeError
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from zoneinfo import ZoneInfo

try:
    import certifi  # type: ignore
except Exception:  # pragma: no cover
    certifi = None


JST = ZoneInfo("Asia/Tokyo")

API_BASE_DEFAULT = "https://edinetdb.jp/v1"


def normalize_spaces(text: Any) -> str:
    return " ".join(str(text or "").split()).strip()


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


def keep_latest_keys(mapping: dict[str, Any], max_keep: int) -> dict[str, Any]:
    keys = sorted([k for k in mapping.keys() if normalize_spaces(k)], reverse=True)
    keep = set(keys[: max(0, int(max_keep))])
    return {k: mapping[k] for k in mapping.keys() if k in keep}


def sec_code_to_short(sec_code: Any) -> str:
    s = normalize_spaces(sec_code)
    if re.fullmatch(r"\d{5}", s) and s.endswith("0"):
        return s[:4]
    if re.fullmatch(r"\d{4}", s):
        return s
    return s


def make_ssl_context() -> ssl.SSLContext:
    if certifi is not None:
        try:
            return ssl.create_default_context(cafile=certifi.where())
        except Exception:
            pass
    return ssl.create_default_context()


def fetch_json(url: str, api_key: str, timeout: int) -> Any:
    headers = {
        "User-Agent": "market-morning-brief/1.0 (+GitHub Actions)",
        "Accept": "application/json",
        "Accept-Language": "ja,en;q=0.8",
        "X-API-Key": api_key,
    }

    retry_statuses = {429, 500, 502, 503, 504}
    max_attempts = 4
    base_sleep = 1.2

    last_err: Exception | None = None
    for attempt in range(max_attempts):
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=int(timeout), context=make_ssl_context()) as res:
                raw = res.read()
                try:
                    charset = res.headers.get_content_charset()  # type: ignore[attr-defined]
                except Exception:
                    charset = None
            text = raw.decode(charset or "utf-8", errors="replace")
            return json.loads(text)
        except HTTPError as e:
            last_err = e
            if int(getattr(e, "code", 0) or 0) in retry_statuses and attempt < (max_attempts - 1):
                time.sleep(base_sleep * (2**attempt))
                continue
            raise
        except (URLError, JSONDecodeError) as e:
            last_err = e
            if attempt < (max_attempts - 1):
                time.sleep(base_sleep * (2**attempt))
                continue
            raise

    if last_err:
        raise last_err
    raise RuntimeError("Failed to fetch JSON")


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


@dataclass(frozen=True)
class Metric:
    key: str
    label: str
    unit: str
    better: str
    decimals: int
    description: str
    ranking_slug: str


METRICS: list[Metric] = [
    Metric(key="roe", label="ROE", unit="%", better="high", decimals=2, description="自己資本利益率", ranking_slug="roe"),
    Metric(key="operating_margin", label="営業利益率", unit="%", better="high", decimals=2, description="", ranking_slug="operating-margin"),
    Metric(key="net_margin", label="純利益率", unit="%", better="high", decimals=2, description="", ranking_slug="net-margin"),
    Metric(key="roa", label="ROA", unit="%", better="high", decimals=2, description="総資産利益率", ranking_slug="roa"),
    Metric(key="equity_ratio", label="自己資本比率", unit="%", better="high", decimals=2, description="", ranking_slug="equity-ratio"),
    Metric(key="dividend_yield", label="配当利回り", unit="%", better="high", decimals=2, description="", ranking_slug="dividend-yield"),
    Metric(key="per", label="PER", unit="x", better="low", decimals=2, description="株価収益率（低いほど割安）", ranking_slug="per"),
    Metric(key="health_score", label="健全性スコア", unit="", better="high", decimals=0, description="0〜100（高いほど健全）", ranking_slug="health-score"),
    Metric(key="sales_growth_yoy", label="売上成長率", unit="%", better="high", decimals=2, description="前年比（EDINET DB）", ranking_slug="revenue-growth"),
]


PAIR_DEFS: list[dict[str, Any]] = [
    {
        "key": "roe_growth",
        "label": "高ROE×成長",
        "a": {"key": "roe", "metric": "roe", "op": "gte", "value": 15},
        "b": {"key": "sales_growth_yoy", "metric": "revenue_growth", "op": "gte", "value": 5},
        "sort": "roe",
    },
    {
        "key": "div_health",
        "label": "高配当×健全",
        "a": {"key": "dividend_yield", "metric": "dividend_yield", "op": "gte", "value": 3},
        "b": {"key": "equity_ratio", "metric": "equity_ratio", "op": "gte", "value": 40},
        "sort": "dividend_yield",
    },
    {
        "key": "margin_roe",
        "label": "高利益率×ROE",
        "a": {"key": "operating_margin", "metric": "operating_margin", "op": "gte", "value": 15},
        "b": {"key": "roe", "metric": "roe", "op": "gte", "value": 12},
        "sort": "operating_margin",
    },
    {
        "key": "quality_value",
        "label": "高ROE×割安PER",
        "a": {"key": "roe", "metric": "roe", "op": "gte", "value": 12},
        "b": {"key": "per", "metric": "per", "op": "lte", "value": 15},
        "sort": "roe",
    },
]


def hash_int(text: str) -> int:
    h = 0
    for ch in text:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h


def pick_pair_for_date(date_iso: str) -> dict[str, Any] | None:
    if not PAIR_DEFS:
        return None
    idx = hash_int(date_iso) % len(PAIR_DEFS)
    return PAIR_DEFS[idx]


def resolve_company_meta(api_base: str, api_key: str, company: dict[str, Any], timeout: int) -> tuple[str, str]:
    """Return (sec_code_short, industry). Best-effort and low-call."""
    sec_code = normalize_spaces(company.get("sec_code") or company.get("secCode") or company.get("security_code") or "")
    industry = normalize_spaces(company.get("industry") or company.get("industry_name") or "")
    if sec_code and industry:
        return sec_code_to_short(sec_code), industry

    edinet_code = normalize_spaces(company.get("edinet_code") or company.get("edinetCode") or "")
    query = edinet_code or normalize_spaces(company.get("name") or "")
    if not query:
        return sec_code_to_short(sec_code), industry

    url = f"{api_base}/search?q={urllib.parse.quote(query)}&limit=5"
    try:
        j = fetch_json(url, api_key=api_key, timeout=timeout)
        hits = as_list(as_dict(j).get("data"))
        hit = hits[0] if hits else {}
        sec_code2 = normalize_spaces(as_dict(hit).get("sec_code") or "")
        industry2 = normalize_spaces(as_dict(hit).get("industry") or "")
        return sec_code_to_short(sec_code2 or sec_code), industry2 or industry
    except Exception:
        return sec_code_to_short(sec_code), industry


def build_metric_defs() -> list[dict[str, Any]]:
    return [
        {
            "key": m.key,
            "label": m.label,
            "unit": m.unit,
            "better": m.better,
            "decimals": m.decimals,
            "description": m.description,
        }
        for m in METRICS
    ]


def update_rankings_store(store: dict[str, Any], month: str, now: datetime, top_n: int, metrics: dict[str, Any], max_months: int) -> dict[str, Any]:
    months = store.get("months")
    if not isinstance(months, dict):
        months = {}
    months[str(month)] = {
        "month": month,
        "generated_at": now.isoformat(timespec="seconds"),
        "top_n": int(top_n),
        "metrics": metrics,
    }
    months = keep_latest_keys(months, int(max_months))
    return {
        "version": 1,
        "updated_at": now.isoformat(timespec="seconds"),
        "latest_month": month,
        "months": months,
        "metric_defs": build_metric_defs(),
    }


def update_hidden_store(store: dict[str, Any], date_iso: str, now: datetime, payload: dict[str, Any], max_days: int) -> dict[str, Any]:
    days = store.get("days")
    if not isinstance(days, dict):
        days = {}
    days[str(date_iso)] = payload
    days = keep_latest_keys(days, int(max_days))
    return {
        "version": 1,
        "updated_at": now.isoformat(timespec="seconds"),
        "latest_date": date_iso,
        "days": days,
        "pair_defs": [{"key": p["key"], "label": p["label"], "a": p["a"]["key"], "b": p["b"]["key"]} for p in PAIR_DEFS],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Update fundamentals rankings + hidden gems via EDINET DB API (no Kabutan scraping).")
    ap.add_argument("--rankings", default="docs/data/fundamentals_rankings.json")
    ap.add_argument("--hidden", default="docs/data/hidden_gems.json")
    ap.add_argument("--top", type=int, default=200, help="Fetch top N rows per metric (default: 200). Cards show top5.")
    ap.add_argument("--month", default="", help="YYYY-MM (default: now JST)")
    ap.add_argument("--date", default="", help="YYYY-MM-DD (default: today JST)")
    ap.add_argument("--max-months", type=int, default=24)
    ap.add_argument("--max-days", type=int, default=366)
    ap.add_argument("--api-base", default=API_BASE_DEFAULT)
    ap.add_argument("--timeout", type=int, default=30)
    ap.add_argument("--api-key-env", default="EDINETDB_API_KEY")
    args = ap.parse_args()

    api_key = normalize_spaces(os.environ.get(str(args.api_key_env)) or "")
    if not api_key:
        raise SystemExit(f"{args.api_key_env} が未設定です（GitHub Secretsに追加してください）")

    now = datetime.now(JST)
    month = normalize_spaces(args.month) or now.strftime("%Y-%m")
    date_iso = normalize_spaces(args.date) or now.strftime("%Y-%m-%d")

    api_base = normalize_spaces(args.api_base) or API_BASE_DEFAULT
    top_n = max(1, min(int(args.top), 500))

    metrics_payload: dict[str, Any] = {}
    for m in METRICS:
        url = f"{api_base}/rankings/{urllib.parse.quote(m.ranking_slug)}?limit={top_n}"
        j = fetch_json(url, api_key=api_key, timeout=int(args.timeout))
        rows = []
        for r in as_list(as_dict(j).get("data")):
            if not isinstance(r, dict):
                continue
            code = sec_code_to_short(r.get("sec_code") or r.get("secCode") or "")
            if not code:
                continue
            rows.append(
                {
                    "code": code,
                    "name": normalize_spaces(r.get("name") or ""),
                    "sector": normalize_spaces(r.get("industry") or ""),
                    "value": r.get("value"),
                }
            )
        metrics_payload[m.key] = rows

    rankings_path = Path(args.rankings)
    hidden_path = Path(args.hidden)

    old_rank_store = load_json(rankings_path, {})
    new_rank_store = update_rankings_store(as_dict(old_rank_store), month=month, now=now, top_n=5, metrics=metrics_payload, max_months=int(args.max_months))

    pair = pick_pair_for_date(date_iso) or PAIR_DEFS[0]
    a = as_dict(pair.get("a"))
    b = as_dict(pair.get("b"))

    hidden_error = ""
    items: list[dict[str, Any]] = []
    try:
        params = urllib.parse.urlencode(
            {
                "limit": 5,
                "sort": normalize_spaces(pair.get("sort") or a.get("metric") or "roe") or "roe",
                "order": "desc",
                f"{normalize_spaces(a.get('metric'))}_{normalize_spaces(a.get('op'))}": str(a.get("value")),
                f"{normalize_spaces(b.get('metric'))}_{normalize_spaces(b.get('op'))}": str(b.get("value")),
            }
        )
        s_url = f"{api_base}/screener?{params}"
        s_json = fetch_json(s_url, api_key=api_key, timeout=int(args.timeout))
        s_data = as_dict(s_json).get("data")
        payload_root = as_dict(s_data) if isinstance(s_data, dict) else as_dict(s_json)
        companies = as_list(payload_root.get("companies"))
        for c in companies[:5]:
            if not isinstance(c, dict):
                continue
            code, industry = resolve_company_meta(api_base, api_key=api_key, company=c, timeout=int(args.timeout))
            if not code:
                continue
            items.append(
                {
                    "code": code,
                    "name": normalize_spaces(c.get("name") or ""),
                    "sector": industry,
                    "a_value": c.get(normalize_spaces(a.get("metric"))),
                    "b_value": c.get(normalize_spaces(b.get("metric"))),
                }
            )
    except Exception as e:
        # EDINET DB 側の一時障害（503等）で workflow 全体を落とさない。
        hidden_error = normalize_spaces(str(e))
        items = []

    hidden_payload: dict[str, Any] = {
        "date": date_iso,
        "generated_at": now.isoformat(timespec="seconds"),
        "pair": {
            "key": normalize_spaces(pair.get("key")),
            "label": normalize_spaces(pair.get("label")),
            "a": normalize_spaces(a.get("key")),
            "b": normalize_spaces(b.get("key")),
        },
        "items": items,
    }
    if hidden_error:
        hidden_payload["error"] = hidden_error

    old_hidden_store = load_json(hidden_path, {})
    new_hidden_store = update_hidden_store(as_dict(old_hidden_store), date_iso=date_iso, now=now, payload=hidden_payload, max_days=int(args.max_days))

    old_rank = rankings_path.read_text(encoding="utf-8") if rankings_path.exists() else ""
    new_rank = json.dumps(new_rank_store, ensure_ascii=False, indent=2) + "\n"
    if old_rank != new_rank:
        dump_json(rankings_path, new_rank_store)

    old_hidden = hidden_path.read_text(encoding="utf-8") if hidden_path.exists() else ""
    new_hidden = json.dumps(new_hidden_store, ensure_ascii=False, indent=2) + "\n"
    if old_hidden != new_hidden:
        dump_json(hidden_path, new_hidden_store)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
