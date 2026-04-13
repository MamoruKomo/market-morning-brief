#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def load_json(path: Path) -> dict:
    if not path.exists():
        return {"version": 1, "briefs": []}
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_store(data: dict) -> dict:
    if isinstance(data, list):
        return {"version": 1, "briefs": data}
    if not isinstance(data, dict):
        return {"version": 1, "briefs": []}
    briefs = data.get("briefs")
    if not isinstance(briefs, list):
        briefs = []
    return {"version": int(data.get("version") or 1), "briefs": briefs}


def upsert_by_date(briefs: list[dict], entry: dict) -> list[dict]:
    date = str(entry.get("date") or "").strip()
    if not date:
        raise ValueError("entry.date is required (YYYY-MM-DD)")

    out: list[dict] = []
    replaced = False
    for b in briefs:
        if str(b.get("date") or "").strip() == date:
            out.append(entry)
            replaced = True
        else:
            out.append(b)
    if not replaced:
        out.append(entry)

    out.sort(key=lambda x: str(x.get("date") or ""), reverse=True)
    return out


def upsert_index_file(index_path: Path, entry: dict) -> dict:
    """Upsert an entry into briefs index file and return the normalized store."""
    data = normalize_store(load_json(index_path))
    data["briefs"] = upsert_by_date(list(data["briefs"]), entry)
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return data


def main() -> int:
    p = argparse.ArgumentParser(description="Upsert docs/data/briefs.json by date.")
    p.add_argument(
        "--index",
        default="docs/data/briefs.json",
        help="Path to briefs index JSON (default: docs/data/briefs.json)",
    )
    p.add_argument(
        "--entry",
        default="-",
        help="Entry JSON path, or '-' to read from stdin (default: '-')",
    )
    args = p.parse_args()

    index_path = Path(args.index)
    data = normalize_store(load_json(index_path))

    if args.entry == "-":
        entry = json.loads(sys.stdin.read() or "{}")
    else:
        entry = json.loads(Path(args.entry).read_text(encoding="utf-8"))
    if not isinstance(entry, dict):
        raise SystemExit("Entry JSON must be an object")

    upsert_index_file(index_path, entry)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
