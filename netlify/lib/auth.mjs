import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { readAuth, writeAuth } from "./store.mjs";

export const COOKIE = "later_session";
const YEAR = 60 * 60 * 24 * 365;
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60 * 1000;

const sha = (s) => createHash("sha256").update(s).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString("hex");
}

function safeEqualHex(a, b) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

export function sessionCookie(token, req) {
  const secure = new URL(req.url).protocol === "https:" ? " Secure;" : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${YEAR}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function presentedToken(req) {
  const header = req.headers.get("authorization") || "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  const cookies = req.headers.get("cookie") || "";
  for (const part of cookies.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return null;
}

// Returns { configured, authed, auth, tokenHash }
export async function check(req) {
  const auth = await readAuth();
  if (!auth) return { configured: false, authed: false, auth: null };
  const token = presentedToken(req);
  if (!token) return { configured: true, authed: false, auth };
  const h = sha(token);
  const authed =
    (auth.sessions || []).some((s) => s.hash === h) ||
    (auth.tokens || []).some((t) => t.hash === h);
  return { configured: true, authed, auth, tokenHash: h };
}

export async function setup(password) {
  if (await readAuth()) return { error: "Already set up", status: 409 };
  if (typeof password !== "string" || password.length < 8)
    return { error: "Use a password of at least 8 characters", status: 400 };
  const salt = randomBytes(16).toString("hex");
  const token = newToken();
  await writeAuth({
    salt,
    hash: hashPassword(password, salt),
    sessions: [{ hash: sha(token), created: Date.now() }],
    tokens: [],
    fails: 0,
    lockedUntil: 0,
  });
  return { token };
}

export async function login(password) {
  const auth = await readAuth();
  if (!auth) return { error: "Not set up yet", status: 409 };
  if (auth.lockedUntil && Date.now() < auth.lockedUntil)
    return { error: "Too many attempts. Try again in a few minutes.", status: 429 };
  const ok =
    typeof password === "string" &&
    safeEqualHex(hashPassword(password, auth.salt), auth.hash);
  if (!ok) {
    auth.fails = (auth.fails || 0) + 1;
    if (auth.fails >= MAX_FAILS) {
      auth.lockedUntil = Date.now() + LOCK_MS;
      auth.fails = 0;
    }
    await writeAuth(auth);
    return { error: "Wrong password", status: 401 };
  }
  const token = newToken();
  auth.fails = 0;
  auth.lockedUntil = 0;
  auth.sessions = [...(auth.sessions || []), { hash: sha(token), created: Date.now() }].slice(-30);
  await writeAuth(auth);
  return { token };
}

export async function logout(tokenHash) {
  const auth = await readAuth();
  if (!auth) return;
  auth.sessions = (auth.sessions || []).filter((s) => s.hash !== tokenHash);
  await writeAuth(auth);
}

// Long-lived tokens for the iOS Shortcut and other scripts.
export async function createToken(label) {
  const auth = await readAuth();
  const token = newToken();
  const entry = {
    id: randomBytes(6).toString("hex"),
    label: String(label || "Device").slice(0, 60),
    hash: sha(token),
    created: Date.now(),
  };
  auth.tokens = [...(auth.tokens || []), entry];
  await writeAuth(auth);
  return { id: entry.id, label: entry.label, created: entry.created, token };
}

export function listTokens(auth) {
  return (auth.tokens || []).map(({ id, label, created }) => ({ id, label, created }));
}

export async function revokeToken(id) {
  const auth = await readAuth();
  auth.tokens = (auth.tokens || []).filter((t) => t.id !== id);
  await writeAuth(auth);
}
