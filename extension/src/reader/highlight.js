/* Reading Mode — bridge into the existing vocabulary pipeline in
 * src/content/content.js (exposed as globalThis.__VHContent).
 * The reader never re-implements highlighting or the word popup; it only
 * points the shared pipeline at the extracted article container.
 */
(() => {
  "use strict";
  const NS = (globalThis.VHReader = globalThis.VHReader || {});

  const api = () => globalThis.__VHContent || null;

  NS.highlight = {
    run(containerEl) {
      const a = api();
      if (a && containerEl) a.highlightElement(containerEl);
    },
    clear(containerEl) {
      const a = api();
      if (a && containerEl) a.unwrapElement(containerEl);
    },
    closePopup() {
      const a = api();
      if (a) a.closePopup();
    },
    setForcedDark(value) {
      const a = api();
      if (a) a.setForcedDark(value);
    },
  };
})();
