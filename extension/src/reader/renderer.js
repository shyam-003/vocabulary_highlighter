/* Reading Mode — turns a Readability article into the DOM shown in the
 * overlay: sanitized content plus a title/byline header.
 */
(() => {
  "use strict";
  const NS = (globalThis.VHReader = globalThis.VHReader || {});

  // Element types that never belong in a reading view.
  const DROP_TAGS = new Set([
    "SCRIPT", "STYLE", "LINK", "META", "IFRAME", "FRAME", "FRAMESET",
    "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA",
    "CANVAS", "NOSCRIPT", "DIALOG", "TEMPLATE", "SLOT",
  ]);

  function sanitizeElement(el) {
    // Depth-first so removals don't skip siblings.
    const children = Array.from(el.children);
    for (const child of children) {
      if (DROP_TAGS.has(child.tagName)) {
        child.remove();
        continue;
      }
      sanitizeElement(child);
    }

    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      else if (name === "style" || name === "class") el.removeAttribute(attr.name);
      else if ((name === "href" || name === "src") && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }

    if (el.tagName === "A") {
      const href = el.getAttribute("href") || "";
      // External links leave the reader intact; in-page anchors stay in-page.
      if (href && !href.startsWith("#")) {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
    }
    if (el.tagName === "IMG") {
      el.setAttribute("loading", "lazy");
      el.removeAttribute("width");
      el.removeAttribute("height");
    }
  }

  function sanitizeArticleHtml(html) {
    const doc = new DOMParser().parseFromString(html || "", "text/html");
    sanitizeElement(doc.body);
    const container = document.createElement("div");
    container.className = "vh-reader-content";
    while (doc.body.firstChild) container.appendChild(doc.body.firstChild);
    return container;
  }

  function readingTimeMinutes(text) {
    const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 220));
  }

  function buildHeader(article) {
    const header = document.createElement("header");
    header.className = "vh-reader-header";

    const title = document.createElement("h1");
    title.className = "vh-reader-title";
    title.textContent = article.title || document.title || "Untitled";
    header.appendChild(title);

    const meta = document.createElement("p");
    meta.className = "vh-reader-meta";
    const bits = [];
    if (article.byline) bits.push(article.byline.trim());
    bits.push(location.hostname.replace(/^www\./, ""));
    bits.push(`${readingTimeMinutes(article.textContent)} min read`);
    meta.textContent = bits.join(" · ");
    header.appendChild(meta);

    return header;
  }

  NS.renderer = {
    // -> { header, content } detached elements ready to mount in the overlay.
    render(article) {
      return {
        header: buildHeader(article),
        content: sanitizeArticleHtml(article.content),
      };
    },
  };
})();
