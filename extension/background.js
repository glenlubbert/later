import { BASES } from "./config.js";

const COOKIE = "later_session";
const MAX_HTML = 3_500_000;

// The extension rides on your website sign-in: no separate setup.
async function findSession() {
  for (const base of BASES) {
    const cookie = await chrome.cookies.get({ url: base, name: COOKIE });
    if (cookie?.value) return { base, token: cookie.value };
  }
  return null;
}

function badge(text, color, tabId) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text, tabId });
  if (text !== "…") setTimeout(() => chrome.action.setBadgeText({ text: "", tabId }).catch(() => {}), 3000);
}

// Runs inside the page: a small confirmation in the top-right corner.
function pageToast(message, tone) {
  const id = "later-extension-toast";
  document.getElementById(id)?.remove();
  const el = document.createElement("div");
  el.id = id;
  el.textContent = message;
  el.style.cssText =
    "all:initial;position:fixed;top:18px;right:18px;z-index:2147483647;padding:11px 16px;border-radius:12px;" +
    "font:600 14px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fff;" +
    "box-shadow:0 8px 28px rgba(0,0,0,.28);max-width:340px;transition:opacity .25s;" +
    "background:" + (tone === "error" ? "#b3261e" : tone === "busy" ? "#55504a" : "#b5492c");
  document.documentElement.appendChild(el);
  if (tone !== "busy") setTimeout(() => ((el.style.opacity = "0"), setTimeout(() => el.remove(), 300)), 2400);
}

async function show(tabId, message, tone) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: pageToast, args: [message, tone] });
  } catch {
    // Pages like chrome:// can't be scripted; the toolbar badge still reports.
  }
}

async function grabPage(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({ html: document.documentElement.outerHTML, title: document.title }),
    });
    return result || {};
  } catch {
    return {};
  }
}

async function save(tab, linkUrl) {
  const url = linkUrl || tab?.url || "";
  const tabId = tab?.id;
  if (!/^https?:/i.test(url)) return badge("!", "#b3261e", tabId);

  const session = await findSession();
  if (!session) {
    await show(tabId, "Sign in to Later first", "error");
    chrome.tabs.create({ url: BASES[0] });
    return;
  }

  badge("…", "#55504a", tabId);
  show(tabId, "Saving to Later…", "busy");

  const payload = { url };
  if (!linkUrl) {
    // Send what you are actually looking at, so logged-in and
    // script-rendered pages are captured properly.
    const page = await grabPage(tabId);
    payload.title = page.title || tab.title;
    if (page.html && page.html.length < MAX_HTML) payload.html = page.html;
  }

  try {
    const res = await fetch(session.base + "/api/save", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + session.token },
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      await show(tabId, "Sign in to Later first", "error");
      chrome.tabs.create({ url: session.base });
      return badge("!", "#b3261e", tabId);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Couldn't save this page");
    badge("✓", "#2e7d4f", tabId);
    show(tabId, data.duplicate ? "Already in Later, moved to the top" : "Saved to Later", "ok");
  } catch (err) {
    badge("!", "#b3261e", tabId);
    show(tabId, err.message || "Couldn't reach Later", "error");
  }
}

chrome.action.onClicked.addListener((tab) => save(tab));

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "save-link", title: "Save link to Later", contexts: ["link"] });
  chrome.contextMenus.create({ id: "save-page", title: "Save page to Later", contexts: ["page"] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "save-link") save(tab, info.linkUrl);
  else save(tab);
});
