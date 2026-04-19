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

  async function loadJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return res.json();
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

  function fmtNum(value, opts) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return new Intl.NumberFormat("ja-JP", opts || { maximumFractionDigits: 2 }).format(n);
  }

  function fmtPct(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return `${sign}${fmtNum(n, { maximumFractionDigits: 2 })}%`;
  }

  function deltaClass(delta, deltaPct) {
    const d = Number.isFinite(Number(deltaPct)) ? Number(deltaPct) : Number(delta);
    if (!Number.isFinite(d) || d === 0) return "flat";
    return d > 0 ? "up" : "down";
  }

  function syncTopbarHeight() {
    const shell = document.querySelector(".app-shell.has-topbar");
    const topbar = document.querySelector(".app-topbar");
    if (!shell || !topbar) return;
    const h = Math.ceil(topbar.getBoundingClientRect().height || 0);
    if (h > 0) shell.style.setProperty("--app-topbar-height", `${h}px`);
  }

  const QUICKLINKS_STORAGE_KEY = "mmb_quicklinks_v1";

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  function normalizeQuickLinks(value) {
    const list = Array.isArray(value) ? value : [];
    const out = [];
    for (const it of list) {
      const label = String(it?.label ?? it?.name ?? "").trim();
      const url = String(it?.url ?? it?.href ?? "").trim();
      if (!url) continue;
      if (!/^https?:\/\//i.test(url)) continue;
      let safeLabel = label;
      try {
        const u = new URL(url);
        if (!safeLabel) safeLabel = u.hostname;
      } catch (e) {
        // ignore
      }
      if (!safeLabel) continue;
      out.push({ label: safeLabel, url });
    }
    return out.slice(0, 12);
  }

  function loadQuickLinksFromLocalStorage() {
    try {
      const raw = localStorage.getItem(QUICKLINKS_STORAGE_KEY);
      if (!raw) return null;
      const json = safeJsonParse(raw);
      return normalizeQuickLinks(json);
    } catch (e) {
      return null;
    }
  }

  function saveQuickLinksToLocalStorage(links) {
    try {
      localStorage.setItem(QUICKLINKS_STORAGE_KEY, JSON.stringify(links));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearQuickLinksLocalStorage() {
    try {
      localStorage.removeItem(QUICKLINKS_STORAGE_KEY);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function loadQuickLinks() {
    const local = loadQuickLinksFromLocalStorage();
    if (local && local.length) return { links: local, source: "local" };

    try {
      const json = await loadJson("data/quick_links.json");
      const links = normalizeQuickLinks(json?.links || json);
      if (links.length) return { links, source: "file" };
    } catch (e) {
      // ignore
    }

    const fallback = normalizeQuickLinks([
      { label: "会社開示（株探）", url: "https://kabutan.jp/disclosures/" },
      { label: "PTS夜間 上昇率", url: "https://kabutan.jp/warning/pts_night_price_increase" },
      { label: "PTS夜間 出来高", url: "https://kabutan.jp/warning/pts_night_volume_ranking" },
    ]);
    return { links: fallback, source: "fallback" };
  }

  function getHost(url) {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return "";
    }
  }

  function renderQuickLinksDisplay(container, links) {
    const list = Array.isArray(links) ? links : [];
    if (!list.length) {
      container.innerHTML = `<div class="empty">—</div>`;
      return;
    }
    container.innerHTML = `<div class="ql-grid">${list
      .map((it) => {
        const label = escapeHtml(it.label || "");
        const url = escapeHtml(it.url || "");
        const host = escapeHtml(getHost(it.url || ""));
        return `<a class="ql-btn" href="${url}" target="_blank" rel="noreferrer"><span class="ql-label">${label}</span><span class="ql-host">${host}</span></a>`;
      })
      .join("")}</div>`;
  }

  function readQuickLinksEditor(container) {
    const rows = Array.from(container.querySelectorAll(".ql-row"));
    return rows.map((row) => {
      const label = String(row.querySelector('input[name="label"]')?.value || "").trim();
      const url = String(row.querySelector('input[name="url"]')?.value || "").trim();
      return { label, url };
    });
  }

  function renderQuickLinksEditor(container, links) {
    const list = Array.isArray(links) ? links : [];
    const rows = list
      .map((it, idx) => {
        const label = escapeHtml(it?.label || "");
        const url = escapeHtml(it?.url || "");
        return `<div class="ql-row" data-idx="${idx}">
  <input name="label" type="text" placeholder="ラベル" value="${label}" />
  <input name="url" type="url" placeholder="https://..." value="${url}" />
  <button class="go js-ql-del" type="button" data-idx="${idx}">削除</button>
</div>`;
      })
      .join("");

    container.innerHTML = `<div class="ql-editor">
  ${rows || `<div class="empty">リンクがありません（追加してください）。</div>`}
  <div class="row" style="justify-content:flex-start">
    <button class="go js-ql-add" type="button">＋ 追加</button>
    <div class="ql-help">保存するとこのブラウザにだけ反映されます。</div>
  </div>
</div>`;
  }

  function renderChipLinks(values, hrefFn) {
    const list = asArray(values)
      .map((v) => String(v || "").trim())
      .filter(Boolean);
    if (list.length === 0) return `<div class="empty">—</div>`;
    return `<div class="chips">${list
      .slice(0, 20)
      .map((v) => `<a class="chip" href="${escapeHtml(hrefFn(v))}">${escapeHtml(v)}</a>`)
      .join("")}</div>`;
  }

  function renderBadges(tags) {
    const list = asArray(tags)
      .map((t) => String(t || "").trim())
      .filter(Boolean);
    if (list.length === 0) return "";
    return `<div class="badges">${list
      .slice(0, 12)
      .map((t) => `<span class="badge">${escapeHtml(t)}</span>`)
      .join("")}</div>`;
  }

  function renderTapeItem(tile) {
    const label = escapeHtml(tile.label || "");
    const valueCore =
      tile.valueText != null
        ? String(tile.valueText)
        : tile.value === "—"
          ? "—"
          : fmtNum(tile.value, tile.formatOpts);
    const value = tile.valueSuffix && valueCore !== "—" ? `${valueCore}${escapeHtml(tile.valueSuffix)}` : valueCore;
    const deltaCore =
      tile.deltaText != null
        ? String(tile.deltaText)
        : tile.deltaPct != null
          ? fmtPct(tile.deltaPct)
          : tile.delta != null
            ? fmtNum(tile.delta)
            : "—";
    const delta = tile.deltaSuffix && deltaCore && deltaCore !== "—" ? `${deltaCore}${escapeHtml(tile.deltaSuffix)}` : deltaCore;
    const cls = deltaClass(tile.delta, tile.deltaPct);
    const href = tile.href ? escapeHtml(tile.href) : "";

    const hideDelta = tile.hideDeltaWhenMissing !== false && (!deltaCore || deltaCore === "—");
    const deltaHtml = hideDelta ? "" : `<span class="tape-delta ${cls}">(${escapeHtml(delta)})</span>`;
    const inner = `<span class="tape-label">${label}:</span><span class="tape-value">${escapeHtml(
      value,
    )}</span>${deltaHtml}`;

    if (href) {
      return `<a class="tape-item" href="${href}" target="_blank" rel="noreferrer">${inner}</a>`;
    }
    return `<div class="tape-item">${inner}</div>`;
  }

  function buildKpisFromMarketOverview(mo) {
    const nikkei = mo?.nikkei || {};
    const topix = mo?.topix || {};
    const spx = mo?.sp500 || mo?.spx || {};
    const dow = mo?.dow || {};
    const nasdaq = mo?.nasdaq || {};
    const us10y = mo?.us10y || {};
    const usdJpy = mo?.usd_jpy || mo?.usdjpy || {};
    const wti = mo?.wti || {};
    const fut = mo?.nikkei_futures || mo?.nikkei225_futures || {};
    const gap = mo?.futures_gap || {};

    const hasValue = (v) => Number.isFinite(Number(v));
    const hasPct = (v) => Number.isFinite(Number(v));

    const tile = (t) => {
      if (hasValue(t.value)) return t;
      if (hasPct(t.deltaPct)) {
        return {
          ...t,
          valueText: fmtPct(t.deltaPct),
          deltaText: "",
        };
      }
      return null;
    };

    const tiles = [
      tile({ label: "日経平均", value: nikkei.value, deltaPct: nikkei.change_pct, sub: nikkei.asof || "" }),
      tile({ label: "TOPIX", value: topix.value, deltaPct: topix.change_pct, sub: topix.asof || "" }),
      tile({
        label: "米ドル/円",
        value: usdJpy.value,
        delta: usdJpy.change,
        deltaPct: usdJpy.change_pct,
        formatOpts: { maximumFractionDigits: 2 },
        sub: usdJpy.asof || "",
      }),
      tile({
        label: "米10年",
        value: us10y.value,
        delta: us10y.change,
        deltaPct: us10y.change_pct,
        formatOpts: { maximumFractionDigits: 3 },
        valueSuffix: "%",
        hideDeltaWhenMissing: true,
        sub: us10y.asof || "",
      }),
      tile({
        label: "WTI",
        value: wti.value,
        deltaPct: wti.change_pct,
        formatOpts: { maximumFractionDigits: 2 },
        sub: wti.asof || "",
      }),
      tile({ label: "日経225先物", value: fut.value, deltaPct: fut.change_pct, sub: fut.asof || "" }),
      tile({
        label: "先物ギャップ",
        value: gap.value,
        delta: gap.value,
        formatOpts: { maximumFractionDigits: 0 },
        valueSuffix: "pts",
        hideDeltaWhenMissing: true,
        sub: gap.asof || "",
      }),
      tile({ label: "S&P500", value: spx.value, deltaPct: spx.change_pct, sub: spx.asof || "" }),
      tile({ label: "NYダウ", value: dow.value, deltaPct: dow.change_pct, sub: dow.asof || "" }),
      tile({ label: "ナスダック", value: nasdaq.value, deltaPct: nasdaq.change_pct, sub: nasdaq.asof || "" }),
    ].filter(Boolean);

    return tiles;
  }

  function parseMarketOverviewFromBullets(bullets) {
    const text = asArray(bullets).join(" ");
    const out = {};

    const num = (s) => {
      const n = Number(String(s || "").replaceAll(",", ""));
      return Number.isFinite(n) ? n : null;
    };

    const mNikkei =
      text.match(/日経平均\s*([0-9,]+(?:\.[0-9]+)?)\s*[（(]\s*([+\-]?[0-9.]+)%/) ||
      text.match(/日経平均\s*(?:\([^)]*\)\s*)?[:：]?\s*([0-9,]+(?:\.[0-9]+)?)\s*[（(]\s*([+\-]?[0-9.]+)%/);
    if (mNikkei) out.nikkei = { value: num(mNikkei[1]), change_pct: num(mNikkei[2]) };

    const mTopix = text.match(/TOPIX\s*([0-9,]+(?:\.[0-9]+)?)\s*（\s*([+\-]?[0-9.]+)%/i);
    if (mTopix) out.topix = { value: num(mTopix[1]), change_pct: num(mTopix[2]) };

    const mUsd =
      text.match(/ドル円\s*([0-9.]+)(?:\s*[（(]\s*([+\-]?[0-9.]+)%\s*[）)])?/) ||
      text.match(/USDJPY\s*[:：]?\s*([0-9.]+)(?:\s*[（(]\s*([+\-]?[0-9.]+)%\s*[）)])?/i) ||
      text.match(/米ドル\/円\s*([0-9.]+)(?:\s*[（(]\s*([+\-]?[0-9.]+)%\s*[）)])?/);
    if (mUsd) out.usd_jpy = { value: num(mUsd[1]), change_pct: num(mUsd[2]) };

    const mUs10y = text.match(/米10年\s*[:：]?\s*([0-9.]+)%/);
    if (mUs10y) out.us10y = { value: num(mUs10y[1]) };

    const mWti = text.match(/WTI\s*[:：]?\s*([0-9.]+)(?:\s*[（(]\s*([+\-]?[0-9.]+)%\s*[）)])?/i);
    if (mWti) out.wti = { value: num(mWti[1]), change_pct: num(mWti[2]) };

    const mFut =
      text.match(/日経225先物\s*[:：]?\s*([0-9,]+(?:\.[0-9]+)?)(?:\s*[（(][^)]*?([+\-]?[0-9.]+)%[^)]*[）)])?/) ||
      text.match(/先物\s*[:：]?\s*([0-9,]+(?:\.[0-9]+)?)(?:\s*[（(][^)]*?([+\-]?[0-9.]+)%[^)]*[）)])?/);
    if (mFut) out.nikkei_futures = { value: num(mFut[1]), change_pct: num(mFut[2]) };

    const mGap = text.match(/現物比\s*([+\-]?[0-9,]+)/);
    if (mGap) out.futures_gap = { value: num(mGap[1]) };

    const mSpx =
      text.match(/S&P\s*500\s*([0-9,]+(?:\.[0-9]+)?)\s*[（(]\s*([+\-]?[0-9.]+)%/i) ||
      text.match(/S&P\s*500\s*[（(]\s*([+\-]?[0-9.]+)%/i) ||
      text.match(/S&P500\s*[（(]\s*([+\-]?[0-9.]+)%/i) ||
      text.match(/S&P\s*([+\-]?[0-9.]+)%/i);
    if (mSpx) out.sp500 = { value: num(mSpx[2] ? mSpx[1] : null), change_pct: num(mSpx[2] ? mSpx[2] : mSpx[1]) };

    const mDow = text.match(/ダウ\s*([0-9,]+(?:\.[0-9]+)?)\s*（\s*([+\-]?[0-9.]+)%/);
    if (mDow) out.dow = { value: num(mDow[1]), change_pct: num(mDow[2]) };

    const mNas =
      text.match(/ナスダック\s*([0-9,]+(?:\.[0-9]+)?)\s*[（(]\s*([+\-]?[0-9.]+)%/) ||
      text.match(/Nasdaq\s*([0-9,]+(?:\.[0-9]+)?)\s*[（(]\s*([+\-]?[0-9.]+)%/i) ||
      text.match(/Nasdaq\s*[（(]\s*([+\-]?[0-9.]+)%/i);
    if (mNas) out.nasdaq = { value: num(mNas[2] ? mNas[1] : null), change_pct: num(mNas[2] ? mNas[2] : mNas[1]) };

    return out;
  }

  function renderTodayBrief(container, latest) {
    if (!latest) {
      container.innerHTML = `<div class="empty">まだブリーフがありません。</div>`;
      return;
    }
    const date = escapeHtml(latest.date || "");
    const headline = escapeHtml(latest.headline || "");
    const url = escapeHtml(latest.url || "");
    const synthesis = escapeHtml(latest.synthesis || "");

    const bullets = asArray(latest.summary_bullets)
      .map((t) => String(t || "").trim())
      .filter(Boolean);
    const bulletHtml =
      bullets.length > 0
        ? `<ul class="mini">${bullets.slice(0, 5).map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`
        : `<div class="empty">サマリーがありません。</div>`;

    const tickers = renderChipLinks(latest.tickers, (code) => `stocks/ticker.html?code=${encodeURIComponent(code)}`);
    const tags = renderChipLinks(latest.tags, (tag) => `tags/tag.html?tag=${encodeURIComponent(tag)}`);

    container.innerHTML = `<div class="row">
  <div class="headline">${date} — ${headline || "<span class=\"muted\">(headline未設定)</span>"}</div>
  <a class="go" href="${url}">本文</a>
</div>
${synthesis ? `<div class="synthesis">${synthesis}</div>` : ""}
${bulletHtml}
<div class="subhead">注目銘柄</div>
${tickers}
<div class="subhead">テーマ</div>
${tags}`;
  }

  function renderRecentBriefs(container, briefs) {
    const list = asArray(briefs);
    if (list.length === 0) {
      container.innerHTML = `<div class="empty">—</div>`;
      return;
    }
    container.innerHTML = `<div class="mini-list">${list
      .slice(0, 6)
      .map((b) => {
        const date = escapeHtml(b.date || "");
        const headline = escapeHtml(b.headline || "");
        const url = escapeHtml(b.url || "");
        return `<a class="mini-row" href="${url}">
  <div class="mini-date">${date}</div>
  <div class="mini-text">${headline}</div>
</a>`;
      })
      .join("")}</div>`;
  }

  function renderTagTrends(container, briefs) {
    const counts = new Map();
    for (const b of briefs) {
      for (const t of asArray(b.tags)) {
        const key = String(t || "").trim();
        if (!key) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    const top = Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, 20);
    if (top.length === 0) {
      container.innerHTML = `<div class="empty">—</div>`;
      return;
    }
    container.innerHTML = `<div class="chips">${top
      .map(
        (t) =>
          `<a class="chip chip-muted" href="tags/tag.html?tag=${encodeURIComponent(t.tag)}">${escapeHtml(
            t.tag,
          )}<span class="chip-count">${t.count}</span></a>`,
      )
      .join("")}</div>`;
  }

  function renderTdnetMini(container, json) {
    const items = Array.isArray(json?.items) ? json.items : [];
    if (items.length === 0) {
      container.innerHTML = `<div class="empty">データなし（GitHub Actionsが更新します）</div>`;
      return;
    }
    const list = items
      .slice()
      .sort((a, b) => String(b.datetime_jst || "").localeCompare(String(a.datetime_jst || "")))
      .slice(0, 8);
    container.innerHTML = `<div class="mini-list">${list
      .map((it) => {
        const dt = escapeHtml(String(it.datetime_jst || "").slice(0, 16).replace("T", " "));
        const code = escapeHtml(String(it.code || ""));
        const company = escapeHtml(String(it.company || ""));
        const title = escapeHtml(String(it.title_ja || it.title_en || it.title || ""));
        const pdfTdnet = escapeHtml(String(it.pdf_url_tdnet || it.pdf_url_ja || ""));
        const pdfKabutan = escapeHtml(String(it.pdf_url_kabutan || it.pdf_url_en || ""));
        const pdfPrimary = escapeHtml(String(pdfTdnet || pdfKabutan || it.pdf_url || ""));
        const points = asArray(it.points_ja).filter(Boolean).slice(0, 2);
        const pointsHtml =
          points.length > 0
            ? `<ul class="points compact">${points.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`
            : "";
        return `<div class="mini-card">
  <div class="row">
    <div class="date">${dt}</div>
    <div class="actions">
      ${pdfPrimary ? `<a class="go" href="${pdfPrimary}" target="_blank" rel="noreferrer">PDF</a>` : ""}
      ${
        pdfTdnet && pdfTdnet !== pdfPrimary
          ? `<a class="go" href="${pdfTdnet}" target="_blank" rel="noreferrer">公式</a>`
          : ""
      }
    </div>
  </div>
  <div class="tdnet-title">${code ? `<span class="code-pill">${code}</span> ` : ""}${company ? `${company} — ` : ""}${title}</div>
  ${pointsHtml}
  ${renderBadges(it.tags || [])}
</div>`;
      })
      .join("")}</div>`;
  }

  function groupWatchSnapshots(snapshots) {
    const map = new Map();
    for (const snap of asArray(snapshots)) {
      const dt = String(snap?.datetime_jst || "").trim();
      const phase = String(snap?.phase || "").trim();
      if (!dt || !phase) continue;
      const date = dt.slice(0, 10);
      const key = `${date}:${phase}`;
      const existing = map.get(key);
      if (!existing || String(existing.datetime_jst || "") < dt) map.set(key, snap);
    }
    return map;
  }

  function mapWatchItems(snapshot) {
    const m = new Map();
    const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
    for (const it of items) {
      const code = String(it?.code || "").trim();
      if (!code) continue;
      m.set(code, it);
    }
    return m;
  }

  function computeChange(price, prevClose) {
    const p = Number(price);
    const prev = Number(prevClose);
    if (!Number.isFinite(p) || !Number.isFinite(prev) || prev === 0) return null;
    return { delta: p - prev, pct: ((p - prev) / prev) * 100 };
  }

  function renderDeltaPill(change) {
    if (!change) return `<span class="delta flat">—</span>`;
    const cls = change.delta === 0 ? "flat" : change.delta > 0 ? "up" : "down";
    const sign = change.delta > 0 ? "+" : "";
    return `<span class="delta ${cls}">${sign}${fmtNum(change.delta, { maximumFractionDigits: 0 })} (${fmtPct(
      change.pct,
    )})</span>`;
  }

  function renderPctPill(pct) {
    const n = Number(pct);
    if (!Number.isFinite(n) || n === 0) return `<span class="delta flat">0.00%</span>`;
    const cls = n > 0 ? "up" : "down";
    return `<span class="delta ${cls}">${fmtPct(n)}</span>`;
  }

  function renderWatchlistMini(container, cfg, snapshots, opts) {
    const groups = asArray(cfg?.groups);
    const snaps = asArray(snapshots);
    if (!groups.length) {
      const setupHref = opts?.setupHref || "watchlist/manage.html";
      container.innerHTML = `<div class="empty">ウォッチが未設定です。<a href="${escapeHtml(setupHref)}">追加</a></div>`;
      return;
    }
    if (!snaps.length) {
      container.innerHTML = `<div class="empty">まだスナップショットがありません（GitHub Actionsが更新）</div>`;
      return;
    }

    const dates = Array.from(
      new Set(snaps.map((s) => String(s?.datetime_jst || "").slice(0, 10)).filter(Boolean)),
    ).sort((a, b) => b.localeCompare(a));
    const date = dates[0];
    const by = groupWatchSnapshots(snaps);
    const openSnap = by.get(`${date}:open`);
    const closeSnap = by.get(`${date}:close`);
    const openMap = mapWatchItems(openSnap);
    const closeMap = mapWatchItems(closeSnap);

    const stamp = closeSnap?.datetime_jst || openSnap?.datetime_jst || "";

    const label = opts?.label ? `<span class="badge">${escapeHtml(String(opts.label))}</span>` : "";
    const count = groups.reduce((sum, g) => sum + asArray(g?.tickers).length, 0);
    const head = `<div class="row" style="margin-top:2px">
  <div class="meta-line">${escapeHtml(date)}（${escapeHtml(stamp ? stamp.slice(11, 16) : "—")} JST）</div>
  <div class="muted" style="font-size:12px">${label}${label ? " " : ""}${count}銘柄</div>
</div>`;

    const sections = groups
      .map((g) => {
        const sector = escapeHtml(g.sector || "—");
        const tickers = asArray(g.tickers);
        const sectorPcts = [];
        const rows = tickers
          .slice(0, 8)
          .map((t) => {
            const code = String(t?.code || "").trim();
            if (!code) return "";
            const openItem = openMap.get(code);
            const closeItem = closeMap.get(code);
            const base = closeItem || openItem || {};
            const name = String(base.name || t.name || "").trim();

            const prev = base.prev_close;
            const last = closeItem?.close ?? openItem?.open ?? base.close ?? base.open;
            const vol = closeItem?.volume ?? openItem?.volume ?? base.volume;

            const ch = computeChange(last, prev);
            if (ch && Number.isFinite(Number(ch.pct))) sectorPcts.push(Number(ch.pct));
            const cls = ch ? deltaClass(ch.delta, ch.pct) : "flat";
            const rowClass = cls === "up" ? "is-up" : cls === "down" ? "is-down" : "";
            const lastHtml = Number.isFinite(Number(last)) ? fmtNum(last, { maximumFractionDigits: 0 }) : "—";
            const lastHtmlColored =
              cls === "up"
                ? `<span class="price up">${lastHtml}</span>`
                : cls === "down"
                  ? `<span class="price down">${lastHtml}</span>`
                  : lastHtml;
            const volHtml = Number.isFinite(Number(vol)) ? fmtNum(vol, { maximumFractionDigits: 0 }) : "—";
            const url = `https://kabutan.jp/stock/?code=${encodeURIComponent(code)}`;

            return `<div class="watch-mini-row${rowClass ? ` ${rowClass}` : ""}">
  <a class="watch-mini-code" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(code)}</a>
  <a class="watch-mini-name" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(name || "—")}</a>
  <div class="watch-mini-last">${lastHtmlColored}</div>
  <div class="watch-mini-delta">${renderDeltaPill(ch)}</div>
  <div class="watch-mini-vol">${volHtml}</div>
</div>`;
          })
          .filter(Boolean)
          .join("");
        if (!rows) return "";

        const avgPct = sectorPcts.length ? sectorPcts.reduce((a, b) => a + b, 0) / sectorPcts.length : null;
        const sectorPill = avgPct == null ? `<span class="delta flat">—</span>` : renderPctPill(avgPct);

        return `<div class="watch-mini">
  <div class="watch-mini-head"><span>${sector}</span>${sectorPill}</div>
  <div class="watch-mini-grid">
    <div class="watch-mini-row watch-mini-header">
      <div class="watch-mini-code">コード</div>
      <div class="watch-mini-name">銘柄</div>
      <div class="watch-mini-last">値</div>
      <div class="watch-mini-delta">前日比</div>
      <div class="watch-mini-vol">出来高</div>
    </div>
    ${rows}
  </div>
</div>`;
      })
      .filter(Boolean)
      .join("");

    container.innerHTML = head + (sections || `<div class="empty">—</div>`);
  }

  function collectMyWatchCodes(cfg) {
    const codes = [];
    const groups = asArray(cfg?.groups);
    for (const g of groups) {
      for (const t of asArray(g?.tickers)) {
        const code = String(t?.code || "").trim();
        if (code) codes.push(code);
      }
    }
    return Array.from(new Set(codes));
  }

  function buildVolumeHistory(snaps) {
    const byCode = new Map();
    for (const s of asArray(snaps)) {
      if (String(s?.phase || "") !== "close") continue;
      const items = asArray(s?.items);
      for (const it of items) {
        const code = String(it?.code || "").trim();
        const vol = Number(it?.volume);
        if (!code || !Number.isFinite(vol) || vol <= 0) continue;
        if (!byCode.has(code)) byCode.set(code, []);
        byCode.get(code).push(vol);
      }
    }
    for (const [code, vols] of byCode.entries()) {
      // keep latest 12 volumes
      byCode.set(code, vols.slice(-12));
    }
    return byCode;
  }

  function pickLatestWatchSnapshot(snaps, date) {
    const by = groupWatchSnapshots(snaps);
    const openSnap = by.get(`${date}:open`);
    const closeSnap = by.get(`${date}:close`);
    return { openSnap, closeSnap, by };
  }

  function renderWatchOverview(container, ctx) {
    if (!container) return;
    if (!ctx?.hasMy) {
      container.innerHTML = `<div class="empty">マイウォッチが未設定です。<a href="watchlist/manage.html">追加</a></div>`;
      return;
    }
    const { stamp, breadth, sectorAvgs } = ctx;
    if (!stamp) {
      container.innerHTML = `<div class="empty">まだスナップショットがありません（GitHub Actionsが更新）</div>`;
      return;
    }
    const { up, down, flat, avgPct, maxUp, maxDown } = breadth;
    const avgHtml = avgPct == null ? "—" : fmtPct(avgPct);
    const stampHtml = escapeHtml(stamp.slice(11, 16));

    const sectors = sectorAvgs
      .slice()
      .sort((a, b) => Math.abs(b.avgPct) - Math.abs(a.avgPct))
      .slice(0, 8);

    const sectorChips =
      sectors.length > 0
        ? `<div class="chips" style="margin-top:8px">${sectors
            .map((s) => {
              const cls = s.avgPct > 0 ? "tone-up" : s.avgPct < 0 ? "tone-down" : "tone-flat";
              return `<span class="chip chip-muted"><span style="font-weight:700">${escapeHtml(
                s.sector,
              )}</span> <span class="${cls}" style="font-variant-numeric:tabular-nums">${escapeHtml(
                fmtPct(s.avgPct),
              )}</span></span>`;
            })
            .join("")}</div>`
        : "";

    const fmtPick = (p) => {
      if (!p) return "—";
      const cls = p.pct > 0 ? "tone-up" : p.pct < 0 ? "tone-down" : "tone-flat";
      return `<span class="${cls}" style="font-variant-numeric:tabular-nums">${escapeHtml(
        fmtPct(p.pct),
      )}</span> <span class="muted" style="font-size:12px">${escapeHtml(p.name || p.code || "")}</span>`;
    };

    container.innerHTML = `<div class="watch-overview">
  <div class="watch-kpi"><span class="label">更新</span><span class="value">${stampHtml}</span></div>
  <div class="watch-kpi"><span class="label">上昇</span><span class="value tone-up">${up}</span></div>
  <div class="watch-kpi"><span class="label">下落</span><span class="value tone-down">${down}</span></div>
  <div class="watch-kpi"><span class="label">横ばい</span><span class="value">${flat}</span></div>
  <div class="watch-kpi"><span class="label">平均</span><span class="value">${avgHtml}</span></div>
  <div class="watch-kpi"><span class="label">最大↑</span><span class="value">${fmtPick(maxUp)}</span></div>
  <div class="watch-kpi"><span class="label">最大↓</span><span class="value">${fmtPick(maxDown)}</span></div>
</div>${sectorChips}`;
  }

  function renderWatchHighlights(container, ctx) {
    if (!container) return;
    if (!ctx?.hasMy) {
      container.innerHTML = "";
      return;
    }
    if (!ctx?.stamp) {
      container.innerHTML = "";
      return;
    }
    const { highlights, stamp } = ctx;
    const stampHtml = escapeHtml(stamp.slice(11, 16));
    if (!highlights) {
      container.innerHTML = "";
      return;
    }

    const renderList = (rows, fmt) => {
      const list = asArray(rows).slice(0, 5);
      if (!list.length) return `<div class="empty">—</div>`;
      return `<div class="hl-list">${list
        .map((r) => {
          const url = `https://kabutan.jp/stock/?code=${encodeURIComponent(r.code)}`;
          const metric = fmt(r);
          return `<div class="hl-row">
  <a class="hl-code" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(r.code)}</a>
  <a class="hl-name" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(r.name || "—")}</a>
  ${metric}
</div>`;
        })
        .join("")}</div>`;
    };

    const metricPct = (v) => {
      const n = Number(v);
      const cls = !Number.isFinite(n) || n === 0 ? "flat" : n > 0 ? "up" : "down";
      return `<div class="hl-metric ${cls}">${escapeHtml(fmtPct(n))}</div>`;
    };

    const metricRatio = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return `<div class="hl-metric">—</div>`;
      const cls = n >= 2 ? "up" : n >= 1.2 ? "flat" : "down";
      return `<div class="hl-metric ${cls}">${escapeHtml(fmtNum(n, { maximumFractionDigits: 2 }))}x</div>`;
    };

    const grid = `<div class="hl-grid">
  <div class="hl-card">
    <div class="hl-title">ギャップ% 上位</div>
    <div class="hl-sub">${stampHtml} 時点（寄り/最新スナップ）</div>
    ${renderList(highlights.gap, (r) => metricPct(r.gapPct))}
  </div>
  <div class="hl-card">
    <div class="hl-title">出来高 急増</div>
    <div class="hl-sub">${stampHtml} 時点（過去の終値出来高平均比）</div>
    ${renderList(highlights.vol, (r) => metricRatio(r.volRatio))}
  </div>
  <div class="hl-card">
    <div class="hl-title">前日比% 異常</div>
    <div class="hl-sub">${stampHtml} 時点（絶対値）</div>
    ${renderList(highlights.move, (r) => metricPct(r.changePct))}
  </div>
</div>`;

    container.innerHTML = `<div class="watch-highlights">${grid}</div>`;
  }

  async function main() {
    const kpi = document.querySelectorAll(".js-kpi");
    const quickLinks = $(".js-quicklinks");
    const qlEdit = $(".js-ql-edit");
    const qlSave = $(".js-ql-save");
    const qlCancel = $(".js-ql-cancel");
    const qlReset = $(".js-ql-reset");
    const today = $(".js-today");
    const recent = $(".js-recent");
    const trends = $(".js-tag-trends");
    const tdnetMini = $(".js-tdnet-mini");
    const watchMini = $(".js-watchlist-mini");
    const watchOverview = $(".js-watchlist-overview");
    const watchHighlights = $(".js-watchlist-highlights");
    const statsBrief = $(".js-stats-brief");
    const statsTdnet = $(".js-stats-tdnet");

    let briefs = [];
    try {
      const briefJson = await loadJson("data/briefs.json");
      briefs = Array.isArray(briefJson) ? briefJson : Array.isArray(briefJson.briefs) ? briefJson.briefs : [];
      briefs = briefs.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    } catch (e) {
      // ignore
    }

    const latest = briefs[0] || null;

    if (statsBrief) {
      statsBrief.textContent = latest?.date ? `最新ブリーフ: ${latest.date}` : "最新ブリーフ: —";
    }

    if (today) renderTodayBrief(today, latest);
    if (recent) renderRecentBriefs(recent, briefs);
    if (trends) renderTagTrends(trends, briefs);

    if (kpi && kpi.length) {
      const hasMo =
        latest &&
        latest.market_overview &&
        typeof latest.market_overview === "object" &&
        !Array.isArray(latest.market_overview) &&
        Object.keys(latest.market_overview).length > 0;
      const mo = hasMo ? latest.market_overview : parseMarketOverviewFromBullets(latest?.summary_bullets || []);
      const tiles = buildKpisFromMarketOverview(mo);
      const html = tiles.map((t) => renderTapeItem(t)).join("");
      kpi.forEach((el) => {
        if (!html) {
          el.innerHTML = `<div class="tape-set"><div class="tape-item"><span class="tape-label">マーケット:</span><span class="tape-value">—</span></div></div>`;
          return;
        }
        el.innerHTML = `<div class="tape-set">${html}</div><div class="tape-set" aria-hidden="true">${html}</div>`;
        window.requestAnimationFrame(() => {
          const set = el.querySelector(".tape-set");
          if (!set) return;
          const width = Math.max(set.scrollWidth || 0, set.getBoundingClientRect().width || 0);
          if (!Number.isFinite(width) || width <= 0) return;
          const pxPerSec = 78;
          const secs = Math.min(140, Math.max(24, width / pxPerSec));
          el.style.setProperty("--tape-duration", `${secs.toFixed(1)}s`);
          syncTopbarHeight();
        });
      });
    }

    if (quickLinks) {
      const loaded = await loadQuickLinks();
      let viewLinks = loaded.links;
      let editing = false;

      const setMode = (mode) => {
        editing = mode === "edit";
        if (qlEdit) qlEdit.style.display = editing ? "none" : "";
        if (qlSave) qlSave.style.display = editing ? "" : "none";
        if (qlCancel) qlCancel.style.display = editing ? "" : "none";
        if (qlReset) qlReset.style.display = editing ? "" : "none";

        if (editing) {
          renderQuickLinksEditor(quickLinks, viewLinks);
        } else {
          renderQuickLinksDisplay(quickLinks, viewLinks);
        }
      };

      const updateEditorHandlers = () => {
        if (!editing) return;
        quickLinks.querySelectorAll(".js-ql-del").forEach((btn) => {
          btn.addEventListener("click", () => {
            const idx = Number(btn.getAttribute("data-idx"));
            const cur = readQuickLinksEditor(quickLinks);
            if (Number.isFinite(idx) && idx >= 0) cur.splice(idx, 1);
            viewLinks = cur;
            renderQuickLinksEditor(quickLinks, viewLinks);
            updateEditorHandlers();
          });
        });
        const add = quickLinks.querySelector(".js-ql-add");
        if (add) {
          add.addEventListener("click", () => {
            const cur = readQuickLinksEditor(quickLinks);
            cur.push({ label: "", url: "" });
            viewLinks = cur;
            renderQuickLinksEditor(quickLinks, viewLinks);
            updateEditorHandlers();
          });
        }
      };

      setMode("view");

      if (qlEdit) {
        qlEdit.addEventListener("click", () => {
          setMode("edit");
          updateEditorHandlers();
        });
      }
      if (qlCancel) {
        qlCancel.addEventListener("click", () => {
          setMode("view");
        });
      }
      if (qlReset) {
        qlReset.addEventListener("click", async () => {
          clearQuickLinksLocalStorage();
          const reloaded = await loadQuickLinks();
          viewLinks = reloaded.links;
          setMode("view");
        });
      }
      if (qlSave) {
        qlSave.addEventListener("click", () => {
          const cur = normalizeQuickLinks(readQuickLinksEditor(quickLinks));
          viewLinks = cur;
          saveQuickLinksToLocalStorage(cur);
          setMode("view");
        });
      }
    }

    try {
      const tdnetJson = await loadJson("data/tdnet.json");
      if (statsTdnet) {
        statsTdnet.textContent = tdnetJson?.last_checked_jst ? `適時開示更新: ${tdnetJson.last_checked_jst}` : "適時開示更新: —";
      }
      if (tdnetMini) renderTdnetMini(tdnetMini, tdnetJson);
    } catch (e) {
      if (statsTdnet) statsTdnet.textContent = "適時開示更新: —";
      if (tdnetMini) tdnetMini.innerHTML = `<div class="empty">読み込みに失敗しました。</div>`;
    }

    if (watchMini || watchOverview || watchHighlights) {
      try {
        const wlSnap = await loadJson("data/watchlist_snapshots.json");
        const snaps = Array.isArray(wlSnap.snapshots) ? wlSnap.snapshots : [];
        const my = loadMyWatchlist();
        const hasMy = asArray(my?.groups).some((g) => asArray(g?.tickers).length > 0);
        const useCfg = hasMy ? my : { version: 1, groups: [] };

        if (watchMini) {
          renderWatchlistMini(watchMini, useCfg, snaps, {
            label: "マイウォッチ",
            setupHref: "watchlist/manage.html",
          });
        }

        const codes = collectMyWatchCodes(useCfg);
        const dates = Array.from(
          new Set(snaps.map((s) => String(s?.datetime_jst || "").slice(0, 10)).filter(Boolean)),
        ).sort((a, b) => b.localeCompare(a));
        const date = dates[0] || "";
        const { openSnap, closeSnap } = pickLatestWatchSnapshot(snaps, date);
        const stamp = closeSnap?.datetime_jst || openSnap?.datetime_jst || "";
        const openMap = mapWatchItems(openSnap);
        const closeMap = mapWatchItems(closeSnap);

        const volHist = buildVolumeHistory(snaps);

        const sectorMap = new Map();
        for (const g of asArray(useCfg?.groups)) {
          const sector = String(g?.sector || "").trim() || "—";
          for (const t of asArray(g?.tickers)) {
            const code = String(t?.code || "").trim();
            if (!code) continue;
            sectorMap.set(code, sector);
          }
        }

        const rows = codes
          .map((code) => {
            const openItem = openMap.get(code);
            const closeItem = closeMap.get(code);
            const base = closeItem || openItem || {};
            const name = String(base.name || "").trim();
            const prev = Number(base.prev_close);
            const openPrice = Number(openItem?.open ?? base.open);
            const lastPrice = Number(closeItem?.close ?? openItem?.open ?? base.close ?? base.open);
            const vol = Number(closeItem?.volume ?? openItem?.volume ?? base.volume);
            const gap = computeChange(openPrice, prev);
            const move = computeChange(lastPrice, prev);
            const vols = volHist.get(code) || [];
            const avgVol =
              vols.length > 0 ? vols.reduce((a, b) => a + b, 0) / Math.max(1, vols.length) : null;
            const volRatio = avgVol && Number.isFinite(vol) && vol > 0 ? vol / avgVol : null;
            const sector = sectorMap.get(code) || "—";
            return {
              code,
              name,
              sector,
              gapPct: gap?.pct ?? null,
              changePct: move?.pct ?? null,
              volRatio,
            };
          })
          .filter((r) => r.code);

        const breadth = (() => {
          let up = 0;
          let down = 0;
          let flat = 0;
          const pcts = [];
          let maxUp = null;
          let maxDown = null;
          for (const r of rows) {
            const pct = Number(r.changePct);
            if (!Number.isFinite(pct)) continue;
            pcts.push(pct);
            if (pct > 0) up += 1;
            else if (pct < 0) down += 1;
            else flat += 1;
            if (!maxUp || pct > maxUp.pct) maxUp = { code: r.code, name: r.name, pct };
            if (!maxDown || pct < maxDown.pct) maxDown = { code: r.code, name: r.name, pct };
          }
          const avgPct = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
          return { up, down, flat, avgPct, maxUp, maxDown };
        })();

        const sectorAvgs = (() => {
          const m = new Map();
          for (const r of rows) {
            const pct = Number(r.changePct);
            if (!Number.isFinite(pct)) continue;
            const sector = r.sector || "—";
            if (!m.has(sector)) m.set(sector, []);
            m.get(sector).push(pct);
          }
          return Array.from(m.entries()).map(([sector, pcts]) => ({
            sector,
            avgPct: pcts.reduce((a, b) => a + b, 0) / Math.max(1, pcts.length),
            count: pcts.length,
          }));
        })();

        const highlights = {
          gap: rows
            .filter((r) => Number.isFinite(Number(r.gapPct)))
            .slice()
            .sort((a, b) => Math.abs(Number(b.gapPct)) - Math.abs(Number(a.gapPct)))
            .slice(0, 5),
          vol: rows
            .filter((r) => Number.isFinite(Number(r.volRatio)))
            .slice()
            .sort((a, b) => Number(b.volRatio) - Number(a.volRatio))
            .slice(0, 5),
          move: rows
            .filter((r) => Number.isFinite(Number(r.changePct)))
            .slice()
            .sort((a, b) => Math.abs(Number(b.changePct)) - Math.abs(Number(a.changePct)))
            .slice(0, 5),
        };

        const ctx = {
          hasMy,
          stamp,
          breadth,
          sectorAvgs,
          highlights,
        };
        if (watchOverview) renderWatchOverview(watchOverview, ctx);
        if (watchHighlights) renderWatchHighlights(watchHighlights, ctx);
      } catch (e) {
        if (watchMini) watchMini.innerHTML = `<div class="empty">読み込みに失敗しました。</div>`;
        if (watchOverview) watchOverview.innerHTML = `<div class="empty">読み込みに失敗しました。</div>`;
        if (watchHighlights) watchHighlights.innerHTML = "";
      }
    }

    syncTopbarHeight();
    window.addEventListener("resize", () => syncTopbarHeight());
  }

  window.addEventListener("DOMContentLoaded", () => {
    void main();
  });
})();
