const form = document.getElementById("form");
const address = document.getElementById("address");
const status = document.getElementById("status");

function say(message, bad) {
  status.textContent = message;
  status.className = bad ? "bad" : "";
}

function toOrigin(input) {
  let raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  return new URL(raw).origin;
}

async function check(base) {
  try {
    const res = await fetch(base + "/api/status");
    const data = await res.json();
    if (typeof data.configured !== "boolean") throw new Error();
    const cookie = await chrome.cookies.get({ url: base, name: "later_session" });
    if (!data.configured) return say("Connected. Open your site once to choose a password, then you're set.");
    if (!cookie) return say("Connected. Now sign in at " + base + " and the button will work.");
    say("Connected and signed in. Click the Later button on any page to save it.");
  } catch {
    say("That address doesn't look like a Later site. Check it and try again.", true);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  let base;
  try {
    base = toOrigin(address.value);
  } catch {
    return say("That isn't a valid address.", true);
  }
  // Must be asked for directly from this click.
  const granted = await chrome.permissions.request({ origins: [base + "/*"] });
  if (!granted) return say("Chrome needs your permission to talk to that site.", true);
  await chrome.storage.local.set({ base });
  address.value = base;
  say("Checking…");
  check(base);
});

chrome.storage.local.get("base").then(({ base }) => {
  if (!base) return;
  address.value = base;
  check(base);
});
