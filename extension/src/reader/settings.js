/* Reading Mode — persisted reader preferences (chrome.storage.local).
 * Plain content script; attaches to the shared VHReader namespace.
 */
(() => {
  "use strict";
  const NS = (globalThis.VHReader = globalThis.VHReader || {});
  const KEY = "vh_reader";

  const DEFAULTS = {
    theme: "light", // light | dark | sepia | black
    font: "georgia",
    fontSize: 18, // px, 14–28
    lineHeight: 1.6, // 1.3–2.4
    letterSpacing: 0, // px, -0.5–3
    width: 750, // px, 600–1000
    showImages: true,
    showLinks: true,
  };

  const clamp = (v, min, max, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };

  function sanitize(raw) {
    const s = { ...DEFAULTS, ...(raw || {}) };
    return {
      theme: ["light", "dark", "sepia", "black"].includes(s.theme) ? s.theme : DEFAULTS.theme,
      font: typeof s.font === "string" ? s.font : DEFAULTS.font,
      fontSize: clamp(s.fontSize, 14, 28, DEFAULTS.fontSize),
      lineHeight: clamp(s.lineHeight, 1.3, 2.4, DEFAULTS.lineHeight),
      letterSpacing: clamp(s.letterSpacing, -0.5, 3, DEFAULTS.letterSpacing),
      width: clamp(s.width, 600, 1000, DEFAULTS.width),
      showImages: s.showImages !== false,
      showLinks: s.showLinks !== false,
    };
  }

  let cache = { ...DEFAULTS };
  const listeners = new Set();

  function load() {
    return new Promise((resolve) => {
      chrome.storage.local.get(KEY, (res) => {
        cache = sanitize(res[KEY]);
        resolve({ ...cache });
      });
    });
  }

  function save(patch) {
    cache = sanitize({ ...cache, ...patch });
    chrome.storage.local.set({ [KEY]: cache });
    listeners.forEach((cb) => cb({ ...cache }));
    return { ...cache };
  }

  // Keep multiple tabs in sync.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[KEY]) return;
    const next = sanitize(changes[KEY].newValue);
    if (JSON.stringify(next) === JSON.stringify(cache)) return;
    cache = next;
    listeners.forEach((cb) => cb({ ...cache }));
  });

  NS.settings = {
    DEFAULTS,
    load,
    save,
    get: () => ({ ...cache }),
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
})();
