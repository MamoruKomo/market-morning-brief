(function () {
  const BASE_HREF = "../";
  const NOTES_KEY = "mmb_review_notes_v1";

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

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeText(value) {
    return String(value ?? "").trim();
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

  function iterSnapshots(snapshots) {
    return asArray(snapshots)
      .filter((s) => s && typeof s === "object")
      .slice()
      .sort((a, b) => String(b.datetime_jst || "").localeCompare(String(a.datetime_jst || "")));
  }

  function findPrevCloseSnapshot(snapshots, currentDate) {
    for (const s of iterSnapshots(snapshots)) {
      if (normalizeText(s.phase) !== "close") continue;
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
      if (normalizeText(s.phase) !== "close") continue;
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

  function renderBrief(container, brief) {
    if (!container) return;
    if (!brief) {
      container.innerHTML = `<div class="empty">この日のブリーフがありません。</div>`;
      return;
    }
    const date = escapeHtml(brief.date || "");
    const headline = escapeHtml(brief.headline || "");
    const url = escapeHtml(brief.url || "");
    const synthesis = escapeHtml(brief.synthesis || "");
    const bullets = asArray(brief.summary_bullets).filter(Boolean).slice(0, 6);
    const bulletsHtml =
      bullets.length > 0
        ? `<ul class="mini">${bullets.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`
        : `<div class="empty">サマリーがありません。</div>`;

    container.innerHTML = `<div class="row">
  <div class="headline">${date} — ${headline || "<span class=\"muted\">(headline未設定)</span>"}</div>
  <a class="go" href="${BASE_HREF}${url}">本文</a>
</div>
${synthesis ? `<div class="synthesis">${synthesis}</div>` : ""}
${bulletsHtml}`;
  }

  function renderMoversCard(title, stamp, movers) {
    const ups = movers.filter((m) => m.pct != null && m.pct > 0).slice(0, 5);
    const downs = movers
      .filter((m) => m.pct != null && m.pct < 0)
      .slice()
      .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))
      .slice(0, 5);

    const renderList = (items) =>
      items.length
        ? `<ul class="points compact">${items
            .map((m) => {
              const url = escapeHtml(m.url);
              const label = escapeHtml(`${m.code} ${m.name}`.trim() || m.code);
              const pct = m.pct == null ? "—" : escapeHtml(fmtPct(m.pct));
              const px = escapeHtml(fmt(m.price, { maximumFractionDigits: 0 }));
              const vol = escapeHtml(fmt(m.volume, { maximumFractionDigits: 0 }));
              return `<li><a href="${url}" target="_blank" rel="noreferrer">${label}</a> ${pct}（${px} / 出来高 ${vol}）</li>`;
            })
            .join("")}</ul>`
        : `<div class="empty">—</div>`;

    return `<div class="mini-card">
  <div class="row"><div class="metric-title">${escapeHtml(title)}</div><div class="date">${escapeHtml(stamp || "—")} JST</div></div>
  <div class="meta-line">上位（+）</div>
  ${renderList(ups)}
  <div class="meta-line" style="margin-top:10px">下位（-）</div>
  ${renderList(downs)}
</div>`;
  }

  function renderAlertsCard(title, stamp, label, items, lineFn) {
    const body =
      items.length > 0
        ? `<ul class="points compact">${items.slice(0, ALERT_TOP_N).map(lineFn).join("")}</ul>`
        : `<div class="empty">なし（${escapeHtml(label)}）</div>`;
    return `<div class="mini-card">
  <div class="row"><div class="metric-title">${escapeHtml(title)}</div><div class="date">${escapeHtml(stamp || "—")} JST</div></div>
  <div class="meta-line">条件: ${escapeHtml(label)}</div>
  ${body}
</div>`;
  }

  function renderWatch(container, snapshots, date) {
    if (!container) return;
    const by = groupSnapshotsByDate(snapshots);
    const openSnap = by.get(`${date}:open`);
    const closeSnap = by.get(`${date}:close`);
    const openMap = mapItems(openSnap);
    const closeMap = mapItems(closeSnap);
    const codes = new Set([...openMap.keys(), ...closeMap.keys()]);
    if (!codes.size) {
      container.innerHTML = `<div class="empty">この日のスナップショットがありません。</div>`;
      return;
    }

    const openStamp = openSnap?.datetime_jst ? openSnap.datetime_jst.slice(11, 16) : "—";
    const closeStamp = closeSnap?.datetime_jst ? closeSnap.datetime_jst.slice(11, 16) : "—";

    const buildMovers = (phase) => {
      const map = phase === "close" ? closeMap : openMap;
      const out = [];
      for (const code of map.keys()) {
        const it = map.get(code) || {};
        const price = phase === "close" ? it.close : it.open;
        const prev = it.prev_close;
        const pct = computeChangePct(price, prev);
        const name = normalizeText(it.name || "");
        const volume = it.volume;
        const url = normalizeText(it.source_url || `https://kabutan.jp/stock/?code=${encodeURIComponent(code)}`);
        out.push({ code, name, pct, price, volume, url });
      }
      return out
        .filter((m) => m.pct != null)
        .slice()
        .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
    };

    const openMovers = buildMovers("open");
    const closeMovers = buildMovers("close");

    // Alerts (gap + volume)
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

    const gapLabel = `|%| ≥ ${GAP_ALERT_PCT.toFixed(0)}%`;
    const volLabel =
      volPhase === "close"
        ? `平常比 ≥ ${CLOSE_VOL_ALERT_RATIO.toFixed(1)}x`
        : `前日比 ≥ ${Math.round(OPEN_VOL_ALERT_RATIO * 100)}%`;

    const alertsGrid = `<div class="metric-grid" style="margin-top:12px">
${renderAlertsCard(
  "ギャップ",
  openStamp,
  gapLabel,
  gapAlerts,
  (a) =>
    `<li><a href="${escapeHtml(a.url)}" target="_blank" rel="noreferrer">${escapeHtml(
      `${a.code} ${a.name}`.trim() || a.code,
    )}</a> ${escapeHtml(fmtPct(a.pct))}（寄り ${escapeHtml(fmt(a.open, { maximumFractionDigits: 0 }))} / 前日 ${escapeHtml(
      fmt(a.prev, { maximumFractionDigits: 0 }),
    )}）</li>`,
)}
${renderAlertsCard(
  "出来高急増",
  volPhase === "close" ? closeStamp : openStamp,
  volLabel,
  volAlerts,
  (a) =>
    `<li><a href="${escapeHtml(a.url)}" target="_blank" rel="noreferrer">${escapeHtml(
      `${a.code} ${a.name}`.trim() || a.code,
    )}</a> ${escapeHtml(fmt(a.vol, { maximumFractionDigits: 0 }))}（${escapeHtml(
      fmt(a.ratio, { maximumFractionDigits: 2 }),
    )}x / 基準 ${escapeHtml(fmt(a.base, { maximumFractionDigits: 0 }))}）</li>`,
)}
</div>`;

    const moversGrid = `<div class="metric-grid">
${renderMoversCard("寄り 変動Top", openStamp, openMovers)}
${renderMoversCard("引け 変動Top", closeStamp, closeMovers)}
</div>`;

    container.innerHTML = moversGrid + alertsGrid;
  }

  function renderTdnetDay(container, tdnetJson, date) {
    if (!container) return;
    const items = Array.isArray(tdnetJson?.items) ? tdnetJson.items : [];
    const filtered = items
      .filter((it) => String(it?.datetime_jst || "").slice(0, 10) === date)
      .slice()
      .sort((a, b) => String(b.datetime_jst || "").localeCompare(String(a.datetime_jst || "")))
      .slice(0, 12);

    if (!filtered.length) {
      container.innerHTML = `<div class="empty">この日の適時開示はありません。</div>`;
      return;
    }

    container.innerHTML = `<div class="mini-list">${filtered
      .map((it) => {
        const dt = escapeHtml(String(it.datetime_jst || "").slice(11, 16));
        const code = escapeHtml(String(it.code || ""));
        const company = escapeHtml(String(it.company || ""));
        const title = escapeHtml(String(it.title_ja || it.title_en || it.title || ""));
        const pdf = escapeHtml(
          String(it.pdf_url_tdnet || it.pdf_url_ja || it.pdf_url || it.pdf_url_kabutan || it.pdf_url_en || ""),
        );
        return `<div class="mini-card">
  <div class="row">
    <div class="date">${dt} JST</div>
    ${pdf ? `<a class="go" href="${pdf}" target="_blank" rel="noreferrer">PDF</a>` : ""}
  </div>
  <div class="tdnet-title">${code ? `<span class="code-pill">${code}</span> ` : ""}${company ? `${company} — ` : ""}${title}</div>
</div>`;
      })
      .join("")}</div>`;
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

  async function main() {
    const root = document.documentElement;
    const briefsPath = root.getAttribute("data-briefs-json") || "../data/briefs.json";
    const tdnetPath = root.getAttribute("data-tdnet-json") || "../data/tdnet.json";
    const wlSnapPath = root.getAttribute("data-watchlist-snapshots") || "../data/watchlist_snapshots.json";

    const select = $(".js-date");
    const status = $(".js-status");
    const briefEl = $(".js-brief");
    const watchEl = $(".js-watch");
    const tdnetEl = $(".js-tdnet");

    const memo = $(".js-memo");
    const memoStatus = $(".js-memo-status");
    const memoCopy = $(".js-memo-copy");
    const memoClear = $(".js-memo-clear");

    let briefs = [];
    let tdnetJson = null;
    let snapshots = [];

    try {
      const briefJson = await loadJson(briefsPath);
      briefs = Array.isArray(briefJson) ? briefJson : Array.isArray(briefJson?.briefs) ? briefJson.briefs : [];
      briefs = briefs.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    } catch (e) {
      // ignore
    }

    try {
      tdnetJson = await loadJson(tdnetPath);
    } catch (e) {
      tdnetJson = { items: [] };
    }

    try {
      const wlSnap = await loadJson(wlSnapPath);
      snapshots = Array.isArray(wlSnap?.snapshots) ? wlSnap.snapshots : [];
    } catch (e) {
      snapshots = [];
    }

    const dateSet = new Set();
    for (const b of briefs) if (normalizeText(b?.date)) dateSet.add(normalizeText(b.date));
    for (const s of snapshots) {
      const d = normalizeText(s?.datetime_jst).slice(0, 10);
      if (d) dateSet.add(d);
    }
    for (const it of asArray(tdnetJson?.items)) {
      const d = normalizeText(it?.datetime_jst).slice(0, 10);
      if (d) dateSet.add(d);
    }
    const dates = Array.from(dateSet).filter(Boolean).sort((a, b) => b.localeCompare(a));
    const today = jstToday();
    const initial = dates.includes(today) ? today : dates[0] || today;

    if (select) {
      select.innerHTML = dates.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
      select.value = initial;
    }

    let currentDate = initial;
    const notes = loadNotes();

    const updateMemoStatus = (label) => {
      if (memoStatus) memoStatus.textContent = label || "";
    };

    const loadMemoForDate = () => {
      const next = loadNotes();
      if (memo) memo.value = normalizeText(next.notes?.[currentDate] || "");
      updateMemoStatus("");
    };

    const saveMemo = () => {
      const next = loadNotes();
      next.notes[currentDate] = normalizeText(memo?.value || "");
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

    const renderAll = () => {
      currentDate = select?.value || initial;
      if (status) status.textContent = `${currentDate}`;

      const brief = briefs.find((b) => normalizeText(b?.date) === currentDate) || null;
      renderBrief(briefEl, brief);
      renderWatch(watchEl, snapshots, currentDate);
      renderTdnetDay(tdnetEl, tdnetJson, currentDate);
      loadMemoForDate();
    };

    if (select) select.addEventListener("change", renderAll);
    renderAll();
  }

  window.addEventListener("DOMContentLoaded", () => {
    void main();
  });
})();

