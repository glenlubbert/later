import { randomBytes } from "node:crypto";
import * as auth from "../lib/auth.mjs";
import { extract, normalizeUrl, hostOf, readEmail, htmlToText } from "../lib/extract.mjs";
import { store, readIndex, updateIndex, readBody, writeBody, deleteBody } from "../lib/store.mjs";
import * as dropbox from "../lib/dropbox.mjs";
import * as marks from "../lib/highlights.mjs";
import * as mail from "../lib/mail.mjs";
import * as ai from "../lib/summary.mjs";

// Tags are kept as typed ("Long reads"), compared case-insensitively.
function cleanTags(input) {
  const seen = new Map();
  for (const raw of Array.isArray(input) ? input : []) {
    const tag = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (tag && !seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
  }
  return [...seen.values()].slice(0, 20);
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
const fail = (message, status = 400) => json({ error: message }, status);

const newId = () => randomBytes(6).toString("hex");

async function body(req) {
  try {
    return (await req.json()) ?? {};
  } catch {
    return {};
  }
}

// Cookie-authenticated writes must come from this site or the extension.
function originAllowed(req) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  if (origin.startsWith("chrome-extension://") || origin.startsWith("safari-web-extension://")) return true;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

function applyExtract(meta, data) {
  meta.title = data.title || meta.title || meta.url;
  meta.site = data.site || meta.site || hostOf(meta.url);
  meta.author = data.author || meta.author || "";
  meta.excerpt = data.excerpt || meta.excerpt || "";
  meta.image = data.image || meta.image || "";
  meta.words = data.words || 0;
  meta.hasContent = Boolean(data.content);
  meta.note = data.note || "";
  meta.fetched = true;
  return meta;
}

async function saveArticle({ url, title, html }) {
  const clean = normalizeUrl(url);
  const data = await extract(clean, typeof html === "string" && html.length > 500 ? html : null);
  let saved;
  await updateIndex((list) => {
    const existing = list.find((a) => a.url === clean);
    const meta = existing ?? {
      id: newId(),
      url: clean,
      title: "",
      savedAt: Date.now(),
      archived: false,
      liked: false,
      progress: 0,
    };
    if (!data.title && title) data.title = String(title).slice(0, 300);
    // A failed re-save must not wipe a copy that was already readable.
    if (existing?.hasContent && !data.content) {
      existing.archived = false;
      existing.savedAt = Date.now();
    } else {
      applyExtract(meta, data);
      meta.archived = false;
      meta.savedAt = Date.now();
    }
    saved = { meta: { ...meta }, wasNew: !existing, keepBody: existing?.hasContent && !data.content };
    const rest = list.filter((a) => a.id !== meta.id);
    return { list: [meta, ...rest] };
  });
  if (!saved.keepBody) await writeBody(saved.meta.id, { content: data.content });
  return { article: saved.meta, duplicate: !saved.wasNew };
}

// A forwarded email kept as an article. It has no web address, so its key
// is "email:<hash of the message id>", which also makes redeliveries harmless.
async function saveEmail({ key, title, author, html, text }) {
  const data = readEmail(html, text);
  if (!data.content) throw new Error("The email had no readable text");
  const url = `email:${key}`;
  let saved;
  await updateIndex((list) => {
    const existing = list.find((a) => a.url === url);
    const meta = existing ?? { id: newId(), url, kind: "email", liked: false, progress: 0 };
    Object.assign(meta, {
      title: String(title).slice(0, 300),
      site: "Email",
      author: author || "",
      excerpt: data.excerpt,
      image: "",
      words: data.words,
      hasContent: true,
      fetched: true,
      note: "",
      archived: false,
      savedAt: Date.now(),
    });
    saved = { ...meta };
    return { list: [meta, ...list.filter((a) => a.id !== meta.id)] };
  });
  await writeBody(saved.id, { content: data.content });
  return saved;
}

// Handles one message delivered by the mail relay. Always answers 200 once
// the caller is known to be the relay: any other status makes the sending
// mail server retry for days.
async function receiveMail(req, ip) {
  const local = process.env.NETLIFY_DEV === "true";
  // Not logged: the address is public, so strangers knocking here is routine.
  if (!local && !(await mail.fromRelay(ip))) {
    console.warn("inbound mail refused: caller is not the mail relay", ip);
    return fail("Forbidden", 403);
  }
  const payload = await body(req);
  const msg = mail.parse(payload);
  const { senders } = await mail.readConfig();
  if (!msg.sender) {
    await mail.log({ status: "blocked", message: `Unreadable message (fields: ${Object.keys(payload).slice(0, 12).join(", ") || "none"})` });
    return json({ ok: false });
  }
  if (!senders.includes(msg.sender)) {
    await mail.log({ status: "blocked", sender: msg.sender, reason: "sender", message: `${msg.sender} isn't on your list of senders` });
    return json({ ok: false });
  }
  if (!local && !mail.authentic(payload, msg.sender)) {
    await mail.log({ status: "blocked", sender: msg.sender, message: `Couldn't confirm the message really came from ${msg.sender}` });
    return json({ ok: false });
  }
  const text = msg.text || htmlToText(msg.html);
  const title = mail.cleanSubject(msg.subject);
  try {
    const link = mail.pickLink(msg.subject, text);
    if (link) {
      const { article } = await saveArticle({ url: link, title });
      await mail.log({ status: "saved", sender: msg.sender, message: `Saved the link: ${article.title || hostOf(article.url)}` });
    } else {
      const article = await saveEmail({ key: msg.key, title, author: mail.originalSender(text) || msg.senderName, html: msg.html, text: msg.text });
      await mail.log({ status: "saved", sender: msg.sender, message: `Saved the email: ${article.title}` });
    }
    return json({ ok: true });
  } catch (err) {
    await mail.log({ status: "error", sender: msg.sender, message: `${err.message || "Could not save"} (${title.slice(0, 60)})` });
    return json({ ok: false });
  }
}

async function loadArticle(id, { refresh = false } = {}) {
  const list = await readIndex();
  const meta = list.find((a) => a.id === id);
  if (!meta) return null;
  const isMail = meta.kind === "email";
  let stored = refresh && !isMail ? null : await readBody(id);
  // Imported links are fetched the first time they are opened.
  if (!isMail && (!stored || (!meta.fetched && !stored.content))) {
    const data = await extract(meta.url);
    if (data.content || !stored?.content) {
      stored = { content: data.content };
      await writeBody(id, stored);
      await updateIndex((l) => {
        const m = l.find((a) => a.id === id);
        if (m) {
          const keepTitle = m.title && !m.fetched ? m.title : "";
          applyExtract(m, data);
          if (keepTitle && !data.title) m.title = keepTitle;
          Object.assign(meta, m);
        }
        return { list: l };
      });
    }
  }
  const { highlights } = await marks.readHighlights(id);
  return { ...meta, content: stored?.content || "", summary: stored?.summary || "", canSummarize: ai.available(), highlights };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((v) => v.trim()));
}

// Accepts an Instapaper export (URL,Title,Selection,Folder,Timestamp) or any
// CSV with a URL column, or a plain list of links, one per line.
async function importList(text) {
  const rows = parseCsv(String(text || ""));
  if (!rows.length) return { added: 0, skipped: 0 };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const hasHeader = header.includes("url");
  const col = (name) => (hasHeader ? header.indexOf(name) : -1);
  const urlCol = hasHeader ? col("url") : 0;
  const titleCol = col("title");
  const folderCol = col("folder");
  const timeCol = col("timestamp");
  let added = 0;
  let skipped = 0;
  await updateIndex((list) => {
    const known = new Set(list.map((a) => a.url));
    const fresh = [];
    for (const row of hasHeader ? rows.slice(1) : rows) {
      let url;
      try {
        url = normalizeUrl(row[urlCol]);
      } catch {
        skipped++;
        continue;
      }
      if (known.has(url)) {
        skipped++;
        continue;
      }
      known.add(url);
      const folderName = (row[folderCol] || "").trim();
      const folder = folderName.toLowerCase();
      const seconds = Number(row[timeCol]);
      // Instapaper's own lists map onto ours; any other folder becomes a tag.
      const tags = folder && !["unread", "archive", "starred"].includes(folder) ? cleanTags([folderName]) : [];
      fresh.push({
        id: newId(),
        url,
        title: (row[titleCol] || "").trim().slice(0, 300) || url,
        site: hostOf(url),
        author: "",
        excerpt: "",
        image: "",
        words: 0,
        savedAt: seconds > 0 ? seconds * 1000 : Date.now(),
        archived: folder === "archive",
        liked: folder === "starred",
        tags,
        progress: 0,
        hasContent: false,
        fetched: false,
        note: "",
      });
      added++;
    }
    const merged = [...list, ...fresh].sort((a, b) => b.savedAt - a.savedAt);
    return { list: merged };
  });
  return { added, skipped };
}

// Remembers the last few saves from the iPhone shortcut, so a failing
// shortcut can be diagnosed from Settings. Never stores the token itself.
async function logShare(req, status, message) {
  try {
    const list = (await store().get("sharelog", { type: "json" })) || [];
    list.unshift({
      at: Date.now(),
      status,
      message: String(message).slice(0, 200),
      sentToken: /^Bearer\s+\S/.test(req.headers.get("authorization") || ""),
      agent: (req.headers.get("user-agent") || "").slice(0, 80),
    });
    await store().setJSON("sharelog", list.slice(0, 10));
  } catch {}
}

export default async (req, context) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
  const method = req.method;

  try {
    const who = await auth.check(req);

    if (path === "/status" && method === "GET")
      return json({ configured: who.configured, authed: who.authed, ...(who.authed ? { summaries: ai.available() } : {}) });

    if (path === "/inbound" && method === "POST") return await receiveMail(req, context?.ip);

    if (method !== "GET" && !originAllowed(req)) return fail("Cross-site request blocked", 403);

    if (path === "/setup" && method === "POST") {
      const { password } = await body(req);
      const result = await auth.setup(password);
      if (result.error) return fail(result.error, result.status);
      return json({ ok: true }, 200, { "set-cookie": auth.sessionCookie(result.token, req) });
    }

    if (path === "/login" && method === "POST") {
      const { password } = await body(req);
      const result = await auth.login(password);
      if (result.error) return fail(result.error, result.status);
      return json({ ok: true }, 200, { "set-cookie": auth.sessionCookie(result.token, req) });
    }

    // The iOS Shortcut shows whatever text comes back as a notification.
    const plain = url.searchParams.has("plain");
    const say = (message, status = 200) =>
      new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

    if (!who.authed) {
      if (plain) {
        await logShare(req, 401, "Token missing or not recognised");
        return say("Not signed in. Make a new token in Later settings and re-add the shortcut.", 401);
      }
      return fail(who.configured ? "Sign in required" : "Not set up yet", 401);
    }

    if (path === "/logout" && method === "POST") {
      await auth.logout(who.tokenHash);
      return json({ ok: true }, 200, { "set-cookie": auth.clearCookie() });
    }

    if (path === "/sharelog" && method === "GET")
      return json({ attempts: (await store().get("sharelog", { type: "json" })) || [] });

    if (path === "/mail" && method === "GET") return json({ ...(await mail.readConfig()), log: await mail.readLog() });
    if (path === "/mail" && method === "PUT") {
      try {
        return json({ ...(await mail.writeConfig(await body(req))), log: await mail.readLog() });
      } catch (err) {
        return fail(err.message);
      }
    }

    if (path === "/articles" && method === "GET") return json({ articles: await readIndex() });

    if (path === "/save" && method === "POST") {
      const input = await body(req);
      if (plain) {
        // The shortcut sends the link it found plus the raw shared item; use the first real link in either.
        const link = [input.url, input.text]
          .map((v) => String(v || "").match(/https?:\/\/[^\s"'<>]+/i)?.[0])
          .find(Boolean);
        input.url = link || "";
      }
      if (!input.url) {
        if (plain) await logShare(req, 400, `No link in request (got: ${Object.keys(input).join(", ") || "nothing"})`);
        return plain ? say("Nothing to save: no link was shared.", 400) : fail("No URL given");
      }
      try {
        const result = await saveArticle(input);
        if (plain) await logShare(req, 200, `Saved ${hostOf(result.article.url)}`);
        return plain ? say(`Saved: ${result.article.title}`) : json(result);
      } catch (err) {
        const message = err.message || "Could not save that link";
        if (plain) await logShare(req, 400, `${message} (link: ${String(input.url).slice(0, 80)})`);
        return plain ? say(`Couldn't save: ${message}`, 400) : fail(message);
      }
    }

    if (path === "/import" && method === "POST") {
      const { text } = await body(req);
      return json(await importList(text));
    }

    if (path === "/export" && method === "GET") {
      return json({ exportedAt: new Date().toISOString(), articles: await readIndex() }, 200, {
        "content-disposition": 'attachment; filename="later-export.json"',
      });
    }

    if (path === "/tokens" && method === "GET") return json({ tokens: auth.listTokens(who.auth) });
    if (path === "/tokens" && method === "POST") {
      const { label } = await body(req);
      return json(await auth.createToken(label));
    }
    const tokenMatch = path.match(/^\/tokens\/([a-f0-9]+)$/);
    if (tokenMatch && method === "DELETE") {
      await auth.revokeToken(tokenMatch[1]);
      return json({ ok: true });
    }

    const origin = url.origin;

    if (path === "/dropbox" && method === "GET") return json(await dropbox.status());
    if (path === "/dropbox/start" && method === "POST") {
      const { appKey, folder } = await body(req);
      try {
        return json({ url: await dropbox.start(appKey, folder, origin) });
      } catch (err) {
        return fail(err.message);
      }
    }
    if (path === "/dropbox/callback" && method === "GET") {
      let outcome = "connected";
      try {
        if (url.searchParams.get("error")) throw new Error(url.searchParams.get("error_description") || "Dropbox sign-in was cancelled");
        await dropbox.finish(url.searchParams.get("code"), url.searchParams.get("state"), origin);
      } catch (err) {
        outcome = "error=" + encodeURIComponent(err.message);
      }
      // A page rather than a 302, so the one-time code doesn't ride along in the address bar.
      const target = `/#/settings?dropbox=${outcome}`;
      return new Response(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${target}"><title>Later</title><a href="${target}">Continue to Later</a>`, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" },
      });
    }
    if (path === "/dropbox/disconnect" && method === "POST") {
      await dropbox.disconnect();
      return json({ ok: true });
    }
    if (path === "/dropbox/sync" && method === "POST") {
      // Rewrites every highlights file, e.g. after connecting or changing folder.
      let files = 0;
      let problem = "";
      for (const meta of (await readIndex()).filter((a) => a.highlights > 0)) {
        const result = await marks.sync(meta, await marks.readHighlights(meta.id), origin);
        if (result === "ok") files++;
        else problem = result;
        if (result === "off") break;
      }
      return json({ files, problem });
    }

    // Renames a tag on every article, merging into an existing tag of that
    // name; an empty "to" removes the tag everywhere.
    if (path === "/tags/rename" && method === "POST") {
      const input = await body(req);
      const from = String(input.from || "").trim().toLowerCase();
      const to = cleanTags([input.to])[0] || "";
      if (!from) return fail("Which tag?");
      const changed = await updateIndex((list) => {
        let count = 0;
        const into = to.toLowerCase();
        for (const a of list) {
          if (!(a.tags || []).length) continue;
          const had = a.tags.some((t) => t.toLowerCase() === from);
          // Renaming into an existing tag also gives that tag the new spelling.
          a.tags = cleanTags(a.tags.map((t) => (t.toLowerCase() === from || (into && t.toLowerCase() === into) ? to : t)));
          if (had) count++;
        }
        return { list, value: count };
      });
      return json({ changed });
    }

    const summaryMatch = path.match(/^\/articles\/([a-f0-9]+)\/summary$/);
    if (summaryMatch && method === "POST") {
      const id = summaryMatch[1];
      const meta = (await readIndex()).find((a) => a.id === id);
      if (!meta) return fail("Not found", 404);
      const stored = (await readBody(id)) || {};
      if (stored.summary) return json({ summary: stored.summary });
      if (!stored.content) return fail("There's no article text to summarize");
      try {
        const summary = await ai.summarize({ title: meta.title, site: meta.site, content: stored.content });
        await writeBody(id, { ...((await readBody(id)) || stored), summary });
        return json({ summary });
      } catch (err) {
        console.warn("summary failed:", err.message);
        return fail(ai.explain(err), 502);
      }
    }

    const mark = path.match(/^\/articles\/([a-f0-9]+)\/highlights(?:\/([a-f0-9]+))?$/);
    if (mark) {
      const meta = (await readIndex()).find((a) => a.id === mark[1]);
      if (!meta) return fail("Not found", 404);
      let result = null;
      try {
        if (method === "POST" && !mark[2]) result = await marks.add(meta, await body(req), origin);
        else if (method === "PATCH" && mark[2]) result = await marks.update(meta, mark[2], await body(req), origin);
        else if (method === "DELETE" && mark[2]) result = await marks.remove(meta, mark[2], origin);
      } catch (err) {
        return fail(err.message);
      }
      if (!result) return fail("Not found", 404);
      if ((meta.highlights || 0) !== result.count)
        await updateIndex((list) => {
          const m = list.find((a) => a.id === meta.id);
          if (m) m.highlights = result.count;
          return { list };
        });
      return json(result);
    }

    const match = path.match(/^\/articles\/([a-f0-9]+)(\/refresh)?$/);
    if (match) {
      const id = match[1];
      if (match[2] && method === "POST") {
        const article = await loadArticle(id, { refresh: true });
        return article ? json({ article }) : fail("Not found", 404);
      }
      if (method === "GET") {
        const article = await loadArticle(id);
        return article ? json({ article }) : fail("Not found", 404);
      }
      if (method === "PATCH") {
        const patch = await body(req);
        const updated = await updateIndex((list) => {
          const meta = list.find((a) => a.id === id);
          if (!meta) return { list, value: null };
          if (typeof patch.archived === "boolean") meta.archived = patch.archived;
          if (typeof patch.liked === "boolean") meta.liked = patch.liked;
          if (Array.isArray(patch.tags)) meta.tags = cleanTags(patch.tags);
          if (typeof patch.progress === "number") meta.progress = Math.max(0, Math.min(1, patch.progress));
          if (typeof patch.title === "string" && patch.title.trim()) meta.title = patch.title.trim().slice(0, 300);
          return { list, value: { ...meta } };
        });
        return updated ? json({ article: updated }) : fail("Not found", 404);
      }
      if (method === "DELETE") {
        await updateIndex((list) => ({ list: list.filter((a) => a.id !== id) }));
        await deleteBody(id);
        // The Markdown file in Dropbox is kept: highlights outlive the article.
        await marks.deleteHighlights(id);
        return json({ ok: true });
      }
    }

    return fail("Not found", 404);
  } catch (err) {
    console.error(err);
    return fail("Something went wrong on the server", 500);
  }
};

export const config = { path: "/api/*" };
