#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request


SLACK_API_BASE = "https://slack.com/api/"


def _slack_api(
    *,
    token: str,
    method: str,
    params: dict[str, str],
    http_method: str,
) -> dict:
    if http_method not in {"GET", "POST"}:
        raise ValueError(f"Unsupported http_method: {http_method}")

    headers = {"Authorization": f"Bearer {token}"}

    if http_method == "GET":
        url = f"{SLACK_API_BASE}{method}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers=headers, method="GET")
    else:
        data = urllib.parse.urlencode(params).encode("utf-8")
        headers = {**headers, "Content-Type": "application/x-www-form-urlencoded"}
        req = urllib.request.Request(
            f"{SLACK_API_BASE}{method}",
            data=data,
            headers=headers,
            method="POST",
        )

    with urllib.request.urlopen(req, timeout=20) as res:
        raw = res.read()
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        raise RuntimeError(f"Non-JSON Slack response: {raw[:200]!r}") from None


def _pick_rollcall_message(messages: list[dict], required_fragments: list[str]) -> dict | None:
    for msg in messages:
        text = msg.get("text") or ""
        if all(fragment in text for fragment in required_fragments):
            return msg
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Add :white_check_mark: reaction to the nightly rollcall message.",
    )
    parser.add_argument(
        "--channel-id",
        default=os.environ.get("SLACK_CHANNEL_ID", "C0AFD5SKDG9"),
        help="Slack channel ID (default: env SLACK_CHANNEL_ID or C0AFD5SKDG9)",
    )
    parser.add_argument(
        "--token-env",
        default="SLACK_USER_TOKEN",
        help="Env var name that contains the Slack User OAuth token",
    )
    parser.add_argument(
        "--reaction",
        default=os.environ.get("SLACK_REACTION", "white_check_mark"),
        help="Reaction name (without colons). Default: white_check_mark",
    )
    parser.add_argument(
        "--lookback-minutes",
        type=int,
        default=int(os.environ.get("LOOKBACK_MINUTES", "90")),
        help="How many minutes back to search. Default: 90",
    )
    parser.add_argument(
        "--require-text",
        action="append",
        default=[],
        help="Additional required substring (repeatable)",
    )
    args = parser.parse_args(argv)

    token = os.environ.get(args.token_env, "").strip()
    if not token:
        print(f"Missing token env var: {args.token_env}", file=sys.stderr)
        return 2

    required_fragments = [
        "点呼を開始します",
        ":white_check_mark:",
    ]
    for extra in args.require_text:
        extra = (extra or "").strip()
        if extra:
            required_fragments.append(extra)

    now = time.time()
    oldest = now - (args.lookback_minutes * 60)

    history = _slack_api(
        token=token,
        method="conversations.history",
        params={
            "channel": args.channel_id,
            "limit": "100",
            "oldest": f"{oldest:.6f}",
            "inclusive": "true",
        },
        http_method="GET",
    )
    if not history.get("ok"):
        err = history.get("error") or "unknown_error"
        print(f"Slack conversations.history failed: {err}", file=sys.stderr)
        return 3

    messages = history.get("messages") or []
    msg = _pick_rollcall_message(messages, required_fragments)
    if not msg:
        print("No matching rollcall message found; skipping.")
        return 0

    ts = msg.get("ts")
    if not ts:
        print("Matched message missing ts; skipping.", file=sys.stderr)
        return 4

    add = _slack_api(
        token=token,
        method="reactions.add",
        params={
            "channel": args.channel_id,
            "timestamp": str(ts),
            "name": args.reaction,
        },
        http_method="POST",
    )
    if add.get("ok"):
        print(f"Reaction added: :{args.reaction}: ts={ts}")
        return 0

    err = add.get("error") or "unknown_error"
    if err == "already_reacted":
        print("Already reacted; done.")
        return 0

    print(f"Slack reactions.add failed: {err}", file=sys.stderr)
    return 5


if __name__ == "__main__":
    raise SystemExit(main())

