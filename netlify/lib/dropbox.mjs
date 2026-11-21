import { createHash, randomBytes } from "node:crypto";
import { store } from "./store.mjs";

// Blob "dropbox" -> { appKey, folder, refreshToken, verifier, state, lastError }
const KEY = "dropbox";
const AUTH = "https://www.dropbox.com/oauth2/authorize";
const TOKEN = "https://api.dropboxapi.com/oauth2/token";

let cached = { token: null, expires: 0, refresh: null };

export const readConfig = async () => (await store().get(KEY, { type: "json" })) ?? null;
const writeConfig = (cfg) => store().setJSON(KEY, cfg);

export function cleanFolder(input) {
  const parts = String(input || "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? "/" + parts.join("/") : "";
}

export async function status() {
  const cfg = await readConfig();
  return {
    connected: Boolean(cfg?.refreshToken),
    folder: cfg?.folder || "",
    appKey: cfg?.appKey || "",
    lastError: cfg?.lastError || "",
  };
}

const redirectUri = (origin) => origin + "/api/dropbox/callback";

// Step 1 of connecting: PKCE, so no app secret ever needs storing.
export async function start(appKey, folder, origin) {
  appKey = String(appKey || "").trim();
  folder = cleanFolder(folder);
  if (!/^[a-z0-9]{8,40}$/i.test(appKey)) throw new Error("That doesn't look like a Dropbox app key");
  if (!folder) throw new Error("Choose a Dropbox folder for your highlights");
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(16).toString("hex");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const existing = (await readConfig()) || {};
  await writeConfig({ ...existing, appKey, folder, verifier, state, lastError: "" });
  const url = new URL(AUTH);
  url.search = new URLSearchParams({
    client_id: appKey,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    token_access_type: "offline",
    redirect_uri: redirectUri(origin),
    state,
  }).toString();
  return url.toString();
}

export async function finish(code, state, origin) {
  const cfg = await readConfig();
  if (!cfg?.verifier || !state || state !== cfg.state) throw new Error("The Dropbox sign-in expired, try again");
  const res = await fetch(TOKEN, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: cfg.appKey,
      code_verifier: cfg.verifier,
      redirect_uri: redirectUri(origin),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.refresh_token) throw new Error(data.error_description || "Dropbox refused the connection");
  await writeConfig({ appKey: cfg.appKey, folder: cfg.folder, refreshToken: data.refresh_token, lastError: "" });
  cached = { token: data.access_token, expires: Date.now() + (data.expires_in - 120) * 1000, refresh: data.refresh_token };
}

export async function disconnect() {
  const cfg = await readConfig();
  if (!cfg) return;
  if (cfg.refreshToken) {
    try {
      const token = await accessToken(cfg);
      await fetch("https://api.dropboxapi.com/2/auth/token/revoke", { method: "POST", headers: { authorization: "Bearer " + token } });
    } catch {}
  }
  cached = { token: null, expires: 0, refresh: null };
  await writeConfig({ appKey: cfg.appKey, folder: cfg.folder, lastError: "" });
}

async function accessToken(cfg) {
  if (cached.token && cached.refresh === cfg.refreshToken && Date.now() < cached.expires) return cached.token;
  const res = await fetch(TOKEN, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: cfg.refreshToken, client_id: cfg.appKey }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(data.error_description || "Dropbox needs reconnecting");
  cached = { token: data.access_token, expires: Date.now() + (data.expires_in - 120) * 1000, refresh: cfg.refreshToken };
  return cached.token;
}

// Dropbox reads this JSON from an HTTP header, which must stay ASCII.
const headerJson = (value) => JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

function explain(data, fallback) {
  const summary = data?.error_summary || "";
  if (summary.includes("missing_scope")) return "The Dropbox app is missing the files.content.write permission";
  if (summary.includes("insufficient_space")) return "Your Dropbox is full";
  return summary ? `Dropbox said: ${summary.split("/.")[0]}` : fallback;
}

async function noteError(cfg, message) {
  if ((cfg.lastError || "") === message) return;
  await writeConfig({ ...cfg, lastError: message });
}

// Writes (or replaces) one Markdown file. Returns "ok", "off", or an error message.
export async function putFile(name, content) {
  const cfg = await readConfig();
  if (!cfg?.refreshToken) return "off";
  try {
    const token = await accessToken(cfg);
    const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/octet-stream",
        "dropbox-api-arg": headerJson({ path: `${cfg.folder}/${name}`, mode: "overwrite", mute: true }),
      },
      body: content,
    });
    if (!res.ok) throw new Error(explain(await res.json().catch(() => null), `Dropbox answered ${res.status}`));
    await noteError(cfg, "");
    return "ok";
  } catch (err) {
    await noteError(cfg, err.message);
    return err.message;
  }
}

export async function removeFile(name) {
  const cfg = await readConfig();
  if (!cfg?.refreshToken) return "off";
  try {
    const token = await accessToken(cfg);
    const res = await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ path: `${cfg.folder}/${name}` }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      if (!(data?.error_summary || "").includes("not_found")) throw new Error(explain(data, `Dropbox answered ${res.status}`));
    }
    return "ok";
  } catch (err) {
    await noteError(cfg, err.message);
    return err.message;
  }
}
