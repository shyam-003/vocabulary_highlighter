/* Reading Mode — fonts and typography controls.
 * Applies user typography as CSS custom properties on the overlay root.
 */
(() => {
  "use strict";
  const NS = (globalThis.VHReader = globalThis.VHReader || {});

  const FONTS = [
    { id: "georgia", label: "Georgia", stack: 'Georgia, "Times New Roman", serif' },
    { id: "merriweather", label: "Merriweather", stack: '"Merriweather", Georgia, serif' },
    { id: "inter", label: "Inter", stack: '"Inter", -apple-system, "Segoe UI", sans-serif' },
    { id: "open-sans", label: "Open Sans", stack: '"Open Sans", -apple-system, "Segoe UI", sans-serif' },
    { id: "source-serif", label: "Source Serif 4", stack: '"Source Serif 4", Georgia, serif' },
    { id: "atkinson", label: "Atkinson Hyperlegible", stack: '"Atkinson Hyperlegible", -apple-system, sans-serif' },
  ];

  const RANGES = {
    fontSize: { min: 14, max: 28, step: 1, unit: "px", label: "Font size" },
    lineHeight: { min: 1.3, max: 2.4, step: 0.05, unit: "", label: "Line height" },
    letterSpacing: { min: -0.5, max: 3, step: 0.1, unit: "px", label: "Letter spacing" },
    width: { min: 600, max: 1000, step: 10, unit: "px", label: "Content width" },
  };

  NS.typography = {
    fonts: FONTS,
    ranges: RANGES,
    apply(rootEl, settings) {
      if (!rootEl || !settings) return;
      const font = FONTS.find((f) => f.id === settings.font) || FONTS[0];
      rootEl.style.setProperty("--vh-r-font", font.stack);
      rootEl.style.setProperty("--vh-r-size", `${settings.fontSize}px`);
      rootEl.style.setProperty("--vh-r-lh", String(settings.lineHeight));
      rootEl.style.setProperty("--vh-r-ls", `${settings.letterSpacing}px`);
      rootEl.style.setProperty("--vh-r-width", `${settings.width}px`);
    },
  };
})();
