import { normalizeWord } from "../lib/normalizer.js";
import { getCefrLevel } from "../lib/cefr-data.js";
import {
  KEYS,
  addKnown,
  getKnownMap,
  getSettings,
  getStats,
  markWordStatusKnown,
  removeKnown,
  setSettings,
  sumLastDays,
  todayStr,
  updateKnown,
} from "../lib/storage.js";
import { clearAuthSession, getAuthConfig, saveAuthSession, getSyncStatus, refreshSupabaseToken } from "../lib/sync.js";
import { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY } from "../lib/supabase-config.js";

const $ = (s) => document.querySelector(s);
const PAGE_SIZE = 10;

function notifyKnownChanged() {
  chrome.tabs?.query({}, (tabs) => {
    for (const tab of tabs || []) {
      if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "vh:known-changed" }).catch(() => { });
    }
  });
}

const view = {
  words: [], // sorted known words list
  records: {}, // word record metadata (definition, pos, cefrLevel, status, createdAt)
  filtered: [],
  page: 0,
  search: "",
  statusFilter: "all", // "all", "learned", "unknown"
  cefrFilter: null, // "A1", "A2", "B1", "B2", "C1", "C2" or null
  currentTab: "home",
};

// ----------------------------------------------------------------------
// Language Settings & Top Header
// ----------------------------------------------------------------------
async function renderSettings() {
  const s = await getSettings();
  const count = Object.keys(await getKnownMap()).length;

  const topLang = $("#learning-lang");
  const settingsLang = $("#settings-learning-lang");
  const translateLang = $("#translate-lang");

  if (topLang) topLang.value = s.learningLang || "en";
  if (settingsLang) settingsLang.value = s.learningLang || "en";
  if (translateLang) translateLang.value = s.translateLang || "en";

  const countFormatted = count >= 1000 ? (count / 1000).toFixed(1) + "k" : count;
  if (topLang) {
    const selectedOpt = topLang.selectedOptions[0];
    if (selectedOpt) {
      const rawName = selectedOpt.textContent.replace(/\s*\(.*\)$/, "");
      selectedOpt.textContent = `${rawName} (${countFormatted} words)`;
    }
  }

  const foot = $("#dict-foot");
  if (foot) {
    foot.textContent = `${count} words in your dictionary · Switch anytime — each language has its own dictionary.`;
  }
}

async function renderHeaderPill() {
  const stats = await getStats();
  const countEl = $("#learned-count-text");
  if (countEl) {
    countEl.textContent = `${stats.totalLearned || 0} words learned`;
  }
}

function wireSettings() {
  $("#learning-lang")?.addEventListener("change", async (e) => {
    await setSettings({ learningLang: e.target.value });
    if ($("#settings-learning-lang")) $("#settings-learning-lang").value = e.target.value;
    await refreshAll();
  });

  $("#settings-learning-lang")?.addEventListener("change", async (e) => {
    await setSettings({ learningLang: e.target.value });
    if ($("#learning-lang")) $("#learning-lang").value = e.target.value;
    await refreshAll();
  });

  $("#translate-lang")?.addEventListener("change", async (e) => {
    await setSettings({ translateLang: e.target.value });
  });
}

// ----------------------------------------------------------------------
// Metrics & CEFR Classification (Overview cards)
// ----------------------------------------------------------------------
async function renderMetrics() {
  const stats = await getStats();

  const streakDays = $("#streak-days");
  if (streakDays) streakDays.textContent = stats.streak || 0;

  const streakCta = $("#streak-cta");
  if (streakCta) {
    streakCta.textContent = stats.streak > 0 ? "Keep it going!" : "Start your streak today!";
  }

  const learned7 = $("#learned-7");
  if (learned7) learned7.textContent = sumLastDays(stats.knownByDate, 7);
}

async function renderCefrClassification() {
  const map = await getKnownMap();
  const store = await chrome.storage.local.get([KEYS.vocabRecords]);
  const records = store[KEYS.vocabRecords] || {};

  const allWordKeys = Array.from(new Set([...Object.keys(map), ...Object.keys(records)]));
  const totalCount = allWordKeys.length;

  const totalEl = $("#total-vocab-count");
  if (totalEl) {
    totalEl.textContent = totalCount.toLocaleString();
  }

  const cefrDist = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 };

  for (const word of allWordKeys) {
    const rec = records[word];
    const rawLevel = rec?.cefrLevel || getCefrLevel(word, rec?.pos) || "B1";
    const level = String(rawLevel).toUpperCase();
    if (cefrDist[level] !== undefined) {
      cefrDist[level]++;
    } else {
      cefrDist["B1"]++;
    }
  }

  for (const level of ["a1", "a2", "b1", "b2", "c1", "c2"]) {
    const el = $(`#cefr-count-${level}`);
    if (el) {
      el.textContent = (cefrDist[level.toUpperCase()] || 0).toLocaleString();
    }
  }
}

// ----------------------------------------------------------------------
// Learning Activity Bar Chart
// ----------------------------------------------------------------------
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatShortDate(dateObj) {
  return `${MONTH_NAMES[dateObj.getMonth()]} ${dateObj.getDate()}`;
}

function buildBuckets(byDate, range) {
  const now = new Date();
  const buckets = [];

  if (range === "days" || range === "7D") {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const ds = todayStr(d);
      buckets.push({
        label: formatShortDate(d),
        value: byDate[ds] || 0,
      });
    }
  } else if (range === "weeks" || range === "30D") {
    for (let w = 5; w >= 0; w--) {
      let sum = 0;
      for (let i = 0; i < 5; i++) {
        const d = new Date(now - (w * 5 + i) * 86400000);
        sum += byDate[todayStr(d)] || 0;
      }
      const end = new Date(now - w * 5 * 86400000);
      buckets.push({ label: formatShortDate(end), value: sum });
    }
  } else if (range === "months" || range === "3M") {
    for (let m = 5; m >= 0; m--) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const y = d.getFullYear(), mo = d.getMonth();
      let sum = 0;
      for (const [k, v] of Object.entries(byDate)) {
        const kd = new Date(k);
        if (kd.getFullYear() === y && kd.getMonth() === mo) sum += v;
      }
      buckets.push({ label: MONTH_NAMES[mo], value: sum });
    }
  } else {
    // 1Y / years
    for (let yy = 3; yy >= 0; yy--) {
      const year = now.getFullYear() - yy;
      let sum = 0;
      for (const [k, v] of Object.entries(byDate)) {
        if (new Date(k).getFullYear() === year) sum += v;
      }
      buckets.push({ label: String(year), value: sum });
    }
  }
  return buckets;
}

async function renderChart(range = "days") {
  const stats = await getStats();
  const buckets = buildBuckets(stats.knownByDate, range);
  const max = Math.max(1, ...buckets.map((b) => b.value));
  const chart = $("#chart");
  if (!chart) return;

  chart.innerHTML = "";

  for (const b of buckets) {
    const col = document.createElement("div");
    col.className = "chart-bar-wrap";

    const h = Math.round((b.value / max) * 90);
    const heightStyle = b.value > 0 ? `height: ${Math.max(10, h)}px;` : "height: 3px; background-color: #EBE4DC; opacity: 0.9;";

    col.innerHTML = `
      <div class="chart-tooltip">${b.value} word${b.value === 1 ? "" : "s"}</div>
      <div class="chart-bar-track">
        ${b.value > 0 ? `<span class="chart-bar-value">${b.value.toLocaleString()}</span>` : ""}
        <div class="chart-bar" style="${heightStyle}"></div>
      </div>
      <div class="chart-bar-label">${b.label}</div>
    `;
    chart.appendChild(col);
  }
}

function wireChart() {
  $("#chart-seg")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    $("#chart-seg .active")?.classList.remove("active");
    btn.classList.add("active");
    renderChart(btn.dataset.range || "days");
  });
}

// ----------------------------------------------------------------------
// Vocabulary Dictionary Data & Table
// ----------------------------------------------------------------------
async function loadWords() {
  const map = await getKnownMap();
  const store = await chrome.storage.local.get([KEYS.vocabRecords]);
  view.records = store[KEYS.vocabRecords] || {};

  // Combine words from map and records
  const allWordKeys = Array.from(new Set([...Object.keys(map), ...Object.keys(view.records)]));

  // Sort alphabetically
  view.words = allWordKeys.sort((a, b) => a.localeCompare(b));
  applyFilter();
}

function applyFilter() {
  const rawQ = (view.search || "").trim().toLowerCase();
  const normQ = rawQ ? normalizeWord(rawQ) : "";
  const cefrFilter = view.cefrFilter || null;

  view.filtered = view.words.filter((w) => {
    const rec = view.records[w] || {};
    const normW = normalizeWord(w);

    // CEFR filter
    if (cefrFilter) {
      const level = String(rec.cefrLevel || getCefrLevel(w, rec.pos) || "B1").toUpperCase();
      if (level !== cefrFilter.toUpperCase()) return false;
    }

    // Search query match (word, normalized lemma, or meaning)
    const matchesQuery = !rawQ ||
      w.includes(rawQ) ||
      normW === normQ ||
      normW.includes(normQ) ||
      (rec.definition && rec.definition.toLowerCase().includes(rawQ));

    return matchesQuery;
  });

  const totalPages = Math.max(1, Math.ceil(view.filtered.length / PAGE_SIZE));
  view.page = Math.min(view.page, totalPages - 1);

  renderTable();
}

async function renderTable() {
  const tbody = $("#known-table-body");
  const emptyState = $("#known-empty-state");
  const countText = $("#table-showing-text");
  if (!tbody) return;

  tbody.innerHTML = "";

  const totalWords = view.filtered.length;
  const start = view.page * PAGE_SIZE;
  const slice = view.filtered.slice(start, start + PAGE_SIZE);

  if (countText) {
    const end = Math.min(start + PAGE_SIZE, totalWords);
    countText.textContent = totalWords > 0 ? `Showing ${start + 1}–${end} of ${totalWords.toLocaleString()} words` : "Showing 0 words";
  }

  if (slice.length === 0) {
    if (emptyState) emptyState.style.display = "block";
    renderPagination(0);
    return;
  }

  if (emptyState) emptyState.style.display = "none";

  slice.forEach((word) => {
    const norm = normalizeWord(word);
    const rec = view.records[word] || (norm && view.records[norm]) || {};

    const meaning = rec.definition || "—";
    const dateAdded = rec.createdAt ? new Date(rec.createdAt) : new Date();
    const dateFormatted = formatShortDate(dateAdded) + ", " + dateAdded.getFullYear();

    const tr = document.createElement("tr");
    tr.dataset.word = word;
    tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td class="word-cell-bold">${word}</td>
      <td class="meaning-cell-muted" title="${meaning.replace(/"/g, '&quot;')}">${meaning}</td>
      <td class="date-cell-muted">${dateFormatted}</td>
      <td>
        <button class="action-expand-btn" title="View details or edit meaning">›</button>
      </td>
    `;

    // Row expansion / details modal trigger
    tr.addEventListener("click", () => {
      openWordEditor(word, rec);
    });

    tbody.appendChild(tr);
  });

  renderPagination(totalWords);
}

function renderPagination(totalWords) {
  const pagesContainer = $("#pager-pages");
  const prevBtn = $("#prev-page");
  const nextBtn = $("#next-page");
  if (!pagesContainer) return;

  pagesContainer.innerHTML = "";
  const totalPages = Math.max(1, Math.ceil(totalWords / PAGE_SIZE));

  if (prevBtn) prevBtn.disabled = view.page <= 0;
  if (nextBtn) nextBtn.disabled = view.page >= totalPages - 1;

  // Build page number buttons (1, 2, 3, ... max)
  const maxButtons = 5;
  let startPage = Math.max(0, view.page - 2);
  let endPage = Math.min(totalPages, startPage + maxButtons);
  if (endPage - startPage < maxButtons) {
    startPage = Math.max(0, endPage - maxButtons);
  }

  for (let i = startPage; i < endPage; i++) {
    const btn = document.createElement("button");
    btn.className = "page-num-btn" + (i === view.page ? " active" : "");
    btn.textContent = i + 1;
    btn.addEventListener("click", () => {
      view.page = i;
      renderTable();
    });
    pagesContainer.appendChild(btn);
  }
}

// ----------------------------------------------------------------------
// Word Details & Editor Modal
// ----------------------------------------------------------------------
let activeEditorWord = null;
let activeEditorCefr = "B1";

function closeWordEditorModal() {
  const modal = $("#word-editor-modal");
  if (modal) modal.style.display = "none";
  activeEditorWord = null;
}

async function openWordEditor(word, rec = {}, cached = {}) {
  const modal = $("#word-editor-modal");
  if (!modal) return;

  activeEditorWord = word;

  const pos = rec.partOfSpeech || cached.pos || "";
  const pron = rec.pronunciation || cached.pronunciation || "";
  const activeCefr = String(rec.cefrLevel || cached.cefrLevel || getCefrLevel(word, pos) || "B1").toUpperCase();
  activeEditorCefr = activeCefr;

  const currentDef = rec.definition || cached.definition || "";
  const currentExample = rec.exampleSentence || cached.exampleSentence || cached.example || "";

  const dateAdded = rec.createdAt ? new Date(rec.createdAt) : new Date();
  const dateFormatted = "Added " + formatShortDate(dateAdded) + ", " + dateAdded.getFullYear();

  // Populate UI
  const titleEl = $("#modal-word-title");
  const posEl = $("#modal-word-pos");
  const pronEl = $("#modal-word-pron");
  const dateEl = $("#modal-word-date");
  const cefrLabel = $("#modal-current-cefr-label");
  const meaningInput = $("#modal-word-meaning");
  const exampleInput = $("#modal-word-example");
  const msgEl = $("#modal-msg");

  if (titleEl) titleEl.textContent = word;
  if (posEl) posEl.textContent = pos ? `(${pos})` : "";
  if (pronEl) pronEl.textContent = pron ? `/${pron}/` : "";
  if (dateEl) dateEl.textContent = dateFormatted;

  if (cefrLabel) cefrLabel.textContent = `Level: ${activeCefr}`;

  // Update CEFR pill active state
  document.querySelectorAll("#modal-cefr-options .cefr-pill-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.cefr === activeCefr);
  });

  if (meaningInput) meaningInput.value = currentDef;
  if (exampleInput) exampleInput.value = currentExample;
  if (msgEl) {
    msgEl.style.display = "none";
    msgEl.textContent = "";
  }

  modal.style.display = "flex";
  setTimeout(() => meaningInput?.focus(), 50);

  // Background lookup to backfill definition / pronunciation if missing
  if (!currentDef && !cached.definition) {
    lookup(word).then((data) => {
      if (activeEditorWord === word && data?.found) {
        if (meaningInput && !meaningInput.value) {
          meaningInput.value = data.definition || "";
        }
        if (exampleInput && !exampleInput.value) {
          exampleInput.value = data.exampleSentence || data.example || "";
        }
        if (posEl && !posEl.textContent && data.pos) {
          posEl.textContent = `(${data.pos})`;
        }
        if (pronEl && !pronEl.textContent && data.pronunciation) {
          pronEl.textContent = `/${data.pronunciation}/`;
        }
      }
    });
  }
}

function wireWordEditorModal() {
  const modal = $("#word-editor-modal");
  if (!modal) return;

  // Close handlers
  $("#modal-close-btn")?.addEventListener("click", closeWordEditorModal);
  $("#modal-cancel-btn")?.addEventListener("click", closeWordEditorModal);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeWordEditorModal();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.style.display === "flex") {
      closeWordEditorModal();
    }
  });

  // CEFR Pill selection
  document.querySelectorAll("#modal-cefr-options .cefr-pill-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeEditorCefr = btn.dataset.cefr;
      document.querySelectorAll("#modal-cefr-options .cefr-pill-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.cefr === activeEditorCefr);
      });
      const cefrLabel = $("#modal-current-cefr-label");
      if (cefrLabel) cefrLabel.textContent = `Level: ${activeEditorCefr}`;
    });
  });

  // Save changes
  $("#modal-save-btn")?.addEventListener("click", async () => {
    if (!activeEditorWord) return;
    const word = activeEditorWord;
    const meaning = $("#modal-word-meaning")?.value.trim() || "";
    const example = $("#modal-word-example")?.value.trim() || "";
    const cefr = activeEditorCefr;

    const msgEl = $("#modal-msg");
    const saveBtn = $("#modal-save-btn");
    if (saveBtn) saveBtn.disabled = true;

    try {
      // 1. Save Definition & Example
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "vh:save-definition",
            word,
            definitionText: meaning,
            definitionHtml: meaning,
            exampleSentence: example,
          },
          resolve
        );
      });

      // 2. Save CEFR level
      if (cefr) {
        await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: "vh:save-cefr",
              word,
              cefrLevel: cefr,
            },
            resolve
          );
        });
      }

      notifyKnownChanged();
      await refreshAll();

      if (msgEl) {
        msgEl.className = "modal-msg success";
        msgEl.textContent = "✓ Changes saved successfully!";
        msgEl.style.display = "block";
      }

      setTimeout(() => {
        closeWordEditorModal();
        if (saveBtn) saveBtn.disabled = false;
      }, 450);
    } catch (err) {
      if (msgEl) {
        msgEl.className = "modal-msg error";
        msgEl.textContent = `Error saving: ${err.message}`;
        msgEl.style.display = "block";
      }
      if (saveBtn) saveBtn.disabled = false;
    }
  });
}

function wireDictionary() {
  $("#search")?.addEventListener("input", (e) => {
    view.search = e.target.value;
    view.cefrFilter = null;
    applyFilter();
  });

  $("#prev-page")?.addEventListener("click", () => {
    if (view.page > 0) {
      view.page--;
      renderTable();
    }
  });

  $("#next-page")?.addEventListener("click", () => {
    const totalPages = Math.ceil(view.filtered.length / PAGE_SIZE);
    if (view.page < totalPages - 1) {
      view.page++;
      renderTable();
    }
  });

  // Quick Add Word UI Toggle
  const quickAddBtn = $("#quick-add-open-btn");
  const quickAddPanel = $("#quick-add-panel");
  const quickAddClose = $("#quick-add-close-btn");

  quickAddBtn?.addEventListener("click", () => {
    if (quickAddPanel) {
      quickAddPanel.style.display = quickAddPanel.style.display === "none" ? "flex" : "none";
      if (quickAddPanel.style.display === "flex") {
        $("#add-word")?.focus();
      }
    }
  });

  quickAddClose?.addEventListener("click", () => {
    if (quickAddPanel) quickAddPanel.style.display = "none";
  });

  const doAdd = async () => {
    const input = $("#add-word");
    const word = input?.value.trim();
    if (!word) return;
    const lemma = normalizeWord(word);
    const added = await addKnown(word);
    if (input) input.value = "";

    const msgEl = $("#add-msg");
    if (msgEl) {
      msgEl.className = "add-msg " + (added ? "success" : "error");
      msgEl.textContent = added ? `✓ Added “${word}” to known words.` : `“${word}” is already in dictionary.`;
    }

    notifyKnownChanged();
    await refreshAll();
  };

  $("#add-btn")?.addEventListener("click", doAdd);
  $("#add-word")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doAdd();
  });
}

// ----------------------------------------------------------------------
// Navigation & Sections
// ----------------------------------------------------------------------
function switchTab(tabName, scrollTargetId = null) {
  view.currentTab = tabName;

  // Update sidebar active buttons
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  // Update tab pages
  document.querySelectorAll(".tab-page").forEach((page) => {
    page.classList.remove("active");
  });

  const targetPage = $(`#tab-${tabName}`);
  if (targetPage) targetPage.classList.add("active");

  if (tabName === "settings") {
    renderCloudSyncStatus();
  }

  if (scrollTargetId) {
    setTimeout(() => {
      const el = document.getElementById(scrollTargetId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 60);
  }
}

function wireNavigation() {
  document.querySelectorAll("[data-tab]").forEach((el) => {
    el.addEventListener("click", () => {
      const tab = el.dataset.tab;
      const scrollTarget = el.dataset.scroll;
      const cefr = el.dataset.cefr;

      if (cefr) {
        view.cefrFilter = cefr;
        view.search = "";
        if ($("#search")) $("#search").value = "";
        applyFilter();
      }

      switchTab(tab, scrollTarget);
    });
  });
}

// ----------------------------------------------------------------------
// Cloud Synchronization
// ----------------------------------------------------------------------
async function renderCloudSyncStatus() {
  let config = await getAuthConfig();
  const expiresAt = config.session?.expires_at;
  const nowInSec = Math.floor(Date.now() / 1000);
  if (config.session?.refresh_token && expiresAt && nowInSec >= expiresAt - 300) {
    const refreshed = await refreshSupabaseToken(config);
    if (refreshed) {
      config = refreshed;
    }
  }
  const status = await getSyncStatus().catch(() => ({ pendingCount: 0, lastSyncedAt: null }));

  const loggedInCard = $("#cloud-logged-in-card");
  const loggedOutCard = $("#cloud-logged-out-card");
  const connPill = $("#cloud-connection-pill");
  const avatarText = $("#cloud-avatar-text");
  const userEmail = $("#cloud-user-email");
  const syncText = $("#cloud-sync-text");
  const msgEl = $("#cloud-auth-msg");

  const isConnected = !!(config.user || config.session?.user || config.session?.access_token);

  if (isConnected) {
    if (loggedInCard) loggedInCard.style.display = "flex";
    if (loggedOutCard) loggedOutCard.style.display = "none";
    if (connPill) {
      connPill.textContent = "Connected";
      connPill.className = "connection-pill connected";
    }

    const emailStr = config.user?.email || config.session?.user?.email || "User";
    if (avatarText) avatarText.textContent = emailStr.charAt(0).toUpperCase();
    if (userEmail) userEmail.textContent = emailStr;

    const pendingCount = status?.pendingCount || 0;
    const lastSynced = status?.lastSyncedAt
      ? new Date(status.lastSyncedAt).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
      : null;

    if (pendingCount > 0) {
      if (syncText) syncText.textContent = `Sync status: ↻ ${pendingCount} word${pendingCount === 1 ? "" : "s"} pending sync`;
    } else {
      if (syncText) syncText.textContent = `Sync status: Up to date${lastSynced ? ` • Last synced: ${lastSynced}` : ""}`;
    }

    const loggedInMsg = $("#cloud-logged-in-msg");
    if (loggedInMsg) {
      if (status?.error) {
        loggedInMsg.textContent = `⚠️ Sync issue: ${status.error}`;
        loggedInMsg.style.color = "#ef4444";
      } else if (loggedInMsg.textContent && loggedInMsg.textContent.startsWith("⚠️")) {
        loggedInMsg.textContent = "";
      }
    }
  } else {
    if (loggedInCard) loggedInCard.style.display = "none";
    if (loggedOutCard) loggedOutCard.style.display = "flex";
    if (connPill) {
      connPill.textContent = "Disconnected";
      connPill.className = "connection-pill disconnected";
    }

    if ($("#cloud-email")) $("#cloud-email").value = "";
    if ($("#cloud-password")) $("#cloud-password").value = "";

    if (msgEl) {
      if (status?.error && (status.error.includes("expired") || status.error.includes("sign in"))) {
        msgEl.textContent = "⚠️ Your login session has expired. Please sign in again.";
        msgEl.style.color = "#ef4444";
      } else if (!msgEl.textContent || msgEl.textContent.startsWith("✓")) {
        msgEl.textContent = "Enter your Email and Password to sync with mobile.";
        msgEl.style.color = "var(--muted)";
      }
    }
  }
}

function wireCloudSync() {
  document.querySelectorAll(".pwd-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      const input = document.getElementById(targetId);
      if (input) {
        const isPwd = input.type === "password";
        input.type = isPwd ? "text" : "password";
        btn.textContent = isPwd ? "🙈" : "👁️";
      }
    });
  });

  $("#cloud-sync-now-btn")?.addEventListener("click", async () => {
    const config = await getAuthConfig();
    const syncText = $("#cloud-sync-text");
    const msgEl = $("#cloud-logged-in-msg") || $("#cloud-auth-msg");
    const syncBtn = $("#cloud-sync-now-btn");

    if (!config.session?.user && !config.user) {
      if (msgEl) {
        msgEl.textContent = "⚠️ Please sign in to sync with your mobile app.";
        msgEl.style.color = "#ef4444";
      }
      return;
    }

    if (syncBtn) syncBtn.disabled = true;
    if (syncText) syncText.textContent = "Sync status: ↻ Syncing with cloud…";
    if (msgEl) {
      msgEl.textContent = "Syncing vocabulary with Supabase…";
      msgEl.style.color = "var(--muted)";
    }

    chrome.runtime.sendMessage({ type: "vh:sync-now" }, async (res) => {
      if (syncBtn) syncBtn.disabled = false;
      if (res?.ok) {
        const totalWords = res.pulledCount ?? res.syncedCount ?? 0;
        const msg = totalWords > 0
          ? `✓ Synchronized ${totalWords} word${totalWords === 1 ? "" : "s"} successfully!`
          : `✓ Synchronized successfully! Up to date with cloud.`;
        if (msgEl) {
          msgEl.textContent = msg;
          msgEl.style.color = "var(--good-text)";
        }
      } else if (res?.error) {
        const isExpired = res.reason === "session_expired" || res.reason === "not_authenticated" || res.error.includes("expired") || res.error.includes("sign in");
        if (msgEl) {
          msgEl.textContent = isExpired
            ? `⚠️ Your session has expired. Please sign in again.`
            : `⚠️ Sync failed: ${res.error}`;
          msgEl.style.color = "#ef4444";
        }
      }
      await new Promise((r) => setTimeout(r, 100));
      await refreshAll();
    });
  });

  $("#cloud-login-btn")?.addEventListener("click", async () => {
    let url = (DEFAULT_SUPABASE_URL || "").trim();
    const key = (DEFAULT_SUPABASE_ANON_KEY || "").trim();
    const email = $("#cloud-email")?.value.trim() || "";
    const password = $("#cloud-password")?.value.trim() || "";
    const msgEl = $("#cloud-auth-msg");
    const loginBtn = $("#cloud-login-btn");

    if (url && !/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }

    if (!url || !key) {
      if (msgEl) {
        msgEl.textContent = "Supabase configuration missing in supabase-config.js.";
        msgEl.style.color = "#ef4444";
      }
      return;
    }

    if (!email || !password) {
      if (msgEl) {
        msgEl.textContent = "Please enter your Email and Password.";
        msgEl.style.color = "#ef4444";
      }
      return;
    }

    if (loginBtn) loginBtn.disabled = true;
    if (msgEl) {
      msgEl.textContent = "Signing in…";
      msgEl.style.color = "var(--muted)";
    }

    try {
      const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: key },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error_description || data.msg || data.message || `HTTP ${res.status}`);
      }

      await saveAuthSession(data, url, key);
      if ($("#cloud-password")) $("#cloud-password").value = "";

      // Immediately transition the UI to the connected state
      await renderCloudSyncStatus();

      const loggedInMsg = $("#cloud-logged-in-msg");
      if (loggedInMsg) {
        loggedInMsg.textContent = "✓ Connected! Syncing vocabulary in the background…";
        loggedInMsg.style.color = "var(--good-text)";
      }

      chrome.runtime.sendMessage({ type: "vh:sync-now" }, async (syncRes) => {
        if (loggedInMsg) {
          if (syncRes?.ok) {
            const totalWords = syncRes.pulledCount ?? syncRes.syncedCount ?? 0;
            loggedInMsg.textContent = totalWords > 0
              ? `✓ Synchronized ${totalWords} word${totalWords === 1 ? "" : "s"} successfully!`
              : `✓ Synchronized successfully! Up to date with cloud.`;
            loggedInMsg.style.color = "var(--good-text)";
          } else if (syncRes?.error) {
            loggedInMsg.textContent = `⚠️ Sync notice: ${syncRes.error}`;
            loggedInMsg.style.color = "#ef4444";
          }
        }
        await refreshAll();
      });
    } catch (err) {
      if (msgEl) {
        msgEl.textContent = `Login failed: ${err.message}`;
        msgEl.style.color = "#ef4444";
      }
    } finally {
      if (loginBtn) loginBtn.disabled = false;
    }
  });

  $("#cloud-logout-btn")?.addEventListener("click", async () => {
    await clearAuthSession();
    if ($("#cloud-email")) $("#cloud-email").value = "";
    if ($("#cloud-password")) $("#cloud-password").value = "";
    if ($("#cloud-auth-msg")) {
      $("#cloud-auth-msg").textContent = "Logged out successfully.";
      $("#cloud-auth-msg").style.color = "var(--accent)";
    }
    await renderCloudSyncStatus();
  });
}

// ----------------------------------------------------------------------
// Import / Export Operations
// ----------------------------------------------------------------------
function wireImportExport() {
  $("#export-btn")?.addEventListener("click", async () => {
    const map = await getKnownMap();
    const store = await chrome.storage.local.get([
      KEYS.vocabRecords,
      "vh_custom_cefr",
    ]);
    const records = store[KEYS.vocabRecords] || {};
    const customCefr = store["vh_custom_cefr"] || {};

    const allWords = Array.from(new Set([...Object.keys(map), ...Object.keys(records)]));
    allWords.sort((a, b) => a.localeCompare(b));

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/\r\n|\r|\n/g, " ").trim();
      return `"${str.replace(/"/g, '""')}"`;
    };

    const rows = [
      ["word", "meaning", "example sentence", "pos", "cefr", "pronunciation"].map(escapeCsv).join(","),
    ];

    for (const w of allWords) {
      const norm = normalizeWord(w);
      const rec = records[norm] || records[w] || {};

      const wordText = rec.word || w;
      const meaning = rec.definition || "";
      const example = rec.exampleSentence || "";
      const pos = rec.partOfSpeech || "";
      const cefr = customCefr[norm] || rec.cefrLevel || getCefrLevel(w, pos) || "";
      const pron = rec.pronunciation || "";

      rows.push([
        escapeCsv(wordText),
        escapeCsv(meaning),
        escapeCsv(example),
        escapeCsv(pos),
        escapeCsv(cefr),
        escapeCsv(pron),
      ].join(","));
    }

    const blob = new Blob(["\uFEFF" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vocabulary-dictionary-${todayStr()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $("#import-btn")?.addEventListener("click", () => $("#import-file")?.click());

  $("#import-file")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      let words = [];
      if (file.name.endsWith(".json")) {
        const parsed = JSON.parse(text);
        words = Array.isArray(parsed) ? parsed : Object.keys(parsed);
      } else {
        const lines = text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          let firstCol = line;
          if (line.includes(",")) {
            const match = line.match(/^"([^"]*)"/);
            firstCol = match ? match[1] : line.split(",")[0].replace(/^"|"$/g, "");
          } else {
            firstCol = line.replace(/^"|"$/g, "");
          }
          firstCol = firstCol.trim();
          if (firstCol && firstCol.toLowerCase() !== "word") {
            words.push(firstCol);
          }
        }
      }

      let addedCount = 0;
      for (const w of words) {
        if (await addKnown(w)) addedCount++;
      }

      notifyKnownChanged();
      await refreshAll();
      alert(`Successfully imported ${addedCount} new words into your dictionary!`);
    } catch (err) {
      alert(`Import error: ${err.message}`);
    } finally {
      e.target.value = "";
    }
  });

  $("#clear-local-btn")?.addEventListener("click", async () => {
    const confirmClear = confirm("Are you sure you want to clear all words from your local browser storage? (Your Supabase cloud database will NOT be deleted).");
    if (!confirmClear) return;

    await chrome.storage.local.set({
      [KEYS.knownWords]: {},
      [KEYS.vocabRecords]: {},
      [KEYS.defcache]: {},
    });

    notifyKnownChanged();
    await refreshAll();
    alert("Local dictionary cleared.");
  });
}

// ----------------------------------------------------------------------
// Hash Routing & Refresh
// ----------------------------------------------------------------------
function routeHash() {
  const hash = location.hash.replace("#", "");
  if (["home", "dictionary", "learn", "settings"].includes(hash)) {
    switchTab(hash);
  } else if (hash === "sync") {
    switchTab("settings", "settings-sync-section");
  } else if (hash === "import-export") {
    switchTab("settings", "settings-io-section");
  }
}

async function refreshAll() {
  try { await renderSettings(); } catch (e) { console.error("renderSettings error:", e); }
  try { await renderHeaderPill(); } catch (e) { console.error("renderHeaderPill error:", e); }
  try { await renderMetrics(); } catch (e) { console.error("renderMetrics error:", e); }
  try { await renderCefrClassification(); } catch (e) { console.error("renderCefrClassification error:", e); }
  try { await renderChart($("#chart-seg .active")?.dataset.range || "days"); } catch (e) { console.error("renderChart error:", e); }
  try { await loadWords(); } catch (e) { console.error("loadWords error:", e); }
  try { await renderCloudSyncStatus(); } catch (e) { console.error("renderCloudSyncStatus error:", e); }
}

function init() {
  wireSettings();
  wireChart();
  wireDictionary();
  wireWordEditorModal();
  wireImportExport();
  wireCloudSync();
  wireNavigation();
  window.addEventListener("hashchange", routeHash);
  refreshAll().then(routeHash);
}

init();
