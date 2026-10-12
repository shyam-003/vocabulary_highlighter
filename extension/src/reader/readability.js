/* Reading Mode — article extraction via Mozilla Readability (vendored in
 * src/vendor/readability.js as globalThis.VHReadabilityLib).
 *
 * The live DOM is cloned so the page is never touched, extension UI and
 * existing highlight spans are stripped from the clone, and the result is
 * cached per URL so Readability runs at most once per page view.
 */
(() => {
  "use strict";
  const NS = (globalThis.VHReader = globalThis.VHReader || {});

  let cached = null; // { href, article }

  // The clone contains our own injected UI and highlight spans; remove them so
  // Readability scores the page as the user originally received it.
  function stripExtensionArtifacts(docClone) {
    // Unwrap highlight spans FIRST: they also carry the .vh-ui class, so a
    // blanket .vh-ui removal would delete the highlighted words with them.
    docClone.querySelectorAll("span.vh-unknown").forEach((span) => {
      span.replaceWith(docClone.createTextNode(span.textContent));
    });
    docClone.querySelectorAll(".vh-popup, .vh-float, .vh-panel, .vh-reader-root").forEach((el) => el.remove());
  }

  function extract() {
    if (cached && cached.href === location.href) return cached.article;

    let article = null;
    try {
      const Readability = globalThis.VHReadabilityLib && globalThis.VHReadabilityLib.Readability;
      if (Readability) {
        const docClone = document.cloneNode(true);
        stripExtensionArtifacts(docClone);
        article = new Readability(docClone, { keepClasses: false }).parse();
      }
    } catch (_) {
      article = null;
    }

    // Reject junk extractions (empty or near-empty bodies).
    if (article && (!article.content || !article.textContent || article.textContent.trim().length < 140)) {
      article = null;
    }

    cached = { href: location.href, article };
    return article;
  }

  NS.readability = {
    extract,
    invalidate() {
      cached = null;
    },
  };
})();
