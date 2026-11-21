# Later

A personal read-it-later app: save pages from Chrome or the iPhone/iPad share
sheet, read them in a clean reader view on any device.

- **Web app** (`public/`): list, search, reader view, likes, archive, offline reading. No build step.
- **API** (`netlify/functions/api.mjs`): one Netlify Function at `/api/*`. Articles are stored in Netlify Blobs; page text is extracted with Mozilla Readability.
- **Chrome extension** (`extension/`): toolbar button, `Option+Shift+S`, and right-click "Save link to Later". Uses your website sign-in.
- **iPhone / iPad** (`public/later.shortcut`): a signed Shortcut that adds "Save to Later" to the share sheet. Built by `scripts/make_shortcut.py`.

- **Highlights** (`netlify/lib/highlights.mjs`, `netlify/lib/dropbox.mjs`): select text in the reader to highlight and add notes. Each highlighted article is written as a Markdown file to a Dropbox folder (connected under Settings, via the Dropbox app "Later Highlights GL").

## Run locally

    npm install
    npm run dev        # http://localhost:8899, with a throwaway local data store

## Deploy

    npm run deploy     # needs `npx netlify-cli login` once

The site is the Netlify project `later-glenlubbert`, served at
https://read.glenlubbert.com (CNAME `read` -> `later-glenlubbert.netlify.app`).

## Sign-in

The first visit asks you to choose a password. Only a salted hash is stored.
Forgot it? Delete the `auth` key from the `later` blob store
(`npx netlify-cli blobs:delete later auth`) and the site asks for a new one;
your articles are untouched.

## After changing things

- Extension code: `npm run zip` refreshes the download on the settings page, then reload the extension in `chrome://extensions`.
- Site address: update `extension/config.js`, `extension/manifest.json`, and run `npm run shortcut`.
