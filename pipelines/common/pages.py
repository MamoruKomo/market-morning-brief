from __future__ import annotations

import urllib.parse


def ensure_trailing_slash(url: str) -> str:
    u = (url or "").strip()
    if not u:
        return ""
    return u if u.endswith("/") else u + "/"


def ensure_docs_base_url(pages_base_url: str) -> str:
    """
    Normalize a GitHub Pages base URL to point at the repo's published `/docs/` root.

    - If `pages_base_url` already ends with `/docs/`, keep it.
    - Otherwise, append `/docs/`.

    This matches setups where GitHub Pages is configured to publish the repository root
    and the site lives under the `docs/` directory (e.g. .../repo/docs/...).
    """

    base = ensure_trailing_slash(pages_base_url)
    if not base:
        return ""

    parts = urllib.parse.urlsplit(base)
    path = parts.path or "/"

    if path.endswith("/docs/"):
        new_path = path
    elif path.endswith("/docs"):
        new_path = path + "/"
    else:
        new_path = path.rstrip("/") + "/docs/"

    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, new_path, parts.query, parts.fragment))

