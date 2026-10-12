import { SEED_WORDS } from "../lib/seed-words.js";
import { lookupWord } from "../lib/dictionary.js";
import { normalizeWord } from "../lib/normalizer.js";
import {
  KEYS,
  getKnownMap,
  addKnown,
  recordActivity,
} from "../lib/storage.js";

const DEF_CACHE_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days
const MISS_CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days for "no such word"

import { runStorageMigration, enrichMissingVocabularyDetails } from "../lib/migration.js";
import { runBatchSync, getSyncStatus } from "../lib/sync.js";
import { getCefrLevel } from "../lib/cefr-data.js";

// Normalize any dictionary saved by older extension versions, migrate records, and enrich missing metadata.
getKnownMap()
  .then(() => runStorageMigration())
  .then(() => enrichMissingVocabularyDetails())
  .catch(() => {});

// Seed the known-word dictionary on first install so pages are immediately readable.
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const existing = await getKnownMap();
    if (Object.keys(existing).length === 0) {
      const map = {};
      const records = {};
      const nowISO = new Date().toISOString();
      for (const w of SEED_WORDS) {
        const lemma = normalizeWord(w);
        if (lemma) {
          map[lemma] = true;
          records[lemma] = {
            id: `seed_${lemma}`,
            word: w,
            normalizedWord: lemma,
            cefrLevel: getCefrLevel(lemma),
            definition: null,
            partOfSpeech: null,
            exampleSentence: null,
            pronunciation: null,
            status: "known",
            createdAt: nowISO,
            updatedAt: nowISO,
          };
        }
      }
      await chrome.storage.local.set({ [KEYS.known]: map, [KEYS.vocabRecords]: records });
    }
  }
  chrome.contextMenus.create({
    id: "vh-add-known",
    title: 'Mark "%s" as known',
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === "vh-add-known" && info.selectionText) {
    const word = info.selectionText.trim().split(/\s+/)[0];
    if (word) {
      await addKnown(word);
      // Tell the active tab to refresh its highlights.
      if (info.frameId === 0) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, { type: "vh:known-changed" }).catch(() => {});
          }
        });
      }
    }
  }
});

// ---- API pacing --------------------------------------------------------
// Three guards keep network lookups smooth and efficient: requests run with a
// minimal gap, concurrent lookups of the same word share a single in-flight
// request, and cached results are served directly.
const MIN_REQUEST_GAP = 20;

let rateLimitedUntil = 0;
let lastRequestAt = 0;
let queue = Promise.resolve();
const inFlight = new Map();

function schedule(fn) {
  const run = queue.then(async () => {
    const wait = lastRequestAt + MIN_REQUEST_GAP - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  queue = run.catch(() => {}); // a failed lookup must not stall the queue
  return run;
}

function pacedLookup(word) {
  const key = word.toLowerCase();
  const pending = inFlight.get(key);
  if (pending) return pending;

  const p = (async () => {
    const cooling = rateLimitedUntil - Date.now();
    if (cooling > 0) {
      // Don't spend a request we know will be refused.
      return { word, found: false, transient: true, rateLimited: true, cooldownMs: cooling };
    }
    const data = await schedule(() => lookupWord(word));
    if (data.rateLimited) rateLimitedUntil = Date.now() + (data.cooldownMs || 60_000);
    else if (data.found || data.notFound) rateLimitedUntil = 0;
    return data;
  })();

  inFlight.set(key, p);
  return p.finally(() => inFlight.delete(key));
}

// ---- cached dictionary lookups ----------------------------------------

// chrome.storage has no expiry of its own, so freshness is entirely on us.
// A cached failure that carries neither `notFound` nor a definition was
// written by an older build from a transient API error — ignore it so the
// word gets a real lookup instead of being stuck on "Definition unavailable".
// Session-only in-memory definition cache (not persisted to storage).
// Unsaved lookups are discarded when session ends; saved definitions go to vocabRecords.
const sessionDefCache = new Map();

function isFresh(entry) {
  const data = entry?.data;
  if (!data) return false;
  if (data.customDefinition) return true;
  const age = Date.now() - (entry.ts || 0);
  if (data.found) return age < DEF_CACHE_TTL;
  if (data.notFound) return age < MISS_CACHE_TTL;
  return false;
}

async function cachedLookup(word) {
  const norm = normalizeWord(word) || word.toLowerCase();
  const raw = word.toLowerCase();

  // 1. Check if word already has a saved record in vocabRecords
  const store = await chrome.storage.local.get(KEYS.vocabRecords);
  const records = store[KEYS.vocabRecords] || {};
  const saved = records[norm] || records[raw];
  if (saved && saved.definition) {
    return {
      word: saved.word || word,
      found: true,
      definition: saved.definition,
      definitionHtml: `<p>${saved.definition}</p>`,
      pos: saved.partOfSpeech || "",
      pronunciation: saved.pronunciation || "",
      exampleSentence: saved.exampleSentence || "",
      example: saved.exampleSentence || "",
      cefrLevel: saved.cefrLevel || getCefrLevel(word, saved.partOfSpeech),
      customDefinition: true,
    };
  }

  // 2. Check transient in-memory session cache
  const cached = sessionDefCache.get(norm) || sessionDefCache.get(raw);
  if (cached && isFresh(cached)) {
    return cached.data;
  }

  // 3. Perform network API lookup
  const data = await pacedLookup(word);
  if (data.found || data.notFound) {
    sessionDefCache.set(raw, { data, ts: Date.now() });
    if (norm) sessionDefCache.set(norm, { data, ts: Date.now() });
  }
  return data;
}

async function saveCustomDefinition(word, definitionHtml, definitionText, exampleSentence = null) {
  const key = normalizeWord(word) || word.toLowerCase();
  const store = await chrome.storage.local.get([KEYS.vocabRecords, KEYS.pendingSync, "vh_custom_cefr"]);
  const records = store[KEYS.vocabRecords] || {};
  const syncQueue = store[KEYS.pendingSync] || [];
  const customCefr = store["vh_custom_cefr"] || {};

  const existing = sessionDefCache.get(key)?.data || { word, found: true };
  const newExample = exampleSentence !== null ? exampleSentence : (existing.exampleSentence || existing.example || null);
  const activeCefr = customCefr[key] || records[key]?.cefrLevel || existing.cefrLevel || getCefrLevel(word);

  const data = {
    ...existing,
    word,
    found: true,
    definition: definitionText || "",
    definitionHtml: definitionHtml || (definitionText ? `<p>${definitionText}</p>` : ""),
    customDefinition: true,
    cefrLevel: activeCefr,
    example: newExample,
    exampleSentence: newExample,
  };
  sessionDefCache.set(key, { data, ts: Date.now() });

  const activePos = existing.pos || records[key]?.partOfSpeech || null;
  const activePron = existing.pronunciation || records[key]?.pronunciation || null;

  if (!records[key]) {
    records[key] = {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `word_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      word,
      normalizedWord: key,
      cefrLevel: activeCefr,
      definition: definitionText || "",
      partOfSpeech: activePos,
      exampleSentence: newExample,
      pronunciation: activePron,
      updatedAt: new Date().toISOString(),
    };
  } else {
    records[key].definition = definitionText || "";
    records[key].cefrLevel = activeCefr;
    if (activePos) records[key].partOfSpeech = activePos;
    if (activePron) records[key].pronunciation = activePron;
    if (newExample !== null) records[key].exampleSentence = newExample;
    records[key].updatedAt = new Date().toISOString();
  }

  const eventId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  syncQueue.push({
    id: eventId,
    eventId,
    entityType: "vocabulary_word",
    entityId: key,
    operation: "UPSERT",
    payload: records[key],
    createdAt: new Date().toISOString(),
  });

  await chrome.storage.local.set({
    [KEYS.vocabRecords]: records,
    [KEYS.pendingSync]: syncQueue,
  });
  return data;
}

async function resetCustomDefinition(word) {
  const key = normalizeWord(word) || word.toLowerCase();
  const store = await chrome.storage.local.get([KEYS.vocabRecords, KEYS.pendingSync]);
  const records = store[KEYS.vocabRecords] || {};
  if (records[key]) {
    records[key].definition = "";
    records[key].updatedAt = new Date().toISOString();
    await chrome.storage.local.set({ [KEYS.vocabRecords]: records });
  }
  sessionDefCache.delete(key);
  sessionDefCache.delete(word.toLowerCase());
  return await cachedLookup(word);
}

async function saveCustomCefr(word, cefrLevel) {
  const key = normalizeWord(word);
  if (!key) return { ok: false };
  const store = await chrome.storage.local.get([KEYS.vocabRecords, "vh_custom_cefr", KEYS.pendingSync]);
  const records = store[KEYS.vocabRecords] || {};
  const customCefr = store["vh_custom_cefr"] || {};
  const syncQueue = store[KEYS.pendingSync] || [];

  customCefr[key] = cefrLevel;
  const activePos = sessionDefCache.get(key)?.data?.pos || records[key]?.partOfSpeech || null;
  const activePron = sessionDefCache.get(key)?.data?.pronunciation || records[key]?.pronunciation || null;

  if (!records[key]) {
    records[key] = {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `word_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      word,
      normalizedWord: key,
      cefrLevel,
      partOfSpeech: activePos,
      pronunciation: activePron,
      updatedAt: new Date().toISOString(),
    };
  } else {
    records[key].cefrLevel = cefrLevel;
    if (activePos) records[key].partOfSpeech = activePos;
    if (activePron) records[key].pronunciation = activePron;
    records[key].updatedAt = new Date().toISOString();
  }

  const cachedEntry = sessionDefCache.get(key);
  if (cachedEntry?.data) {
    cachedEntry.data.cefrLevel = cefrLevel;
  }

  const eventId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  syncQueue.push({
    id: eventId,
    eventId,
    entityType: "vocabulary_word",
    entityId: key,
    operation: "UPSERT",
    payload: records[key],
    createdAt: new Date().toISOString(),
  });

  await chrome.storage.local.set({
    [KEYS.vocabRecords]: records,
    [KEYS.pendingSync]: syncQueue,
    "vh_custom_cefr": customCefr,
  });

  runBatchSync().catch((err) => console.warn("Auto sync after saveCustomCefr failed:", err));

  return { ok: true, cefrLevel };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "vh:lookup" && msg.word) {
    cachedLookup(msg.word)
      .then((data) => sendResponse(data || { word: msg.word, found: false, notFound: true }))
      .catch((err) => {
        console.warn("vh:lookup error:", err);
        sendResponse({ word: msg.word, found: false, transient: true, error: String(err) });
      });
    return true; // async response
  }
  if (msg?.type === "vh:save-definition" && msg.word) {
    saveCustomDefinition(msg.word, msg.definitionHtml || "", msg.definitionText || "", msg.exampleSentence ?? null).then((data) => sendResponse(data));
    return true;
  }
  if (msg?.type === "vh:save-cefr" && msg.word && msg.cefrLevel) {
    saveCustomCefr(msg.word, msg.cefrLevel).then((res) => sendResponse(res));
    return true;
  }
  if (msg?.type === "vh:reset-definition" && msg.word) {
    resetCustomDefinition(msg.word).then((data) => sendResponse(data));
    return true;
  }
  if (msg?.type === "vh:add-known" && msg.word) {
    addKnown(msg.word).then((added) => sendResponse({ added }));
    return true;
  }
  if (msg?.type === "vh:activity") {
    recordActivity().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "vh:sync-now") {
    enrichMissingVocabularyDetails()
      .then(() => runBatchSync())
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.type === "vh:enrich-missing") {
    enrichMissingVocabularyDetails()
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.type === "vh:sync-status") {
    getSyncStatus()
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.type === "vh:get-vocab-record" && msg.word) {
    const key = normalizeWord(msg.word) || msg.word.toLowerCase();
    chrome.storage.local.get(KEYS.vocabRecords, (store) => {
      const records = store[KEYS.vocabRecords] || {};
      sendResponse({ record: records[key] || null });
    });
    return true;
  }
  if (msg?.type === "vh:get-cefr") {
    const key = normalizeWord(msg.word);
    chrome.storage.local.get(["vh_custom_cefr", KEYS.vocabRecords], (store) => {
      const customCefr = store["vh_custom_cefr"] || {};
      const records = store[KEYS.vocabRecords] || {};
      const savedLevel = customCefr[key] || records[key]?.cefrLevel;
      const level = savedLevel || getCefrLevel(msg.word, msg.pos);
      sendResponse({ level });
    });
    return true;
  }
});
