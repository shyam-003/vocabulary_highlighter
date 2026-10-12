# Vocabulary Highlighter

A Chrome extension (Manifest V3) that highlights the words you don't know yet on
any web page and helps you learn them one click at a time.

## What it does

- Words **not** in your personal "known" dictionary are highlighted on every page.
- Click **any** word — highlighted or not — to open a card showing:
  - the **word** (bold heading)
  - its **part of speech** — e.g. `(noun)` (hidden if unavailable)
  - the **definition**
  - a natural **example sentence** (hidden if unavailable)
  - a **Translate** link (Google Translate, respects your target language)
  - **Know word** / **Cancel** buttons
  - `Press Enter to mark as known`
- **Enter** marks the word known (adds it to your dictionary and stops highlighting it everywhere); **Esc** closes the card.
- Floating buttons (bottom-right of any page) let you disable highlighting or list every unknown word on the current page.
- Right-click a selected word → **Mark as known** for a quick add.
- A dashboard (the extension's options page) with usage stats, a streak, a
  "known words added" chart, add / import / export, and full known-word management.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder
   (`vocabulary-highlighter`, the one containing `manifest.json`).
4. Open any article and start clicking words. Open the toolbar popup for stats,
   or **Settings** for the full dashboard.

## Data source

Definitions and parts of speech come from the [Datamuse](https://www.datamuse.com/api/)
API. Results are cached (30 days) so re-opening the same word costs no extra request. An
example sentence is generated when the dictionary provides none.

## Project layout

```
manifest.json            MV3 manifest
icons/                   generated PNG icons (see scripts/make_icons.py)
src/
  background/background.js  install seeding, context menu, cached lookups (service worker)
  content/content.js        highlighting engine + the popup card (injected on every page)
  content/content.css       highlight, popup, floating-control, and panel styles
  popup/                    toolbar popup (enable/disable, language, page + streak stats)
  options/                  full dashboard (settings, metrics, chart, word management)
  lib/storage.js            known words, settings, and stats (chrome.storage.local)
  lib/dictionary.js         Datamuse API lookup + parsing + fallback example
  lib/seed-words.js         starter list of common words treated as "known"
```

Storage lives in `chrome.storage.local` so a large dictionary never hits sync's
per-item quota.

## Notes

- Icons are generated deterministically: `python3 scripts/make_icons.py`.
- The known dictionary is seeded on first install so a fresh page isn't a wall of
  highlights; you grow it by marking words known.
