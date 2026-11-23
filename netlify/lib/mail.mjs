import { resolve4, resolve6 } from "node:dns/promises";
import { createHash } from "node:crypto";
import { store } from "./store.mjs";

// Saving by email. Forward Email (forwardemail.net) receives mail for the
// address and POSTs each message here as JSON. On its free plan the address
// and this endpoint are public, so a message is only accepted when it
//   1. arrives from Forward Email's own servers,
//   2. is From an address listed in Settings, and
//   3. passed the sender domain's own checks (DMARC, or aligned SPF/DKIM).
// Blob keys:  mail -> { address, senders: [] }   maillog -> last few deliveries

const RELAYS = ["mx1.forwardemail.net", "mx2.forwardemail.net"];

export async function readConfig() {
  const saved = (await store().get("mail", { type: "json" })) || {};
  return { address: saved.address || "", senders: saved.senders || [] };
}

const isAddress = (s) => /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(s);

export async function writeConfig(input) {
  const address = String(input.address || "").trim().toLowerCase();
  if (address && !isAddress(address)) throw new Error("That forwarding address doesn't look right");
  const senders = [...new Set((input.senders || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean))];
  const bad = senders.find((s) => !isAddress(s));
  if (bad) throw new Error(`"${bad.slice(0, 60)}" isn't an email address`);
  const next = { address, senders: senders.slice(0, 20) };
  await store().setJSON("mail", next);
  return next;
}

export async function readLog() {
  return (await store().get("maillog", { type: "json" })) || [];
}

export async function log(entry) {
  try {
    const list = await readLog();
    list.unshift({ at: Date.now(), ...entry, message: String(entry.message || "").slice(0, 200) });
    await store().setJSON("maillog", list.slice(0, 10));
  } catch {}
}

// True when the request really came from one of Forward Email's mail servers.
export async function fromRelay(ip) {
  if (!ip) return false;
  const want = String(ip).toLowerCase();
  for (const host of RELAYS) {
    const found = [...(await resolve4(host).catch(() => [])), ...(await resolve6(host).catch(() => []))];
    if (found.some((a) => a.toLowerCase() === want)) return true;
  }
  return false;
}

// Subjects arrive as raw header text: "=?UTF-8?B?...?=" and friends.
function decodeWords(value) {
  return String(value || "")
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (whole, charset, kind, data) => {
      try {
        const bytes =
          kind.toLowerCase() === "b"
            ? Buffer.from(data, "base64")
            : Buffer.from(
                data.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (m, hex) => String.fromCharCode(parseInt(hex, 16))),
                "latin1"
              );
        return new TextDecoder(charset.toLowerCase()).decode(bytes);
      } catch {
        return whole;
      }
    });
}

export function parse(payload) {
  const header = (key) => {
    const line = (payload.headerLines || []).find((h) => h.key === key)?.line || "";
    return line.slice(line.indexOf(":") + 1).replace(/\r?\n\s+/g, " ").trim();
  };
  const from = payload.from?.value?.[0] || {};
  const subject = decodeWords(payload.subject || header("subject"));
  const messageId = String(payload.messageId || header("message-id") || "");
  return {
    sender: String(from.address || "").trim().toLowerCase(),
    senderName: String(from.name || "").trim(),
    recipient: String(payload.session?.recipient || payload.recipients?.[0] || "").toLowerCase(),
    subject,
    text: typeof payload.text === "string" ? payload.text : "",
    html: typeof payload.html === "string" ? payload.html : "",
    key: createHash("sha256").update(messageId || subject + (payload.date || "")).digest("hex").slice(0, 16),
  };
}

const aligned = (domain, fromDomain) => {
  const d = String(domain || "").toLowerCase().replace(/^.*@/, "");
  return Boolean(d) && (d === fromDomain || fromDomain.endsWith("." + d) || d.endsWith("." + fromDomain));
};

// The From line is trivially faked; these results say whether the sender's
// own domain vouches for the message.
export function authentic(payload, sender) {
  const fromDomain = sender.split("@")[1] || "";
  if (!fromDomain) return false;
  if (payload.dmarc?.status?.result === "pass") return true;
  const spf = payload.spf || {};
  if (spf.status?.result === "pass" && aligned(spf.domain || spf["envelope-from"], fromDomain)) return true;
  return (payload.dkim?.results || []).some(
    (r) => r.status?.result === "pass" && aligned(r.signingDomain, fromDomain)
  );
}

const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();
const LINK = /https?:\/\/[^\s<>"')\]]+/gi;

// What the person actually wrote, without the "Forwarded message" header
// block, quote marks, or a phone signature.
function ownWords(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[>\s]+/, ""))
    .filter(
      (line) =>
        !/^-{2,}\s*(forwarded|original) message\s*-{2,}$/i.test(line) &&
        !/^begin forwarded message:?$/i.test(line) &&
        !/^(from|to|date|sent|subject|cc|reply-to):\s/i.test(line) &&
        !/^sent from my /i.test(line) &&
        !/^get outlook for /i.test(line)
    )
    .join("\n");
}

// An email that is little more than a link saves the page it points to;
// anything longer is saved as an article itself.
export function pickLink(subject, text) {
  const body = ownWords(text);
  const links = (body.match(LINK) || []).map((l) => l.replace(/[.,;:!?]+$/, ""));
  const rest = squash(body.replace(LINK, ""));
  if (links.length && rest.length < 300) return links[0];
  if (!rest) return (String(subject).match(LINK) || [])[0] || null;
  return null;
}

export const cleanSubject = (subject) => squash(subject).replace(/^((fwd?|fw|re)\s*:\s*)+/i, "") || "Email";

// For a forwarded newsletter, the person who wrote it rather than the forwarder.
export function originalSender(text) {
  const m = String(text || "").match(
    /(?:forwarded message|original message)[\s\S]{0,300}?\bfrom:\s*\*?"?([^<\n*"]+?)"?\*?\s*(?:<|\n)/i
  );
  return m ? squash(m[1]).slice(0, 120) : "";
}
