/* Vocabulary Highlighter — content script (plain script, no ES modules).
 *
 * Responsibilities:
 *   - Highlight words that are NOT in the user's "known" dictionary.
 *   - Open a popup card for ANY clicked word (known or unknown) showing the
 *     word, part of speech, definition, an example sentence, and a Translate
 *     link, plus "Know word" / "Cancel" actions.
 *   - Keep highlights in sync as the known list / settings change.
 *
 * Storage keys are duplicated here (content scripts can't import the storage
 * module). Keep them in sync with src/lib/storage.js.
 */
(() => {
  "use strict";
  if (window.__vhLoaded) return; // guard against double injection
  if (location.pathname.endsWith("options.html") || location.pathname.endsWith("popup.html")) return;
  window.__vhLoaded = true;

  const K_KNOWN = "vh_known";
  const K_VOCAB_RECORDS = "vh_vocabulary_records";
  const K_SETTINGS = "vh_settings";
  const normalizeWord = globalThis.VHNormalizer.normalizeWord;
  const normalizeKnownMap = globalThis.VHNormalizer.normalizeKnownMap;
  const DEFAULT_SETTINGS = {
    enabled: false,
    translateLang: "en",
    colors: { known: "#DCE5D8", similar: "#EFE3CF", unknown: "#F4D5C3" },
    minWordLength: 3,
  };

  const state = {
    known: new Set(), // lowercase words
    vocabRecords: new Map(), // lemma -> record
    dismissed: new Set(), // session-only: cancelled words stay unhighlighted but are NOT saved as known
    pageDisabled: false, // session-only: "Disable highlighting" turns off THIS page, not the global setting
    settings: { ...DEFAULT_SETTINGS },
    total: 0, // total eligible word tokens on the page
    unknownCount: 0, // eligible tokens not known
    unknownWords: new Map(), // lemma -> { word: first page form, count }
    activePopup: null,
    defCache: new Map(), // in-session lookup cache: word -> data
    prefetching: new Set(), // words currently being prefetched
  };

  const WORD_RE = /[A-Za-z][A-Za-z'’-]*/g;
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT",
    "CODE", "PRE", "KBD", "SVG",
  ]);

  // ---------------------------------------------------------------------
  // Storage helpers
  // ---------------------------------------------------------------------
  function loadState() {
    return new Promise((resolve) => {
      chrome.storage.local.get([K_KNOWN, K_VOCAB_RECORDS, K_SETTINGS], (res) => {
        const knownMap = normalizeKnownMap(res[K_KNOWN] || {});
        state.known = new Set(Object.keys(knownMap));
        const records = res[K_VOCAB_RECORDS] || {};
        state.vocabRecords.clear();
        for (const [k, rec] of Object.entries(records)) {
          const norm = normalizeWord(k) || k.toLowerCase();
          state.vocabRecords.set(norm, rec);
        }
        state.settings = {
          ...DEFAULT_SETTINGS,
          ...(res[K_SETTINGS] || {}),
          colors: { ...DEFAULT_SETTINGS.colors, ...((res[K_SETTINGS] || {}).colors || {}) },
        };
        resolve();
      });
    });
  }

  function isActive() {
    return state.settings.enabled && !state.pageDisabled;
  }

  function isEligible(word) {
    return word.length >= state.settings.minWordLength && !!normalizeWord(word);
  }

  function isKnown(word) {
    const lemma = normalizeWord(word);
    if (!lemma) return false;
    return state.vocabRecords.has(lemma) || state.known.has(lemma);
  }

  // ---------------------------------------------------------------------
  // Highlighting
  // ---------------------------------------------------------------------
  // `boundary` lets the reader highlight inside its own overlay: the overlay
  // root carries .vh-ui (so the normal page pass skips it), and the scoped
  // pass stops the ancestor walk at the article container.
  function shouldSkipNode(node, boundary = null) {
    let el = node.parentElement;
    while (el && el !== boundary) {
      if (el.classList && el.classList.contains("vh-ui")) return true;
      if (SKIP_TAGS.has(el.tagName)) return true;
      if (el.isContentEditable) return true;
      el = el.parentElement;
    }
    return false;
  }

  function collectTextNodes(root = document.body, boundary = null) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (shouldSkipNode(node, boundary)) return NodeFilter.FILTER_REJECT;
        // Use a fresh, non-global test — WORD_RE is stateful (/g) and reused below.
        if (!/[A-Za-z]/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  // countStats=false for the reader's scoped pass: the same words were already
  // counted when the underlying page was highlighted.
  function highlightTextNode(node, countStats = true) {
    const text = node.nodeValue;
    WORD_RE.lastIndex = 0;
    let match;
    let last = 0;
    let frag = null;

    while ((match = WORD_RE.exec(text))) {
      const word = match[0];
      if (!isEligible(word)) continue;
      if (countStats) state.total++;
      const key = normalizeWord(word);
      if (isKnown(word) || state.dismissed.has(key)) continue;

      if (countStats) {
        state.unknownCount++;
        const entry = state.unknownWords.get(key);
        if (entry) entry.count += 1;
        else state.unknownWords.set(key, { word, count: 1 });
      }

      if (!frag) frag = document.createDocumentFragment();
      if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)));

      const span = document.createElement("span");
      span.className = "vh-unknown vh-ui";
      span.dataset.w = word;
      span.dataset.k = key;
      span.textContent = word;
      frag.appendChild(span);
      last = match.index + word.length;
    }

    if (frag) {
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
  }

  function clearHighlights() {
    document.querySelectorAll("span.vh-unknown").forEach((span) => {
      const t = document.createTextNode(span.textContent);
      span.parentNode.replaceChild(t, span);
      t.parentNode.normalize();
    });
  }

  function highlightPage() {
    if (!isActive()) return;
    state.total = 0;
    state.unknownCount = 0;
    state.unknownWords.clear();
    const nodes = collectTextNodes();
    // Process in idle chunks to stay responsive on large pages.
    let i = 0;
    const step = () => {
      const end = Math.min(i + 400, nodes.length);
      for (; i < end; i++) {
        if (nodes[i].parentNode) highlightTextNode(nodes[i]);
      }
      if (i < nodes.length) {
        (window.requestIdleCallback || window.setTimeout)(step);
      } else {
        applyColorVars();
        reportStats();
        refreshFloatingVisibility();
      }
    };
    step();
  }

  function parseRgb(color) {
    if (!color || color === "transparent") return null;
    const m = color.match(/rgba?\(\s*([\d.]+)(?:,|\s)\s*([\d.]+)(?:,|\s)\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/);
    if (!m) return null;
    const alpha = m[4] == null ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (alpha <= 0.05) return null;
    return { r: +m[1], g: +m[2], b: +m[3] };
  }

  function luminance(rgb) {
    return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
  }

  function backgroundAtPoint(x, y) {
    let el = document.elementFromPoint(x, y) || document.body || document.documentElement;
    while (el) {
      const rgb = parseRgb(getComputedStyle(el).backgroundColor);
      if (rgb) return rgb;
      el = el.parentElement;
    }
    return parseRgb(getComputedStyle(document.documentElement).backgroundColor);
  }

  // While the Reading Mode overlay is open its theme decides light/dark for
  // the injected UI (popup card, colors), not the page underneath.
  let forcedDark = null;

  // Sample the visible page instead of only <body>; many sites put their real
  // light/dark surface on an app wrapper.
  function detectDarkPage() {
    if (forcedDark !== null) return forcedDark;
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const samples = [
      backgroundAtPoint(w / 2, h / 2),
      backgroundAtPoint(Math.min(w - 1, 24), Math.min(h - 1, 24)),
      backgroundAtPoint(Math.max(0, w - 24), Math.min(h - 1, 24)),
      backgroundAtPoint(Math.min(w - 1, 24), Math.max(0, h - 24)),
      backgroundAtPoint(Math.max(0, w - 24), Math.max(0, h - 24)),
    ].filter(Boolean);
    if (!samples.length) return false; // browser default is white
    const avg = samples.reduce((sum, rgb) => sum + luminance(rgb), 0) / samples.length;
    return avg < 128;
  }

  function hexToRgba(hex, alpha) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return null;
    return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
  }

  function applyColorVars() {
    const root = document.documentElement;
    const isDark = detectDarkPage();
    root.classList.toggle("vh-dark-page", isDark);

    // Light page colors
    root.style.setProperty("--vh-unknown", state.settings.colors.unknown || "#F4D5C3");
    root.style.setProperty("--vh-known", state.settings.colors.known || "#a7e0b5");
    root.style.setProperty("--vh-similar", state.settings.colors.similar || "#f4f0b0");

    // Dark page colors
    const unknownDark = state.settings.colors.unknownDark || "#D77A52";
    root.style.setProperty("--vh-unknown-dark-val", unknownDark);
    root.style.setProperty("--vh-known-dark-val", state.settings.colors.knownDark || "#91A88B");
    root.style.setProperty("--vh-similar-dark-val", state.settings.colors.similarDark || "#C49455");

    const tint = hexToRgba(unknownDark, 0.26);
    if (tint) root.style.setProperty("--vh-unknown-dark-tint", tint);
  }

  let statsReported = false;
  function reportStats() {
    if (statsReported) return;
    statsReported = true;
    try {
      chrome.runtime.sendMessage({ type: "vh:activity" }).catch(() => {});
    } catch (_) {}
  }

 function unwrapWord(word) {
   const key = normalizeWord(word);
    document.querySelectorAll("span.vh-unknown").forEach((span) => {
      const spanKey = span.dataset.k || normalizeWord(span.dataset.w || "");
      if (spanKey === key) {
        const t = document.createTextNode(span.textContent);
        span.parentNode.replaceChild(t, span);
        t.parentNode.normalize();
      }
    });
   state.unknownWords.delete(key);
 }

  // ---------------------------------------------------------------------
  // Word-at-point detection (so clicking a NON-highlighted word also works)
  // ---------------------------------------------------------------------
  function wordAtPoint(x, y) {
    const range =
      (document.caretRangeFromPoint && document.caretRangeFromPoint(x, y)) ||
      (document.caretPositionFromPoint &&
        (() => {
          const p = document.caretPositionFromPoint(x, y);
          if (!p) return null;
          const r = document.createRange();
          r.setStart(p.offsetNode, p.offset);
          return r;
        })());
    if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return null;

    const text = range.startContainer.nodeValue;
    const offset = range.startOffset;
    let s = offset, e = offset;
    const isWordChar = (c) => c && /[A-Za-z'’-]/.test(c);
    while (s > 0 && isWordChar(text[s - 1])) s--;
    while (e < text.length && isWordChar(text[e])) e++;
    const word = text.slice(s, e).replace(/^['’-]+|['’-]+$/g, "");
    return word && /[A-Za-z]/.test(word) ? word : null;
  }

  // ---------------------------------------------------------------------
  // Popup card
  // ---------------------------------------------------------------------
  function closePopup() {
    if (state.activePopup) {
      state.activePopup.remove();
      state.activePopup = null;
    }
    document.removeEventListener("keydown", onPopupKeydown, true);
  }

  function onPopupKeydown(e) {
    if (!state.activePopup) return;
    if (state.activePopup.classList.contains("vh-popup--editing")) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelDefinitionEdit(state.activePopup);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const word = state.activePopup.dataset.word;
      markKnown(word);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelWord(state.activePopup.dataset.word);
    }
  }

  function markKnown(word) {
    const key = normalizeWord(word);
    chrome.runtime.sendMessage({ type: "vh:add-known", word }, () => {
      state.known.add(key);
      const cached = state.defCache.get(key) || {};
      if (!state.vocabRecords.has(key)) {
        state.vocabRecords.set(key, {
          word,
          normalizedWord: key,
          definition: cached.definition || null,
          partOfSpeech: cached.pos || null,
          exampleSentence: cached.example || cached.exampleSentence || null,
          pronunciation: cached.pronunciation || null,
          status: "known",
          updatedAt: new Date().toISOString(),
        });
      }
      unwrapWord(word);
      refreshFloatingVisibility();
      closePopup();
    });
  }

  // Cancel = dismiss for this page view: the highlight is removed but the
  // word is NOT saved as known, so it highlights again on the next page load.
  function cancelWord(word) {
    if (word) {
      state.dismissed.add(normalizeWord(word));
      unwrapWord(word);
    }
    closePopup();
  }

  function positionPopup(popup, rect) {
    const margin = 8;
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;
    let left = rect.left + rect.width / 2 - pw / 2 + window.scrollX;
    let top = rect.bottom + margin + window.scrollY;
    // flip above if it would overflow the bottom
    if (rect.bottom + margin + ph > window.innerHeight) {
      top = rect.top - ph - margin + window.scrollY;
    }
    left = Math.max(window.scrollX + margin, Math.min(left, window.scrollX + window.innerWidth - pw - margin));
    top = Math.max(window.scrollY + margin, top);
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }

  function buildPopup(word) {
    closePopup();
    const popup = document.createElement("div");
    popup.className = "vh-popup vh-ui";
    popup.dataset.word = word;
    popup.innerHTML = `
      <div class="vh-popup__header">
        <div class="vh-popup__word"></div>
        <span class="vh-popup__pron" hidden></span>
      </div>
      <div class="vh-popup__body">
        <span class="vh-popup__pos" hidden></span>
        <span class="vh-popup__def">Looking up…</span>
        <div class="vh-popup__example" hidden></div>
      </div>
      <div class="vh-popup__editor" contenteditable="true" role="textbox" aria-label="Edit meaning" hidden></div>
      <div class="vh-popup__cefr-edit-row" hidden>
        <div style="font-size: 11px; opacity: 0.8; margin-bottom: 4px; font-weight: 600;">CEFR Level:</div>
        <div class="vh-cefr-pills">
          <button type="button" class="vh-cefr-pill" data-lvl="A1">A1</button>
          <button type="button" class="vh-cefr-pill" data-lvl="A2">A2</button>
          <button type="button" class="vh-cefr-pill" data-lvl="B1">B1</button>
          <button type="button" class="vh-cefr-pill" data-lvl="B2">B2</button>
          <button type="button" class="vh-cefr-pill" data-lvl="C1">C1</button>
          <button type="button" class="vh-cefr-pill" data-lvl="C2">C2</button>
        </div>
      </div>
      <div class="vh-popup__example-edit-row" hidden>
        <div style="font-size: 11px; opacity: 0.8; margin-bottom: 4px; font-weight: 600;">Example Sentence:</div>
        <input type="text" class="vh-popup__example-input" placeholder="Add example sentence..." />
      </div>
      <div class="vh-popup__edit-actions" hidden>
        <button class="vh-btn vh-btn--primary vh-popup__save" data-act="save-definition">Save</button>
        <button class="vh-btn" data-act="cancel-edit">Cancel</button>
      </div>
      <div class="vh-popup__meta-row">
        <a class="vh-popup__translate" target="_blank" rel="noopener">translate</a>
        <button class="vh-popup__edit" data-act="edit" hidden>edit</button>
        <span class="vh-popup__cefr" title="Click to edit CEFR level" style="cursor: pointer;" hidden></span>
      </div>
      <div class="vh-popup__actions">
        <button class="vh-btn vh-btn--primary" data-act="know">known word</button>
        <button class="vh-btn" data-act="cancel">cancel</button>
      </div>
    `;
    popup.querySelector(".vh-popup__word").textContent = word;

    let selectedCefr = "";
    const pillBtns = popup.querySelectorAll(".vh-cefr-pill");
    pillBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        pillBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        selectedCefr = btn.dataset.lvl;
        popup.dataset.selectedCefr = selectedCefr;
      });
    });

    // Fetch CEFR level from background CEFR provider
    chrome.runtime.sendMessage({ type: "vh:get-cefr", word }, (res) => {
      const cefrEl = popup.querySelector(".vh-popup__cefr");
      if (res?.level) {
        selectedCefr = res.level;
        popup.dataset.cefr = res.level;
        popup.dataset.selectedCefr = res.level;
        if (cefrEl) {
          cefrEl.textContent = `${res.level} • CEFR level`;
          cefrEl.hidden = false;
        }
        pillBtns.forEach((b) => {
          b.classList.toggle("active", b.dataset.lvl === res.level);
        });
      }
    });

    const tl = state.settings.translateLang || "en";
    const link = popup.querySelector(".vh-popup__translate");
    link.href = `https://translate.google.com/?sl=auto&tl=${encodeURIComponent(tl)}&text=${encodeURIComponent(word)}&op=translate`;

    popup.querySelector('[data-act="know"]').addEventListener("click", () => markKnown(word));
    popup.querySelectorAll('[data-act="cancel"]').forEach((btn) => {
      btn.addEventListener("click", () => cancelWord(word));
    });
    popup.querySelector(".vh-popup__cefr")?.addEventListener("click", () => startDefinitionEdit(popup));
    popup.querySelector('[data-act="edit"]').addEventListener("click", () => startDefinitionEdit(popup));
    popup.querySelector('[data-act="save-definition"]').addEventListener("click", () => saveDefinitionEdit(popup));
    popup.querySelector('[data-act="cancel-edit"]').addEventListener("click", () => cancelDefinitionEdit(popup));
    // Clicks inside the popup shouldn't bubble to the document dismiss handler.
    popup.addEventListener("mousedown", (e) => e.stopPropagation());

    document.body.appendChild(popup);
    state.activePopup = popup;
    document.addEventListener("keydown", onPopupKeydown, true);
    return popup;
  }

  const ALLOWED_DEF_TAGS = new Set(["A", "B", "BR", "EM", "I", "P", "SPAN", "STRONG", "U"]);

  function sanitizeDefinitionHtml(html) {
    const doc = new DOMParser().parseFromString(`<div>${html || ""}</div>`, "text/html");
    const root = doc.body.firstElementChild;
    const cleanNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue);
      if (node.nodeType !== Node.ELEMENT_NODE) return document.createTextNode("");

      const tag = node.tagName;
      const out = ALLOWED_DEF_TAGS.has(tag)
        ? document.createElement(tag.toLowerCase())
        : document.createDocumentFragment();

      if (tag === "A" && out.nodeType === Node.ELEMENT_NODE) {
        const href = node.getAttribute("href") || "";
        if (/^https?:\/\//i.test(href)) {
          out.setAttribute("href", href);
          out.setAttribute("target", "_blank");
          out.setAttribute("rel", "noopener noreferrer");
        }
      }

      node.childNodes.forEach((child) => out.appendChild(cleanNode(child)));
      return out;
    };

    const container = document.createElement("div");
    root.childNodes.forEach((child) => container.appendChild(cleanNode(child)));
    return container.innerHTML.trim();
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function markdownDefinitionToHtml(markdown) {
    const escaped = escapeHtml(markdown);
    const body = escaped
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\n{2,}/g, "</p><p>")
      .replace(/\n/g, "<br>");
    return `<p>${body}</p>`;
  }

  function editorDefinitionHtml(editor) {
    const text = editor.textContent.trim();
    if (/\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\)/.test(text)) {
      return sanitizeDefinitionHtml(markdownDefinitionToHtml(text));
    }
    return sanitizeDefinitionHtml(editor.innerHTML);
  }

  function currentDefinitionHtml(popup) {
    const data = popup.__lookupData || {};
    if (data.fromVocabRecord && !data.customDefinition) return "";
    if (data.customDefinition && data.definitionHtml) return sanitizeDefinitionHtml(data.definitionHtml);
    if (data.definition) return escapeHtml(data.definition);
    return "";
  }

  function renderDefinition(popup, data) {
    const defEl = popup.querySelector(".vh-popup__def");
    const editBtn = popup.querySelector('[data-act="edit"]');
    const exampleEl = popup.querySelector(".vh-popup__example");

    if (data?.customDefinition && data.definitionHtml) {
      defEl.innerHTML = sanitizeDefinitionHtml(data.definitionHtml);
    } else if (data?.definition) {
      defEl.textContent = data.definition;
    } else if (data?.rateLimited) {
      const secs = Math.max(1, Math.ceil((data.cooldownMs || 60000) / 1000));
      const wait = secs >= 60 ? `${Math.ceil(secs / 60)} min` : `${secs}s`;
      defEl.textContent = `Dictionary limit reached. Try again in ${wait}.`;
    } else if (data?.transient) {
      // The dictionary service was unreachable — say so, rather than implying
      // the word has no definition. Reopening the popup retries.
      defEl.textContent = "Dictionary unreachable. Try again in a moment.";
    } else {
      defEl.textContent = "No definition found.";
    }

    const exampleText = data?.exampleSentence || data?.example;
    if (exampleEl) {
      if (exampleText && String(exampleText).trim()) {
        exampleEl.textContent = `“${String(exampleText).trim()}”`;
        exampleEl.hidden = false;
      } else {
        exampleEl.hidden = true;
        exampleEl.textContent = "";
      }
    }

    editBtn.hidden = false;
  }

  function setDefinitionEditMode(popup, editing) {
    popup.classList.toggle("vh-popup--editing", editing);
    popup.querySelector(".vh-popup__def").hidden = editing;
    popup.querySelector(".vh-popup__editor").hidden = !editing;
    const cefrRow = popup.querySelector(".vh-popup__cefr-edit-row");
    if (cefrRow) cefrRow.hidden = !editing;
    const exampleRow = popup.querySelector(".vh-popup__example-edit-row");
    if (exampleRow) exampleRow.hidden = !editing;
    const exampleEl = popup.querySelector(".vh-popup__example");
    if (exampleEl) {
      if (editing) {
        exampleEl.hidden = true;
      } else {
        const data = popup.__lookupData || {};
        const exampleText = data.exampleSentence || data.example;
        exampleEl.hidden = !exampleText || !String(exampleText).trim();
      }
    }
    popup.querySelector(".vh-popup__edit-actions").hidden = !editing;
    popup.querySelector('[data-act="edit"]').hidden = editing;
  }

  function startDefinitionEdit(popup) {
    const editor = popup.querySelector(".vh-popup__editor");
    editor.innerHTML = currentDefinitionHtml(popup);
    const exampleInput = popup.querySelector(".vh-popup__example-input");
    if (exampleInput) {
      const data = popup.__lookupData || {};
      exampleInput.value = data.exampleSentence || data.example || "";
    }
    setDefinitionEditMode(popup, true);
    editor.focus();
  }

  function cancelDefinitionEdit(popup) {
    setDefinitionEditMode(popup, false);
  }

  function saveDefinitionEdit(popup) {
    const word = popup.dataset.word;
    const editor = popup.querySelector(".vh-popup__editor");
    const definitionHtml = editorDefinitionHtml(editor);
    const definitionText = editor.textContent.trim();
    const exampleInput = popup.querySelector(".vh-popup__example-input");
    const exampleSentence = exampleInput ? exampleInput.value.trim() : null;

    const saveBtn = popup.querySelector('[data-act="save-definition"]');
    saveBtn.textContent = "Saving...";
    saveBtn.disabled = true;

    const selectedCefr = popup.dataset.selectedCefr;
    if (selectedCefr) {
      chrome.runtime.sendMessage({ type: "vh:save-cefr", word, cefrLevel: selectedCefr });
    }

    chrome.runtime.sendMessage(
      { type: "vh:save-definition", word, definitionHtml, definitionText, exampleSentence },
      (data) => {
        saveBtn.textContent = "Save";
        saveBtn.disabled = false;
        if (chrome.runtime.lastError || !data) return;
        const key = normalizeWord(word) || word.toLowerCase();
        state.defCache.set(key, data);
        if (state.vocabRecords.has(key)) {
          const rec = state.vocabRecords.get(key);
          rec.definition = definitionText || "";
          if (selectedCefr) rec.cefrLevel = selectedCefr;
          if (exampleSentence !== null) rec.exampleSentence = exampleSentence;
          rec.updatedAt = new Date().toISOString();
        } else {
          state.vocabRecords.set(key, {
            word,
            normalizedWord: key,
            definition: definitionText || "",
            cefrLevel: selectedCefr || popup.dataset.cefr || null,
            exampleSentence,
            status: "known",
            updatedAt: new Date().toISOString(),
          });
        }
        popup.__lookupData = data;
        renderLookup(popup, data);
        setDefinitionEditMode(popup, false);
        const rect = popup.__anchorRect;
        if (rect) positionPopup(popup, rect);
      }
    );
  }



  function renderLookup(popup, data) {
    if (!popup.isConnected) return;
    const posEl = popup.querySelector(".vh-popup__pos");
    const pronEl = popup.querySelector(".vh-popup__pron");

    popup.__lookupData = data || { found: false };
    setDefinitionEditMode(popup, false);

    if (data && data.found) {
      if (data.pos) {
        posEl.textContent = `(${data.pos})`;
        posEl.hidden = false;
      } else {
        posEl.hidden = true;
      }

      if (pronEl) {
        if (data.pronunciation) {
          pronEl.textContent = data.pronunciation;
          pronEl.hidden = false;
        } else {
          pronEl.hidden = true;
          pronEl.textContent = "";
        }
      }

      renderDefinition(popup, data);
    } else {
      // Not found: omit pos entirely, keep a quiet definition line.
      posEl.hidden = true;
      if (pronEl) {
        pronEl.hidden = true;
        pronEl.textContent = "";
      }
      renderDefinition(popup, data || { found: false });
    }

    // Reposition — content height changed.
    const rect = popup.__anchorRect;
    if (rect) positionPopup(popup, rect);
  }

  function openPopupForWord(word, rect, isHighlighted = false) {
    const popup = buildPopup(word);
    popup.__anchorRect = rect;
    positionPopup(popup, rect);

    const key = normalizeWord(word) || word.toLowerCase();

    // 1. NON-HIGHLIGHTED WORD:
    //    Fetch meaning strictly from VocabRecord, NOT from API.
    if (!isHighlighted) {
      const record = state.vocabRecords.get(key);
      if (record && record.definition) {
        const data = {
          word: record.word || word,
          found: true,
          definition: record.definition,
          definitionHtml: `<p>${escapeHtml(record.definition)}</p>`,
          pos: record.partOfSpeech || "",
          pronunciation: record.pronunciation || "",
          exampleSentence: record.exampleSentence || "",
          example: record.exampleSentence || "",
          cefrLevel: record.cefrLevel || (popup.dataset.cefr || ""),
          customDefinition: true,
          fromVocabRecord: true,
        };
        renderLookup(popup, data);
        return;
      }

      if (record) {
        const data = {
          word: record.word || word,
          found: true,
          definition: "No meaning saved. Click edit to add meaning.",
          definitionHtml: "<p><em>No meaning saved. Click edit to add meaning.</em></p>",
          pos: record.partOfSpeech || "",
          pronunciation: record.pronunciation || "",
          exampleSentence: record.exampleSentence || "",
          example: record.exampleSentence || "",
          cefrLevel: record.cefrLevel || (popup.dataset.cefr || ""),
          customDefinition: false,
          fromVocabRecord: true,
        };
        renderLookup(popup, data);
        return;
      }

      // Query background storage for vocab record without triggering dictionary API
      chrome.runtime.sendMessage({ type: "vh:get-vocab-record", word }, (res) => {
        if (!popup.isConnected || popup.dataset.word?.toLowerCase() !== word.toLowerCase()) return;
        const rec = res?.record;
        if (rec) {
          state.vocabRecords.set(key, rec);
          const data = {
            word: rec.word || word,
            found: true,
            definition: rec.definition || "No meaning saved. Click edit to add meaning.",
            definitionHtml: rec.definition ? `<p>${escapeHtml(rec.definition)}</p>` : "<p><em>No meaning saved. Click edit to add meaning.</em></p>",
            pos: rec.partOfSpeech || "",
            pronunciation: rec.pronunciation || "",
            exampleSentence: rec.exampleSentence || "",
            example: rec.exampleSentence || "",
            cefrLevel: rec.cefrLevel || (popup.dataset.cefr || ""),
            customDefinition: !!rec.definition,
            fromVocabRecord: true,
          };
          renderLookup(popup, data);
        } else {
          renderLookup(popup, { word, found: false });
        }
      });
      return;
    }

    // 2. HIGHLIGHTED WORD:
    //    Check cache table (defCache) first; if not found, fetch via API.
    if (state.defCache.has(key)) {
      renderLookup(popup, state.defCache.get(key));
      return;
    }

    const fallbackTimer = setTimeout(() => {
      if (popup.isConnected && popup.dataset.word?.toLowerCase() === word.toLowerCase()) {
        renderLookup(popup, { word, found: false, transient: true });
      }
    }, 4000);

    chrome.runtime.sendMessage({ type: "vh:lookup", word }, (data) => {
      clearTimeout(fallbackTimer);
      if (chrome.runtime.lastError || !data) {
        if (popup.isConnected && popup.dataset.word?.toLowerCase() === word.toLowerCase()) {
          renderLookup(popup, { word, found: false, transient: true });
        }
        return;
      }
      if (data?.found || data?.notFound) state.defCache.set(key, data);
      if (popup.isConnected && popup.dataset.word?.toLowerCase() === word.toLowerCase()) {
        renderLookup(popup, data);
      }
    });
  }

  // ---------------------------------------------------------------------
  // Hover prefetching (pre-fetches unknown words on gentle hover for 0ms clicks)
  // ---------------------------------------------------------------------
  let hoverTimer = null;
  let hoveredWord = null;

  function prefetchWord(word) {
    const clean = String(word || "").trim();
    if (!clean) return;
    const key = normalizeWord(clean) || clean.toLowerCase();
    if (state.defCache.has(key) || state.prefetching.has(key)) return;

    state.prefetching.add(key);
    chrome.runtime.sendMessage({ type: "vh:lookup", word: clean }, (data) => {
      state.prefetching.delete(key);
      if (chrome.runtime.lastError || !data) return;
      if (data?.found || data?.notFound) {
        state.defCache.set(key, data);
      }
    });
  }

  document.addEventListener("mouseover", (e) => {
    if (!isActive()) return;
    const span = e.target.closest && e.target.closest("span.vh-unknown");
    if (!span) {
      if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      hoveredWord = null;
      return;
    }

    const word = span.dataset.w || span.textContent.trim();
    if (!word || word === hoveredWord) return;
    hoveredWord = word;

    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      prefetchWord(word);
    }, 80);
  }, true);

  document.addEventListener("mouseout", (e) => {
    const span = e.target.closest && e.target.closest("span.vh-unknown");
    if (span) {
      // Ignore mouse transitions that remain inside the same highlighted span
      if (e.relatedTarget && span.contains(e.relatedTarget)) return;
      if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      hoveredWord = null;
    }
  }, true);

  // ---------------------------------------------------------------------
  // Click handling
  // ---------------------------------------------------------------------
  const INTERACTIVE = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL"]);
  const INTERACTIVE_SELECTOR =
    Array.from(INTERACTIVE).join(",") + ",[contenteditable],[role=button]";

  document.addEventListener(
    "click",
    (e) => {
      if (!isActive()) return;
      const target = e.target;
      if (target.closest && target.closest(".vh-ui.vh-popup")) return; // inside popup

      const span = target.closest && target.closest("span.vh-unknown");
      if (span) {
        e.preventDefault();
        e.stopPropagation();
        openPopupForWord(span.dataset.w, span.getBoundingClientRect(), true);
        return;
      }

      // Never open the word popup from extension UI (toolbar, panels, reader
      // chrome) — but DO allow it inside the reader's article body.
      if (target.closest && target.closest(".vh-ui") && !target.closest(".vh-reader-content")) return;

      // Non-highlighted (known) word: only intercept plain, non-interactive text.
      // Reader links displayed as plain text (data-vh-plain) count as text.
      const interactive = target.closest && target.closest(INTERACTIVE_SELECTOR);
      if (interactive && !(interactive.tagName === "A" && interactive.dataset.vhPlain)) return;
      const word = wordAtPoint(e.clientX, e.clientY);
      if (word && isEligible(word)) {
        openPopupForWord(word, makeRectFromPoint(e.clientX, e.clientY), false);
      } else {
        closePopup();
      }
    },
    true
  );

  function makeRectFromPoint(x, y) {
    return { left: x, right: x, top: y - 8, bottom: y + 8, width: 0, height: 16 };
  }

  // Dismiss popup when clicking elsewhere.
  document.addEventListener("mousedown", (e) => {
    if (state.activePopup && !(e.target.closest && e.target.closest(".vh-popup"))) {
      // If they clicked a word, the click handler will reopen; just close here.
      if (!(e.target.closest && e.target.closest("span.vh-unknown"))) closePopup();
    }
  });

  // ---------------------------------------------------------------------
  // Floating controls + unknown-words panel (matches the reference UI)
  // ---------------------------------------------------------------------
  // The floating controls only exist while highlighting is ON: a "Disable
  // highlighting" button and "Show unknown words". There is deliberately no
  // "Enable highlighting" state — when disabled the buttons hide entirely,
  // and re-enabling happens from the extension's toolbar popup.
  let floatingEl = null;
  function updateUnknownButtonText() {
    if (!floatingEl) return;
    const btn = floatingEl.querySelector('[data-act="unknown"]');
    if (btn) {
      btn.textContent = panelEl ? "Hide unknown words" : "Show unknown words";
    }
  }

  function buildFloating() {
    if (floatingEl) return;
    floatingEl = document.createElement("div");
    floatingEl.className = "vh-float vh-ui";
    const unknownText = panelEl ? "Hide unknown words" : "Show unknown words";
    floatingEl.innerHTML = `
      <button class="vh-float__btn" data-act="reader">Reading mode</button>
      <button class="vh-float__btn" data-act="toggle">Disable highlighting</button>
      <button class="vh-float__btn" data-act="unknown">${unknownText}</button>
    `;
    floatingEl.querySelector('[data-act="reader"]').addEventListener("click", () => {
      if (globalThis.VHReader) globalThis.VHReader.open();
    });
    floatingEl.querySelector('[data-act="toggle"]').addEventListener("click", disableHighlighting);
    floatingEl.querySelector('[data-act="unknown"]').addEventListener("click", toggleUnknownPanel);
    document.body.appendChild(floatingEl);
  }

  function refreshFloatingVisibility() {
    if (isActive()) {
      applyColorVars();
      buildFloating();
      updateUnknownButtonText();
      return;
    }
    if (floatingEl) {
      floatingEl.remove();
      floatingEl = null;
    }
  }

  // Only turns highlighting off for THIS page view. The global setting (and
  // therefore every other tab) is untouched; re-enable from the toolbar popup
  // or by reloading the page.
  function disableHighlighting() {
    state.pageDisabled = true;
    clearHighlights();
    closeUnknownPanel();
    closePopup();
    refreshFloatingVisibility();
  }

  let panelEl = null;
  function toggleUnknownPanel() {
    if (!isActive()) return;
    if (panelEl) return closeUnknownPanel();
    panelEl = document.createElement("div");
    panelEl.className = "vh-panel vh-ui";
    const entries = [...state.unknownWords.values()].sort((a, b) =>
      a.word.localeCompare(b.word)
    );
    const rows = entries
      .map(
        ({ word, count }) => `
        <div class="vh-panel__row" data-w="${escapeHtml(word)}">
          <span class="vh-panel__word">${escapeHtml(word)}</span>
          <span class="vh-panel__count">${count}</span>
          <button class="vh-btn vh-panel__know" data-w="${escapeHtml(word)}">Know</button>
        </div>`
      )
      .join("");
    panelEl.innerHTML = `
      <div class="vh-panel__head">Unknown words</div>
      <div class="vh-panel__list">${rows || '<div class="vh-panel__empty">Nothing unknown here 🎉</div>'}</div>
    `;
    panelEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".vh-panel__know");
      if (btn) {
        markKnownFromPanel(btn.dataset.w, btn.closest(".vh-panel__row"));
      }
    });
    document.body.appendChild(panelEl);
    updateUnknownButtonText();
  }

  function markKnownFromPanel(word, rowEl) {
    chrome.runtime.sendMessage({ type: "vh:add-known", word }, () => {
      state.known.add(normalizeWord(word));
      unwrapWord(word);
      if (rowEl) rowEl.remove();
      refreshFloatingVisibility();
    });
  }

  function closeUnknownPanel() {
    if (panelEl) { panelEl.remove(); panelEl = null; }
    updateUnknownButtonText();
  }

  // ---------------------------------------------------------------------
  // Messaging from popup toolbar / background
  // ---------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "vh:page-stats") {
      sendResponse({ total: state.total, unknown: state.unknownCount, isDark: detectDarkPage() });
      return true;
    }
    if (msg?.type === "vh:set-enabled") {
      state.settings.enabled = msg.enabled;
      // Re-enabling from the toolbar also revives a page that was disabled
      // via the floating "Disable highlighting" button.
      if (msg.enabled) state.pageDisabled = false;
      if (msg.enabled) {
        applyColorVars();
        refreshFloatingVisibility();
        highlightPage();
      } else {
        clearHighlights();
        closeUnknownPanel();
        closePopup();
        refreshFloatingVisibility();
      }
      if (globalThis.VHReader) globalThis.VHReader.refreshHighlights();
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === "vh:show-unknown") {
      toggleUnknownPanel();
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === "vh:known-changed") {
      loadState().then(() => {
        clearHighlights();
        highlightPage();
        if (globalThis.VHReader) globalThis.VHReader.refreshHighlights();
      });
    }
  });

  // Re-sync when the known list / settings change from elsewhere.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[K_VOCAB_RECORDS]) {
      const records = changes[K_VOCAB_RECORDS].newValue || {};
      state.vocabRecords.clear();
      for (const [k, rec] of Object.entries(records)) {
        const norm = normalizeWord(k) || k.toLowerCase();
        state.vocabRecords.set(norm, rec);
      }
    }
    if (changes[K_KNOWN] || changes[K_VOCAB_RECORDS] || changes[K_SETTINGS]) {
      loadState().then(() => {
        clearHighlights();
        statsReported = true; // don't re-count activity on a resync
        highlightPage();
        refreshFloatingVisibility(); // enable/disable may have come from another tab
        if (!isActive()) { closeUnknownPanel(); closePopup(); }
        if (globalThis.VHReader) globalThis.VHReader.refreshHighlights();
      });
    }
  });

  // Watch for theme changes on documentElement or body
  function watchThemeChanges() {
    let pending = false;
    const check = () => {
      pending = false;
      const isDark = detectDarkPage();
      const root = document.documentElement;
      if (root.classList.contains("vh-dark-page") !== isDark) {
        applyColorVars();
      }
    };
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(check);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      subtree: true,
      attributeFilter: ["class", "style"],
    });
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", applyColorVars);
  }

  // ---------------------------------------------------------------------
  // Bridge for the Reading Mode overlay (src/reader/*). The reader reuses
  // this script's highlighting + popup pipeline instead of duplicating it.
  // ---------------------------------------------------------------------
  globalThis.__VHContent = {
    isActive,
    closePopup,
    // Highlight all eligible words inside `root` (the reader article).
    // Stats are not re-counted — the underlying page already reported them.
    highlightElement(root) {
      if (!isActive() || !root) return;
      const nodes = collectTextNodes(root, root);
      for (const n of nodes) {
        if (n.parentNode) highlightTextNode(n, false);
      }
      applyColorVars();
    },
    // Remove highlight spans inside `root` only.
    unwrapElement(root) {
      if (!root) return;
      root.querySelectorAll("span.vh-unknown").forEach((span) => {
        const t = document.createTextNode(span.textContent);
        span.parentNode.replaceChild(t, span);
        t.parentNode.normalize();
      });
    },
    // true/false while the reader forces a theme; null restores detection.
    setForcedDark(value) {
      forcedDark = typeof value === "boolean" ? value : null;
      applyColorVars();
    },
  };

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  loadState().then(() => {
    applyColorVars();
    refreshFloatingVisibility();
    if (isActive()) highlightPage();
    watchThemeChanges();
  });
})();
