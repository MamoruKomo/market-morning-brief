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

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeText(value) {
    return String(value ?? "").trim();
  }

  function formatDt(value) {
    const s = normalizeText(value);
    if (!s) return "";
    return s.slice(0, 16).replace("T", " ");
  }

  const DEFAULT_FILTERS = [
    "決算",
    "業績修正",
    "配当",
    "自己株",
    "TOB",
    "増資/売出",
    "M&A",
    "人事",
    "借入",
    "訂正",
    "遅延",
  ];

  const FALLBACK_POINTS = {
    決算: "決算関連（決算短信/説明資料）を確認",
    業績修正: "業績予想/ガイダンスの修正（上方/下方・理由）を確認",
    配当: "配当予想/方針（増配/減配/無配）を確認",
    自己株: "自己株式（取得/消却/方針）の条件を確認",
    TOB: "TOB（価格/期間/目的）を確認",
    "増資/売出": "増資/売出（希薄化・需給インパクト）を確認",
    "M&A": "M&A/子会社化など（スキーム/条件）を確認",
    人事: "役員人事/体制変更の内容を確認",
    借入: "借入/資金調達（条件/返済）を確認",
    自己株処分: "自己株式の処分（需給/希薄化）を確認",
    SO: "ストックオプション（希薄化/条件）を確認",
    遅延: "開示遅延（追補の有無）に注意",
    訂正: "訂正開示（差分）を確認",
  };

  function getTitleJa(item) {
    const ja = normalizeText(item.title_ja);
    if (ja) return ja;
    return normalizeText(item.title || item.title_en);
  }

  function getTitleEn(item) {
    return normalizeText(item.title_en || item.title);
  }

  function getPointsJa(item) {
    const points = asArray(item.points_ja)
      .map((p) => normalizeText(p))
      .filter(Boolean);
    if (points.length > 0) return points.slice(0, 3);

    const tags = asArray(item.tags)
      .map((t) => normalizeText(t))
      .filter(Boolean);
    const fallback = [];
    for (const tag of tags) {
      const msg = FALLBACK_POINTS[tag];
      if (msg && !fallback.includes(msg)) fallback.push(msg);
    }
    return fallback.slice(0, 3);
  }

  function computeTagCounts(items) {
    const map = new Map();
    for (const item of items) {
      for (const tag of asArray(item.tags)) {
        const key = normalizeText(tag);
        if (!key) continue;
        map.set(key, (map.get(key) || 0) + 1);
      }
    }
    return map;
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
      getTitleJa(item),
      getTitleEn(item),
      ...asArray(item.points_ja),
      ...asArray(item.tags),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  }

  function renderFilters(container, tagCounts, onPick) {
    const tags = DEFAULT_FILTERS.filter((t) => tagCounts.has(t)).map((t) => ({
      tag: t,
      count: tagCounts.get(t),
    }));
    if (tags.length === 0) {
      container.innerHTML = "";
      return;
    }

    container.innerHTML = tags
      .map(
        (t) =>
          `<button type="button" class="filter" data-tag="${escapeHtml(t.tag)}">${escapeHtml(
            t.tag,
          )}<span class="filter-count">${t.count}</span></button>`,
      )
      .join("");

    container.querySelectorAll("button[data-tag]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tag = btn.getAttribute("data-tag") || "";
        if (!tag) return;
        onPick(tag);
      });
    });
  }

  function renderCard(item, showEnglish) {
    const dt = escapeHtml(formatDt(item.datetime_jst));
    const code = escapeHtml(normalizeText(item.code));
    const company = escapeHtml(normalizeText(item.company));
    const titleJa = escapeHtml(getTitleJa(item));
    const titleEn = escapeHtml(getTitleEn(item));
    const pdf = escapeHtml(
      normalizeText(item.pdf_url_kabutan || item.pdf_url_en || item.pdf_url || item.pdf_url_ja || item.pdf_url_tdnet),
    );
    const source = escapeHtml(normalizeText(item.source_url));
    const tags = asArray(item.tags).map((t) => normalizeText(t)).filter(Boolean);
    const points = getPointsJa(item);

    const pointsHtml =
      points.length > 0
        ? `<ul class="points">${points.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`
        : "";
    const enHtml =
      showEnglish && titleEn
        ? `<div class="meta-line title-en">原文: ${titleEn}</div>`
        : "";

    return `<article class="card tdnet-card">
  <div class="row">
    <div class="date">${dt}</div>
    <div class="actions">
      ${pdf ? `<a class="go" href="${pdf}" target="_blank" rel="noreferrer">PDF</a>` : ""}
      ${source ? `<a class="go" href="${source}" target="_blank" rel="noreferrer">一覧</a>` : ""}
    </div>
  </div>
  <div class="tdnet-head">
    ${code ? `<span class="code-pill">${code}</span>` : ""}
    ${company ? `<span class="company">${company}</span>` : ""}
  </div>
  <div class="tdnet-title">${titleJa}</div>
  ${enHtml}
  ${pointsHtml}
  ${renderBadges(tags)}
</article>`;
  }

  function renderList(container, items, q, opts) {
    const query = normalizeQuery(q);
    const limit = opts?.limit ?? items.length;
    const showEnglish = !!opts?.showEnglish;

    const list = items.filter((it) => matches(it, query));
    if (list.length === 0) {
      container.innerHTML = `<div class="empty">該当なし</div>`;
      return { shown: 0, total: 0, hasMore: false };
    }

    let html = "";
    let lastDay = "";
    for (const item of list.slice(0, limit)) {
      const day = normalizeText(item.datetime_jst).slice(0, 10);
      if (day && day !== lastDay) {
        html += `<div class="day-divider">${escapeHtml(day)}</div>`;
        lastDay = day;
      }
      html += renderCard(item, showEnglish);
    }
    container.innerHTML = html;
    return { shown: Math.min(limit, list.length), total: list.length, hasMore: list.length > limit };
  }

  async function main() {
    const root = document.documentElement;
    const dataPath = root.getAttribute("data-tdnet-json") || "../data/tdnet.json";

    const list = $(".js-tdnet-list");
    const input = $(".js-search");
    const info = $(".js-count");
    const err = $(".js-error");
    const last = $(".js-last-checked");
    const filters = $(".js-filters");
    const toggleEn = $(".js-toggle-en");
    const moreBtn = $(".js-more");

    let items = [];
    try {
      const json = await loadJson(dataPath);
      items = Array.isArray(json.items) ? json.items : [];
      items = items
        .slice()
        .sort((a, b) =>
          String(b.datetime_jst || "").localeCompare(String(a.datetime_jst || "")) ||
          String(b.id || "").localeCompare(String(a.id || "")),
        );

      if (last) {
        last.textContent = json.last_checked_jst ? `最終更新: ${json.last_checked_jst}` : "";
      }

      if (filters) {
        const tagCounts = computeTagCounts(items);
        renderFilters(filters, tagCounts, (tag) => {
          if (input) input.value = tag;
          render();
        });
      }
    } catch (e) {
      if (err) err.textContent = "データの読み込みに失敗しました。";
      return;
    }

    try {
      const q = new URLSearchParams(window.location.search).get("q");
      if (input && q) input.value = q;
    } catch (e) {
      // ignore
    }

    let limit = 80;
    const render = () => {
      const q = input?.value || "";
      const showEnglish = !!toggleEn?.checked;
      const res = renderList(list, items, q, { limit, showEnglish });
      if (info) info.textContent = `${res.shown}/${res.total}件表示（累計 ${items.length}件）`;

      if (moreBtn) {
        moreBtn.style.display = res.hasMore ? "inline-flex" : "none";
      }
    };

    if (input) {
      input.addEventListener("input", () => {
        limit = 80;
        render();
      });
    }
    if (toggleEn) {
      toggleEn.addEventListener("change", render);
    }
    if (moreBtn) {
      moreBtn.addEventListener("click", () => {
        limit += 80;
        render();
      });
    }

    render();
  }

  window.addEventListener("DOMContentLoaded", () => {
    void main();
  });
})();
