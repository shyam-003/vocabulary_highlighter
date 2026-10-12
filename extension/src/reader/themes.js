/* Reading Mode — theme definitions and application.
 * Colors live in reader.css keyed off data-vh-theme; this module only knows
 * the list, applies the attribute, and reports whether a theme is dark so the
 * shared popup/highlight UI can follow.
 */
(() => {
  "use strict";
  const NS = (globalThis.VHReader = globalThis.VHReader || {});

  const THEMES = [
    { id: "light", label: "Light", swatch: "#F7F3EC", dark: false },
    { id: "dark", label: "Dark", swatch: "#1E1B18", dark: true },
    { id: "sepia", label: "Sepia", swatch: "#EFE3D2", dark: false },
    { id: "black", label: "Charcoal", swatch: "#15120F", dark: true },
  ];

  NS.themes = {
    list: THEMES,
    isDark(id) {
      const t = THEMES.find((t) => t.id === id);
      return !!(t && t.dark);
    },
    apply(rootEl, id) {
      if (!rootEl) return;
      rootEl.dataset.vhTheme = THEMES.some((t) => t.id === id) ? id : "light";
    },
  };
})();
