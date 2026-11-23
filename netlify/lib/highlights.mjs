import { randomBytes } from "node:crypto";
import { store } from "./store.mjs";
import { putFile, removeFile } from "./dropbox.mjs";

// Blob h/<articleId> -> { file, highlights: [{ id, text, quote, start, note, created }] }
const key = (id) => `h/${id}`;
const EMPTY = () => ({ file: "", highlights: [] });

export const readHighlights = async (id) => (await store().get(key(id), { type: "json" })) ?? EMPTY();
const writeHighlights = (id, record) => store().setJSON(key(id), record);
export const deleteHighlights = (id) => store().delete(key(id));

export function fileName(title) {
  const clean = String(title || "")
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110)
    .replace(/[. ]+$/, "");
  return (clean || "Untitled") + ".md";
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const yaml = (s) => JSON.stringify(String(s ?? ""));

// Same front-matter shape as the Obsidian clippings already in the vault.
export function toMarkdown(meta, highlights, origin) {
  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  const isMail = meta.kind === "email";
  const lines = ["---", `title: ${yaml(meta.title || meta.url)}`, `source: ${yaml(isMail ? "email" : meta.url)}`];
  if (meta.author) lines.push("author:", `  - ${yaml(`[[${meta.author}]]`)}`);
  if (meta.site) lines.push(`site: ${yaml(meta.site)}`);
  lines.push(`created: ${day(meta.savedAt || Date.now())}`, `updated: ${day(Date.now())}`);
  if (meta.excerpt) lines.push(`description: ${yaml(meta.excerpt)}`);
  lines.push("tags:", '  - "highlights"', "---");
  lines.push(`${isMail ? "" : `[Original](${meta.url}) · `}[Open in Later](${origin}/#/read/${meta.id})`, "");
  lines.push(`## Highlights`, "");
  for (const h of sorted) {
    const quote = String(h.quote || h.text)
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    lines.push(quote.map((l) => `> ${l}`).join("\n>\n"), "");
    if (h.note) lines.push(`**Note:** ${h.note.trim().replace(/\n+/g, "\n\n")}`, "");
  }
  return lines.join("\n");
}

// Rewrites the article's Markdown file from its current highlights.
export async function sync(meta, record, origin) {
  if (!record.highlights.length) {
    if (!record.file) return "ok";
    const result = await removeFile(record.file);
    return result;
  }
  const name = record.file || fileName(meta.title || meta.url);
  const result = await putFile(name, toMarkdown(meta, record.highlights, origin));
  if (result === "ok" && record.file !== name) {
    record.file = name;
    await writeHighlights(meta.id, record);
  }
  return result;
}

export async function add(meta, input, origin) {
  const text = String(input.text || "");
  if (text.trim().length < 2 || text.length > 6000) throw new Error("Select a sentence or two to highlight");
  const record = await readHighlights(meta.id);
  const highlight = {
    id: randomBytes(5).toString("hex"),
    text,
    quote: String(input.quote || text).slice(0, 7000),
    start: Math.max(0, Number(input.start) || 0),
    note: String(input.note || "").slice(0, 4000),
    created: Date.now(),
  };
  record.highlights.push(highlight);
  await writeHighlights(meta.id, record);
  return { highlight, count: record.highlights.length, sync: await sync(meta, record, origin) };
}

export async function update(meta, hid, patch, origin) {
  const record = await readHighlights(meta.id);
  const highlight = record.highlights.find((h) => h.id === hid);
  if (!highlight) return null;
  if (typeof patch.note === "string") highlight.note = patch.note.slice(0, 4000);
  await writeHighlights(meta.id, record);
  return { highlight, count: record.highlights.length, sync: await sync(meta, record, origin) };
}

export async function remove(meta, hid, origin) {
  const record = await readHighlights(meta.id);
  record.highlights = record.highlights.filter((h) => h.id !== hid);
  await writeHighlights(meta.id, record);
  return { count: record.highlights.length, sync: await sync(meta, record, origin) };
}
