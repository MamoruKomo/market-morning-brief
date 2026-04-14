/* eslint-disable no-alert */
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

  function normalizeQuery(query) {
    return String(query ?? "")
      .trim()
      .toLowerCase()
      .replaceAll(/\s+/g, " ");
  }

  async function loadBriefs(dataPath) {
    const res = await fetch(dataPath, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${dataPath}`);
    const json = await res.json();
    const briefs = Array.isArray(json) ? json : json.briefs;
    if (!Array.isArray(briefs)) return [];
    return briefs.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  function renderBadges(values) {
    if (!values || values.length === 0) return "";
    return `<div class="badges">${values
      .slice(0, 12)
      .map((v) => `<span class="badge">${escapeHtml(v)}</span>`)
      .join("")}</div>`;
  }

  function renderTickerLinks(tickers, baseHref) {
    if (!tickers || tickers.length === 0) return "";
    const safeBaseHref = baseHref || "";
    return `<div class="tickers">${tickers
      .slice(0, 12)
      .map((code) => {
        const c = String(code);
        return `<a class="ticker" href="${safeBaseHref}stocks/ticker.html?code=${encodeURIComponent(
          c,
        )}">${escapeHtml(c)}</a>`;
      })
      .join("")}</div>`;
  }

  function matchesBrief(brief, q) {
    if (!q) return true;
    const hay = [
      brief.date,
      brief.headline,
      ...(brief.summary_bullets || []),
      ...(brief.tags || []),
      ...(brief.tickers || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  }

  function renderBriefList(container, briefs, opts) {
    const baseHref = opts?.baseHref || "";
    const query = normalizeQuery(opts?.query || "");
    const list = briefs.filter((b) => matchesBrief(b, query));
    if (list.length === 0) {
      container.innerHTML = `<div class="empty">該当なし</div>`;
      return;
    }

    container.innerHTML = list
      .slice(0, opts?.limit || list.length)
      .map((b) => {
        const date = escapeHtml(b.date || "");
        const headline = escapeHtml(b.headline || "");
        const url = escapeHtml(b.url || "");
        const tags = renderBadges(b.tags || []);
        const tickers = renderTickerLinks(b.tickers || [], baseHref);
        const bullets = Array.isArray(b.summary_bullets)
          ? `<ul class="mini">${b.summary_bullets
              .slice(0, 4)
              .map((t) => `<li>${escapeHtml(t)}</li>`)
              .join("")}</ul>`
          : "";

        return `<article class="card">
  <div class="row">
    <div class="date">${date}</div>
    <a class="go" href="${baseHref}${url}">本文</a>
  </div>
  <div class="headline">${headline || "<span class=\"muted\">(headline未設定)</span>"}</div>
  ${bullets}
  ${tickers}
  ${tags}
</article>`;
      })
      .join("");
  }

  function buildTickerIndex(briefs) {
    const map = new Map();
    for (const b of briefs) {
      const codes = Array.isArray(b.tickers) ? b.tickers : [];
      for (const code of codes) {
        const key = String(code);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(b);
      }
    }
    return map;
  }

  function buildTagIndex(briefs) {
    const map = new Map();
    for (const b of briefs) {
      const tags = Array.isArray(b.tags) ? b.tags : [];
      for (const tag of tags) {
        const key = String(tag);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(b);
      }
    }
    return map;
  }

  function renderTickerIndex(container, tickerMap, baseHref, query) {
    const q = normalizeQuery(query);
    const items = Array.from(tickerMap.entries())
      .map(([code, entries]) => ({
        code,
        count: entries.length,
        latest: entries[0]?.date,
        latestUrl: entries[0]?.url,
        latestHeadline: entries[0]?.headline,
      }))
      .sort((a, b) => b.count - a.count || String(b.latest || "").localeCompare(String(a.latest || "")));

    const filtered = q
      ? items.filter((it) => {
          const hay = `${it.code} ${it.latestHeadline || ""}`.toLowerCase();
          return hay.includes(q);
        })
      : items;

    if (filtered.length === 0) {
      container.innerHTML = `<div class="empty">該当なし</div>`;
      return;
    }

    container.innerHTML = filtered
      .slice(0, 300)
      .map((it) => {
        const code = escapeHtml(it.code);
        const latest = escapeHtml(it.latest || "");
        const latestHeadline = escapeHtml(it.latestHeadline || "");
        const latestUrl = escapeHtml(it.latestUrl || "");
        return `<article class="card">
  <div class="row">
    <div class="headline">
      <a href="${baseHref}stocks/ticker.html?code=${encodeURIComponent(it.code)}">${code}</a>
      <span class="muted">（${it.count}回）</span>
    </div>
    <a class="go" href="${baseHref}${latestUrl}">直近</a>
  </div>
  <div class="meta-line">直近: ${latest} — ${latestHeadline}</div>
</article>`;
      })
      .join("");
  }

  function renderTagIndex(container, tagMap, baseHref, query) {
    const q = normalizeQuery(query);
    const items = Array.from(tagMap.entries())
      .map(([tag, entries]) => ({
        tag,
        count: entries.length,
        latest: entries[0]?.date,
        latestUrl: entries[0]?.url,
        latestHeadline: entries[0]?.headline,
      }))
      .sort((a, b) => b.count - a.count || String(b.latest || "").localeCompare(String(a.latest || "")));

    const filtered = q
      ? items.filter((it) => {
          const hay = `${it.tag} ${it.latestHeadline || ""}`.toLowerCase();
          return hay.includes(q);
        })
      : items;

    if (filtered.length === 0) {
      container.innerHTML = `<div class="empty">該当なし</div>`;
      return;
    }

    container.innerHTML = filtered
      .slice(0, 400)
      .map((it) => {
        const tag = escapeHtml(it.tag);
        const latest = escapeHtml(it.latest || "");
        const latestHeadline = escapeHtml(it.latestHeadline || "");
        const latestUrl = escapeHtml(it.latestUrl || "");
        return `<article class="card">
  <div class="row">
    <div class="headline">
      <a href="${baseHref}tags/tag.html?tag=${encodeURIComponent(it.tag)}">${tag}</a>
      <span class="muted">（${it.count}回）</span>
    </div>
    <a class="go" href="${baseHref}${latestUrl}">直近</a>
  </div>
  <div class="meta-line">直近: ${latest} — ${latestHeadline}</div>
</article>`;
      })
      .join("");
  }

  function renderTickerDetail(container, entries, baseHref, code) {
    if (!entries || entries.length === 0) {
      container.innerHTML = `<div class="empty">データがありません（${escapeHtml(code)}）</div>`;
      return;
    }
    const codestr = escapeHtml(code);
    container.innerHTML = `<div class="ticker-head">
  <div class="ticker-code">${codestr}</div>
  <div class="muted">${entries.length}回出現</div>
</div>
${entries
  .slice()
  .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  .map((b) => {
    const date = escapeHtml(b.date || "");
    const headline = escapeHtml(b.headline || "");
    const url = escapeHtml(b.url || "");
    return `<article class="card">
  <div class="row">
    <div class="date">${date}</div>
    <a class="go" href="${baseHref}${url}">本文</a>
  </div>
  <div class="headline">${headline}</div>
  ${renderBadges(b.tags || [])}
</article>`;
  })
  .join("")}`;
  }

  function renderTagDetail(container, entries, baseHref, tag) {
    if (!entries || entries.length === 0) {
      container.innerHTML = `<div class="empty">データがありません（${escapeHtml(tag)}）</div>`;
      return;
    }
    const tagstr = escapeHtml(tag);
    container.innerHTML = `<div class="ticker-head">
  <div class="ticker-code">${tagstr}</div>
  <div class="muted">${entries.length}回出現</div>
</div>
${entries
  .slice()
  .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  .map((b) => {
    const date = escapeHtml(b.date || "");
    const headline = escapeHtml(b.headline || "");
    const url = escapeHtml(b.url || "");
    const tickers = renderTickerLinks(b.tickers || [], baseHref);
    return `<article class="card">
  <div class="row">
    <div class="date">${date}</div>
    <a class="go" href="${baseHref}${url}">本文</a>
  </div>
  <div class="headline">${headline}</div>
  ${tickers}
</article>`;
  })
  .join("")}`;
  }

  async function main() {
    const root = document.documentElement;
    const dataPath = root.getAttribute("data-briefs-json") || "data/briefs.json";
    const baseHref = root.getAttribute("data-base-href") || "";
    const mode = root.getAttribute("data-page-mode") || "";

    let briefs = [];
    try {
      briefs = await loadBriefs(dataPath);
    } catch (e) {
      const err = $(".js-error");
      if (err) err.textContent = "データの読み込みに失敗しました。";
      return;
    }

    if (mode === "archive") {
      const list = $(".js-brief-list");
      const input = $(".js-search");
      const info = $(".js-count");
      const params = new URLSearchParams(location.search);
      const preset = params.get("q");
      if (input && preset) input.value = preset;
      const render = () => {
        const q = input?.value || "";
        renderBriefList(list, briefs, { baseHref, query: q });
        const shown = list?.querySelectorAll("article.card")?.length || 0;
        if (info) info.textContent = `${shown}件表示`;
      };
      if (input) input.addEventListener("input", render);
      render();
      return;
    }

    if (mode === "search") {
      const list = $(".js-brief-list");
      const input = $(".js-search");
      const info = $(".js-count");
      const params = new URLSearchParams(location.search);
      const preset = params.get("q");
      if (input && preset) input.value = preset;
      const render = () => {
        const q = input?.value || "";
        renderBriefList(list, briefs, { baseHref, query: q, limit: 200 });
        const shown = list?.querySelectorAll("article.card")?.length || 0;
        if (info) info.textContent = `${shown}件表示`;
      };
      if (input) input.addEventListener("input", render);
      render();
      return;
    }

    if (mode === "tickers") {
      const tickerMap = buildTickerIndex(briefs);
      const list = $(".js-ticker-list");
      const input = $(".js-search");
      const info = $(".js-count");
      const params = new URLSearchParams(location.search);
      const preset = params.get("q");
      if (input && preset) input.value = preset;
      const render = () => {
        const q = input?.value || "";
        renderTickerIndex(list, tickerMap, baseHref, q);
        const shown = list?.querySelectorAll("article.card")?.length || 0;
        if (info) info.textContent = `${shown}件表示`;
      };
      if (input) input.addEventListener("input", render);
      render();
      return;
    }

    if (mode === "tags") {
      const tagMap = buildTagIndex(briefs);
      const list = $(".js-tag-list");
      const input = $(".js-search");
      const info = $(".js-count");
      const params = new URLSearchParams(location.search);
      const preset = params.get("q");
      if (input && preset) input.value = preset;
      const render = () => {
        const q = input?.value || "";
        renderTagIndex(list, tagMap, baseHref, q);
        const shown = list?.querySelectorAll("article.card")?.length || 0;
        if (info) info.textContent = `${shown}件表示`;
      };
      if (input) input.addEventListener("input", render);
      render();
      return;
    }

    if (mode === "ticker") {
      const params = new URLSearchParams(location.search);
      const code = String(params.get("code") || "").trim();
      const title = $(".js-ticker-title");
      if (title) title.textContent = code ? `銘柄: ${code}` : "銘柄";

      const tickerMap = buildTickerIndex(briefs);
      const entries = code ? tickerMap.get(code) : null;
      const list = $(".js-ticker-detail");
      renderTickerDetail(list, entries || [], baseHref, code || "-");
      return;
    }

    if (mode === "tag") {
      const params = new URLSearchParams(location.search);
      const tag = String(params.get("tag") || "").trim();
      const title = $(".js-tag-title");
      if (title) title.textContent = tag ? `タグ: ${tag}` : "タグ";

      const tagMap = buildTagIndex(briefs);
      const entries = tag ? tagMap.get(tag) : null;
      const list = $(".js-tag-detail");
      renderTagDetail(list, entries || [], baseHref, tag || "-");
      return;
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    void main();
  });
})();
