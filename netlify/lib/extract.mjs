import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

const MAX_BYTES = 6 * 1024 * 1024;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|igshid|ref_src|s_kwcid|msclkid)$/i;

export function normalizeUrl(input) {
  let raw = String(input || "").trim();
  if (!raw) throw new Error("No URL given");
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = "https://" + raw;
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only web links can be saved");
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
  return u.toString();
}

// The server only ever fetches public web pages.
function assertPublicHost(url) {
  const host = new URL(url).hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    host.startsWith("[") ||
    !host.includes(".");
  if (blocked) throw new Error("That address can't be fetched");
}

async function fetchPage(url) {
  assertPublicHost(url);
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`The site answered ${res.status}`);
  const type = res.headers.get("content-type") || "";
  if (type && !/html|xml|text\/plain/i.test(type)) return { html: null, type };
  const buf = new Uint8Array(await res.arrayBuffer());
  const bytes = buf.length > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
  let charset = (type.match(/charset=([^;]+)/i) || [])[1];
  if (!charset) {
    const head = new TextDecoder("latin1").decode(bytes.slice(0, 4096));
    charset = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
  }
  let html;
  try {
    html = new TextDecoder((charset || "utf-8").trim().toLowerCase()).decode(bytes);
  } catch {
    html = new TextDecoder("utf-8").decode(bytes);
  }
  return { html, type };
}

const KEEP = new Set(
  "p h1 h2 h3 h4 h5 h6 a img picture source figure figcaption blockquote ul ol li pre code em strong b i u s sub sup br hr table thead tbody tfoot tr td th caption div span section dl dt dd small mark del ins abbr cite q time details summary iframe video audio".split(
    " "
  )
);
const DROP = new Set(
  "script style noscript form input button select textarea svg canvas object embed link meta template nav aside footer dialog".split(
    " "
  )
);
const ATTRS = {
  a: ["href", "title"],
  img: ["src", "srcset", "alt", "title", "width", "height"],
  source: ["src", "srcset", "type", "media"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
  time: ["datetime"],
  iframe: ["src", "width", "height", "allowfullscreen"],
  video: ["src", "poster", "controls"],
  audio: ["src", "controls"],
  ol: ["start"],
};
const FRAME_OK = /^https:\/\/(www\.youtube(-nocookie)?\.com\/embed\/|player\.vimeo\.com\/video\/)/;

function absolute(value, base) {
  try {
    const u = new URL(value, base);
    return /^(https?|mailto):$/.test(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

function absoluteSrcset(value, base) {
  return value
    .split(",")
    .map((part) => {
      const [u, ...rest] = part.trim().split(/\s+/);
      const abs = u && absolute(u, base);
      return abs ? [abs, ...rest].join(" ") : null;
    })
    .filter(Boolean)
    .join(", ");
}

function clean(node, base) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 8) {
      child.remove();
      continue;
    }
    if (child.nodeType !== 1) continue;
    const tag = child.tagName.toLowerCase();
    if (DROP.has(tag)) {
      child.remove();
      continue;
    }
    clean(child, base);
    if (!KEEP.has(tag)) {
      child.replaceWith(...child.childNodes);
      continue;
    }
    if (tag === "img") {
      // Lazy-loaded images keep the real address in data attributes.
      const lazy =
        child.getAttribute("data-src") ||
        child.getAttribute("data-lazy-src") ||
        child.getAttribute("data-original");
      const src = child.getAttribute("src") || "";
      if (lazy && (!src || src.startsWith("data:"))) child.setAttribute("src", lazy);
      const lazySet = child.getAttribute("data-srcset");
      if (lazySet && !child.getAttribute("srcset")) child.setAttribute("srcset", lazySet);
    }
    const allowed = ATTRS[tag] || [];
    for (const attr of [...child.attributes]) {
      const name = attr.name.toLowerCase();
      if (!allowed.includes(name)) {
        child.removeAttribute(attr.name);
        continue;
      }
      if (name === "href" || name === "src" || name === "poster") {
        const abs = absolute(attr.value, base);
        if (abs) child.setAttribute(attr.name, abs);
        else child.removeAttribute(attr.name);
      } else if (name === "srcset") {
        const set = absoluteSrcset(attr.value, base);
        if (set) child.setAttribute(attr.name, set);
        else child.removeAttribute(attr.name);
      }
    }
    if (tag === "a") {
      child.setAttribute("target", "_blank");
      child.setAttribute("rel", "noopener noreferrer");
    }
    if (tag === "img") {
      if (!child.getAttribute("src") && !child.getAttribute("srcset")) child.remove();
      else {
        child.setAttribute("loading", "lazy");
        child.setAttribute("referrerpolicy", "no-referrer");
      }
    }
    if (tag === "iframe" && !FRAME_OK.test(child.getAttribute("src") || "")) child.remove();
    if (tag === "video" || tag === "audio") child.setAttribute("controls", "");
  }
}

function sanitize(html, base) {
  const { document } = parseHTML(`<!doctype html><html><body><div id="root">${html}</div></body></html>`);
  const root = document.getElementById("root");
  clean(root, base);
  return root.innerHTML.trim();
}

function meta(document, ...names) {
  for (const name of names) {
    const el =
      document.querySelector(`meta[property="${name}"]`) || document.querySelector(`meta[name="${name}"]`);
    const value = el?.getAttribute("content")?.trim();
    if (value) return value;
  }
  return "";
}

const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Turns a URL (plus the page HTML, when the browser extension supplies what
// the reader is actually looking at) into clean article data.
export async function extract(url, suppliedHtml) {
  let html = suppliedHtml || null;
  let note = "";
  if (!html) {
    try {
      const page = await fetchPage(url);
      html = page.html;
      if (!html) note = "This link isn't a web article, so there is no reader view.";
    } catch (err) {
      note = `Couldn't fetch the page (${err.message}).`;
    }
  }
  const out = {
    title: "",
    site: hostOf(url),
    author: "",
    excerpt: "",
    image: "",
    published: "",
    content: "",
    words: 0,
    note,
  };
  if (!html) return out;

  let document;
  try {
    ({ document } = parseHTML(html));
  } catch {
    out.note = "Couldn't read the page.";
    return out;
  }

  out.title = squash(meta(document, "og:title", "twitter:title") || document.querySelector("title")?.textContent);
  out.site = squash(meta(document, "og:site_name")) || out.site;
  out.author = squash(meta(document, "author", "article:author", "parsely-author")).slice(0, 120);
  if (/^https?:/i.test(out.author)) out.author = "";
  out.excerpt = squash(meta(document, "og:description", "description", "twitter:description")).slice(0, 320);
  out.published = meta(document, "article:published_time", "date", "parsely-pub-date");
  const image = meta(document, "og:image", "twitter:image");
  out.image = (image && absolute(image, url)) || "";

  let article = null;
  try {
    article = new Readability(document, { charThreshold: 200 }).parse();
  } catch {
    article = null;
  }
  if (article?.content) {
    out.content = sanitize(article.content, url);
    const text = squash(article.textContent);
    out.words = text ? text.split(" ").length : 0;
    out.title = squash(article.title) || out.title;
    out.author = out.author || squash(article.byline).slice(0, 120);
    out.excerpt = out.excerpt || squash(article.excerpt).slice(0, 320) || text.slice(0, 240);
    out.site = out.site || squash(article.siteName);
  }
  if (!out.content || out.words < 40) {
    out.note = out.note || "No readable article text was found on this page.";
    if (out.words < 40) out.content = "";
  }
  return out;
}
