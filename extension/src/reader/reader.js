/* Reading Mode — orchestrator.
 * Wires extraction (readability.js), rendering (renderer.js), the overlay
 * shell (overlay.js), the toolbar (toolbar.js), persisted preferences
 * (settings.js) and the shared vocabulary pipeline (highlight.js) together.
 *
 * Public API (globalThis.VHReader): open(), close(), toggle(),
 * refreshHighlights() — the last one is called by content.js whenever the
 * known-word list or the enabled flag changes.
 */
(() => {
  "use strict";
  if (location.pathname.endsWith("options.html") || location.pathname.endsWith("popup.html")) return;
  const NS = (globalThis.VHReader = globalThis.VHReader || {});

  let isOpen = false;
  let toolbar = null;
  let contentEl = null; // .vh-reader-content — the only highlighted region
  let unsubscribeSettings = null;
  let onScrollCapture = null;
  let onLinkClickCapture = null;

  function applyAll(settings) {
    const refs = NS.overlay.refs();
    if (!refs) return;
    NS.themes.apply(refs.root, settings.theme);
    NS.typography.apply(refs.root, settings);
    refs.root.dataset.vhImages = settings.showImages ? "on" : "off";
    refs.root.dataset.vhLinks = settings.showLinks ? "on" : "off";
    // Links rendered as plain text should behave like plain text for the
    // word popup (see the click handler in content.js) and for keyboards.
    if (contentEl) {
      contentEl.querySelectorAll("a[href]").forEach((a) => {
        if (settings.showLinks) {
          delete a.dataset.vhPlain;
          a.removeAttribute("tabindex");
          a.removeAttribute("aria-disabled");
        } else {
          a.dataset.vhPlain = "1";
          a.setAttribute("tabindex", "-1");
          a.setAttribute("aria-disabled", "true");
        }
      });
    }
    // The popup card + highlight colors follow the reader theme, not the page.
    NS.highlight.setForcedDark(NS.themes.isDark(settings.theme));
    if (toolbar) toolbar.applyState(settings);
  }

  function renderError(pageEl) {
    const box = document.createElement("div");
    box.className = "vh-reader-error";
    const msg = document.createElement("p");
    msg.className = "vh-reader-error__msg";
    msg.textContent = "This page doesn't appear to contain a readable article.";
    const btn = document.createElement("button");
    btn.className = "vh-reader-error__btn";
    btn.type = "button";
    btn.textContent = "Return to original page";
    btn.addEventListener("click", close);
    box.appendChild(msg);
    box.appendChild(btn);
    pageEl.appendChild(box);
    btn.focus();
  }

  async function open() {
    if (isOpen) return;
    isOpen = true;

    const settings = await NS.settings.load();
    const article = NS.readability.extract();

    const refs = NS.overlay.mount(article ? article.title || "Reading mode" : "Reading mode");

    toolbar = NS.toolbar.build(refs.root, {
      settings,
      onClose: close,
      onChange: (patch) => {
        const next = NS.settings.save(patch);
        applyAll(next);
      },
    });

    if (!article) {
      contentEl = null;
      NS.themes.apply(refs.root, settings.theme);
      NS.typography.apply(refs.root, settings);
      toolbar.applyState(settings);
      renderError(refs.page);
      wireGlobalHandlers(refs);
      return;
    }

    const { header, content } = NS.renderer.render(article);
    contentEl = content;
    refs.page.appendChild(header);
    refs.page.appendChild(content);

    applyAll(settings);
    NS.highlight.run(contentEl);
    wireGlobalHandlers(refs);

    // Follow preference changes made from another tab.
    unsubscribeSettings = NS.settings.onChange((next) => {
      if (isOpen) applyAll(next);
    });
  }

  function wireGlobalHandlers(refs) {
    // The word popup is positioned against the (locked) page, so it can't
    // follow the reader's inner scroll — close it instead of letting it drift.
    onScrollCapture = () => NS.highlight.closePopup();
    refs.scroller.addEventListener("scroll", onScrollCapture, { passive: true });

    // With links off, swallow navigation; the text stays readable/clickable.
    onLinkClickCapture = (e) => {
      if (refs.root.dataset.vhLinks === "off" && e.target.closest && e.target.closest(".vh-reader-content a")) {
        e.preventDefault();
      }
    };
    refs.root.addEventListener("click", onLinkClickCapture, true);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;

    NS.highlight.closePopup();
    NS.highlight.setForcedDark(null);
    if (unsubscribeSettings) {
      unsubscribeSettings();
      unsubscribeSettings = null;
    }
    if (toolbar) {
      toolbar.destroy();
      toolbar = null;
    }
    const refs = NS.overlay.refs();
    if (refs && onScrollCapture) refs.scroller.removeEventListener("scroll", onScrollCapture);
    if (refs && onLinkClickCapture) refs.root.removeEventListener("click", onLinkClickCapture, true);
    onScrollCapture = null;
    onLinkClickCapture = null;
    contentEl = null;
    NS.overlay.unmount();
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  // Re-run the scoped highlight after content.js clears/rebuilds page
  // highlights (known-word changes, enable/disable, cross-tab sync).
  function refreshHighlights() {
    if (!isOpen || !contentEl) return;
    NS.highlight.clear(contentEl);
    NS.highlight.run(contentEl);
  }

  // ---- global wiring ----------------------------------------------------
  document.addEventListener("keydown", (e) => {
    if (!isOpen) {
      // Alt+R opens Reading Mode from anywhere on the page.
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyR") {
        e.preventDefault();
        open();
      }
      return;
    }
    if (e.key === "Escape" && !e.defaultPrevented) {
      // The word popup's own Esc handler (capture) runs first and marks the
      // event; a bare Esc closes the settings popover, then the reader.
      if (toolbar && toolbar.isPanelOpen()) {
        e.preventDefault();
        toolbar.closePanel();
        return;
      }
      e.preventDefault();
      close();
    } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyR") {
      e.preventDefault();
      close();
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "vh:open-reader") {
      toggle();
      sendResponse({ ok: true, open: isOpen });
      return true;
    }
  });

  NS.open = open;
  NS.close = close;
  NS.toggle = toggle;
  NS.refreshHighlights = refreshHighlights;
  NS.isOpen = () => isOpen;
})();
