/* Reading Mode — floating top-right toolbar and its settings popover.
 * Pure UI: reads/writes preferences through VHReader.settings, notifies the
 * orchestrator via callbacks. Auto-hides after a short idle period.
 */
(() => {
  "use strict";
  const NS = (globalThis.VHReader = globalThis.VHReader || {});

  const IDLE_MS = 2500;

  function el(tag, className, attrs = {}) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function buildSlider(key, range, value, onInput) {
    const wrap = el("label", "vh-rt-field");
    const head = el("span", "vh-rt-field__head");
    const name = el("span", "vh-rt-field__label");
    name.textContent = range.label;
    const val = el("span", "vh-rt-field__value");
    head.appendChild(name);
    head.appendChild(val);

    const input = el("input", "vh-rt-slider", {
      type: "range",
      min: String(range.min),
      max: String(range.max),
      step: String(range.step),
      "aria-label": range.label,
    });
    input.value = String(value);

    const show = (v) => {
      val.textContent = range.unit ? `${v}${range.unit}` : Number(v).toFixed(2).replace(/\.?0+$/, "");
    };
    show(value);
    input.addEventListener("input", () => {
      show(input.value);
      onInput(key, Number(input.value));
    });

    wrap.appendChild(head);
    wrap.appendChild(input);
    return { wrap, input, show };
  }

  NS.toolbar = {
    /**
     * @param {HTMLElement} host overlay root to mount into
     * @param {object} opts { settings, onClose, onChange }
     *   onChange(patch) — persist + apply a settings patch.
     */
    build(host, opts) {
      const { themes, typography } = NS;
      let current = { ...opts.settings };

      const bar = el("div", "vh-reader-toolbar", { role: "toolbar", "aria-label": "Reading mode controls" });

      const settingsBtn = el("button", "vh-rt-btn", {
        type: "button",
        "aria-label": "Reading settings",
        "aria-expanded": "false",
        title: "Reading settings",
      });
      settingsBtn.textContent = "Aa";

      const imgBtn = el("button", "vh-rt-btn", { type: "button", "aria-label": "Show or hide images", title: "Show / hide images" });
      imgBtn.textContent = "🖼";
      const linkBtn = el("button", "vh-rt-btn", { type: "button", "aria-label": "Show or hide links", title: "Show / hide links" });
      linkBtn.textContent = "🔗";

      const closeBtn = el("button", "vh-rt-btn vh-rt-btn--close", {
        type: "button",
        "aria-label": "Close reading mode",
        title: "Close reading mode (Esc)",
      });
      closeBtn.textContent = "✕";

      bar.appendChild(settingsBtn);
      bar.appendChild(imgBtn);
      bar.appendChild(linkBtn);
      bar.appendChild(closeBtn);

      // ---- settings popover -------------------------------------------
      const panel = el("div", "vh-reader-settings", { role: "group", "aria-label": "Reading settings" });

      // Theme swatches
      const themeRow = el("div", "vh-rt-row");
      const themeLabel = el("span", "vh-rt-field__label");
      themeLabel.textContent = "Theme";
      const themeGroup = el("div", "vh-rt-themes", { role: "radiogroup", "aria-label": "Theme" });
      const themeBtns = new Map();
      for (const t of themes.list) {
        const b = el("button", "vh-rt-theme", {
          type: "button",
          role: "radio",
          "aria-checked": "false",
          "aria-label": `${t.label} theme`,
          title: t.label,
        });
        b.style.background = t.swatch;
        b.dataset.theme = t.id;
        b.addEventListener("click", () => opts.onChange({ theme: t.id }));
        themeBtns.set(t.id, b);
        themeGroup.appendChild(b);
      }
      themeRow.appendChild(themeLabel);
      themeRow.appendChild(themeGroup);
      panel.appendChild(themeRow);

      // Font select
      const fontRow = el("label", "vh-rt-row");
      const fontLabel = el("span", "vh-rt-field__label");
      fontLabel.textContent = "Font";
      const fontSelect = el("select", "vh-rt-select", { "aria-label": "Font" });
      for (const f of typography.fonts) {
        const o = el("option");
        o.value = f.id;
        o.textContent = f.label;
        fontSelect.appendChild(o);
      }
      fontSelect.addEventListener("change", () => opts.onChange({ font: fontSelect.value }));
      fontRow.appendChild(fontLabel);
      fontRow.appendChild(fontSelect);
      panel.appendChild(fontRow);

      // Sliders
      const sliders = {};
      for (const key of ["fontSize", "lineHeight", "letterSpacing", "width"]) {
        const s = buildSlider(key, typography.ranges[key], current[key], (k, v) => opts.onChange({ [k]: v }));
        sliders[key] = s;
        panel.appendChild(s.wrap);
      }

      // Visibility toggles
      const toggles = {};
      for (const [key, label] of [["showImages", "Show images"], ["showLinks", "Show links"]]) {
        const row = el("label", "vh-rt-toggle");
        const input = el("input", "", { type: "checkbox" });
        input.checked = current[key];
        input.addEventListener("change", () => opts.onChange({ [key]: input.checked }));
        const text = el("span");
        text.textContent = label;
        row.appendChild(input);
        row.appendChild(text);
        toggles[key] = input;
        panel.appendChild(row);
      }

      // ---- behavior ----------------------------------------------------
      let panelOpen = false;
      const setPanel = (open) => {
        panelOpen = open;
        panel.classList.toggle("is-open", open);
        settingsBtn.setAttribute("aria-expanded", String(open));
        wake();
      };
      settingsBtn.addEventListener("click", () => setPanel(!panelOpen));
      imgBtn.addEventListener("click", () => opts.onChange({ showImages: !current.showImages }));
      linkBtn.addEventListener("click", () => opts.onChange({ showLinks: !current.showLinks }));
      closeBtn.addEventListener("click", () => opts.onClose());

      // Close the popover when clicking elsewhere in the overlay.
      const onHostMousedown = (e) => {
        if (panelOpen && !panel.contains(e.target) && !settingsBtn.contains(e.target)) setPanel(false);
      };
      host.addEventListener("mousedown", onHostMousedown);

      // Auto-hide after idle; wake on pointer/keyboard activity.
      let idleTimer = 0;
      const idle = () => {
        if (panelOpen || bar.matches(":hover") || bar.contains(document.activeElement) || panel.contains(document.activeElement)) {
          wake();
          return;
        }
        bar.classList.add("is-idle");
      };
      const wake = () => {
        bar.classList.remove("is-idle");
        window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(idle, IDLE_MS);
      };
      const onActivity = () => wake();
      host.addEventListener("pointermove", onActivity);
      host.addEventListener("keydown", onActivity, true);
      wake();

      host.appendChild(bar);
      host.appendChild(panel);

      return {
        el: bar,
        panel,
        closePanel: () => setPanel(false),
        isPanelOpen: () => panelOpen,
        // Reflect the (possibly externally changed) settings in the controls.
        applyState(next) {
          current = { ...next };
          themeBtns.forEach((b, id) => b.setAttribute("aria-checked", String(id === current.theme)));
          if (fontSelect.value !== current.font) fontSelect.value = current.font;
          for (const key of Object.keys(sliders)) {
            const input = sliders[key].input;
            if (Number(input.value) !== current[key]) input.value = String(current[key]);
            sliders[key].show(current[key]);
          }
          toggles.showImages.checked = current.showImages;
          toggles.showLinks.checked = current.showLinks;
          imgBtn.setAttribute("aria-pressed", String(current.showImages));
          linkBtn.setAttribute("aria-pressed", String(current.showLinks));
          imgBtn.classList.toggle("is-off", !current.showImages);
          linkBtn.classList.toggle("is-off", !current.showLinks);
        },
        destroy() {
          window.clearTimeout(idleTimer);
          host.removeEventListener("mousedown", onHostMousedown);
          host.removeEventListener("pointermove", onActivity);
          host.removeEventListener("keydown", onActivity, true);
        },
      };
    },
  };
})();
