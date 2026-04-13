#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import random
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from pipelines.fundamentals.defs import METRICS, PAIR_DEFS

JST = ZoneInfo("Asia/Tokyo")


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


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def num(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)) and float(value) == float(value):
        return float(value)
    s = normalize_spaces(value).replace(",", "")
    if not s or s in {"—", "-", "N/A"}:
        return None
    try:
        return float(s)
    except Exception:
        return None


def load_fundamentals_items(path: Path) -> list[dict[str, Any]]:
    data = load_json(path, {"version": 1, "items": []})
    items = as_list(as_dict(data).get("items"))
    out: list[dict[str, Any]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        code = normalize_spaces(it.get("code") or "")
        if not code:
            continue
        out.append(it)
    return out


def render_metric_defs() -> list[dict[str, Any]]:
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
    ] + [
        {
            "key": "sales_growth_yoy",
            "label": "売上成長率",
            "unit": "%",
            "better": "high",
            "decimals": 2,
            "description": "前年比（取得できる場合）",
        }
    ]


def compute_rankings(items: list[dict[str, Any]], top_n: int) -> dict[str, list[dict[str, Any]]]:
    rankings: dict[str, list[dict[str, Any]]] = {}
    metric_defs = render_metric_defs()

    for md in metric_defs:
        key = str(md.get("key") or "")
        better = str(md.get("better") or "high")

        rows: list[dict[str, Any]] = []
        for it in items:
            metrics = as_dict(it.get("metrics"))
            v = num(metrics.get(key))
            if v is None:
                continue
            if key in {"per", "pbr"} and v <= 0:
                continue
            rows.append(
                {
                    "code": normalize_spaces(it.get("code") or ""),
                    "name": normalize_spaces(it.get("name") or ""),
                    "sector": normalize_spaces(it.get("sector") or ""),
                    "value": float(v),
                }
            )

        rows.sort(key=lambda r: r["value"], reverse=(better != "low"))
        rankings[key] = rows[: max(0, int(top_n))]

    return rankings


def percentile_map(values: list[float], better: str) -> dict[float, float]:
    if not values:
        return {}
    uniq = sorted(set(values), reverse=(better != "low"))
    if len(uniq) == 1:
        return {uniq[0]: 1.0}
    out: dict[float, float] = {}
    n = len(uniq) - 1
    for idx, v in enumerate(uniq):
        # 0..1 where 1 is best
        out[v] = 1.0 - (idx / n)
    return out


def compute_hidden_gems(items: list[dict[str, Any]], date_iso: str, top_n: int) -> dict[str, Any]:
    rnd = random.Random(date_iso)
    candidates = list(PAIR_DEFS)
    rnd.shuffle(candidates)

    defs = {d["key"]: d for d in render_metric_defs()}

    def is_eligible(p: dict[str, str]) -> bool:
        a_key = str(p.get("a") or "")
        b_key = str(p.get("b") or "")
        if not a_key or not b_key:
            return False
        for it in items:
            metrics = as_dict(it.get("metrics"))
            av = num(metrics.get(a_key))
            bv = num(metrics.get(b_key))
            if av is None or bv is None:
                continue
            if a_key in {"per", "pbr"} and av <= 0:
                continue
            if b_key in {"per", "pbr"} and bv <= 0:
                continue
            return True
        return False

    pair = next((p for p in candidates if is_eligible(p)), None) or (
        PAIR_DEFS[0]
        if PAIR_DEFS
        else {"key": "roe_growth", "label": "高ROE×成長", "a": "roe", "b": "sales_growth_yoy"}
    )
    a = str(pair.get("a") or "")
    b = str(pair.get("b") or "")

    # Metric defs for better direction.
    a_better = str(defs.get(a, {}).get("better") or "high")
    b_better = str(defs.get(b, {}).get("better") or "high")

    rows: list[dict[str, Any]] = []
    a_values: list[float] = []
    b_values: list[float] = []
    for it in items:
        metrics = as_dict(it.get("metrics"))
        av = num(metrics.get(a))
        bv = num(metrics.get(b))
        if av is None or bv is None:
            continue
        if a in {"per", "pbr"} and av <= 0:
            continue
        if b in {"per", "pbr"} and bv <= 0:
            continue
        a_values.append(float(av))
        b_values.append(float(bv))
        rows.append(
            {
                "code": normalize_spaces(it.get("code") or ""),
                "name": normalize_spaces(it.get("name") or ""),
                "sector": normalize_spaces(it.get("sector") or ""),
                "a_value": float(av),
                "b_value": float(bv),
            }
        )

    a_pct = percentile_map(a_values, a_better)
    b_pct = percentile_map(b_values, b_better)

    for r in rows:
        a_score = a_pct.get(r["a_value"], 0.0)
        b_score = b_pct.get(r["b_value"], 0.0)
        r["score"] = round(a_score + b_score, 6)

    rows.sort(key=lambda r: (r.get("score") or 0.0, r.get("a_value") or 0.0), reverse=True)

    return {
        "date": date_iso,
        "generated_at": datetime.now(JST).isoformat(timespec="seconds"),
        "pair": {
            "key": str(pair.get("key") or ""),
            "label": str(pair.get("label") or ""),
            "a": a,
            "b": b,
        },
        "items": rows[: max(0, int(top_n))],
    }


def normalize_rankings_store(data: Any) -> dict[str, Any]:
    data = data if isinstance(data, dict) else {}
    months = data.get("months")
    if not isinstance(months, dict):
        months = {}
    return {
        "version": int(data.get("version") or 1),
        "updated_at": data.get("updated_at"),
        "latest_month": normalize_spaces(data.get("latest_month") or ""),
        "months": months,
        "metric_defs": data.get("metric_defs"),
    }


def normalize_hidden_store(data: Any) -> dict[str, Any]:
    data = data if isinstance(data, dict) else {}
    days = data.get("days")
    if not isinstance(days, dict):
        days = {}
    return {
        "version": int(data.get("version") or 1),
        "updated_at": data.get("updated_at"),
        "latest_date": normalize_spaces(data.get("latest_date") or ""),
        "days": days,
        "pair_defs": data.get("pair_defs"),
    }


def keep_latest_keys(mapping: dict[str, Any], max_keep: int) -> dict[str, Any]:
    keys = sorted([k for k in mapping.keys() if normalize_spaces(k)], reverse=True)
    keep = set(keys[: max(0, int(max_keep))])
    return {k: mapping[k] for k in mapping.keys() if k in keep}


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
    ap = argparse.ArgumentParser(description="Compute monthly rankings + daily hidden gems from fundamentals.json.")
    ap.add_argument("--fundamentals", default="docs/data/fundamentals.json")
    ap.add_argument("--rankings", default="docs/data/fundamentals_rankings.json")
    ap.add_argument("--hidden", default="docs/data/hidden_gems.json")
    ap.add_argument("--top", type=int, default=5)
    ap.add_argument("--month", default="", help="YYYY-MM (default: now JST)")
    ap.add_argument("--date", default="", help="YYYY-MM-DD (default: today JST)")
    ap.add_argument("--max-months", type=int, default=24)
    ap.add_argument("--max-days", type=int, default=366)
    ap.add_argument("--out", default=os.environ.get("GITHUB_OUTPUT", ""), help="GitHub Actions output file path")
    args = ap.parse_args()

    now = datetime.now(JST)
    month = normalize_spaces(args.month) or now.strftime("%Y-%m")
    date_iso = normalize_spaces(args.date) or now.strftime("%Y-%m-%d")

    items = load_fundamentals_items(Path(args.fundamentals))
    rankings = compute_rankings(items, top_n=int(args.top))
    hidden = compute_hidden_gems(items, date_iso=date_iso, top_n=int(args.top))

    rankings_path = Path(args.rankings)
    hidden_path = Path(args.hidden)

    # Update rankings store.
    rank_store = normalize_rankings_store(load_json(rankings_path, {}))
    months = rank_store["months"] if isinstance(rank_store.get("months"), dict) else {}
    months[str(month)] = {
        "month": month,
        "generated_at": now.isoformat(timespec="seconds"),
        "top_n": int(args.top),
        "metrics": rankings,
    }
    months = keep_latest_keys(months, int(args.max_months))
    rank_store.update(
        {
            "version": 1,
            "updated_at": now.isoformat(timespec="seconds"),
            "latest_month": month,
            "months": months,
            "metric_defs": render_metric_defs(),
        }
    )

    # Update hidden gems store.
    hidden_store = normalize_hidden_store(load_json(hidden_path, {}))
    days = hidden_store["days"] if isinstance(hidden_store.get("days"), dict) else {}
    days[str(date_iso)] = hidden
    days = keep_latest_keys(days, int(args.max_days))
    hidden_store.update(
        {
            "version": 1,
            "updated_at": now.isoformat(timespec="seconds"),
            "latest_date": date_iso,
            "days": days,
            "pair_defs": PAIR_DEFS,
        }
    )

    old_rank = rankings_path.read_text(encoding="utf-8") if rankings_path.exists() else ""
    new_rank = json.dumps(rank_store, ensure_ascii=False, indent=2) + "\n"
    rank_changed = old_rank != new_rank
    if rank_changed:
        dump_json(rankings_path, rank_store)

    old_hidden = hidden_path.read_text(encoding="utf-8") if hidden_path.exists() else ""
    new_hidden = json.dumps(hidden_store, ensure_ascii=False, indent=2) + "\n"
    hidden_changed = old_hidden != new_hidden
    if hidden_changed:
        dump_json(hidden_path, hidden_store)

    changed = rank_changed or hidden_changed

    outputs = {"has_changes": "true" if changed else "false"}
    if args.out:
        write_github_output(Path(args.out), outputs)
    else:
        print(json.dumps(outputs, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
