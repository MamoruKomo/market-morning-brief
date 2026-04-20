(function () {
  const STORAGE_KEY = "mmb_my_watchlist_v1";

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

  function secCodeToShort(secCode) {
    if (hasEdinetDb()) return window.EDINETDB.secCodeToShort(secCode);
    const s = normalizeText(secCode);
    if (/^\d{5}$/.test(s) && s.endsWith("0")) return s.slice(0, 4);
    return s;
  }

  async function edinetSearch(q) {
    if (!hasEdinetDb()) return [];
    const qs = normalizeText(q);
    if (!qs) return [];
    const cacheKey = `edinetdb_cache_search_${qs}`;
    const json = await window.EDINETDB.fetchJson(`/search?q=${encodeURIComponent(qs)}&limit=30`, {
      auth: false,
      cacheKey,
      ttlMs: 30 * 60 * 1000,
    });
    return asArray(json?.data);
  }

  function loadLocalWatchlist() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { version: 1, groups: [] };
      const json = JSON.parse(raw);
      const groups = Array.isArray(json?.groups) ? json.groups : [];
      return { version: 1, groups };
    } catch (e) {
      return { version: 1, groups: [] };
    }
  }

  function saveLocalWatchlist(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, groups: asArray(data?.groups) }));
  }

  function upsertGroup(groups, sector) {
    const key = normalizeText(sector) || "未分類";
    let g = groups.find((x) => normalizeText(x?.sector) === key);
    if (!g) {
      g = { sector: key, tickers: [] };
      groups.push(g);
    }
    if (!Array.isArray(g.tickers)) g.tickers = [];
    return g;
  }

  function hasTicker(groups, code) {
    const c = normalizeText(code);
    if (!c) return false;
    for (const g of groups) {
      for (const t of asArray(g?.tickers)) {
        if (normalizeText(t?.code) === c) return true;
      }
    }
    return false;
  }

  function removeTicker(groups, code) {
    const c = normalizeText(code);
    const out = [];
    for (const g of groups) {
      const tickers = asArray(g?.tickers).filter((t) => normalizeText(t?.code) !== c);
      if (!tickers.length) continue;
      out.push({ sector: normalizeText(g?.sector), tickers });
    }
    return out;
  }

  function updateTickerName(groups, code, name) {
    const c = normalizeText(code);
    const n = normalizeText(name);
    if (!c) return asArray(groups);
    return asArray(groups).map((g) => ({
      sector: normalizeText(g?.sector) || "未分類",
      tickers: asArray(g?.tickers).map((t) => (normalizeText(t?.code) === c ? { ...t, code: c, name: n } : t)),
    }));
  }

  function buildTags(item, metrics) {
    const tags = [];
    const sector = normalizeText(item?.sector);
    if (sector) tags.push(sector);

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
    if (per != null && per > 0 && per <= 10) tags.push("割安PER");
    if (pbr != null && pbr > 0 && pbr <= 1) tags.push("割安PBR");

    return tags;
  }

  function renderBadges(tags) {
    const list = asArray(tags).map((t) => normalizeText(t)).filter(Boolean);
    if (!list.length) return "";
    return `<div class="badges">${list
      .slice(0, 12)
      .map((t) => `<span class="badge">${escapeHtml(t)}</span>`)
      .join("")}</div>`;
  }

  function renderResults(container, items, metricsByCode, query, selectedSector, onAdd) {
    const q = normalizeQuery(query);
    const sectorOverride = normalizeText(selectedSector);
    const rows = asArray(items)
      .map((it) => {
        const code = normalizeText(it?.code);
        const name = normalizeText(it?.name);
        const sector = normalizeText(it?.sector);
        if (!code) return null;
        const metrics = metricsByCode.get(code) || {};
        const tags = Array.isArray(it?.tags) ? it.tags : buildTags({ sector }, metrics);
        const hay = `${code} ${name} ${sector} ${tags.join(" ")}`.toLowerCase();
        if (q && !hay.includes(q)) return null;
        const addSector = sectorOverride || sector || "未分類";
        return {
          code,
          name,
          sector,
          addSector,
          tags,
          edinet_code: normalizeText(it?.edinet_code || ""),
          sec_code_full: normalizeText(it?.sec_code_full || ""),
        };
      })
      .filter(Boolean);

    if (!rows.length) {
      container.innerHTML = `<div class="empty">該当なし</div>`;
      return { shown: 0 };
    }

    container.innerHTML = `<div class="mini-list">${rows
      .slice(0, 60)
      .map((r) => {
        const code = escapeHtml(r.code);
        const name = escapeHtml(r.name);
        const sector = escapeHtml(r.sector || "—");
        const addSector = escapeHtml(r.addSector);
        const edinetCode = escapeHtml(r.edinet_code || "");
        const secFull = escapeHtml(r.sec_code_full || "");
        return `<div class="mini-card">
  <div class="row">
    <div class="headline">${code} — ${name || "<span class=\"muted\">(銘柄名なし)</span>"}</div>
    <button type="button" class="go js-add" data-code="${code}" data-name="${escapeHtml(
          r.name,
        )}" data-sector="${addSector}" data-edinet="${edinetCode}" data-secfull="${secFull}">追加</button>
  </div>
  <div class="meta-line">${sector}</div>
  ${renderBadges(r.tags)}
</div>`;
      })
      .join("")}</div>`;

    container.querySelectorAll("button.js-add").forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.getAttribute("data-code") || "";
        const name = btn.getAttribute("data-name") || "";
        const sector = btn.getAttribute("data-sector") || "";
        const edinetCode = btn.getAttribute("data-edinet") || "";
        const secFull = btn.getAttribute("data-secfull") || "";
        if (!code) return;
        onAdd({ code, name, sector, edinetCode, secFull });
      });
    });

    return { shown: Math.min(60, rows.length) };
  }

  function renderMy(container, data) {
    const groups = asArray(data?.groups)
      .map((g) => ({
        sector: normalizeText(g?.sector) || "未分類",
        tickers: asArray(g?.tickers).map((t) => ({ code: normalizeText(t?.code), name: normalizeText(t?.name) })).filter((t) => t.code),
      }))
      .filter((g) => g.tickers.length > 0)
      .sort((a, b) => a.sector.localeCompare(b.sector));

    if (!groups.length) {
      container.innerHTML = `<div class="empty">まだありません。</div>`;
      return;
    }

    container.innerHTML = groups
      .map((g) => {
        const rows = g.tickers
          .map(
            (t) => `<div class="row" style="padding:10px 0">
  <div>
    <div class="w-name-main">${escapeHtml(t.name || "—")}</div>
    <div class="w-code-sub">${escapeHtml(t.code)}</div>
  </div>
  <div class="actions">
    <button class="go js-edit" type="button" data-code="${escapeHtml(t.code)}" data-name="${escapeHtml(t.name || "")}">名前</button>
    <button class="go js-remove" type="button" data-code="${escapeHtml(t.code)}">削除</button>
  </div>
</div>`,
          )
          .join("");
        return `<article class="card">
  <div class="row">
    <div class="headline">${escapeHtml(g.sector)}</div>
    <div class="muted">${g.tickers.length}銘柄</div>
  </div>
  <div style="margin-top:10px">${rows}</div>
</article>`;
      })
      .join("");
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      return false;
    }
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function main() {
    const root = document.documentElement;
    const masterPath = root.getAttribute("data-master-json") || "../data/tickers_master.json";
    const fundamentalsPath = root.getAttribute("data-fundamentals-json") || "../data/fundamentals.json";

    const apiKeyInput = $(".js-api-key");
    const saveKeyBtn = $(".js-save-key");
    const clearKeyBtn = $(".js-clear-key");
    const keyStatus = $(".js-key-status");
    const search = $(".js-search");
    const sectorSelect = $(".js-sector");
    const results = $(".js-results");
    const status = $(".js-status");
    const err = $(".js-error");
    const manualCode = $(".js-manual-code");
    const manualName = $(".js-manual-name");
    const manualAdd = $(".js-manual-add");
    const manualStatus = $(".js-manual-status");
    const my = $(".js-my");
    const msg = $(".js-msg");
    const exportBtn = $(".js-export");
    const downloadBtn = $(".js-download");
    const clearBtn = $(".js-clear");

    let master = [];
    const masterByCode = new Map();
    const metricsByCode = new Map();
    try {
      const masterJson = await loadJson(masterPath);
      master = asArray(masterJson?.items);
      for (const it of master) {
        const code = normalizeText(it?.code);
        if (!code || masterByCode.has(code)) continue;
        masterByCode.set(code, it);
      }
      const fJson = await loadJson(fundamentalsPath);
      for (const it of asArray(fJson?.items)) {
        const code = normalizeText(it?.code);
        if (!code) continue;
        const metrics = it?.metrics && typeof it.metrics === "object" ? it.metrics : {};
        metricsByCode.set(code, metrics);
      }
    } catch (e) {
      if (err) err.textContent = "データの読み込みに失敗しました。";
      return;
    }

    const updateKeyStatus = () => {
      if (!keyStatus) return;
      if (!hasEdinetDb()) {
        keyStatus.textContent = "EDINET DB helper 未読込";
        return;
      }
      keyStatus.textContent = window.EDINETDB.getApiKey() ? "設定済み" : "未設定";
    };
    updateKeyStatus();

    if (saveKeyBtn) {
      saveKeyBtn.addEventListener("click", () => {
        if (!hasEdinetDb()) return;
        window.EDINETDB.setApiKey(apiKeyInput?.value || "");
        if (apiKeyInput) apiKeyInput.value = "";
        updateKeyStatus();
      });
    }
    if (clearKeyBtn) {
      clearKeyBtn.addEventListener("click", () => {
        if (!hasEdinetDb()) return;
        window.EDINETDB.setApiKey("");
        if (apiKeyInput) apiKeyInput.value = "";
        updateKeyStatus();
      });
    }

    const allSectors = Array.from(
      new Set(master.map((it) => normalizeText(it?.sector)).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b));
    const sectorOptions = ["自動", ...allSectors, "未分類"];
    if (sectorSelect) {
      sectorSelect.innerHTML = sectorOptions
        .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
        .join("");
      sectorSelect.value = "自動";
    }

    let local = loadLocalWatchlist();
    let live = { q: "", items: [], loading: false, error: "" };
    let liveTimer = 0;

    const rerenderMy = () => {
      if (my) renderMy(my, local);
      if (msg) msg.textContent = "";

      if (my) {
        my.querySelectorAll("button.js-remove").forEach((btn) => {
          btn.addEventListener("click", () => {
            const code = btn.getAttribute("data-code") || "";
            local.groups = removeTicker(asArray(local.groups), code);
            saveLocalWatchlist(local);
            rerenderMy();
            render();
          });
        });

        my.querySelectorAll("button.js-edit").forEach((btn) => {
          btn.addEventListener("click", () => {
            const code = btn.getAttribute("data-code") || "";
            const cur = btn.getAttribute("data-name") || "";
            if (!code) return;
            const next = normalizeText(window.prompt("銘柄名を入力してください", cur) || "");
            local.groups = updateTickerName(asArray(local.groups), code, next);
            saveLocalWatchlist(local);
            rerenderMy();
            render();
          });
        });
      }
    };

    const render = () => {
      const q = search?.value || "";
      const sectorRaw = sectorSelect?.value || "自動";
      const sectorOverride = sectorRaw === "自動" ? "" : sectorRaw;
      const useLive = normalizeQuery(q).length > 0 && live.q === normalizeQuery(q) && (live.loading || live.items.length > 0);
      const items = useLive ? live.items : master;
      const res = renderResults(results, items, metricsByCode, q, sectorOverride, ({ code, name, sector, edinetCode, secFull }) => {
        if (hasTicker(asArray(local.groups), code)) {
          if (msg) msg.textContent = `すでに追加済み: ${code}`;
          return;
        }
        const groups = asArray(local.groups);
        const g = upsertGroup(groups, sector);
        g.tickers.push({ code, name, edinet_code: edinetCode || "", sec_code_full: secFull || "" });
        local.groups = groups;
        saveLocalWatchlist(local);
        rerenderMy();
        render();
        if (msg) msg.textContent = `追加しました: ${code}`;
      });

      const count = asArray(local.groups).reduce((sum, g) => sum + asArray(g?.tickers).length, 0);
      if (status) {
        const liveNote = useLive ? "（EDINET DB検索）" : "（ローカル）";
        status.textContent = `検索結果: ${res.shown}件 ${liveNote} / マイウォッチ: ${count}銘柄`;
      }
    };

    const scheduleLiveSearch = () => {
      if (!search) return;
      const q = normalizeQuery(search.value || "");
      if (!q) {
        live = { q: "", items: [], loading: false, error: "" };
        render();
        return;
      }
      if (!hasEdinetDb()) {
        live = { q, items: [], loading: false, error: "EDINET DB helper 未読込" };
        render();
        return;
      }
      if (liveTimer) window.clearTimeout(liveTimer);
      liveTimer = window.setTimeout(async () => {
        live = { q, items: [], loading: true, error: "" };
        render();
        try {
          const data = await edinetSearch(q);
          const mapped = data
            .map((it) => {
              const edinetCode = normalizeText(it?.edinet_code);
              const secFull = normalizeText(it?.sec_code);
              const code = secCodeToShort(secFull);
              const name = normalizeText(it?.name);
              const sector = normalizeText(it?.industry);
              const business = asArray(it?.business_tags).map((t) => normalizeText(t)).filter(Boolean);
              const rating = normalizeText(it?.credit_rating);
              const score = it?.credit_score != null ? Number(it.credit_score) : null;
              const tags = [
                ...(sector ? [sector] : []),
                ...(rating ? [`健全性${rating}`] : []),
                ...(Number.isFinite(score) ? [`スコア${score}`] : []),
                ...business,
              ].filter(Boolean);
              if (!code || !name) return null;
              return { code, name, sector, tags, edinet_code: edinetCode, sec_code_full: secFull };
            })
            .filter(Boolean);
          live = { q, items: mapped, loading: false, error: "" };
        } catch (e) {
          live = { q, items: [], loading: false, error: String(e?.message || e || "検索に失敗") };
        }
        render();
      }, 300);
    };

    const manualAddTicker = async () => {
      const codeRaw = secCodeToShort(manualCode?.value || "");
      const code = normalizeText(codeRaw);
      const nameInput = normalizeText(manualName?.value || "");
      const sectorRaw = sectorSelect?.value || "自動";
      const sectorOverride = sectorRaw === "自動" ? "" : normalizeText(sectorRaw);

      if (!code || !/^\d{3,4}[A-Z]?$/.test(code)) {
        if (manualStatus) manualStatus.textContent = "コードが不正です（例: 6361）";
        return;
      }
      if (hasTicker(asArray(local.groups), code)) {
        if (manualStatus) manualStatus.textContent = `すでに追加済み: ${code}`;
        return;
      }

      const resolved = masterByCode.get(code) || null;
      let name = nameInput || normalizeText(resolved?.name || "");
      let sector = sectorOverride || normalizeText(resolved?.sector || "");
      let edinetCode = normalizeText(resolved?.edinet_code || resolved?.edinetCode || "");
      let secFull = normalizeText(resolved?.sec_code_full || resolved?.secCodeFull || "");

      if (!name && hasEdinetDb() && window.EDINETDB.getApiKey()) {
        if (manualStatus) manualStatus.textContent = "EDINET DBで検索中…";
        try {
          const found = await edinetSearch(code);
          const hit =
            found.find((it) => secCodeToShort(it?.sec_code_full || it?.secCodeFull || "") === code) || found[0] || null;
          if (hit) {
            name = name || normalizeText(hit?.name);
            sector = sector || normalizeText(hit?.sector);
            edinetCode = edinetCode || normalizeText(hit?.edinet_code || hit?.edinetCode || "");
            secFull = secFull || normalizeText(hit?.sec_code_full || hit?.secCodeFull || "");
          }
        } catch (e) {
          // ignore
        }
      }

      if (!sector) sector = "未分類";

      const groups = asArray(local.groups);
      const g = upsertGroup(groups, sector);
      g.tickers.push({ code, name, edinet_code: edinetCode || "", sec_code_full: secFull || "" });
      local.groups = groups;
      saveLocalWatchlist(local);

      if (manualCode) manualCode.value = "";
      if (manualName) manualName.value = "";
      if (manualStatus) manualStatus.textContent = `追加しました: ${code}${name ? `（${name}）` : ""}`;
      rerenderMy();
      render();
    };

    if (manualAdd) manualAdd.addEventListener("click", () => void manualAddTicker());
    if (manualCode) {
      manualCode.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          void manualAddTicker();
        }
      });
    }

    if (search) search.addEventListener("input", scheduleLiveSearch);
    if (sectorSelect) sectorSelect.addEventListener("change", render);

    if (exportBtn) {
      exportBtn.addEventListener("click", async () => {
        const text = JSON.stringify({ version: 1, groups: asArray(local.groups) }, null, 2);
        const ok = await copyText(text);
        if (msg) msg.textContent = ok ? "コピーしました。" : "コピーに失敗しました（ブラウザの権限を確認）。";
      });
    }

    if (downloadBtn) {
      downloadBtn.addEventListener("click", () => {
        const text = JSON.stringify({ version: 1, groups: asArray(local.groups) }, null, 2);
        downloadText("my_watchlist.json", text);
        if (msg) msg.textContent = "保存しました。";
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        if (!confirm("マイウォッチを全削除しますか？")) return;
        local = { version: 1, groups: [] };
        saveLocalWatchlist(local);
        rerenderMy();
        render();
      });
    }

    rerenderMy();
    render();
  }

  window.addEventListener("DOMContentLoaded", () => {
    void main();
  });
})();
