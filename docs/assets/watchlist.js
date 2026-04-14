(function () {
  const MY_WATCH_KEY = "mmb_my_watchlist_v1";
  const GAP_ALERT_PCT = 2.0;
  const OPEN_VOL_ALERT_RATIO = 0.15;
  const CLOSE_VOL_ALERT_RATIO = 1.8;
  const ALERT_TOP_N = 5;
  const CLOSE_VOL_HISTORY_DAYS = 20;

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

  function fmt(n, opts) {
    const v = num(n);
    if (v == null) return "—";
    return new Intl.NumberFormat("ja-JP", opts || { maximumFractionDigits: 2 }).format(v);
  }

  function fmtPct(n) {
    const v = num(n);
    if (v == null) return "—";
    const sign = v > 0 ? "+" : "";
    return `${sign}${fmt(v, { maximumFractionDigits: 2 })}%`;
  }

  function deltaClass(delta) {
    const v = num(delta);
    if (v == null || v === 0) return "flat";
    return v > 0 ? "up" : "down";
  }

  function computeChange(price, prevClose) {
    const p = num(price);
    const prev = num(prevClose);
    if (p == null || prev == null) return null;
    return p - prev;
  }

  function computeChangePct(price, prevClose) {
    const p = num(price);
    const prev = num(prevClose);
    if (p == null || prev == null || prev === 0) return null;
    return ((p - prev) / prev) * 100;
  }

  function median(values) {
    const xs = asArray(values).map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    if (!xs.length) return null;
    const mid = Math.floor(xs.length / 2);
    if (xs.length % 2 === 1) return xs[mid];
    return (xs[mid - 1] + xs[mid]) / 2;
  }

  async function loadJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return res.json();
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

      const items = asArray(s.items);
      for (const it of items) {
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

  function buildMetaByCode(cfg) {
    const map = new Map();
    for (const g of asArray(cfg?.groups)) {
      const sector = normalizeText(g?.sector);
      for (const t of asArray(g?.tickers)) {
        const code = normalizeText(t?.code);
        if (!code || map.has(code)) continue;
        map.set(code, {
          code,
          sector,
          name: normalizeText(t?.name),
          name_en: normalizeText(t?.name_en),
        });
      }
    }
    return map;
  }

  function codesFromCfg(cfg) {
    const set = new Set();
    for (const g of asArray(cfg?.groups)) {
      for (const t of asArray(g?.tickers)) {
        const code = normalizeText(t?.code);
        if (code) set.add(code);
      }
    }
    return set;
  }

  function groupSnapshotsByDate(snapshots) {
    const map = new Map();
    for (const snap of asArray(snapshots)) {
      const dt = normalizeText(snap.datetime_jst);
      const phase = normalizeText(snap.phase);
      if (!dt || !phase) continue;
      const date = dt.slice(0, 10);
      if (!date) continue;
      const key = `${date}:${phase}`;
      const existing = map.get(key);
      if (!existing || String(existing.datetime_jst || "") < dt) {
        map.set(key, snap);
      }
    }
    return map;
  }

  function uniqueDatesFromSnapshots(snapshots) {
    const set = new Set();
    for (const snap of asArray(snapshots)) {
      const dt = normalizeText(snap.datetime_jst);
      if (!dt) continue;
      set.add(dt.slice(0, 10));
    }
    return Array.from(set).filter(Boolean).sort((a, b) => b.localeCompare(a));
  }

  function mapItems(snapshot) {
    const m = new Map();
    const items = asArray(snapshot?.items);
    for (const it of items) {
      const code = normalizeText(it?.code);
      if (!code) continue;
      m.set(code, it);
    }
    return m;
  }

  function renderDelta(price, prevClose) {
    const d = computeChange(price, prevClose);
    const p = computeChangePct(price, prevClose);
    const cls = deltaClass(d);
    if (d == null || p == null) return `<span class="delta flat">—</span>`;
    const sign = d > 0 ? "+" : "";
    return `<span class="delta ${cls}">${sign}${fmt(d, { maximumFractionDigits: 0 })} (${fmtPct(p)})</span>`;
  }

  function renderPctPill(pct) {
    const v = num(pct);
    if (v == null || v === 0) return `<span class="delta flat">0.00%</span>`;
    const cls = deltaClass(v);
    return `<span class="delta ${cls}">${fmtPct(v)}</span>`;
  }

  function resolvePhase(view, openSnap, closeSnap) {
    const v = normalizeText(view || "latest");
    if (v === "both") return "both";
    if (v === "open") return "open";
    if (v === "close") return "close";
    return closeSnap ? "close" : "open";
  }

  function phaseLabel(phase) {
    if (phase === "close") return "引け";
    if (phase === "open") return "寄り";
    return "—";
  }

  function renderSector(group, openMap, closeMap, showEnglish, query, phase) {
    const sector = escapeHtml(group.sector || "—");
    const tickers = asArray(group.tickers);
    const sectorPcts = [];
    const counts = { up: 0, down: 0, flat: 0 };
    const rows = tickers
      .map((t) => {
        const code = normalizeText(t.code);
        if (!code) return "";
        const openItem = openMap.get(code);
        const closeItem = closeMap.get(code);
        const base = closeItem || openItem || {};

        const nameJa = normalizeText(base.name || t.name || "");
        const nameEn = normalizeText(base.name_en || t.name_en || "");
        const name = showEnglish
          ? nameEn || nameJa
          : nameJa;

        const hay = `${code} ${nameJa} ${nameEn}`.toLowerCase();
        if (query && !hay.includes(query)) return "";
        const sourceUrl = normalizeText(base.source_url || `https://kabutan.jp/stock/?code=${encodeURIComponent(code)}`);

        const prevClose = base.prev_close;
        const open = openItem?.open ?? base.open;
        const close = closeItem?.close ?? base.close;
        const vol = closeItem?.volume ?? openItem?.volume ?? base.volume;

        const openDelta = computeChange(open, prevClose);
        const closeDelta = computeChange(close, prevClose);
        const singlePhase = phase && phase !== "both" ? phase : null;
        const rowDelta = singlePhase === "open" ? openDelta : singlePhase === "close" ? closeDelta : closeDelta ?? openDelta;
        const rowCls = deltaClass(rowDelta);
        const rowClass = rowCls === "up" ? "is-up" : rowCls === "down" ? "is-down" : "";

        const openPct = computeChangePct(open, prevClose);
        const closePct = computeChangePct(close, prevClose);
        const refPct =
          singlePhase === "open"
            ? openPct
            : singlePhase === "close"
              ? closePct
              : closePct ?? openPct;
        if (refPct != null) sectorPcts.push(refPct);

        const openCls = deltaClass(openDelta);
        const closeCls = deltaClass(closeDelta);
        const openHtmlRaw = open != null ? fmt(open, { maximumFractionDigits: 0 }) : "—";
        const closeHtmlRaw = close != null ? fmt(close, { maximumFractionDigits: 0 }) : "—";
        const openHtml =
          openCls === "up"
            ? `<span class="price up">${openHtmlRaw}</span>`
            : openCls === "down"
              ? `<span class="price down">${openHtmlRaw}</span>`
              : openHtmlRaw;
        const closeHtml =
          closeCls === "up"
            ? `<span class="price up">${closeHtmlRaw}</span>`
            : closeCls === "down"
              ? `<span class="price down">${closeHtmlRaw}</span>`
              : closeHtmlRaw;
        const volHtml = vol != null ? `${fmt(vol, { maximumFractionDigits: 0 })}` : "—";

        const dirCls = deltaClass(rowDelta);
        if (dirCls === "up") counts.up += 1;
        else if (dirCls === "down") counts.down += 1;
        else counts.flat += 1;

        const nameHtml = escapeHtml(name || "—");
        const codeHtml = escapeHtml(code);

        if (singlePhase) {
          const price = singlePhase === "open" ? open : close;
          const phaseDelta = singlePhase === "open" ? openDelta : closeDelta;
          const phaseCls = deltaClass(phaseDelta);
          const priceHtmlRaw = price != null ? fmt(price, { maximumFractionDigits: 0 }) : "—";
          const priceHtml =
            phaseCls === "up"
              ? `<span class="price up">${priceHtmlRaw}</span>`
              : phaseCls === "down"
                ? `<span class="price down">${priceHtmlRaw}</span>`
                : priceHtmlRaw;
          const volOne = singlePhase === "close" ? (closeItem?.volume ?? base.volume ?? openItem?.volume) : (openItem?.volume ?? base.volume ?? closeItem?.volume);
          const volOneHtml = volOne != null ? `${fmt(volOne, { maximumFractionDigits: 0 })}` : "—";

          return `<tr${rowClass ? ` class="${rowClass}"` : ""}>
  <td class="w-ticker">
    <a class="w-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">
      <div class="w-name-main">${nameHtml}</div>
      <div class="w-code-sub">${codeHtml}</div>
    </a>
  </td>
  <td class="w-num">${priceHtml}</td>
  <td class="w-delta">${renderDelta(price, prevClose)}</td>
  <td class="w-num">${volOneHtml}</td>
</tr>`;
        }

        return `<tr${rowClass ? ` class="${rowClass}"` : ""}>
  <td class="w-ticker">
    <a class="w-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">
      <div class="w-name-main">${nameHtml}</div>
      <div class="w-code-sub">${codeHtml}</div>
    </a>
  </td>
  <td class="w-num">${openHtml}</td>
  <td class="w-delta">${renderDelta(open, prevClose)}</td>
  <td class="w-num">${closeHtml}</td>
  <td class="w-delta">${renderDelta(close, prevClose)}</td>
  <td class="w-num">${volHtml}</td>
</tr>`;
      })
      .filter(Boolean)
      .join("");

    const avgPct = sectorPcts.length ? sectorPcts.reduce((a, b) => a + b, 0) / sectorPcts.length : null;
    const countHtml =
      counts.up + counts.down + counts.flat > 0
        ? `<span class="watch-sector-count">↑${counts.up} ↓${counts.down}</span>`
        : "";

    if (!rows) {
      return `<div class="watch-sector">
  <div class="watch-sector-head"><span>${sector}</span><div class="watch-sector-meta">${renderPctPill(
    avgPct,
  )}${countHtml}</div></div>
  <div class="empty">銘柄がありません。</div>
</div>`;
    }

    const single = phase && phase !== "both" ? phase : null;
    const thead = single
      ? `<tr>
          <th>銘柄</th>
          <th>${escapeHtml(phaseLabel(single))}</th>
          <th>前日比</th>
          <th>出来高</th>
        </tr>`
      : `<tr>
          <th>銘柄</th>
          <th>寄り</th>
          <th>前日比</th>
          <th>引け</th>
          <th>前日比</th>
          <th>出来高</th>
        </tr>`;

    return `<div class="watch-sector">
  <div class="watch-sector-head"><span>${sector}</span><div class="watch-sector-meta">${renderPctPill(
    avgPct,
  )}${countHtml}</div></div>
  <div class="watch-table-wrap">
    <table class="watch-table${single ? " is-compact" : ""}">
      <thead>
        ${thead}
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`;
  }

  function render(container, cfg, snapshots, date, showEnglish, query, view) {
    const byDatePhase = groupSnapshotsByDate(snapshots);
    const openSnap = byDatePhase.get(`${date}:open`);
    const closeSnap = byDatePhase.get(`${date}:close`);
    const openMap = mapItems(openSnap);
    const closeMap = mapItems(closeSnap);
    const phase = resolvePhase(view, openSnap, closeSnap);

    const groups = asArray(cfg?.groups);
    if (!groups.length) {
      container.innerHTML = `<div class="empty">watchlist.json にグループがありません。</div>`;
      return { openSnap, closeSnap };
    }

    container.innerHTML = groups
      .map((g) => renderSector(g, openMap, closeMap, showEnglish, query, phase))
      .join("");

    return { openSnap, closeSnap };
  }

  function renderAlerts(container, cfg, snapshots, date, openSnap, closeSnap, wantedCodes) {
    if (!container) return { gapCount: 0, volCount: 0 };
    const metaByCode = buildMetaByCode(cfg);
    const openMap = mapItems(openSnap);
    const closeMap = mapItems(closeSnap);
    const codes = new Set([...openMap.keys(), ...closeMap.keys()]);
    if (wantedCodes && wantedCodes.size) {
      for (const c of Array.from(codes)) {
        if (!wantedCodes.has(c)) codes.delete(c);
      }
    }
    if (!codes.size) {
      container.innerHTML = `<div class="empty">異常検知: スナップショットがありません。</div>`;
      return { gapCount: 0, volCount: 0 };
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
        const meta = metaByCode.get(code) || {};
        const name = normalizeText(it.name || meta.name || "");
        const url = normalizeText(it.source_url || `https://kabutan.jp/stock/?code=${encodeURIComponent(code)}`);
        gapAlerts.push({
          abs: Math.abs(pct),
          code,
          name,
          pct,
          open,
          prev,
          url,
        });
      }
    }
    gapAlerts.sort((a, b) => b.abs - a.abs);

    const volPhase = closeSnap ? "close" : "open";
    const volThreshold = volPhase === "close" ? CLOSE_VOL_ALERT_RATIO : OPEN_VOL_ALERT_RATIO;
    const volAlerts = [];
    const volMap = volPhase === "close" ? closeMap : openMap;
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
      const meta = metaByCode.get(code) || {};
      const name = normalizeText(it.name || meta.name || "");
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
                )}</a> ${escapeHtml(fmtPct(a.pct))}（寄り ${escapeHtml(fmt(a.open, { maximumFractionDigits: 0 }))} / 前日 ${escapeHtml(
                  fmt(a.prev, { maximumFractionDigits: 0 }),
                )}）</li>`,
            )
            .join("")}</ul>`
        : `<div class="empty">なし（|%| ≥ ${GAP_ALERT_PCT.toFixed(0)}%）</div>`;

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
                )}x / 基準 ${escapeHtml(fmt(a.base, { maximumFractionDigits: 0 }))}）</li>`,
            )
            .join("")}</ul>`
        : `<div class="empty">なし（${escapeHtml(volLabel)}）</div>`;

    container.innerHTML = `<div class="metric-grid">
  <div class="mini-card">
    <div class="row"><div class="metric-title">異常検知：ギャップ</div><div class="date">${escapeHtml(
      openSnap?.datetime_jst ? openSnap.datetime_jst.slice(11, 16) : "—",
    )} JST</div></div>
    <div class="meta-line">条件: |%| ≥ ${escapeHtml(GAP_ALERT_PCT.toFixed(0))}%</div>
    ${gapHtml}
  </div>
  <div class="mini-card">
    <div class="row"><div class="metric-title">異常検知：出来高</div><div class="date">${escapeHtml(
      (volPhase === "close" ? closeSnap?.datetime_jst : openSnap?.datetime_jst) ? (volPhase === "close" ? closeSnap?.datetime_jst : openSnap?.datetime_jst).slice(11, 16) : "—",
    )} JST</div></div>
    <div class="meta-line">条件: ${escapeHtml(volLabel)}</div>
    ${volHtml}
  </div>
</div>`;
    return { gapCount: gapAlerts.length, volCount: volAlerts.length };
  }

  async function main() {
    const root = document.documentElement;
    const cfgPath = root.getAttribute("data-watchlist-config") || "../data/watchlist.json";
    const snapPath = root.getAttribute("data-watchlist-snapshots") || "../data/watchlist_snapshots.json";

    const container = $(".js-watchlist");
    const alerts = $(".js-alerts");
    const alertsDetails = $(".watch-alerts");
    const alertsCount = $(".js-alerts-count");
    const select = $(".js-date");
    const scope = $(".js-scope");
    const view = $(".js-view");
    const search = $(".js-search");
    const status = $(".js-status");
    const scopeHint = $(".js-scope-hint");
    const err = $(".js-error");
    const toggleEn = $(".js-toggle-en");

    let cfg = null;
    let snapshots = [];
    try {
      cfg = await loadJson(cfgPath);
      const json = await loadJson(snapPath);
      snapshots = Array.isArray(json.snapshots) ? json.snapshots : [];
    } catch (e) {
      if (err) err.textContent = "データの読み込みに失敗しました。";
      return;
    }

    const dates = uniqueDatesFromSnapshots(snapshots);
    const today = new Date().toISOString().slice(0, 10);
    const initial = dates.includes(today) ? today : dates[0] || today;

    if (select) {
      const options = (dates.length ? dates : [initial]).map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
      select.innerHTML = options;
      select.value = initial;
    }

    const my = loadMyWatchlist();
    const hasMy = hasAnyTickers(my.groups);
    if (scope) {
      scope.value = hasMy ? "auto" : "shared";
    }

    const doRender = () => {
      const date = select?.value || initial;
      const scopeMode = normalizeText(scope?.value || "auto") || "auto";
      const mode = normalizeText(view?.value || "latest") || "latest";
      const showEnglish = !!toggleEn?.checked;
      const query = normalizeQuery(search?.value || "");
      const usingMy = scopeMode === "my" || (scopeMode === "auto" && hasMy);
      const effectiveCfg = usingMy ? my : cfg;
      const wantedCodes = codesFromCfg(effectiveCfg);

      if (usingMy && !hasMy) {
        const href = "manage.html";
        if (scopeHint) {
          scopeHint.innerHTML = `マイウォッチが空です。<a href="${escapeHtml(href)}">編集で追加</a>`;
        }
        container.innerHTML = `<div class="empty">マイウォッチが空です。<a href="${escapeHtml(href)}">編集で追加</a></div>`;
        if (alertsDetails) alertsDetails.open = false;
        if (alertsCount) alertsCount.textContent = "（—）";
        if (status) status.textContent = "—";
        return;
      }

      if (scopeHint) {
        if (!hasMy) {
          scopeHint.innerHTML = `マイウォッチ未設定（<a href="manage.html">編集で追加</a>）。`;
        } else {
          scopeHint.textContent =
            scopeMode === "my"
              ? "表示: マイウォッチ（ブラウザ保存）"
              : scopeMode === "shared"
                ? "表示: 共有ウォッチ（スナップ/Slack通知の対象）"
                : usingMy
                  ? "表示: マイウォッチ（自動）"
                  : "表示: 共有ウォッチ（自動）";
        }
      }

      const { openSnap, closeSnap } = render(container, effectiveCfg, snapshots, date, showEnglish, query, mode);
      const info = renderAlerts(alerts, effectiveCfg, snapshots, date, openSnap, closeSnap, wantedCodes);
      if (alertsCount) {
        const g = Number(info?.gapCount || 0);
        const v = Number(info?.volCount || 0);
        alertsCount.textContent = g || v ? `（ギャップ ${g} / 出来高 ${v}）` : "（なし）";
      }
      if (alertsDetails) {
        const g = Number(info?.gapCount || 0);
        const v = Number(info?.volCount || 0);
        alertsDetails.open = g > 0 || v > 0;
      }

      const openLabel = openSnap?.datetime_jst ? `寄り: ${openSnap.datetime_jst}` : "寄り: —";
      const closeLabel = closeSnap?.datetime_jst ? `引け: ${closeSnap.datetime_jst}` : "引け: —";
      if (status) status.textContent = `${openLabel} / ${closeLabel}（累計 ${snapshots.length} 回）`;
    };

    if (select) select.addEventListener("change", doRender);
    if (scope) scope.addEventListener("change", doRender);
    if (view) view.addEventListener("change", doRender);
    if (search) search.addEventListener("input", doRender);
    if (toggleEn) toggleEn.addEventListener("change", doRender);
    doRender();
  }

  window.addEventListener("DOMContentLoaded", () => {
    void main();
  });
})();
