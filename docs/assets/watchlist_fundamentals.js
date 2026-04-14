(function () {
  const MY_WATCH_KEY = "mmb_my_watchlist_v1";

  function $(selector) {
    return document.querySelector(selector);
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeText(value) {
    return String(value ?? "").trim();
  }

  function normalizeQuery(query) {
    return String(query ?? "")
      .trim()
      .toLowerCase()
      .replaceAll(/\s+/g, " ");
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function loadMyWatchlist() {
    try {
      const raw = localStorage.getItem(MY_WATCH_KEY);
      if (!raw) return { version: 1, groups: [] };
      const json = JSON.parse(raw);
      return { version: 1, groups: asArray(json?.groups) };
    } catch (e) {
      return { version: 1, groups: [] };
    }
  }

  function hasAnyTickers(groups) {
    return asArray(groups).some((g) => asArray(g?.tickers).length > 0);
  }

  function num(value) {
    if (value == null) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const s = String(value).replaceAll(",", "").trim();
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function fmt(n, digits) {
    const v = num(n);
    if (v == null) return "—";
    return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: digits ?? 2 }).format(v);
  }

  function fmtPct(n) {
    const v = num(n);
    if (v == null) return "—";
    const sign = v > 0 ? "+" : "";
    return `${sign}${fmt(v, 2)}%`;
  }

  function fmtX(n) {
    const v = num(n);
    if (v == null) return "—";
    return `${fmt(v, 2)}x`;
  }

  async function loadJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return res.json();
  }

  function hasEdinetDb() {
    return typeof window.EDINETDB === "object" && typeof window.EDINETDB.fetchJson === "function";
  }

  function buildTags(metrics, extra) {
    const tags = [];
    const roe = num(metrics?.roe);
    const eq = num(metrics?.equity_ratio);
    const dy = num(metrics?.dividend_yield);
    const per = num(metrics?.per);
    const pbr = num(metrics?.pbr);

    if (roe != null && roe >= 15) tags.push("高ROE");
    if (dy != null && dy >= 3) tags.push("高配当");
    if (eq != null && eq >= 60) tags.push("健全");
    if (eq != null && eq < 30) tags.push("財務注意");
    if (per != null && per >= 40) tags.push("割高PER");
    if (pbr != null && pbr >= 5) tags.push("割高PBR");

    for (const t of asArray(extra)) {
      const s = normalizeText(t);
      if (!s) continue;
      if (!tags.includes(s)) tags.push(s);
    }

    return tags;
  }

  function healthScore(metrics) {
    let score = 50;
    const roe = num(metrics?.roe);
    const eq = num(metrics?.equity_ratio);
    const per = num(metrics?.per);
    const pbr = num(metrics?.pbr);
    const dy = num(metrics?.dividend_yield);

    if (eq != null) {
      if (eq >= 70) score += 20;
      else if (eq >= 50) score += 10;
      else if (eq >= 30) score += 0;
      else score -= 20;
    }
    if (roe != null) {
      if (roe >= 15) score += 10;
      else if (roe >= 10) score += 5;
      else if (roe >= 5) score += 0;
      else score -= 10;
    }
    if (per != null && per > 0) {
      if (per <= 10) score += 10;
      else if (per <= 20) score += 5;
      else if (per <= 40) score += 0;
      else score -= 10;
    }
    if (pbr != null && pbr > 0) {
      if (pbr <= 1) score += 10;
      else if (pbr <= 2) score += 5;
      else if (pbr <= 5) score += 0;
      else score -= 10;
    }
    if (dy != null) {
      if (dy >= 4) score += 5;
      else if (dy >= 3) score += 4;
      else if (dy >= 2) score += 2;
    }

    score = Math.max(0, Math.min(100, score));
    return Math.round(score);
  }

  function scoreClass(score) {
    const s = num(score);
    if (s == null) return "flat";
    if (s >= 70) return "up";
    if (s >= 40) return "flat";
    return "down";
  }

  function computeSectorAverages(rows, keys) {
    const sums = {};
    const counts = {};
    for (const key of keys) {
      sums[key] = 0;
      counts[key] = 0;
    }
    for (const r of rows) {
      for (const key of keys) {
        const v = num(r?.metrics?.[key]);
        if (v == null) continue;
        sums[key] += v;
        counts[key] += 1;
      }
    }
    const avgs = {};
    for (const key of keys) {
      avgs[key] = counts[key] ? sums[key] / counts[key] : null;
    }
    return avgs;
  }

  function renderMetricWithDiff(value, avg, kind) {
    const v = num(value);
    const a = num(avg);
    if (v == null) return `<span class="muted">—</span>`;
    const diff = a == null ? null : v - a;
    const diffSign = diff == null ? "" : diff > 0 ? "+" : "";
    const diffText =
      diff == null
        ? ""
        : kind === "%"
          ? ` <span class="muted">(${diffSign}${fmt(diff, 2)}pp)</span>`
          : ` <span class="muted">(${diffSign}${fmt(diff, 2)}x)</span>`;
    const valText = kind === "%" ? fmtPct(v) : fmtX(v);
    return `${escapeHtml(valText)}${diffText}`;
  }

  function renderBadges(tags) {
    const list = asArray(tags).map((t) => normalizeText(t)).filter(Boolean);
    if (!list.length) return "";
    return `<div class="badges">${list
      .slice(0, 10)
      .map((t) => `<span class="badge">${escapeHtml(t)}</span>`)
      .join("")}</div>`;
  }

  function renderSector(sector, tickers, fundamentalsByCode, query) {
    const q = normalizeQuery(query);
    const rows = tickers
      .map((t) => {
        const code = normalizeText(t.code);
        if (!code) return null;
        const f = fundamentalsByCode.get(code) || {};
        const metrics = f.metrics && typeof f.metrics === "object" ? f.metrics : {};
        const name = normalizeText(f.name || t.name || "");
        const sourceUrl = normalizeText(f.source_url || `https://kabutan.jp/stock/?code=${encodeURIComponent(code)}`);
        const tags = buildTags(metrics, f.extra_tags);
        const hay = `${code} ${name} ${sector} ${tags.join(" ")}`.toLowerCase();
        if (q && !hay.includes(q)) return null;
        const score = num(f.credit_score);
        const scoreValue = score != null ? Math.round(score) : healthScore(metrics);
        return { code, name, sourceUrl, metrics, tags, score: scoreValue, rating: normalizeText(f.credit_rating || "") };
      })
      .filter(Boolean);

    if (!rows.length) {
      return "";
    }

    const keys = ["roe", "equity_ratio", "per", "pbr", "dividend_yield"];
    const avgs = computeSectorAverages(rows, keys);

    const tableRows = rows
      .map((r) => {
        const scoreCls = scoreClass(r.score);
        const scoreHtml = `<span class="delta ${scoreCls}">${escapeHtml(String(r.score))}</span>${
          r.rating ? ` <span class="muted">${escapeHtml(r.rating)}</span>` : ""
        }`;
        return `<tr>
  <td class="w-ticker">
    <a class="w-link" href="${escapeHtml(r.sourceUrl)}" target="_blank" rel="noreferrer">
      <div class="w-name-main">${escapeHtml(r.name || "—")}</div>
      <div class="w-code-sub">${escapeHtml(r.code)}</div>
    </a>
  </td>
  <td class="w-num">${scoreHtml}</td>
  <td class="w-num">${renderMetricWithDiff(r.metrics.roe, avgs.roe, "%")}</td>
  <td class="w-num">${renderMetricWithDiff(r.metrics.equity_ratio, avgs.equity_ratio, "%")}</td>
  <td class="w-num">${renderMetricWithDiff(r.metrics.per, avgs.per, "x")}</td>
  <td class="w-num">${renderMetricWithDiff(r.metrics.pbr, avgs.pbr, "x")}</td>
  <td class="w-num">${renderMetricWithDiff(r.metrics.dividend_yield, avgs.dividend_yield, "%")}</td>
  <td>${renderBadges(r.tags)}</td>
</tr>`;
      })
      .join("");

    return `<div class="watch-sector">
  <div class="watch-sector-head"><span>${escapeHtml(sector || "—")}</span><div class="watch-sector-meta"><span class="muted">業種平均差を括弧内に表示</span></div></div>
  <div class="watch-table-wrap">
    <table class="watch-table">
      <thead>
        <tr>
          <th>銘柄</th>
          <th>健全性</th>
          <th>ROE</th>
          <th>自己資本比率</th>
          <th>PER</th>
          <th>PBR</th>
          <th>配当利回り</th>
          <th>タグ</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>
</div>`;
  }

  function flattenTickers(groups) {
    const out = [];
    for (const g of asArray(groups)) {
      for (const t of asArray(g?.tickers)) {
        const code = normalizeText(t?.code);
        const name = normalizeText(t?.name);
        if (!code) continue;
        out.push({ code, name, sector: normalizeText(g?.sector) });
      }
    }
    const seen = new Set();
    return out.filter((t) => {
      if (seen.has(t.code)) return false;
      seen.add(t.code);
      return true;
    });
  }

  async function buildFundamentalsFromEdinet(tickers) {
    const key = hasEdinetDb() ? window.EDINETDB.getApiKey() : "";
    if (!key) return { updated_at: "", items: [] };

    const items = [];
    for (const t of asArray(tickers)) {
      const code = normalizeText(t.code);
      if (!code) continue;

      let hit = null;
      try {
        const sJson = await window.EDINETDB.fetchJson(`/search?q=${encodeURIComponent(code)}&limit=5`, {
          auth: false,
          cacheKey: `edinetdb_cache_search_code_${code}`,
          ttlMs: 24 * 60 * 60 * 1000,
        });
        const data = asArray(sJson?.data);
        hit = data.find((x) => window.EDINETDB.secCodeToShort(x?.sec_code) === code) || data[0] || null;
      } catch (e) {
        hit = null;
      }
      if (!hit) continue;

      const edinetCode = normalizeText(hit?.edinet_code);
      if (!edinetCode) continue;

      let ratios = null;
      try {
        const rJson = await window.EDINETDB.fetchJson(`/companies/${encodeURIComponent(edinetCode)}/ratios`, {
          auth: true,
          cacheKey: `edinetdb_cache_ratios_${edinetCode}`,
          ttlMs: 24 * 60 * 60 * 1000,
        });
        const years = asArray(rJson?.data)
          .slice()
          .sort((a, b) => Number(b?.fiscal_year || 0) - Number(a?.fiscal_year || 0));
        ratios = years[0] || null;
      } catch (e) {
        ratios = null;
      }

      const metrics = {
        roe: num(ratios?.roe),
        roa: num(ratios?.roa),
        operating_margin: num(ratios?.operating_margin),
        net_margin: num(ratios?.net_margin),
        equity_ratio: num(ratios?.equity_ratio),
        per: num(ratios?.per),
        dividend_yield: num(ratios?.dividend_yield),
        sales_growth_yoy: num(ratios?.revenue_growth),
      };

      const business = asArray(hit?.business_tags).map((x) => normalizeText(x)).filter(Boolean);
      const rating = normalizeText(hit?.credit_rating);
      const score = hit?.credit_score != null ? Number(hit.credit_score) : null;
      const extra = [
        ...(rating ? [`健全性${rating}`] : []),
        ...(Number.isFinite(score) ? [`スコア${score}`] : []),
        ...business,
      ].filter(Boolean);

      items.push({
        code,
        name: normalizeText(hit?.name) || normalizeText(t.name) || "",
        sector: normalizeText(hit?.industry) || normalizeText(t.sector) || "",
        source_url: `https://edinetdb.jp/v1/companies/${encodeURIComponent(edinetCode)}`,
        credit_score: score,
        credit_rating: rating,
        extra_tags: extra,
        metrics,
      });
    }

    return { updated_at: new Date().toISOString(), items };
  }

  async function main() {
    const root = document.documentElement;
    const watchlistPath = root.getAttribute("data-watchlist-config") || "../data/watchlist.json";
    const fundamentalsPath = root.getAttribute("data-fundamentals-json") || "../data/fundamentals.json";

    const container = $(".js-fundamentals");
    const search = $(".js-search");
    const status = $(".js-status");
    const err = $(".js-error");
    const apiKeyInput = $(".js-api-key");
    const saveKeyBtn = $(".js-save-key");
    const clearKeyBtn = $(".js-clear-key");
    const keyStatus = $(".js-key-status");

    let watch = null;
    let fundamentals = null;
    try {
      watch = await loadJson(watchlistPath);
      fundamentals = await loadJson(fundamentalsPath);
    } catch (e) {
      if (err) err.textContent = "データの読み込みに失敗しました。";
      return;
    }

    const sharedGroups = asArray(watch?.groups);
    const my = loadMyWatchlist();
    const useMy = hasAnyTickers(my.groups);
    const groups = useMy ? asArray(my.groups) : sharedGroups;
    if (!groups.length) {
      container.innerHTML = `<div class="empty">ウォッチがありません。<a href="manage.html">編集で追加</a></div>`;
      if (status) status.textContent = "—";
      return;
    }

    let fundamentalsByCode = new Map();
    let fundamentalsUpdated = normalizeText(fundamentals?.updated_at) || "—";
    let mode = "local";
    let scope = useMy ? "my" : "shared";

    const loadLocal = () => {
      const map = new Map();
      for (const it of asArray(fundamentals?.items)) {
        const code = normalizeText(it?.code);
        if (!code) continue;
        map.set(code, it);
      }
      fundamentalsByCode = map;
      fundamentalsUpdated = normalizeText(fundamentals?.updated_at) || "—";
      mode = "local";
    };

    const updateKeyStatus = () => {
      if (!keyStatus) return;
      if (!hasEdinetDb()) {
        keyStatus.textContent = "EDINET DB helper 未読込";
        return;
      }
      keyStatus.textContent = window.EDINETDB.getApiKey() ? "設定済み" : "未設定";
    };
    updateKeyStatus();

    const refresh = async () => {
      loadLocal();
      if (hasEdinetDb() && window.EDINETDB.getApiKey()) {
        try {
          const flat = flattenTickers(groups);
          const live = await buildFundamentalsFromEdinet(flat);
          const map = new Map();
          for (const it of asArray(live.items)) {
            const code = normalizeText(it?.code);
            if (!code) continue;
            map.set(code, it);
          }
          if (map.size > 0) {
            fundamentalsByCode = map;
            fundamentalsUpdated = "EDINET DB live";
            mode = "edinetdb";
          }
        } catch (e) {
          // fallback to local
          mode = "local";
        }
      }
      render();
    };

    if (saveKeyBtn) {
      saveKeyBtn.addEventListener("click", () => {
        if (!hasEdinetDb()) return;
        window.EDINETDB.setApiKey(apiKeyInput?.value || "");
        if (apiKeyInput) apiKeyInput.value = "";
        updateKeyStatus();
        void refresh();
      });
    }
    if (clearKeyBtn) {
      clearKeyBtn.addEventListener("click", () => {
        if (!hasEdinetDb()) return;
        window.EDINETDB.setApiKey("");
        if (apiKeyInput) apiKeyInput.value = "";
        updateKeyStatus();
        void refresh();
      });
    }

    const render = () => {
      const q = search?.value || "";
      const html = groups
        .map((g) => {
          const sector = normalizeText(g?.sector);
          const tickers = asArray(g?.tickers).map((t) => ({ code: normalizeText(t?.code), name: normalizeText(t?.name) }));
          return renderSector(sector, tickers, fundamentalsByCode, q);
        })
        .filter(Boolean)
        .join("");

      container.innerHTML = html || `<div class="empty">該当なし</div>`;

      if (status) {
        const scopeLabel = scope === "my" ? "マイ" : "共有";
        status.textContent = `対象: ${scopeLabel} / mode: ${mode} / 更新: ${fundamentalsUpdated}`;
      }
    };

    if (search) search.addEventListener("input", render);
    await refresh();
  }

  window.addEventListener("DOMContentLoaded", () => {
    void main();
  });
})();
