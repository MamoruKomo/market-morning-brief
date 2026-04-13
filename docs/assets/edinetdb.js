(function () {
  const BASE = "https://edinetdb.jp/v1";
  const KEY_STORAGE = "edinetdb_api_key";

  function normalizeText(value) {
    return String(value ?? "").trim();
  }

  function nowMs() {
    return Date.now();
  }

  function loadCache(key, ttlMs) {
    if (!ttlMs) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const json = JSON.parse(raw);
      if (!json || typeof json !== "object") return null;
      const ts = Number(json.ts);
      if (!Number.isFinite(ts) || nowMs() - ts > ttlMs) return null;
      return json.data ?? null;
    } catch (e) {
      return null;
    }
  }

  function saveCache(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ ts: nowMs(), data }));
    } catch (e) {
      // ignore
    }
  }

  function secCodeToShort(secCode) {
    const s = normalizeText(secCode);
    if (/^\d{5}$/.test(s) && s.endsWith("0")) return s.slice(0, 4);
    if (/^\d{4}$/.test(s)) return s;
    return s;
  }

  async function fetchJson(path, opts) {
    const options = opts || {};
    const url = path.startsWith("http") ? path : `${BASE}${path.startsWith("/") ? "" : "/"}${path}`;
    const cacheKey = options.cacheKey || "";
    const ttlMs = Number(options.ttlMs || 0);
    if (cacheKey && ttlMs) {
      const cached = loadCache(cacheKey, ttlMs);
      if (cached != null) return cached;
    }

    const headers = {};
    if (options.auth) {
      const key = normalizeText(localStorage.getItem(KEY_STORAGE));
      if (!key) throw new Error("EDINET DB APIキーが未設定です。");
      headers["X-API-Key"] = key;
    }
    const res = await fetch(url, { headers, cache: "no-store" });
    const json = await res.json();
    if (json && json.error) {
      const msg = normalizeText(json.error.message) || "EDINET DB API error";
      throw new Error(msg);
    }
    if (cacheKey && ttlMs) saveCache(cacheKey, json);
    return json;
  }

  function getApiKey() {
    return normalizeText(localStorage.getItem(KEY_STORAGE));
  }

  function setApiKey(key) {
    const v = normalizeText(key);
    if (!v) {
      localStorage.removeItem(KEY_STORAGE);
      return;
    }
    localStorage.setItem(KEY_STORAGE, v);
  }

  window.EDINETDB = {
    BASE,
    KEY_STORAGE,
    getApiKey,
    setApiKey,
    secCodeToShort,
    fetchJson,
  };
})();

