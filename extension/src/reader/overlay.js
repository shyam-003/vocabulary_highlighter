/* Reading Mode — full-screen overlay shell.
 * Owns mounting/unmounting, fade animations, page scroll locking, and focus
 * management. The original page is never navigated or mutated beyond the
 * overlay element and a scroll-lock class on <html>.
 */
(() => {
  "use strict";
  const NS = (globalThis.VHReader = globalThis.VHReader || {});

  const FADE_MS = 220;
  let root = null;
  let previousFocus = null;

  function focusables() {
    if (!root) return [];
    return Array.from(
      root.querySelectorAll(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.disabled && el.offsetParent !== null);
  }

  // Simple focus trap: Tab cycles within the overlay while it is open.
  function onTrapKeydown(e) {
    if (e.key !== "Tab" || !root) return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function mount(labelText) {
    if (root) return refs();
    previousFocus = document.activeElement;

    root = document.createElement("div");
    // .vh-ui keeps the page-level highlighting pass and word-click handler out
    // of the reader chrome; the article container opts back in explicitly.
    root.className = "vh-reader-root vh-ui";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", labelText || "Reading mode");

    const scroller = document.createElement("div");
    scroller.className = "vh-reader-scroll";
    scroller.tabIndex = -1; // programmatic focus target; keeps arrow-key scrolling

    const page = document.createElement("article");
    page.className = "vh-reader-page";
    scroller.appendChild(page);
    root.appendChild(scroller);
    document.body.appendChild(root);

    document.documentElement.classList.add("vh-reader-open");
    document.addEventListener("keydown", onTrapKeydown, true);

    // Fade in on the next frame so the transition actually runs.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => root && root.classList.add("is-open"));
    });
    scroller.focus({ preventScroll: true });

    return refs();
  }

  function refs() {
    return root
      ? { root, scroller: root.querySelector(".vh-reader-scroll"), page: root.querySelector(".vh-reader-page") }
      : null;
  }

  function unmount() {
    if (!root) return;
    const el = root;
    root = null;
    document.removeEventListener("keydown", onTrapKeydown, true);
    document.documentElement.classList.remove("vh-reader-open");

    el.classList.remove("is-open");
    window.setTimeout(() => el.remove(), FADE_MS);

    if (previousFocus && typeof previousFocus.focus === "function" && previousFocus.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
    previousFocus = null;
  }

  NS.overlay = {
    mount,
    unmount,
    refs,
    isMounted: () => !!root,
  };
})();
