(function () {
  const BASE_HREF = "../";
  const MY_WATCH_KEY = "mmb_my_watchlist_v1";
  const NOTES_KEY = "mmb_review_notes_v1";
  const LINKS_KEY = "mmb_my_quicklinks_v1";

  const GAP_ALERT_PCT = 2.0;
  const OPEN_VOL_ALERT_RATIO = 0.15;
  const CLOSE_VOL_ALERT_RATIO = 1.8;
  const ALERT_TOP_N = 5;
  const CLOSE_VOL_HISTORY_DAYS = 20;

  const DEFAULT_LINKS = [
    { label: "PTS夜間 上昇率ランキング", url: "https://kabutan.jp/warning/pts_night_price_increase" },
    { label: "PTS夜間 出来高ランキング", url: "https://kabutan.jp/warning/pts_night_volume_ranking" },
    { label: "会社開示（株探）", url: "https://kabutan.jp/disclosures/" },
    { label: "TDnet（公式）", url: "https://www.release.tdnet.info/inbs/I_main_00.html" },
  ];

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

  function fmt(value, opts) {
    const n = num(value);
    if (n == null) return "—";
    return new Intl.NumberFormat("ja-JP", opts || { maximumFractionDigits: 2 }).format(n);
  }

  function fmtPct(value) {
    const n = num(value);
    if (n == null) return "—";
    const sign = n > 0 ? "+" : "";
    return `${sign}${fmt(n, { maximumFractionDigits: 2 })}%`;
  }

  async function loadJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return res.json();
  }

  function jstToday() {
    try {
      return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function groupSnapshotsByDate(snapshots) {
    const map = new Map();
    for (const snap of asArray(snapshots)) {
      const dt = normalizeText(snap?.datetime_jst);
      const phase = normalizeText(snap?.phase);
      if (!dt || !phase) continue;
      const date = dt.slice(0, 10);
      if (!date) continue;
      const key = `${date}:${phase}`;
      const existing = map.get(key);
      if (!existing || String(existing.datetime_jst || "") < dt) map.set(key, snap);
    }
    return map;
  }

  function mapItems(snapshot) {
    const m = new Map();
    for (const it of asArray(snapshot?.items)) {
      const code = normalizeText(it?.code);
      if (!code) continue;
      m.set(code, it);
    }
    return m;
  }

  function renderBadges(tags) {
    const list = asArray(tags).map((t) => normalizeText(t)).filter(Boolean);
    if (!list.length) return "";
    return `<div class="badges">${list
      .slice(0, 12)
      .map((t) => `<span class="badge">${escapeHtml(t)}</span>`)
      .join("")}</div>`;
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

    const tickers = asArray(latest.tickers).filter(Boolean).slice(0, 16);
    const tags = asArray(latest.tags).filter(Boolean).slice(0, 16);

    const tickersHtml =
      tickers.length > 0
        ? `<div class="chips">${tickers
            .map(
              (code) =>
                `<a class="chip" href="${BASE_HREF}stocks/ticker.html?code=${encodeURIComponent(String(code))}">${escapeHtml(
                  String(code),
                )}</a>`,
            )
            .join("")}</div>`
        : `<div class="empty">—</div>`;

    const tagsHtml =
      tags.length > 0
        ? `<div class="chips">${tags
            .map(
              (tag) =>
                `<a class="chip chip-muted" href="${BASE_HREF}tags/tag.html?tag=${encodeURIComponent(String(tag))}">${escapeHtml(
                  String(tag),
                )}</a>`,
            )
            .join("")}</div>`
        : `<div class="empty">—</div>`;

    container.innerHTML = `<div class="row">
  <div class="headline">${date} — ${headline || "<span class=\"muted\">(headline未設定)</span>"}</div>
  <a class="go" href="${BASE_HREF}${url}">本文</a>
</div>
${synthesis ? `<div class="synthesis">${synthesis}</div>` : ""}
${bulletHtml}
<div class="subhead">注目銘柄</div>
${tickersHtml}
<div class="subhead">テーマ</div>
${tagsHtml}`;
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
      ${
        pdfKabutan && pdfKabutan !== pdfPrimary
          ? `<a class="go" href="${pdfKabutan}" target="_blank" rel="noreferrer">ミラー</a>`
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

  function computeChangePct(price, prevClose) {
    const p = num(price);
    const prev = num(prevClose);
    if (p == null || prev == null || prev === 0) return null;
    return ((p - prev) / prev) * 100;
  }

  function iterSnapshots(snapshots) {
    return asArray(snapshots)
      .filter((s) => s && typeof s === "object")
      .slice()
      .sort((a, b) => String(b.datetime_jst || "").localeCompare(String(a.datetime_jst || "")));
  }

  function findPrevCloseSnapshot(snapshots, currentDate) {
    for (const s of iterSnapshots(snapshots)) {
      const phase = normalizeText(s.phase);
      if (phase !== "close") continue;
      const dt = normalizeText(s.datetime_jst);
      if (!dt) continue;
      const day = dt.slice(0, 10);
      if (day && day < currentDate) return s;
    }
    return null;
  }

  function median(values) {
    const xs = asArray(values).map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    if (!xs.length) return null;
    const mid = Math.floor(xs.length / 2);
    if (xs.length % 2 === 1) return xs[mid];
    return (xs[mid - 1] + xs[mid]) / 2;
  }

  function buildCloseVolumeHistory(snapshots, codes, currentDate, maxDays) {
    const hist = new Map();
    for (const c of codes) hist.set(c, []);
    for (const s of iterSnapshots(snapshots)) {
      const phase = normalizeText(s.phase);
      if (phase !== "close") continue;
      const dt = normalizeText(s.datetime_jst);
      if (!dt) continue;
      const day = dt.slice(0, 10);
      if (!day || day >= currentDate) continue;

      for (const it of asArray(s.items)) {
        const code = normalizeText(it?.code);
        if (!code || !hist.has(code)) continue;
        const arr = hist.get(code);
        if (arr.length >= maxDays) continue;
        const vol = num(it?.volume);
        if (vol == null || vol <= 0) continue;
        arr.push(vol);
      }
    }
    return hist;
  }

  function renderAlerts(container, snapshots, date) {
    if (!container) return;
    const by = groupSnapshotsByDate(snapshots);
    const openSnap = by.get(`${date}:open`);
    const closeSnap = by.get(`${date}:close`);
    const openMap = mapItems(openSnap);
    const closeMap = mapItems(closeSnap);
    const codes = new Set([...openMap.keys(), ...closeMap.keys()]);
    if (!codes.size) {
      container.innerHTML = `<div class="empty">スナップショットがありません。</div>`;
      return;
    }

    const prevCloseSnap = findPrevCloseSnapshot(snapshots, date);
    const prevVol = new Map();
    for (const it of asArray(prevCloseSnap?.items)) {
      const code = normalizeText(it?.code);
      if (!code || !codes.has(code)) continue;
      const v = num(it?.volume);
      if (v == null || v <= 0) continue;
      prevVol.set(code, v);
    }
    const closeHist = buildCloseVolumeHistory(snapshots, codes, date, CLOSE_VOL_HISTORY_DAYS);

    const gapAlerts = [];
    if (openSnap) {
      for (const code of openMap.keys()) {
        const it = openMap.get(code) || {};
        const prev = num(it.prev_close);
        const open = num(it.open);
        if (prev == null || open == null || prev === 0) continue;
        const pct = computeChangePct(open, prev);
        if (pct == null) continue;
        if (Math.abs(pct) < GAP_ALERT_PCT) continue;
        const name = normalizeText(it.name || "");
        const url = normalizeText(it.source_url || `https://kabutan.jp/stock/?code=${encodeURIComponent(code)}`);
        gapAlerts.push({ abs: Math.abs(pct), code, name, pct, open, prev, url });
      }
    }
    gapAlerts.sort((a, b) => b.abs - a.abs);

    const volPhase = closeSnap ? "close" : "open";
    const volThreshold = volPhase === "close" ? CLOSE_VOL_ALERT_RATIO : OPEN_VOL_ALERT_RATIO;
    const volMap = volPhase === "close" ? closeMap : openMap;
    const volAlerts = [];
    for (const code of volMap.keys()) {
      const it = volMap.get(code) || {};
      const vol = num(it.volume);
      if (vol == null || vol <= 0) continue;
      let base = null;
      if (volPhase === "close") {
        const med = median(closeHist.get(code) || []);
        base = med != null && med > 0 ? med : prevVol.get(code);
      } else {
        base = prevVol.get(code);
      }
      if (base == null || base <= 0) continue;
      const ratio = vol / base;
      if (!Number.isFinite(ratio) || ratio < volThreshold) continue;
      const name = normalizeText(it.name || "");
      const url = normalizeText(it.source_url || `https://kabutan.jp/stock/?code=${encodeURIComponent(code)}`);
      volAlerts.push({ ratio, code, name, vol, base, url });
    }
    volAlerts.sort((a, b) => b.ratio - a.ratio);

    const gapHtml =
      gapAlerts.length > 0
        ? `<ul class="points compact">${gapAlerts
            .slice(0, ALERT_TOP_N)
            .map(
              (a) =>
                `<li><a href="${escapeHtml(a.url)}" target="_blank" rel="noreferrer">${escapeHtml(
                  `${a.code} ${a.name}`.trim() || a.code,
                )}</a> ${escapeHtml(fmtPct(a.pct))}（寄り ${escapeHtml(fmt(a.open, { maximumFractionDigits: 0 }))}）</li>`,
            )
            .join("")}</ul>`
        : `<div class="empty">なし（|%| ≥ ${escapeHtml(GAP_ALERT_PCT.toFixed(0))}%）</div>`;

    const volLabel =
      volPhase === "close"
        ? `平常比 ≥ ${CLOSE_VOL_ALERT_RATIO.toFixed(1)}x`
        : `前日比 ≥ ${Math.round(OPEN_VOL_ALERT_RATIO * 100)}%`;
    const volHtml =
      volAlerts.length > 0
        ? `<ul class="points compact">${volAlerts
            .slice(0, ALERT_TOP_N)
            .map(
              (a) =>
                `<li><a href="${escapeHtml(a.url)}" target="_blank" rel="noreferrer">${escapeHtml(
                  `${a.code} ${a.name}`.trim() || a.code,
                )}</a> ${escapeHtml(fmt(a.vol, { maximumFractionDigits: 0 }))}（${escapeHtml(
                  fmt(a.ratio, { maximumFractionDigits: 2 }),
                )}x）</li>`,
            )
            .join("")}</ul>`
        : `<div class="empty">なし（${escapeHtml(volLabel)}）</div>`;

    const openTime = openSnap?.datetime_jst ? openSnap.datetime_jst.slice(11, 16) : "—";
    const volTime =
      volPhase === "close"
        ? closeSnap?.datetime_jst
          ? closeSnap.datetime_jst.slice(11, 16)
          : "—"
        : openTime;

    container.innerHTML = `<div class="metric-grid">
  <div class="mini-card">
    <div class="row"><div class="metric-title">ギャップ</div><div class="date">${escapeHtml(openTime)} JST</div></div>
    <div class="meta-line">条件: |%| ≥ ${escapeHtml(GAP_ALERT_PCT.toFixed(0))}%</div>
    ${gapHtml}
  </div>
  <div class="mini-card">
    <div class="row"><div class="metric-title">出来高急増</div><div class="date">${escapeHtml(volTime)} JST</div></div>
    <div class="meta-line">条件: ${escapeHtml(volLabel)}</div>
    ${volHtml}
  </div>
</div>`;
  }

  function renderWatchlistMini(container, cfg, snapshots) {
    const groups = asArray(cfg?.groups);
    const snaps = asArray(snapshots);
    if (!groups.length) {
      container.innerHTML = `<div class="empty">watchlist.json が未設定です。</div>`;
      return { date: null };
    }
    if (!snaps.length) {
      container.innerHTML = `<div class="empty">まだスナップショットがありません（GitHub Actionsが更新）</div>`;
      return { date: null };
    }

    const dates = Array.from(
      new Set(snaps.map((s) => String(s?.datetime_jst || "").slice(0, 10)).filter(Boolean)),
    ).sort((a, b) => b.localeCompare(a));
    const date = dates[0];
    const by = groupSnapshotsByDate(snaps);
    const openSnap = by.get(`${date}:open`);
    const closeSnap = by.get(`${date}:close`);
    const openMap = mapItems(openSnap);
    const closeMap = mapItems(closeSnap);
    const stamp = closeSnap?.datetime_jst || openSnap?.datetime_jst || "";

    const head = `<div class="meta-line">${escapeHtml(date)}（${escapeHtml(
      stamp ? stamp.slice(11, 16) : "—",
    )} JST）</div>`;

    const sections = groups
      .map((g) => {
        const sector = escapeHtml(g.sector || "—");
        const tickers = asArray(g.tickers);
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

            const pct = computeChangePct(last, prev);
            const cls = pct == null || pct === 0 ? "flat" : pct > 0 ? "up" : "down";
            const rowClass = cls === "up" ? "is-up" : cls === "down" ? "is-down" : "";
            const lastHtml = num(last) != null ? fmt(last, { maximumFractionDigits: 0 }) : "—";
            const lastHtmlColored =
              cls === "up"
                ? `<span class="price up">${lastHtml}</span>`
                : cls === "down"
                  ? `<span class="price down">${lastHtml}</span>`
                  : lastHtml;
            const volHtml = num(vol) != null ? fmt(vol, { maximumFractionDigits: 0 }) : "—";
            const url = `https://kabutan.jp/stock/?code=${encodeURIComponent(code)}`;

            return `<div class="watch-mini-row${rowClass ? ` ${rowClass}` : ""}">
  <a class="watch-mini-code" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(code)}</a>
  <a class="watch-mini-name" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(name || "—")}</a>
  <div class="watch-mini-last">${lastHtmlColored}</div>
  <div class="watch-mini-delta">${pct == null ? `<span class="delta flat">—</span>` : `<span class="delta ${cls}">${escapeHtml(fmtPct(pct))}</span>`}</div>
  <div class="watch-mini-vol">${escapeHtml(volHtml)}</div>
</div>`;
          })
          .filter(Boolean)
          .join("");
        if (!rows) return "";

        return `<div class="watch-mini">
  <div class="watch-mini-head"><span>${sector}</span></div>
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
    return { date };
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

  function flattenMyWatch(groups) {
    const out = [];
    for (const g of asArray(groups)) {
      const sector = normalizeText(g?.sector) || "未分類";
      for (const t of asArray(g?.tickers)) {
        const code = normalizeText(t?.code);
        if (!code) continue;
        out.push({
          code,
          name: normalizeText(t?.name),
          sector,
        });
      }
    }
    return out;
  }

  function renderMyWatch(container, statusEl, query) {
    const data = loadMyWatchlist();
    const list = flattenMyWatch(data.groups);
    const q = normalizeQuery(query);
    const filtered = q
      ? list.filter((it) => `${it.code} ${it.name} ${it.sector}`.toLowerCase().includes(q))
      : list;

    if (statusEl) statusEl.textContent = `${filtered.length} / ${list.length} 件`;
    if (!filtered.length) {
      container.innerHTML = `<div class="empty">マイウォッチが空です（manageで追加）。</div>`;
      return;
    }

    const bySector = new Map();
    for (const it of filtered) {
      if (!bySector.has(it.sector)) bySector.set(it.sector, []);
      bySector.get(it.sector).push(it);
    }
    const sectors = Array.from(bySector.keys()).sort((a, b) => a.localeCompare(b));

    container.innerHTML = sectors
      .map((sector) => {
        const items = bySector.get(sector) || [];
        const rows = items
          .slice()
          .sort((a, b) => a.code.localeCompare(b.code))
          .slice(0, 60)
          .map((it) => {
            const url = `https://kabutan.jp/stock/?code=${encodeURIComponent(it.code)}`;
            return `<a class="mini-row" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">
  <div class="mini-date">${escapeHtml(it.code)}</div>
  <div class="mini-text">${escapeHtml(it.name || "—")}</div>
</a>`;
          })
          .join("");
        return `<div class="watch-sector">
  <div class="watch-sector-head"><span>${escapeHtml(sector)}</span><div class="watch-sector-meta"><span class="watch-sector-count">${items.length}銘柄</span></div></div>
  <div class="mini-list" style="margin-top:10px">${rows}</div>
</div>`;
      })
      .join("");
  }

  function loadNotes() {
    try {
      const raw = localStorage.getItem(NOTES_KEY);
      if (!raw) return { version: 1, notes: {} };
      const json = JSON.parse(raw);
      const notes = json?.notes && typeof json.notes === "object" ? json.notes : {};
      return { version: 1, notes };
    } catch (e) {
      return { version: 1, notes: {} };
    }
  }

  function saveNotes(notes) {
    localStorage.setItem(NOTES_KEY, JSON.stringify({ version: 1, notes }));
  }

  function loadLinks() {
    try {
      const raw = localStorage.getItem(LINKS_KEY);
      if (!raw) return DEFAULT_LINKS.slice();
      const json = JSON.parse(raw);
      const links = asArray(json?.links).map((l) => ({
        label: normalizeText(l?.label),
        url: normalizeText(l?.url),
      }));
      const cleaned = links.filter((l) => l.label && l.url);
      return cleaned.length ? cleaned : DEFAULT_LINKS.slice();
    } catch (e) {
      return DEFAULT_LINKS.slice();
    }
  }

  function saveLinks(links) {
    localStorage.setItem(LINKS_KEY, JSON.stringify({ version: 1, links: asArray(links) }));
  }

  function renderLinks(container, statusEl, links) {
    if (!container) return;
    const list = asArray(links).filter((l) => normalizeText(l?.label) && normalizeText(l?.url));
    if (statusEl) statusEl.textContent = `${list.length} 件`;
    if (!list.length) {
      container.innerHTML = `<div class="empty">—</div>`;
      return;
    }
    container.innerHTML = `<div class="mini-list">${list
      .slice(0, 30)
      .map(
        (l, idx) => `<div class="mini-row" style="grid-template-columns:1fr auto">
  <a class="quick-btn" href="${escapeHtml(l.url)}" target="_blank" rel="noreferrer">${escapeHtml(l.label)}</a>
  <button class="go js-link-del" type="button" data-idx="${idx}">削除</button>
</div>`,
      )
      .join("")}</div>`;
    container.querySelectorAll("button.js-link-del").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-idx"));
        if (!Number.isFinite(idx)) return;
        const next = list.slice().filter((_, i) => i !== idx);
        saveLinks(next);
        renderLinks(container, statusEl, next);
      });
    });
  }

  async function main() {
    const root = document.documentElement;
    const briefsPath = root.getAttribute("data-briefs-json") || "../data/briefs.json";
    const tdnetPath = root.getAttribute("data-tdnet-json") || "../data/tdnet.json";
    const wlCfgPath = root.getAttribute("data-watchlist-config") || "../data/watchlist.json";
    const wlSnapPath = root.getAttribute("data-watchlist-snapshots") || "../data/watchlist_snapshots.json";

    const todayEl = $(".js-today");
    const tdnetMini = $(".js-tdnet-mini");
    const watchMini = $(".js-watchlist-mini");
    const alerts = $(".js-alerts");

    const memo = $(".js-memo");
    const memoStatus = $(".js-memo-status");
    const memoCopy = $(".js-memo-copy");
    const memoClear = $(".js-memo-clear");

    const myWatch = $(".js-my-watch");
    const mySearch = $(".js-my-search");
    const myStatus = $(".js-my-status");

    const linksEl = $(".js-links");
    const linkLabel = $(".js-link-label");
    const linkUrl = $(".js-link-url");
    const linkAdd = $(".js-link-add");
    const linkReset = $(".js-link-reset");
    const linksStatus = $(".js-links-status");

    // Brief
    try {
      const briefJson = await loadJson(briefsPath);
      let briefs = Array.isArray(briefJson) ? briefJson : Array.isArray(briefJson?.briefs) ? briefJson.briefs : [];
      briefs = briefs.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      renderTodayBrief(todayEl, briefs[0] || null);
    } catch (e) {
      if (todayEl) todayEl.innerHTML = `<div class="empty">読み込みに失敗しました。</div>`;
    }

    // TDnet
    try {
      const tdnetJson = await loadJson(tdnetPath);
      if (tdnetMini) renderTdnetMini(tdnetMini, tdnetJson);
    } catch (e) {
      if (tdnetMini) tdnetMini.innerHTML = `<div class="empty">読み込みに失敗しました。</div>`;
    }

    // Watchlist + alerts
    let snaps = [];
    try {
      const wlCfg = await loadJson(wlCfgPath);
      const wlSnap = await loadJson(wlSnapPath);
      snaps = Array.isArray(wlSnap?.snapshots) ? wlSnap.snapshots : [];
      const { date } = watchMini ? renderWatchlistMini(watchMini, wlCfg, snaps) : { date: null };
      if (alerts) {
        const latestDate =
          date ||
          Array.from(new Set(snaps.map((s) => String(s?.datetime_jst || "").slice(0, 10)).filter(Boolean))).sort((a, b) =>
            b.localeCompare(a),
          )[0];
        if (latestDate) renderAlerts(alerts, snaps, latestDate);
        else alerts.innerHTML = `<div class="empty">スナップショットがありません。</div>`;
      }
    } catch (e) {
      if (watchMini) watchMini.innerHTML = `<div class="empty">読み込みに失敗しました。</div>`;
      if (alerts) alerts.innerHTML = `<div class="empty">読み込みに失敗しました。</div>`;
    }

    // My watch
    if (myWatch) {
      const rerender = () => renderMyWatch(myWatch, myStatus, mySearch?.value || "");
      if (mySearch) mySearch.addEventListener("input", rerender);
      rerender();
    }

    // Memo (today)
    const today = jstToday();
    const notes = loadNotes();
    if (memo) memo.value = normalizeText(notes.notes?.[today] || "");
    const updateMemoStatus = (label) => {
      if (memoStatus) memoStatus.textContent = label || "";
    };
    const saveMemo = () => {
      const next = loadNotes();
      const text = normalizeText(memo?.value || "");
      next.notes[today] = text;
      saveNotes(next.notes);
      const now = new Date();
      updateMemoStatus(`保存: ${now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`);
    };
    let memoTimer = null;
    if (memo) {
      memo.addEventListener("input", () => {
        if (memoTimer) window.clearTimeout(memoTimer);
        memoTimer = window.setTimeout(saveMemo, 350);
      });
    }
    if (memoCopy) {
      memoCopy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(String(memo?.value || ""));
          updateMemoStatus("コピーしました");
        } catch (e) {
          updateMemoStatus("コピーに失敗しました");
        }
      });
    }
    if (memoClear) {
      memoClear.addEventListener("click", () => {
        if (!memo) return;
        memo.value = "";
        saveMemo();
      });
    }

    // Quick links
    const links = loadLinks();
    renderLinks(linksEl, linksStatus, links);
    if (linkAdd) {
      linkAdd.addEventListener("click", () => {
        const label = normalizeText(linkLabel?.value || "");
        const url = normalizeText(linkUrl?.value || "");
        if (!label || !url) {
          if (linksStatus) linksStatus.textContent = "ラベルとURLを入力してください。";
          return;
        }
        const next = loadLinks();
        next.unshift({ label, url });
        saveLinks(next);
        if (linkLabel) linkLabel.value = "";
        if (linkUrl) linkUrl.value = "";
        renderLinks(linksEl, linksStatus, next);
      });
    }
    if (linkReset) {
      linkReset.addEventListener("click", () => {
        saveLinks(DEFAULT_LINKS);
        renderLinks(linksEl, linksStatus, DEFAULT_LINKS);
      });
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    void main();
  });
})();
