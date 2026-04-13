(function () {
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

  function asArray(value) {
    return Array.isArray(value) ? value : [];
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

  function num(value) {
    if (value == null) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const s = String(value).replaceAll(",", "").trim();
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  async function loadJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return res.json();
  }

  function hasEdinetDb() {
    return typeof window.EDINETDB === "object" && typeof window.EDINETDB.fetchJson === "function";
  }

  function jstToday() {
    try {
      return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function hashInt(text) {
    const s = String(text || "");
    let h = 0;
    for (let i = 0; i < s.length; i += 1) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  const LIVE_METRICS = [
    { key: "roe", label: "ROE", unit: "%", decimals: 2, slug: "roe", better: "high" },
    { key: "operating_margin", label: "営業利益率", unit: "%", decimals: 2, slug: "operating-margin", better: "high" },
    { key: "net_margin", label: "純利益率", unit: "%", decimals: 2, slug: "net-margin", better: "high" },
    { key: "roa", label: "ROA", unit: "%", decimals: 2, slug: "roa", better: "high" },
    { key: "equity_ratio", label: "自己資本比率", unit: "%", decimals: 2, slug: "equity-ratio", better: "high" },
    { key: "dividend_yield", label: "配当利回り", unit: "%", decimals: 2, slug: "dividend-yield", better: "high" },
    { key: "per", label: "PER", unit: "x", decimals: 2, slug: "per", better: "low" },
    { key: "health_score", label: "健全性スコア", unit: "", decimals: 0, slug: "health-score", better: "high" },
  ];

  const LIVE_HIDDEN_PAIRS = [
    {
      key: "roe_growth",
      label: "高ROE×成長",
      a: { metric: "roe", op: "gte", value: 15, label: "ROE", unit: "%" },
      b: { metric: "revenue_cagr_3y", op: "gte", value: 5, label: "売上CAGR(3y)", unit: "%" },
      sort: "roe",
    },
    {
      key: "div_health",
      label: "高配当×健全",
      a: { metric: "dividend_yield", op: "gte", value: 3, label: "配当利回り", unit: "%" },
      b: { metric: "equity_ratio", op: "gte", value: 40, label: "自己資本比率", unit: "%" },
      sort: "dividend_yield",
    },
    {
      key: "margin_roe",
      label: "高利益率×ROE",
      a: { metric: "operating_margin", op: "gte", value: 15, label: "営業利益率", unit: "%" },
      b: { metric: "roe", op: "gte", value: 12, label: "ROE", unit: "%" },
      sort: "operating_margin",
    },
    {
      key: "quality_value",
      label: "高ROE×割安PER",
      a: { metric: "roe", op: "gte", value: 12, label: "ROE", unit: "%" },
      b: { metric: "per", op: "lte", value: 15, label: "PER", unit: "x" },
      sort: "roe",
    },
  ];

  function pickPairForDate(dateIso) {
    const list = LIVE_HIDDEN_PAIRS.slice();
    if (!list.length) return null;
    const idx = hashInt(dateIso) % list.length;
    return list[idx];
  }

  async function loadLiveRanking(metric, limit) {
    const slug = normalizeText(metric?.slug);
    if (!hasEdinetDb() || !slug) return [];
    const json = await window.EDINETDB.fetchJson(`/rankings/${encodeURIComponent(slug)}?limit=${encodeURIComponent(String(limit || 5))}`, {
      auth: true,
      cacheKey: `edinetdb_cache_rank_${slug}_${limit || 5}`,
      ttlMs: 60 * 60 * 1000,
    });
    return asArray(json?.data).map((r) => ({
      code: window.EDINETDB.secCodeToShort(r?.sec_code),
      name: normalizeText(r?.name),
      sector: normalizeText(r?.industry),
      value: r?.value,
      unit: normalizeText(r?.unit),
      fiscal_year: r?.fiscal_year,
    }));
  }

  function formatValue(v, unit, decimals) {
    const n = num(v);
    if (n == null) return "—";
    const fmt = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: decimals ?? 2 }).format(n);
    if (!unit || unit === "x") return `${fmt}${unit || ""}`;
    return `${fmt}${unit}`;
  }

  function metricDefMap(metricDefs) {
    const m = new Map();
    for (const d of asArray(metricDefs)) {
      const key = normalizeText(d.key);
      if (!key) continue;
      m.set(key, d);
    }
    return m;
  }

  function getLatestKey(keys, fallback) {
    const list = asArray(keys).map((k) => String(k || "")).filter(Boolean);
    if (!list.length) return fallback || "";
    return list.slice().sort((a, b) => b.localeCompare(a))[0];
  }

  function renderMetricCard(metricKey, def, rows, month, opts) {
    const label = escapeHtml(def?.label || metricKey);
    const desc = normalizeText(def?.description || "");
    const unit = normalizeText(def?.unit || "");
    const decimals = def?.decimals ?? 2;
    const href = opts?.href || `metric.html?metric=${encodeURIComponent(metricKey)}${month ? `&month=${encodeURIComponent(month)}` : ""}`;
    const top = asArray(rows).slice(0, 5);
    const body =
      top.length > 0
        ? `<ol class="metric-top">${top
            .map((r) => {
              const code = escapeHtml(normalizeText(r.code));
              const name = escapeHtml(normalizeText(r.name));
              const sector = escapeHtml(normalizeText(r.sector));
              const value = formatValue(r.value, unit, decimals);
              return `<li class="metric-row">
  <div class="metric-left">
    <div class="metric-name">${name || "<span class=\"muted\">(銘柄名なし)</span>"}</div>
    <div class="metric-sub">${code}${sector ? ` · ${sector}` : ""}</div>
  </div>
  <div class="metric-val">${escapeHtml(value)}</div>
</li>`;
            })
            .join("")}</ol>`
        : `<div class="empty">データがありません（${escapeHtml(label)}）</div>`;

    return `<a class="metric-card" href="${href}">
  <div class="metric-head">
    <div class="metric-title">${label}</div>
    <div class="metric-link">${escapeHtml(opts?.linkLabel || "Top企業を見る")}</div>
  </div>
  ${desc ? `<div class="metric-desc">${escapeHtml(desc)}</div>` : ""}
  ${body}
</a>`;
  }

  function renderGrid(container, json, month) {
    const months = json?.months && typeof json.months === "object" ? json.months : {};
    const snapshot = months?.[month] || null;
    const metricDefs = asArray(json?.metric_defs);
    const defMap = metricDefMap(metricDefs);

    const metrics = snapshot?.metrics && typeof snapshot.metrics === "object" ? snapshot.metrics : {};
    const keys = Array.from(defMap.keys());
    if (!keys.length) {
      container.innerHTML = `<div class="empty">指標定義（metric_defs）がありません。</div>`;
      return;
    }

    container.innerHTML = keys
      .map((key) => renderMetricCard(key, defMap.get(key), metrics?.[key] || [], month))
      .join("");
  }

  function renderHidden(container, json, defMap) {
    const days = json?.days && typeof json.days === "object" ? json.days : {};
    const latest = normalizeText(json?.latest_date) || getLatestKey(Object.keys(days), "");
    const snap = latest ? days?.[latest] : null;
    if (!snap) {
      container.innerHTML = `<div class="empty">まだデータがありません。</div>`;
      return;
    }

    const pair = snap.pair || {};
    const label = escapeHtml(normalizeText(pair.label || "隠れ銘柄"));
    const a = normalizeText(pair.a);
    const b = normalizeText(pair.b);
    const aDef = defMap.get(a) || {};
    const bDef = defMap.get(b) || {};

    const items = asArray(snap.items).slice(0, 5);
    const listHtml =
      items.length > 0
        ? `<ol class="metric-top">${items
            .map((it) => {
              const code = escapeHtml(normalizeText(it.code));
              const name = escapeHtml(normalizeText(it.name));
              const sector = escapeHtml(normalizeText(it.sector));
              const aVal = formatValue(it.a_value, aDef.unit, aDef.decimals);
              const bVal = formatValue(it.b_value, bDef.unit, bDef.decimals);
              return `<li class="metric-row">
  <div class="metric-left">
    <div class="metric-name">${name || "<span class=\"muted\">(銘柄名なし)</span>"}</div>
    <div class="metric-sub">${code}${sector ? ` · ${sector}` : ""}</div>
  </div>
  <div class="metric-val">
    <div class="metric-pair">${escapeHtml(aDef.label || a)}: ${escapeHtml(aVal)}</div>
    <div class="metric-pair">${escapeHtml(bDef.label || b)}: ${escapeHtml(bVal)}</div>
  </div>
</li>`;
            })
            .join("")}</ol>`
        : `<div class="empty">この組み合わせのデータがありません。</div>`;

    container.innerHTML = `<div class="row">
  <div class="headline">${escapeHtml(latest)} — ${label}</div>
</div>
<div class="meta-line">${escapeHtml(aDef.label || a)} × ${escapeHtml(bDef.label || b)}</div>
${listHtml}`;
  }

  function renderMetricDetail(container, json, metricKey, month, query) {
    const months = json?.months && typeof json.months === "object" ? json.months : {};
    const snapshot = months?.[month] || null;
    const metricDefs = asArray(json?.metric_defs);
    const defMap = metricDefMap(metricDefs);
    const def = defMap.get(metricKey) || { key: metricKey, label: metricKey, unit: "", decimals: 2 };

    const rows = asArray(snapshot?.metrics?.[metricKey]);
    const q = normalizeQuery(query);
    const filtered = q
      ? rows.filter((r) => `${r.code || ""} ${r.name || ""} ${r.sector || ""}`.toLowerCase().includes(q))
      : rows;

    if (!filtered.length) {
      container.innerHTML = `<div class="empty">該当なし</div>`;
      return { def, shown: 0, total: rows.length };
    }

    container.innerHTML = `<div class="metric-table-wrap">
  <table class="metric-table">
    <thead>
      <tr>
        <th>銘柄</th>
        <th>${escapeHtml(def.label || metricKey)}</th>
        <th>業種</th>
      </tr>
    </thead>
    <tbody>
      ${filtered
        .map((r) => {
          const code = escapeHtml(normalizeText(r.code));
          const name = escapeHtml(normalizeText(r.name));
          const sector = escapeHtml(normalizeText(r.sector));
          const value = escapeHtml(formatValue(r.value, def.unit, def.decimals));
          return `<tr>
  <td>
    <div class="w-name-main">${name || "—"}</div>
    <div class="w-code-sub">${code}</div>
  </td>
  <td class="w-num">${value}</td>
  <td>${sector || "—"}</td>
</tr>`;
        })
        .join("")}
    </tbody>
  </table>
</div>`;

    return { def, shown: filtered.length, total: rows.length };
  }

  async function pageIndex() {
    const root = document.documentElement;
    const rankingsPath = root.getAttribute("data-rankings-json") || "../data/fundamentals_rankings.json";
    const hiddenPath = root.getAttribute("data-hidden-json") || "../data/hidden_gems.json";

    const monthSelect = $(".js-month");
    const grid = $(".js-metric-grid");
    const hidden = $(".js-hidden");
    const status = $(".js-status");
    const err = $(".js-error");
    const apiKeyInput = $(".js-api-key");
    const saveKeyBtn = $(".js-save-key");
    const clearKeyBtn = $(".js-clear-key");
    const keyStatus = $(".js-key-status");

    const updateKeyStatus = () => {
      if (!keyStatus) return;
      if (!hasEdinetDb()) {
        keyStatus.textContent = "EDINET DB helper 未読込";
        return;
      }
      keyStatus.textContent = window.EDINETDB.getApiKey() ? "設定済み" : "未設定";
    };
    updateKeyStatus();

    const saveKey = () => {
      if (!hasEdinetDb()) return;
      window.EDINETDB.setApiKey(apiKeyInput?.value || "");
      if (apiKeyInput) apiKeyInput.value = "";
      updateKeyStatus();
      void refresh();
    };
    const clearKey = () => {
      if (!hasEdinetDb()) return;
      window.EDINETDB.setApiKey("");
      if (apiKeyInput) apiKeyInput.value = "";
      updateKeyStatus();
      void refresh();
    };
    if (saveKeyBtn) saveKeyBtn.addEventListener("click", saveKey);
    if (clearKeyBtn) clearKeyBtn.addEventListener("click", clearKey);

    let rankings = null;
    let hiddenJson = null;
    try {
      rankings = await loadJson(rankingsPath);
      hiddenJson = await loadJson(hiddenPath);
    } catch (e) {
      if (err) err.textContent = "データの読み込みに失敗しました。";
      return;
    }

    const months = rankings?.months && typeof rankings.months === "object" ? Object.keys(rankings.months) : [];
    const latestMonth = normalizeText(rankings?.latest_month) || getLatestKey(months, "");
    const month = latestMonth || "";

    if (monthSelect) {
      const options = asArray(months)
        .slice()
        .sort((a, b) => b.localeCompare(a))
        .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
        .join("");
      monthSelect.innerHTML = options || `<option value="">—</option>`;
      if (month) monthSelect.value = month;
    }

    const defMapLocal = metricDefMap(asArray(rankings?.metric_defs));

    const renderLocal = () => {
      const m = monthSelect?.value || month;
      if (grid) renderGrid(grid, rankings, m);
      if (status) {
        const updated = normalizeText(rankings?.updated_at) || "—";
        status.textContent = `mode: local / 更新: ${updated}`;
      }
      if (hidden) renderHidden(hidden, hiddenJson, defMapLocal);
    };

    const renderLive = async () => {
      if (!hasEdinetDb() || !window.EDINETDB.getApiKey()) return false;
      if (monthSelect) {
        monthSelect.innerHTML = `<option value="live">LIVE</option>`;
        monthSelect.value = "live";
        monthSelect.disabled = true;
      }

      const defs = LIVE_METRICS.map((d) => ({ ...d, description: "EDINET DB API" }));
      const defMap = metricDefMap(defs);

      const results = await Promise.all(
        defs.map(async (d) => {
          try {
            const rows = await loadLiveRanking(d, 5);
            return { key: d.key, def: d, rows };
          } catch (e) {
            return { key: d.key, def: d, rows: [] };
          }
        }),
      );

      if (grid) {
        grid.innerHTML = results.map((r) => renderMetricCard(r.key, r.def, r.rows, "", { href: `metric.html?metric=${encodeURIComponent(r.key)}&live=1`, linkLabel: "詳細" })).join("");
      }

      if (hidden) {
        const today = jstToday();
        const pair = pickPairForDate(today);
        if (!pair) {
          hidden.innerHTML = `<div class="empty">設定がありません。</div>`;
        } else {
          const a = pair.a;
          const b = pair.b;
          const params = new URLSearchParams();
          params.set("limit", "5");
          params.set("sort", pair.sort || a.metric);
          params.set("order", "desc");
          params.set(`${a.metric}_${a.op}`, String(a.value));
          params.set(`${b.metric}_${b.op}`, String(b.value));
          const sJson = await window.EDINETDB.fetchJson(`/screener?${params.toString()}`, {
            auth: true,
            cacheKey: `edinetdb_cache_screener_${pair.key}_${today}`,
            ttlMs: 60 * 60 * 1000,
          });
          const data = sJson?.data && typeof sJson.data === "object" ? sJson.data : sJson;
          const companies = asArray(data?.companies || []);
          const list = companies.slice(0, 5).map((c) => {
            const name = normalizeText(c?.name);
            const code = window.EDINETDB.secCodeToShort(c?.sec_code || c?.secCode || "");
            const industry = normalizeText(c?.industry || c?.industry_name || "");
            const aVal = c?.[a.metric];
            const bVal = c?.[b.metric];
            return {
              code,
              name,
              sector: industry,
              a_value: aVal,
              b_value: bVal,
            };
          });

          const aDef = defMap.get(a.metric) || { label: a.label, unit: a.unit, decimals: 2 };
          const bDef = defMap.get(b.metric) || { label: b.label, unit: b.unit, decimals: 2 };
          const fake = {
            latest_date: today,
            days: {
              [today]: {
                date: today,
                pair: { label: pair.label, a: a.metric, b: b.metric },
                items: list,
              },
            },
          };
          renderHidden(hidden, fake, defMapLocal.size ? defMapLocal : defMap);
        }
      }

      if (status) status.textContent = `mode: EDINET DB live / 更新: 8:00 JST (API)`;
      return true;
    };

    const refresh = async () => {
      try {
        const ok = await renderLive();
        if (ok) return;
      } catch (e) {
        // ignore and fallback
      }
      if (monthSelect) monthSelect.disabled = false;
      renderLocal();
    };

    if (monthSelect) monthSelect.addEventListener("change", renderLocal);
    await refresh();
  }

  async function pageMetric() {
    const root = document.documentElement;
    const rankingsPath = root.getAttribute("data-rankings-json") || "../data/fundamentals_rankings.json";
    const monthSelect = $(".js-month");
    const list = $(".js-list");
    const title = $(".js-title");
    const h2 = $(".js-h2");
    const search = $(".js-search");
    const status = $(".js-status");
    const err = $(".js-error");

    const params = new URLSearchParams(location.search);
    const metricKey = normalizeText(params.get("metric") || "roe");
    const presetMonth = normalizeText(params.get("month") || "");
    const live = normalizeText(params.get("live") || "") === "1";

    let rankings = null;
    try {
      rankings = await loadJson(rankingsPath);
    } catch (e) {
      rankings = null;
    }

    const months = rankings?.months && typeof rankings.months === "object" ? Object.keys(rankings.months) : [];
    const latestMonth = presetMonth || normalizeText(rankings?.latest_month) || getLatestKey(months, "");
    const defMap = metricDefMap(asArray(rankings?.metric_defs));
    const def = defMap.get(metricKey) || { label: metricKey };

    const liveDef = LIVE_METRICS.find((m) => m.key === metricKey) || null;
    if (live && liveDef && hasEdinetDb() && window.EDINETDB.getApiKey()) {
      try {
        const rows = await loadLiveRanking(liveDef, 200);
        const fake = {
          months: {
            live: {
              metrics: {
                [metricKey]: rows.map((r) => ({ code: r.code, name: r.name, sector: r.sector, value: r.value })),
              },
            },
          },
          metric_defs: [{ key: metricKey, label: liveDef.label, unit: liveDef.unit, decimals: liveDef.decimals }],
        };
        if (monthSelect) {
          monthSelect.innerHTML = `<option value="live">LIVE</option>`;
          monthSelect.value = "live";
          monthSelect.disabled = true;
        }
        const doRender = () => {
          const q = search?.value || "";
          const res = renderMetricDetail(list, fake, metricKey, "live", q);
          if (status) status.textContent = `${res.shown}/${res.total}件表示（EDINET DB live）`;
        };
        if (search) search.addEventListener("input", doRender);
        doRender();
        if (title) title.textContent = liveDef.label;
        if (h2) h2.textContent = `${liveDef.label} ランキング`;
        return;
      } catch (e) {
        // fallback to local
      }
    }

    if (!rankings) {
      if (err) err.textContent = "データの読み込みに失敗しました。";
      return;
    }

    if (title) title.textContent = def?.label ? `${def.label}` : "ファンダ指標";
    if (h2) h2.textContent = def?.label ? `${def.label} ランキング` : "ランキング";

    if (monthSelect) {
      const options = asArray(months)
        .slice()
        .sort((a, b) => b.localeCompare(a))
        .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
        .join("");
      monthSelect.innerHTML = options || `<option value="">—</option>`;
      if (latestMonth) monthSelect.value = latestMonth;
    }

    const doRender = () => {
      const m = monthSelect?.value || latestMonth;
      const q = search?.value || "";
      const res = renderMetricDetail(list, rankings, metricKey, m, q);
      if (status) status.textContent = `${res.shown}/${res.total}件表示`;
    };
    if (monthSelect) monthSelect.addEventListener("change", doRender);
    if (search) search.addEventListener("input", doRender);
    doRender();
  }

  window.addEventListener("DOMContentLoaded", () => {
    const root = document.documentElement;
    if (root.matches('[data-hidden-json]')) {
      void pageIndex();
      return;
    }
    void pageMetric();
  });
})();
