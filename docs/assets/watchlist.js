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

  function normalizeText(value) {
    return String(value ?? "").trim();
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

  async function loadJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return res.json();
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

  function renderSector(group, openMap, closeMap, showEnglish) {
    const sector = escapeHtml(group.sector || "—");
    const tickers = asArray(group.tickers);
    const sectorPcts = [];
    const rows = tickers
      .map((t) => {
        const code = normalizeText(t.code);
        if (!code) return "";
        const openItem = openMap.get(code);
        const closeItem = closeMap.get(code);
        const base = closeItem || openItem || {};

        const name = showEnglish
          ? normalizeText(base.name_en || t.name_en || "") || normalizeText(base.name || t.name || "")
          : normalizeText(base.name || t.name || "");
        const sourceUrl = normalizeText(base.source_url || `https://kabutan.jp/stock/?code=${encodeURIComponent(code)}`);

        const prevClose = base.prev_close;
        const open = openItem?.open ?? base.open;
        const close = closeItem?.close ?? base.close;
        const vol = closeItem?.volume ?? openItem?.volume ?? base.volume;

        const openDelta = computeChange(open, prevClose);
        const closeDelta = computeChange(close, prevClose);
        const rowDelta = closeDelta ?? openDelta;
        const rowCls = deltaClass(rowDelta);
        const rowClass = rowCls === "up" ? "is-up" : rowCls === "down" ? "is-down" : "";

        const openPct = computeChangePct(open, prevClose);
        const closePct = computeChangePct(close, prevClose);
        const refPct = closePct ?? openPct;
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

        return `<tr${rowClass ? ` class="${rowClass}"` : ""}>
  <td class="w-code"><a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(
    code,
  )}</a></td>
  <td class="w-name">${escapeHtml(name || "")}</td>
  <td class="w-num">${openHtml}</td>
  <td class="w-delta">${renderDelta(open, prevClose)}</td>
  <td class="w-num">${closeHtml}</td>
  <td class="w-delta">${renderDelta(close, prevClose)}</td>
  <td class="w-num">${volHtml}</td>
</tr>`;
      })
      .filter(Boolean)
      .join("");

    const avgPct = sectorPcts.length
      ? sectorPcts.reduce((a, b) => a + b, 0) / sectorPcts.length
      : null;

    if (!rows) {
      return `<div class="watch-sector">
  <div class="watch-sector-head"><span>${sector}</span>${renderPctPill(avgPct)}</div>
  <div class="empty">銘柄がありません。</div>
</div>`;
    }

    return `<div class="watch-sector">
  <div class="watch-sector-head"><span>${sector}</span>${renderPctPill(avgPct)}</div>
  <div class="watch-table-wrap">
    <table class="watch-table">
      <thead>
        <tr>
          <th>コード</th>
          <th>銘柄</th>
          <th>寄り</th>
          <th>前日比</th>
          <th>引け</th>
          <th>前日比</th>
          <th>出来高</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`;
  }

  function render(container, cfg, snapshots, date, showEnglish) {
    const byDatePhase = groupSnapshotsByDate(snapshots);
    const openSnap = byDatePhase.get(`${date}:open`);
    const closeSnap = byDatePhase.get(`${date}:close`);
    const openMap = mapItems(openSnap);
    const closeMap = mapItems(closeSnap);

    const groups = asArray(cfg?.groups);
    if (!groups.length) {
      container.innerHTML = `<div class="empty">watchlist.json にグループがありません。</div>`;
      return { openSnap, closeSnap };
    }

    container.innerHTML = groups
      .map((g) => renderSector(g, openMap, closeMap, showEnglish))
      .join("");

    return { openSnap, closeSnap };
  }

  async function main() {
    const root = document.documentElement;
    const cfgPath = root.getAttribute("data-watchlist-config") || "../data/watchlist.json";
    const snapPath = root.getAttribute("data-watchlist-snapshots") || "../data/watchlist_snapshots.json";

    const container = $(".js-watchlist");
    const select = $(".js-date");
    const status = $(".js-status");
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

    const doRender = () => {
      const date = select?.value || initial;
      const showEnglish = !!toggleEn?.checked;
      const { openSnap, closeSnap } = render(container, cfg, snapshots, date, showEnglish);

      const openLabel = openSnap?.datetime_jst ? `寄り: ${openSnap.datetime_jst}` : "寄り: —";
      const closeLabel = closeSnap?.datetime_jst ? `引け: ${closeSnap.datetime_jst}` : "引け: —";
      if (status) status.textContent = `${openLabel} / ${closeLabel}（累計 ${snapshots.length} 回）`;
    };

    if (select) select.addEventListener("change", doRender);
    if (toggleEn) toggleEn.addEventListener("change", doRender);
    doRender();
  }

  window.addEventListener("DOMContentLoaded", () => {
    void main();
  });
})();
