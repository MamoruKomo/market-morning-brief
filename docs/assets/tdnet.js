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

  async function loadJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return res.json();
  }

  function renderBadges(tags) {
    if (!Array.isArray(tags) || tags.length === 0) return "";
    return `<div class="badges">${tags
      .slice(0, 16)
      .map((t) => `<span class="badge">${escapeHtml(t)}</span>`)
      .join("")}</div>`;
  }

  function matches(item, q) {
    if (!q) return true;
    const hay = [
      item.datetime_jst,
      item.code,
      item.company,
      item.title,
      ...(item.tags || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  }

  function renderList(container, items, q) {
    const query = normalizeQuery(q);
    const list = items.filter((it) => matches(it, query));
    if (list.length === 0) {
      container.innerHTML = `<div class="empty">該当なし</div>`;
      return 0;
    }

    container.innerHTML = list
      .slice(0, 300)
      .map((it) => {
        const dt = escapeHtml(it.datetime_jst || "");
        const code = escapeHtml(it.code || "");
        const company = escapeHtml(it.company || "");
        const title = escapeHtml(it.title || "");
        const pdf = escapeHtml(it.pdf_url || "");
        const source = escapeHtml(it.source_url || "");
        return `<article class="card">
  <div class="row">
    <div class="date">${dt}</div>
    ${pdf ? `<a class="go" href="${pdf}" target="_blank" rel="noreferrer">PDF</a>` : ""}
  </div>
  <div class="headline">${code ? `<span class="muted">${code}</span> ` : ""}${company}${company ? " — " : ""}${title}</div>
  ${renderBadges(it.tags || [])}
  ${source ? `<div class="meta-line">Source: <a href="${source}" target="_blank" rel="noreferrer">list</a></div>` : ""}
</article>`;
      })
      .join("");

    return list.length;
  }

  async function main() {
    const root = document.documentElement;
    const dataPath = root.getAttribute("data-tdnet-json") || "../data/tdnet.json";

    const list = $(".js-tdnet-list");
    const input = $(".js-search");
    const info = $(".js-count");
    const err = $(".js-error");
    const last = $(".js-last-checked");

    try {
      const json = await loadJson(dataPath);
      const items = Array.isArray(json.items) ? json.items : [];
      if (last) last.textContent = json.last_checked_jst ? `最終チェック: ${json.last_checked_jst}` : "";

      const render = () => {
        const q = input?.value || "";
        const shown = renderList(list, items, q);
        if (info) info.textContent = `${shown}件表示`;
      };

      if (input) input.addEventListener("input", render);
      render();
    } catch (e) {
      if (err) err.textContent = "データの読み込みに失敗しました。";
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    void main();
  });
})();

