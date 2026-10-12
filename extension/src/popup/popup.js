import { getSettings, setSettings } from "../lib/storage.js";

const $ = (sel) => document.querySelector(sel);

function activeTab() {
  return new Promise((resolve) =>
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]))
  );
}

function askPageStats(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "vh:page-stats" }, (res) => {
      if (chrome.runtime.lastError || !res) resolve(null);
      else resolve(res);
    });
  });
}

async function renderSyncStatus() {
  chrome.runtime.sendMessage({ type: "vh:sync-status" }, (res) => {
    const el = $("#sync-stat");
    if (!el) return;
    if (res?.pendingCount > 0) {
      el.textContent = `↻ ${res.pendingCount} word${res.pendingCount === 1 ? "" : "s"} waiting to sync`;
    } else {
      el.textContent = "Synced just now";
    }
  });
}

async function render() {
  const settings = await getSettings();

  // toggle switch
  const toggle = $("#toggle-switch");
  toggle.checked = !!settings.enabled;

  const subtitle = $("#page-subtitle");
  if (subtitle) {
    if (settings.enabled) {
      subtitle.textContent = "Highlighting is active";
    } else {
      subtitle.textContent = "Highlighting is paused";
    }
  }

  // Active tab stats if available
  const tab = await activeTab();
  if (tab?.id && settings.enabled) {
    const ps = await askPageStats(tab.id);
    if (ps && ps.total > 0 && subtitle) {
      const pct = Math.round((ps.unknown / ps.total) * 100);
      subtitle.textContent = `Highlighting is active • ${ps.unknown} unknown (${pct}%)`;
    }
  }

  await renderSyncStatus();
}

async function toggleEnabled() {
  const settings = await getSettings();
  const enabled = !settings.enabled;
  await setSettings({ enabled });
  const tab = await activeTab();
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "vh:set-enabled", enabled }, () => void chrome.runtime.lastError);
  }
  render();
}

function wireNav() {
  $("#header-settings-btn")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const dest = btn.dataset.nav;
      if (dest === "reader") {
        const tab = await activeTab();
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: "vh:open-reader" }, () => void chrome.runtime.lastError);
        }
      } else if (dest === "settings") {
        chrome.runtime.openOptionsPage();
      }
      window.close();
    });
  });

  $("#sync-now-btn")?.addEventListener("click", () => {
    const el = $("#sync-stat");
    if (el) el.textContent = "Syncing…";
    chrome.runtime.sendMessage({ type: "vh:sync-now" }, () => {
      renderSyncStatus();
    });
  });
}

$("#toggle-switch").addEventListener("change", toggleEnabled);
wireNav();
render();
