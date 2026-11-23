const app = document.getElementById("app");
const toastEl = document.getElementById("toast");

const state = { articles: [], loaded: false, tab: "unread", query: "", adding: false, listScroll: 0 };
const prefs = Object.assign({ theme: "auto", font: "serif", size: 20 }, readPrefs());

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem("later-prefs")) || {};
  } catch {
    return {};
  }
}
function applyPrefs() {
  const root = document.documentElement;
  if (prefs.theme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", prefs.theme);
  root.setAttribute("data-font", prefs.font);
  root.style.setProperty("--reader-size", prefs.size + "px");
  try {
    localStorage.setItem("later-prefs", JSON.stringify(prefs));
  } catch {}
  const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
  document.querySelector('meta[name="theme-color"]').setAttribute("content", bg);
}

/* ---------- tiny DOM helpers ---------- */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "html") el.innerHTML = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

const PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  heart: '<path d="M20.8 5.6a5.4 5.4 0 0 0-7.7 0L12 6.7l-1.1-1.1a5.4 5.4 0 0 0-7.7 7.7l1.1 1.1L12 22l7.7-7.6 1.1-1.1a5.4 5.4 0 0 0 0-7.7z"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  out: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
  type: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
  refresh: '<path d="M21 3v6h-6M3 21v-6h6"/><path d="M20.5 9A9 9 0 0 0 5.6 5.6L3 8m18 8-2.6 2.4A9 9 0 0 1 3.5 15"/>',
};
function icon(name, filled) {
  const span = document.createElement("span");
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
  return span.firstChild;
}
function iconBtn(name, label, onclick, extra = {}) {
  return h("button", { class: "icon-btn" + (extra.on ? " on" : ""), "aria-label": label, title: label, type: "button", onclick }, icon(name, extra.filled));
}

let toastTimer;
function toast(message, action) {
  clearTimeout(toastTimer);
  toastEl.replaceChildren(message);
  if (action) toastEl.append(h("button", { type: "button", onclick: () => (action.run(), hideToast()) }, action.label));
  toastEl.classList.add("show");
  toastTimer = setTimeout(hideToast, action ? 5500 : 2600);
}
function hideToast() {
  toastEl.classList.remove("show");
}

/* ---------- API ---------- */
async function api(path, { method = "GET", body, keepalive } = {}) {
  let res;
  try {
    res = await fetch("/api" + path, {
      method,
      keepalive,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("You're offline");
  }
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (res.status === 401 && path !== "/login") {
    gate(data.error === "Not set up yet" ? "setup" : "login");
    throw new Error("Sign in required");
  }
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

const fmtDate = (ms) => {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
};
const readTime = (words) => (words ? `${Math.max(1, Math.round(words / 230))} min` : "");

/* ---------- sign in / first-run ---------- */
function gate(mode) {
  document.title = "Later";
  const error = h("p", { class: "error" });
  const first = h("input", { class: "field", type: "password", placeholder: "Password", required: true, autocomplete: mode === "setup" ? "new-password" : "current-password", minlength: mode === "setup" ? 8 : null });
  const second = mode === "setup" ? h("input", { class: "field", type: "password", placeholder: "Repeat password", required: true, autocomplete: "new-password" }) : null;
  const submit = h("button", { class: "btn", type: "submit" }, mode === "setup" ? "Create my library" : "Sign in");
  const form = h(
    "form",
    {
      onsubmit: async (event) => {
        event.preventDefault();
        if (second && first.value !== second.value) return (error.textContent = "The two passwords don't match");
        submit.disabled = true;
        error.textContent = "";
        try {
          await api(mode === "setup" ? "/setup" : "/login", { method: "POST", body: { password: first.value } });
          state.loaded = false;
          route();
        } catch (err) {
          error.textContent = err.message;
          submit.disabled = false;
        }
      },
    },
    h("input", { type: "text", name: "username", value: "later", autocomplete: "username", hidden: true }),
    first,
    second,
    submit,
    error
  );
  app.replaceChildren(
    h(
      "main",
      { class: "gate" },
      h(
        "div",
        { class: "card" },
        h("img", { src: "/icons/192.png", alt: "" }),
        h("h1", null, mode === "setup" ? "Welcome to Later" : "Later"),
        h("p", null, mode === "setup" ? "Choose a password. It protects your reading list on every device." : "Your reading list"),
        form
      )
    )
  );
  first.focus();
}

/* ---------- list ---------- */
const pendingDeletes = new Set();
let refreshing = false;

async function loadArticles() {
  const { articles } = await api("/articles");
  state.articles = articles.filter((a) => !pendingDeletes.has(a.id));
  state.loaded = true;
  state.loadedAt = Date.now();
  prefetchForOffline();
}

const onList = () => !reader && !/^#\/(settings|save|read)/.test(location.hash);

// Picks up pages saved from the extension or the phone while this tab sat open.
async function refreshIfStale(maxAge = 10000) {
  if (refreshing || !state.loaded || Date.now() - state.loadedAt < maxAge) return;
  refreshing = true;
  try {
    await loadArticles();
    const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
    if (onList() && !typing) renderList();
  } catch {}
  refreshing = false;
}

function visibleArticles() {
  const q = state.query.trim().toLowerCase();
  if (q)
    return state.articles.filter((a) =>
      [a.title, a.site, a.excerpt, a.author, a.url].some((v) => (v || "").toLowerCase().includes(q))
    );
  if (state.tab === "liked") return state.articles.filter((a) => a.liked);
  if (state.tab === "archive") return state.articles.filter((a) => a.archived);
  return state.articles.filter((a) => !a.archived);
}

async function patchArticle(article, patch, undoLabel) {
  const before = { ...article };
  Object.assign(article, patch);
  renderCurrent();
  try {
    await api(`/articles/${article.id}`, { method: "PATCH", body: patch });
    if (undoLabel) {
      const revert = Object.fromEntries(Object.keys(patch).map((k) => [k, before[k]]));
      toast(undoLabel, { label: "Undo", run: () => patchArticle(article, revert) });
    }
  } catch (err) {
    Object.assign(article, before);
    renderCurrent();
    toast(err.message);
  }
}

function removeArticle(article, after) {
  const index = state.articles.indexOf(article);
  if (index < 0) return;
  state.articles.splice(index, 1);
  pendingDeletes.add(article.id);
  let undone = false;
  const timer = setTimeout(async () => {
    if (undone) return;
    try {
      await api(`/articles/${article.id}`, { method: "DELETE" });
    } catch (err) {
      pendingDeletes.delete(article.id);
      state.articles.splice(index, 0, article);
      renderCurrent();
      toast(err.message);
    }
  }, 5500);
  toast("Deleted", {
    label: "Undo",
    run: () => {
      undone = true;
      clearTimeout(timer);
      pendingDeletes.delete(article.id);
      state.articles.splice(index, 0, article);
      renderCurrent();
    },
  });
  after ? after() : renderCurrent();
}

async function saveUrl(url, button) {
  if (button) button.disabled = true;
  try {
    const { article, duplicate } = await api("/save", { method: "POST", body: { url } });
    state.articles = [article, ...state.articles.filter((a) => a.id !== article.id)];
    state.adding = false;
    state.tab = "unread";
    renderList();
    toast(duplicate ? "Already saved, moved to the top" : "Saved");
  } catch (err) {
    toast(err.message);
    if (button) button.disabled = false;
  }
}

function itemRow(a) {
  const meta = [readTime(a.words), fmtDate(a.savedAt)].filter(Boolean).join(" · ");
  const thumb = a.image ? h("img", { class: "thumb", src: a.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : null;
  if (thumb) thumb.addEventListener("error", () => thumb.remove());
  const reading = a.progress > 0.03 && a.progress < 0.97;
  return h(
    "li",
    { class: "item" },
    h(
      "div",
      { class: "item-text" },
      h("a", { class: "item-main", href: `#/read/${a.id}` }, h("h2", null, a.title || a.url), a.excerpt ? h("p", { class: "excerpt" }, a.excerpt) : null),
    h(
      "div",
      { class: "item-foot" },
      h("span", { class: "meta" }, h("span", { class: "site" }, a.site || ""), meta ? " · " + meta : ""),
      a.highlights ? h("span", { class: "hl-count", title: `${a.highlights} highlight${a.highlights === 1 ? "" : "s"}` }, String(a.highlights)) : null,
      reading ? h("span", { class: "progress", title: `${Math.round(a.progress * 100)}% read` }, h("i", { style: `width:${a.progress * 100}%` })) : null,
      iconBtn("heart", a.liked ? "Unlike" : "Like", () => patchArticle(a, { liked: !a.liked }), { on: a.liked, filled: a.liked }),
      a.archived
        ? iconBtn("inbox", "Move back to unread", () => patchArticle(a, { archived: false }, "Moved to unread"))
        : iconBtn("archive", "Archive", () => patchArticle(a, { archived: true }, "Archived")),
      iconBtn("trash", "Delete", () => removeArticle(a))
    )
    ),
    thumb
  );
}

function renderList() {
  document.title = "Later";
  const counts = {
    unread: state.articles.filter((a) => !a.archived).length,
    liked: state.articles.filter((a) => a.liked).length,
    archive: state.articles.filter((a) => a.archived).length,
  };
  const tab = (id, label) =>
    h(
      "button",
      { class: "tab", role: "tab", type: "button", "aria-selected": String(!state.query && state.tab === id), onclick: () => ((state.tab = id), (state.query = ""), renderList()) },
      label,
      h("span", { class: "count" }, String(counts[id]))
    );

  const urlInput = h("input", { class: "field", type: "url", inputmode: "url", placeholder: "Paste a link to save", "aria-label": "Link to save", required: true });
  const addBtn = h("button", { class: "btn", type: "submit" }, "Save");
  const addRow = state.adding
    ? h("form", { class: "add-row", onsubmit: (e) => (e.preventDefault(), saveUrl(urlInput.value, addBtn)) }, urlInput, addBtn)
    : null;

  const search = h("input", { class: "field", type: "search", placeholder: "Search", "aria-label": "Search saved articles", value: state.query });
  const listEl = h("ul", { class: "list" });
  const fill = () => {
    const items = visibleArticles();
    if (items.length) return listEl.replaceChildren(...items.map(itemRow));
    const blank = state.query
      ? ["Nothing matches", "Try a different word, or part of the site name."]
      : state.tab === "liked"
      ? ["No likes yet", "Tap the heart on anything you want to keep handy."]
      : state.tab === "archive"
      ? ["The archive is empty", "Articles you finish and archive land here."]
      : ["Nothing to read yet", "Save a page with the + button, the Chrome extension, or the share sheet on your iPhone. Setup is under the gear icon."];
    listEl.replaceChildren(h("li", { class: "empty" }, h("h2", null, blank[0]), h("p", null, blank[1])));
  };
  search.addEventListener("input", () => {
    state.query = search.value;
    for (const t of app.querySelectorAll(".tab")) t.setAttribute("aria-selected", "false");
    if (!state.query) return renderList();
    fill();
  });
  fill();

  app.replaceChildren(
    h(
      "header",
      { class: "bar" },
      h(
        "div",
        { class: "wrap" },
        h("a", { class: "brand", href: "#/" }, h("img", { src: "/icons/192.png", alt: "" }), "Later"),
        iconBtn("plus", "Save a link", () => ((state.adding = !state.adding), renderList()), { on: state.adding }),
        h("a", { class: "icon-btn", href: "#/settings", "aria-label": "Settings", title: "Settings" }, icon("gear"))
      )
    ),
    h(
      "main",
      { class: "wrap" },
      addRow,
      h("div", { class: "tools", role: "tablist" }, tab("unread", "Unread"), tab("liked", "Liked"), tab("archive", "Archive"), h("div", { class: "search" }, icon("search"), search)),
      listEl
    )
  );
  if (state.adding) urlInput.focus();
  if (state.query) {
    search.focus();
    search.setSelectionRange(state.query.length, state.query.length);
  }
}

/* ---------- reader ---------- */
let reader = null;

function saveProgress(final) {
  if (!reader?.article) return;
  const doc = document.documentElement;
  const max = doc.scrollHeight - window.innerHeight;
  const progress = max > 40 ? Math.min(1, Math.max(0, window.scrollY / max)) : 1;
  if (Math.abs(progress - (reader.sent ?? -1)) < 0.01) return;
  reader.sent = progress;
  const meta = state.articles.find((a) => a.id === reader.article.id);
  if (meta) meta.progress = progress;
  api(`/articles/${reader.article.id}`, { method: "PATCH", body: { progress }, keepalive: final }).catch(() => {});
}

function onReaderScroll() {
  if (!reader) return;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (reader.bar) reader.bar.style.width = (max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0) + "%";
  clearTimeout(reader.timer);
  reader.timer = setTimeout(() => saveProgress(false), 2500);
}

function leaveReader() {
  closeFloaters();
  if (!reader) return;
  clearTimeout(reader.timer);
  if (reader.ready) saveProgress(true);
  window.removeEventListener("scroll", onReaderScroll);
  reader = null;
}

function typeMenu(anchor) {
  const existing = anchor.querySelector(".popover");
  if (existing) return existing.remove();
  const seg = (options, current, pick) =>
    h(
      "div",
      { class: "seg" },
      options.map(([value, label]) =>
        h("button", { type: "button", "aria-pressed": String(current() === value), onclick: (e) => { pick(value); applyPrefs(); for (const b of e.currentTarget.parentNode.children) b.setAttribute("aria-pressed", String(b === e.currentTarget)); } }, label)
      )
    );
  const swatch = (color) => h("span", { class: "swatch", style: `background:${color}` });
  const pop = h(
    "div",
    { class: "popover" },
    seg([["auto", "Auto"], ["light", swatch("#faf8f4")], ["sepia", swatch("#f4ecd8")], ["dark", swatch("#171614")]], () => prefs.theme, (v) => (prefs.theme = v)),
    seg([["serif", "Serif"], ["sans", "Sans"]], () => prefs.font, (v) => (prefs.font = v)),
    h(
      "div",
      { class: "seg" },
      h("button", { type: "button", "aria-label": "Smaller text", onclick: () => ((prefs.size = Math.max(15, prefs.size - 1)), applyPrefs()) }, "A−"),
      h("button", { type: "button", "aria-label": "Larger text", onclick: () => ((prefs.size = Math.min(28, prefs.size + 1)), applyPrefs()) }, "A+")
    )
  );
  anchor.append(pop);
  const close = (event) => {
    if (pop.contains(event.target) || event.target.closest("[data-type-btn]")) return;
    pop.remove();
    document.removeEventListener("click", close);
  };
  setTimeout(() => document.addEventListener("click", close));
}

/* ---------- highlights ---------- */
function textNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out = [];
  let node;
  let pos = 0;
  while ((node = walker.nextNode())) {
    out.push({ node, start: pos, end: pos + node.data.length });
    pos += node.data.length;
  }
  return out;
}

function offsetIn(root, node, offset) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

function paintHighlights() {
  const prose = app.querySelector(".prose");
  if (!prose || !reader) return;
  for (const mark of prose.querySelectorAll("mark[data-h]")) mark.replaceWith(...mark.childNodes);
  prose.normalize();
  const full = prose.textContent;
  for (const hl of reader.highlights) {
    let start = hl.start;
    // If the article text shifted (re-fetched), fall back to finding the words.
    if (full.substr(start, hl.text.length) !== hl.text) start = full.indexOf(hl.text);
    if (start < 0) continue;
    const end = start + hl.text.length;
    for (const tn of textNodes(prose)) {
      if (tn.end <= start || tn.start >= end) continue;
      const a = Math.max(start, tn.start) - tn.start;
      const b = Math.min(end, tn.end) - tn.start;
      let target = tn.node;
      if (b < target.data.length) target.splitText(b);
      if (a > 0) target = target.splitText(a);
      if (!target.data.trim()) continue;
      const mark = document.createElement("mark");
      mark.dataset.h = hl.id;
      if (hl.note) mark.dataset.note = "1";
      target.replaceWith(mark);
      mark.append(target);
    }
  }
}

function syncSuffix(sync) {
  if (sync === "ok") return " · saved to Dropbox";
  if (sync === "off") return "";
  return " · Dropbox sync failed";
}

function closeFloaters() {
  document.querySelector(".hl-btn")?.remove();
  document.querySelector(".hl-pop")?.remove();
}

function placeNear(el, rect, below) {
  document.body.append(el);
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  let top = below ? rect.bottom + 10 : rect.top - hgt - 10;
  if (top < 64) top = rect.bottom + 10;
  if (top + hgt > window.innerHeight - 8) top = Math.max(64, rect.top - hgt - 10);
  const left = Math.min(window.innerWidth - w - 8, Math.max(8, rect.left + rect.width / 2 - w / 2));
  el.style.top = top + "px";
  el.style.left = left + "px";
}

function onSelectionChange() {
  clearTimeout(onSelectionChange.timer);
  onSelectionChange.timer = setTimeout(() => {
    document.querySelector(".hl-btn")?.remove();
    const prose = app.querySelector(".prose");
    const sel = window.getSelection();
    if (!reader || !prose || !sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!prose.contains(range.commonAncestorContainer) || range.toString().trim().length < 2) return;
    const button = h("button", { class: "hl-btn", type: "button", onclick: () => addHighlight(range, sel.toString()) }, "Highlight");
    // Keep the selection alive while the button is pressed.
    button.addEventListener("pointerdown", (e) => e.preventDefault());
    const touch = window.matchMedia("(pointer: coarse)").matches;
    placeNear(button, range.getBoundingClientRect(), touch);
  }, 180);
}

async function addHighlight(range, quote) {
  const prose = app.querySelector(".prose");
  const id = reader.article.id;
  let text = range.toString();
  let start = offsetIn(prose, range.startContainer, range.startOffset);
  const lead = text.length - text.trimStart().length;
  start += lead;
  text = text.trim();
  window.getSelection().removeAllRanges();
  closeFloaters();
  const draft = { id: "pending", text, start, note: "" };
  reader.highlights.push(draft);
  paintHighlights();
  try {
    const result = await api(`/articles/${id}/highlights`, { method: "POST", body: { text, start, quote: quote.trim() } });
    Object.assign(draft, result.highlight);
    setCount(id, result.count);
    toast("Highlighted" + syncSuffix(result.sync));
  } catch (err) {
    reader?.highlights.splice(reader.highlights.indexOf(draft), 1);
    toast(err.message);
  }
  if (reader?.article.id === id) paintHighlights();
}

function setCount(id, count) {
  const meta = state.articles.find((a) => a.id === id);
  if (meta) meta.highlights = count;
  window.caches?.open("later-data-v1").then((c) => c.delete(`/api/articles/${id}`)).catch(() => {});
}

function openHighlight(mark) {
  closeFloaters();
  const hl = reader.highlights.find((x) => x.id === mark.dataset.h);
  if (!hl || hl.id === "pending") return;
  const id = reader.article.id;
  const note = h("textarea", { class: "field", rows: 3, placeholder: "Add a note (optional)", "aria-label": "Note" });
  note.value = hl.note || "";
  const save = async () => {
    try {
      const result = await api(`/articles/${id}/highlights/${hl.id}`, { method: "PATCH", body: { note: note.value.trim() } });
      hl.note = result.highlight.note;
      closeFloaters();
      paintHighlights();
      toast("Note saved" + syncSuffix(result.sync));
    } catch (err) {
      toast(err.message);
    }
  };
  const remove = async () => {
    try {
      const result = await api(`/articles/${id}/highlights/${hl.id}`, { method: "DELETE" });
      reader.highlights.splice(reader.highlights.indexOf(hl), 1);
      setCount(id, result.count);
      closeFloaters();
      paintHighlights();
      toast("Highlight removed");
    } catch (err) {
      toast(err.message);
    }
  };
  const pop = h(
    "div",
    { class: "hl-pop" },
    note,
    h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: save }, "Save note"), h("button", { class: "btn quiet", type: "button", onclick: remove }, "Remove highlight"))
  );
  placeNear(pop, mark.getBoundingClientRect(), true);
}

document.addEventListener("selectionchange", onSelectionChange);
document.addEventListener("click", (event) => {
  const mark = event.target.closest?.("mark[data-h]");
  if (mark && reader && window.getSelection().isCollapsed) return openHighlight(mark);
  if (!event.target.closest?.(".hl-pop")) document.querySelector(".hl-pop")?.remove();
});

async function renderReader(id) {
  state.listScroll = window.scrollY;
  const known = state.articles.find((a) => a.id === id);
  const progressBar = h("div", { class: "reader-progress" });
  const barWrap = h("div", { class: "wrap", style: "position:relative" });
  const bar = h("header", { class: "bar reader-bar" }, barWrap, progressBar);
  const main = h("main", { class: "reader" }, h("header", null, h("h1", null, known?.title || "Loading…")), h("p", { class: "small" }, known && !known.fetched ? "Fetching this article for the first time…" : ""));
  barWrap.append(h("a", { class: "icon-btn", href: "#/", "aria-label": "Back to list", title: "Back" }, icon("back")), h("span", { class: "spacer" }));
  app.replaceChildren(bar, main);
  window.scrollTo(0, 0);
  reader = { bar: progressBar, ready: false };

  let article;
  try {
    ({ article } = await api(`/articles/${id}`));
  } catch (err) {
    if (!reader) return;
    main.replaceChildren(h("div", { class: "note" }, err.message === "You're offline" ? "This article hasn't been downloaded yet, and you're offline." : err.message));
    return;
  }
  if (!reader || location.hash !== `#/read/${id}`) return;
  reader.article = article;
  reader.highlights = article.highlights || [];
  const meta = known || article;
  const isMail = article.kind === "email";
  if (known) Object.assign(known, { ...article, content: undefined, highlights: reader.highlights.length });
  document.title = article.title || "Later";

  const draw = () => {
    const typeBtn = iconBtn("type", "Text settings", () => typeMenu(barWrap));
    typeBtn.setAttribute("data-type-btn", "");
    barWrap.replaceChildren(
      h("a", { class: "icon-btn", href: "#/", "aria-label": "Back to list", title: "Back" }, icon("back")),
      h("span", { class: "spacer" }),
      typeBtn,
      iconBtn("heart", meta.liked ? "Unlike" : "Like", () => patchArticle(meta, { liked: !meta.liked }), { on: meta.liked, filled: meta.liked }),
      meta.archived
        ? iconBtn("inbox", "Move back to unread", () => patchArticle(meta, { archived: false }, "Moved to unread"))
        : iconBtn("archive", "Archive", archiveAndLeave),
      iconBtn("trash", "Delete", () => removeArticle(meta, () => (location.hash = "#/"))),
      ...(isMail ? [] : [h("a", { class: "icon-btn", href: article.url, target: "_blank", rel: "noopener noreferrer", "aria-label": "Open original", title: "Open original" }, icon("out"))])
    );
  };
  const archiveAndLeave = async () => {
    await patchArticle(meta, { archived: true }, "Archived");
    location.hash = "#/";
  };
  reader.redraw = draw;
  draw();

  const byline = [article.author, article.site, readTime(article.words)].filter(Boolean);
  if (!isMail) byline.push(h("a", { href: article.url, target: "_blank", rel: "noopener noreferrer" }, "Original"));
  const refetch = async (button) => {
    button.disabled = true;
    try {
      await api(`/articles/${id}/refresh`, { method: "POST" });
      leaveReader();
      renderReader(id);
    } catch (err) {
      toast(err.message);
      button.disabled = false;
    }
  };
  main.replaceChildren(
    h(
      "header",
      null,
      h("h1", null, article.title || article.url),
      h("div", { class: "byline" }, byline.map((part, i) => h("span", null, i ? "· " : "", part)))
    ),
    article.content
      ? h("div", { class: "prose", html: article.content })
      : h(
          "div",
          { class: "note" },
          article.note || "There's no reader view for this page.",
          isMail ? null : h("div", { class: "row" }, h("a", { class: "btn", href: article.url, target: "_blank", rel: "noopener noreferrer" }, "Open the original"), h("button", { class: "btn quiet", type: "button", onclick: (e) => refetch(e.currentTarget) }, "Try again"))
        ),
    article.content
      ? h(
          "div",
          { class: "end" },
          meta.archived ? null : h("button", { class: "btn", type: "button", onclick: archiveAndLeave }, icon("archive"), "Archive"),
          h("a", { class: "btn quiet", href: "#/" }, "Back to list")
        )
      : null
  );
  for (const img of main.querySelectorAll(".prose img")) img.addEventListener("error", () => img.remove());
  paintHighlights();

  requestAnimationFrame(() => {
    if (!reader) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (article.progress > 0.03 && article.progress < 0.97) window.scrollTo(0, max * article.progress);
    reader.sent = article.progress;
    reader.ready = Boolean(article.content);
    window.addEventListener("scroll", onReaderScroll, { passive: true });
    onReaderScroll();
  });
}

/* ---------- settings ---------- */
async function renderSettings(params) {
  document.title = "Settings · Later";
  const origin = location.origin;
  const bookmarklet = `javascript:(function(){window.open('${origin}/#/save?u='+encodeURIComponent(location.href),'later','width=440,height=300')})()`;

  const tokenArea = h("div");
  const tokenList = h("ul", { class: "token-list" });
  const drawTokens = async () => {
    try {
      const { tokens } = await api("/tokens");
      tokenList.replaceChildren(
        ...tokens.map((t) =>
          h("li", null, `${t.label} · added ${fmtDate(t.created)}`, h("button", { class: "link", type: "button", onclick: async () => (await api(`/tokens/${t.id}`, { method: "DELETE" }), drawTokens()) }, "Revoke"))
        )
      );
    } catch {}
  };
  const makeToken = async (button) => {
    button.disabled = true;
    try {
      const { token } = await api("/tokens", { method: "POST", body: { label: "iPhone / iPad" } });
      const field = h("input", { class: "field", readonly: true, value: token, "aria-label": "Your token" });
      const copy = h("button", { class: "btn", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(token); toast("Token copied"); } catch { field.select(); toast("Select and copy the token"); } } }, "Copy");
      tokenArea.replaceChildren(h("div", { class: "token-box" }, field, copy), h("p", { class: "small" }, "Shown once. Copy it now, then add the shortcut below."));
      drawTokens();
    } catch (err) {
      toast(err.message);
    }
    button.disabled = false;
  };

  const file = h("input", { type: "file", accept: ".csv,.txt,text/csv,text/plain", hidden: true });
  file.addEventListener("change", async () => {
    if (!file.files[0]) return;
    try {
      const text = await file.files[0].text();
      const { added, skipped } = await api("/import", { method: "POST", body: { text } });
      state.loaded = false;
      toast(`Imported ${added} article${added === 1 ? "" : "s"}` + (skipped ? `, skipped ${skipped}` : ""));
    } catch (err) {
      toast(err.message);
    }
    file.value = "";
  });

  const dropboxPanel = h("section", { class: "panel" }, h("h2", null, "Highlights to Dropbox"), h("p", null, "Loading…"));
  const drawDropbox = async () => {
    let info;
    try {
      info = await api("/dropbox");
    } catch {
      return;
    }
    const head = h("h2", null, "Highlights to Dropbox");
    if (info.connected) {
      const syncBtn = h("button", { class: "btn quiet", type: "button", onclick: async () => {
        syncBtn.disabled = true;
        try {
          const { files, problem } = await api("/dropbox/sync", { method: "POST" });
          toast(problem && problem !== "off" ? problem : `Wrote ${files} file${files === 1 ? "" : "s"} to Dropbox`);
        } catch (err) {
          toast(err.message);
        }
        syncBtn.disabled = false;
        drawDropbox();
      } }, "Sync all now");
      dropboxPanel.replaceChildren(
        head,
        h("p", null, "Connected. Every article you highlight gets a Markdown file in ", h("code", null, info.folder), ", updated each time you add, change or remove a highlight."),
        info.lastError ? h("p", { class: "error" }, "Last sync problem: " + info.lastError) : null,
        h("div", { class: "row" }, syncBtn, h("button", { class: "btn quiet", type: "button", onclick: async () => (await api("/dropbox/disconnect", { method: "POST" }).catch(() => {}), drawDropbox()) }, "Disconnect"))
      );
      return;
    }
    const keyField = h("input", { class: "field", placeholder: "Dropbox app key", "aria-label": "Dropbox app key", value: info.appKey, autocomplete: "off", spellcheck: "false" });
    const folderField = h("input", { class: "field", placeholder: "Folder", "aria-label": "Dropbox folder", value: info.folder || "/Later Highlights", autocomplete: "off" });
    const connect = h("button", { class: "btn", type: "submit" }, "Connect Dropbox");
    dropboxPanel.replaceChildren(
      head,
      h("p", null, "Select text in any article and tap Highlight. Connect Dropbox to keep each article's highlights as a Markdown file in your vault."),
      h(
        "ol",
        null,
        h("li", null, "Open ", h("a", { class: "link", href: "https://www.dropbox.com/developers/apps/create", target: "_blank", rel: "noopener noreferrer" }, "dropbox.com/developers/apps"), " and create an app: ", h("b", null, "Scoped access"), ", ", h("b", null, "Full Dropbox"), ", any name."),
        h("li", null, "On its ", h("b", null, "Permissions"), " tab tick ", h("code", null, "files.content.write"), " and press Submit."),
        h("li", null, "On its ", h("b", null, "Settings"), " tab add this redirect URI: ", h("code", null, origin + "/api/dropbox/callback")),
        h("li", null, "Copy the ", h("b", null, "App key"), " (not the secret) into the box below.")
      ),
      h(
        "form",
        {
          class: "stack",
          onsubmit: async (e) => {
            e.preventDefault();
            connect.disabled = true;
            try {
              const { url } = await api("/dropbox/start", { method: "POST", body: { appKey: keyField.value, folder: folderField.value } });
              location.href = url;
            } catch (err) {
              toast(err.message);
              connect.disabled = false;
            }
          },
        },
        keyField,
        folderField,
        h("div", { class: "row" }, connect)
      )
    );
  };

  const marklet = h("a", { class: "btn quiet bookmarklet", href: bookmarklet, onclick: (e) => (e.preventDefault(), toast("Drag this button onto your bookmarks bar")) }, "Save to Later");

  const shareLog = h("p", { class: "small" });
  api("/sharelog")
    .then(({ attempts }) => {
      const last = attempts && attempts[0];
      if (!last) return;
      const when = new Date(last.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      shareLog.textContent = `Last save from the shortcut: ${when}. ${last.status === 200 ? last.message : "Failed: " + last.message}.`;
    })
    .catch(() => {});

  // Saving by email: the forwarding address, who may use it, and what happened last.
  const mailPanel = h("section", { class: "panel" }, h("h2", null, "Email"));
  const drawMail = (info) => {
    const save = async (next) => {
      try {
        drawMail(await api("/mail", { method: "PUT", body: { address: info.address, senders: info.senders, ...next } }));
      } catch (err) {
        toast(err.message);
      }
    };
    const addressField = h("input", { class: "field", type: "email", placeholder: "save@in.example.com", "aria-label": "Forwarding address", value: info.address, autocomplete: "off", spellcheck: "false" });
    const senderField = h("input", { class: "field", type: "email", placeholder: "you@example.com", "aria-label": "Your email address", autocomplete: "email", spellcheck: "false" });
    const last = info.log && info.log[0];
    const when = last ? new Date(last.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
    const canAllow = last && last.reason === "sender" && last.sender && !info.senders.includes(last.sender);
    const parts = [
      h("h2", null, "Email"),
      info.address
        ? h("p", null, "Forward any email to ", h("code", null, info.address), ". A message that is mostly a link saves that page; a newsletter or long email is saved as an article itself.")
        : h("p", null, "Forward emails to an address on your own domain to save them. This needs a one-time mail setup, described in the README under “Save by email”. Once it's done, enter the address here."),
      info.address
        ? h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => navigator.clipboard.writeText(info.address).then(() => toast("Address copied"), () => toast("Couldn't copy")) }, "Copy address"), h("button", { class: "btn quiet", type: "button", onclick: () => save({ address: "" }) }, "Change address"))
        : h("form", { class: "stack", onsubmit: (e) => (e.preventDefault(), save({ address: addressField.value })) }, addressField, h("div", { class: "row" }, h("button", { class: "btn", type: "submit" }, "Save address"))),
      h("p", { style: "margin-top:22px" }, h("b", null, "Who can save by email")),
      info.senders.length
        ? h("p", { class: "small" }, "Only mail sent from these addresses is saved. Everything else is ignored.")
        : h("p", { class: "note" }, h("b", null, "Add the address you forward from."), " Nothing is saved until you do, so strangers can't fill your list."),
      info.senders.length
        ? h("ul", { class: "token-list" }, info.senders.map((s) => h("li", null, s, h("button", { class: "link", type: "button", onclick: () => save({ senders: info.senders.filter((x) => x !== s) }) }, "Remove"))))
        : null,
      h("form", { class: "row", onsubmit: (e) => (e.preventDefault(), senderField.value.trim() && save({ senders: [...info.senders, senderField.value] })) }, senderField, h("button", { class: "btn", type: "submit" }, "Add")),
      last
        ? h("p", { class: "small" }, `Last email: ${when}. ${last.status === "saved" ? last.message : "Not saved: " + last.message}.`, canAllow ? " " : null, canAllow ? h("button", { class: "btn quiet", type: "button", onclick: () => save({ senders: [...info.senders, last.sender] }) }, "Allow this sender") : null)
        : null
    ];
    mailPanel.replaceChildren(...parts.filter(Boolean));
  };
  api("/mail").then(drawMail).catch(() => {});

  app.replaceChildren(
    h("header", { class: "bar" }, h("div", { class: "wrap" }, h("a", { class: "icon-btn", href: "#/", "aria-label": "Back to list", title: "Back" }, icon("back")), h("a", { class: "brand", href: "#/" }, "Later"))),
    h(
      "main",
      { class: "wrap settings" },
      h("h1", null, "Settings"),
      h(
        "section",
        { class: "panel" },
        h("h2", null, "iPhone & iPad"),
        h("p", null, "Adds “Save to Later” to the share sheet in Safari and every other app."),
        h(
          "ol",
          null,
          h("li", null, "Open this page on your iPhone or iPad and tap ", h("b", null, "Create token"), ", then ", h("b", null, "Copy"), "."),
          h("li", null, "Tap ", h("b", null, "Get the shortcut"), ", then ", h("b", null, "Add Shortcut"), ". It asks two things: your address, which is ", h("code", null, origin), ", and the token you just copied."),
          h("li", null, "In Safari tap Share, then ", h("b", null, "Save to Later"), ". The first time, choose “Always Allow”."),
          h("li", null, "For the reading app itself: Share, then ", h("b", null, "Add to Home Screen"), ".")
        ),
        h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: (e) => makeToken(e.currentTarget) }, "Create token"), h("a", { class: "btn quiet", href: "/later.shortcut" }, "Get the shortcut")),
        tokenArea,
        tokenList,
        shareLog
      ),
      mailPanel,
      h(
        "section",
        { class: "panel" },
        h("h2", null, "Chrome extension"),
        h("p", null, "One click on the toolbar button saves the page you're on, including pages behind a login."),
        h(
          "ol",
          null,
          h("li", null, "Download and unzip the extension."),
          h("li", null, "Open ", h("code", null, "chrome://extensions"), " and switch on ", h("b", null, "Developer mode"), " (top right)."),
          h("li", null, "Click ", h("b", null, "Load unpacked"), " and pick the unzipped folder, then pin Later to the toolbar."),
          h("li", null, "A page opens asking where your Later lives. Enter ", h("code", null, origin), " and click Connect."),
          h("li", null, "Click the button on any page, or press ", h("code", null, "Option+Shift+S"), ". Right-click any link to save it without opening it.")
        ),
        h("a", { class: "btn quiet", href: "/later-extension.zip", download: true }, "Download the extension")
      ),
      dropboxPanel,
      h("section", { class: "panel" }, h("h2", null, "Any other browser"), h("p", null, "Drag this button to your bookmarks bar. Clicking it saves the page you're looking at."), marklet),
      h(
        "section",
        { class: "panel" },
        h("h2", null, "Bring your Instapaper library"),
        h("p", null, "In Instapaper go to Settings, then Export, and download the CSV file. Import it here: titles appear straight away and each article is fetched the first time you open it."),
        h("div", { class: "row" }, h("button", { class: "btn quiet", type: "button", onclick: () => file.click() }, "Import CSV"), h("a", { class: "btn quiet", href: "/api/export", download: "later-export.json" }, "Export my library")),
        file
      ),
      h(
        "section",
        { class: "panel" },
        h("h2", null, "This device"),
        h("p", null, "Signing out here leaves your other devices signed in."),
        h(
          "button",
          {
            class: "btn quiet",
            type: "button",
            onclick: async () => {
              await api("/logout", { method: "POST" }).catch(() => {});
              if (window.caches) await caches.delete("later-data-v1").catch(() => {});
              state.articles = [];
              state.loaded = false;
              gate("login");
            },
          },
          "Sign out"
        )
      )
    )
  );
  window.scrollTo(0, 0);
  drawTokens();
  drawDropbox();
}

/* ---------- save popup (bookmarklet) ---------- */
async function renderSave(params) {
  const url = params.get("u");
  const title = h("h1", null, "Saving…");
  const detail = h("p", null, url || "");
  app.replaceChildren(h("main", { class: "gate" }, h("div", { class: "card" }, h("img", { src: "/icons/192.png", alt: "" }), title, detail, h("a", { class: "btn quiet", href: "#/" }, "Open Later"))));
  try {
    const { article } = await api("/save", { method: "POST", body: { url } });
    state.loaded = false;
    title.textContent = "Saved";
    detail.textContent = article.title;
    if (window.opener || window.name === "later") setTimeout(() => window.close(), 1300);
  } catch (err) {
    if (err.message === "Sign in required") return;
    title.textContent = "Couldn't save";
    detail.textContent = err.message;
  }
}

/* ---------- offline ---------- */
async function prefetchForOffline() {
  if (!("caches" in window) || !navigator.serviceWorker?.controller) return;
  const cache = await caches.open("later-data-v1");
  const wanted = state.articles.filter((a) => !a.archived && a.hasContent).slice(0, 40);
  for (const a of wanted) {
    const path = `/api/articles/${a.id}`;
    if (await cache.match(path)) continue;
    try {
      await fetch(path);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

/* ---------- router ---------- */
function renderCurrent() {
  if (reader) reader.redraw?.();
  else if (!location.hash.startsWith("#/settings")) renderList();
}

async function route() {
  leaveReader();
  hideToast();
  const [path, query] = location.hash.replace(/^#/, "").split("?");
  const params = new URLSearchParams(query || "");
  try {
    if (path === "/save" && params.get("u")) return await renderSave(params);
    if (!state.loaded) await loadArticles();
    const read = path.match(/^\/read\/([a-f0-9]+)$/);
    if (read) return await renderReader(read[1]);
    if (path === "/settings") {
      await renderSettings(params);
      const result = params.get("dropbox");
      if (result) {
        toast(result === "connected" ? "Dropbox connected" : "Dropbox: " + (params.get("dropbox").replace(/^error=/, "") || "not connected"));
        history.replaceState(null, "", "#/settings");
        if (result === "connected") api("/dropbox/sync", { method: "POST" }).catch(() => {});
      }
      return;
    }
    renderList();
    window.scrollTo(0, state.listScroll || 0);
    state.listScroll = 0;
    refreshIfStale();
  } catch (err) {
    if (err.message === "Sign in required") return;
    app.replaceChildren(h("main", { class: "gate" }, h("div", { class: "card" }, h("h1", null, "Can't load right now"), h("p", null, err.message), h("button", { class: "btn", type: "button", onclick: route }, "Try again"))));
  }
}

applyPrefs();
window.addEventListener("hashchange", route);
window.addEventListener("pagehide", () => {
  if (reader?.ready) saveProgress(true);
  // Deletes wait a few seconds for Undo; don't lose them if the tab closes first.
  for (const id of pendingDeletes) api(`/articles/${id}`, { method: "DELETE", keepalive: true }).catch(() => {});
});
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refreshIfStale(3000));
window.addEventListener("focus", () => refreshIfStale(3000));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && reader) location.hash = "#/";
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
route();
