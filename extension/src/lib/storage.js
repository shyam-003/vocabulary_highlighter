import { getCefrLevel } from "./cefr-data.js";
import { normalizeKnownMap, normalizeWord } from "./normalizer.js";

export const KEYS = {
  known: "vh_known", // { word: true }
  settings: "vh_settings",
  stats: "vh_stats",
  defcache: "vh_defcache", // { word: {pos, definition, example, ts} }
  schemaVersion: "vh_schema_version",
  vocabRecords: "vh_vocabulary_records", // { [lemma]: VocabularyRecord }
  pendingSync: "vh_pending_sync", // [ SyncOperation ]
  auth: "vh_auth", // { url, anonKey, session }
  syncMeta: "vh_sync_meta", // { lastSyncedAt, error }
};

export const DEFAULT_SETTINGS = {
  enabled: false,
  learningLang: "en",
  translateLang: "en",
  colors: {
    known: "#DCE5D8",
    unknown: "#F4D5C3"
  },
  minWordLength: 3,
};

export const DEFAULT_STATS = {
  streak: 0,
  bestStreak: 0,
  lastActiveDate: null,
  totalLearned: 0,
  knownByDate: {},
};

export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function get(key, fallback) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (res) => resolve(res[key] ?? fallback));
  });
}

function set(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

// ---- known words -------------------------------------------------------
export async function getKnownMap() {
  const map = await get(KEYS.known, {});
  const normalized = normalizeKnownMap(map);
  const oldKeys = Object.keys(map).sort();
  const newKeys = Object.keys(normalized).sort();
  if (oldKeys.length !== newKeys.length || oldKeys.some((k, i) => k !== newKeys[i])) {
    await set({ [KEYS.known]: normalized });
  }
  return normalized;
}

export async function isKnown(word) {
  const map = await getKnownMap();
  return !!map[normalizeWord(word)];
}

export async function addKnown(word) {
  const map = await getKnownMap();
  const w = normalizeWord(word);
  if (!w) return false;
  if (map[w]) return false; // already known — no double count
  map[w] = true;
  await set({ [KEYS.known]: map });

  // Update structured vocabulary record
  const records = await get(KEYS.vocabRecords, {});
  const nowISO = new Date().toISOString();

  const record = {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `vocab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    word: word,
    normalizedWord: w,
    cefrLevel: getCefrLevel(w),
    definition: records[w]?.definition || null,
    partOfSpeech: records[w]?.partOfSpeech || null,
    exampleSentence: records[w]?.exampleSentence || null,
    pronunciation: records[w]?.pronunciation || null,
    status: "known",
    createdAt: records[w]?.createdAt || nowISO,
    updatedAt: nowISO,
  };
  records[w] = record;
  await set({ [KEYS.vocabRecords]: records });

  // Queue sync operation
  const queue = await get(KEYS.pendingSync, []);
  const eventId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  queue.push({
    id: eventId,
    eventId,
    entityType: "vocabulary_word",
    entityId: w,
    operation: "upsert",
    payload: record,
    createdAt: nowISO,
  });
  await set({ [KEYS.pendingSync]: queue });

  try {
    chrome.runtime?.sendMessage({ type: "vh:sync-now" }).catch(() => { });
  } catch { }

  await recordKnownAdded(1);
  return true;
}

export async function removeKnown(word) {
  return await markWordStatusUnknown(word);
}

export async function updateKnown(oldWord, newWord) {
  const oldKey = normalizeWord(oldWord);
  const newKey = normalizeWord(newWord);
  if (!oldKey || !newKey) return { ok: false, error: "Invalid word" };

  const map = await getKnownMap();
  if (!map[oldKey]) return { ok: false, error: "Word not found in dictionary" };

  if (oldKey !== newKey) {
    if (map[newKey]) return { ok: false, error: `"${newWord}" is already in your dictionary.` };
    delete map[oldKey];
    map[newKey] = true;
    await set({ [KEYS.known]: map });



    // 2. Transfer custom CEFR level
    const customCefr = await get("vh_custom_cefr", {});
    if (customCefr[oldKey]) {
      customCefr[newKey] = customCefr[oldKey];
      delete customCefr[oldKey];
      await set({ "vh_custom_cefr": customCefr });
    }

    // 3. Transfer vocabRecord while preserving UUID
    const records = await get(KEYS.vocabRecords, {});
    let record = records[oldKey];
    if (record) {
      delete records[oldKey];
      record.word = newWord;
      record.normalizedWord = newKey;
      record.updatedAt = new Date().toISOString();
      records[newKey] = record;
    } else {
      record = {
        id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `word_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        word: newWord,
        normalizedWord: newKey,
        cefrLevel: customCefr[newKey] || getCefrLevel(newKey),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      records[newKey] = record;
    }
    await set({ [KEYS.vocabRecords]: records });

    // 4. Queue sync operation
    const queue = await get(KEYS.pendingSync, []);
    const eventId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    queue.push({
      id: eventId,
      eventId,
      entityType: "vocabulary_word",
      entityId: newKey,
      operation: "UPSERT",
      payload: record,
      createdAt: new Date().toISOString(),
    });
    await set({ [KEYS.pendingSync]: queue });
  }

  return { ok: true, oldKey, newKey };
}

export async function countKnown() {
  return Object.keys(await getKnownMap()).length;
}

// ---- settings ----------------------------------------------------------
export async function getSettings() {
  const s = await get(KEYS.settings, {});
  return { ...DEFAULT_SETTINGS, ...s, colors: { ...DEFAULT_SETTINGS.colors, ...(s.colors || {}) } };
}

export async function setSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await set({ [KEYS.settings]: next });
  return next;
}

// ---- stats -------------------------------------------------------------
export async function getStats() {
  const s = await get(KEYS.stats, {});
  const stats = { ...DEFAULT_STATS, ...s };
  if (stats.unknownByDate) {
    delete stats.unknownByDate;
    await set({ [KEYS.stats]: stats });
  }
  return stats;
}

async function saveStats(stats) {
  if (stats && stats.unknownByDate) {
    delete stats.unknownByDate;
  }
  await set({ [KEYS.stats]: stats });
  return stats;
}

// Bump the streak if this is the first activity of a new day.
export async function recordActivity() {
  const stats = await getStats();
  const today = todayStr();
  if (stats.lastActiveDate === today) return stats;

  const yesterday = todayStr(new Date(Date.now() - 86400000));
  if (stats.lastActiveDate === yesterday) stats.streak += 1;
  else stats.streak = 1;
  stats.lastActiveDate = today;
  stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
  return await saveStats(stats);
}

export async function recordKnownAdded(n = 1) {
  const stats = await getStats();
  const today = todayStr();
  stats.knownByDate[today] = (stats.knownByDate[today] || 0) + n;
  stats.totalLearned += n;
  // marking a word is also activity
  const yesterday = todayStr(new Date(Date.now() - 86400000));
  if (stats.lastActiveDate !== today) {
    if (stats.lastActiveDate === yesterday) stats.streak += 1;
    else stats.streak = 1;
    stats.lastActiveDate = today;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
  }
  return await saveStats(stats);
}

export function sumLastDays(byDate = {}, days = 7) {
  let total = 0;
  for (let i = 0; i < days; i++) {
    const d = todayStr(new Date(Date.now() - i * 86400000));
    total += byDate[d] || 0;
  }
  return total;
}

// ---- review / unknown words --------------------------------------------
export async function getUnknownVocabularyRecords() {
  const records = await get(KEYS.vocabRecords, {});
  const knownMap = await getKnownMap();
  const customCefr = await get("vh_custom_cefr", {});

  const list = [];
  for (const [key, rec] of Object.entries(records)) {
    const isExplicitlyUnknown = rec.status === "unknown";
    const isNotKnown = !knownMap[key] && rec.status !== "known";

    if (isExplicitlyUnknown || isNotKnown) {
      list.push({
        id: rec.id || key,
        word: rec.word || key,
        normalizedWord: key,
        cefrLevel: customCefr[key] || rec.cefrLevel || getCefrLevel(key, rec.partOfSpeech) || "B1",
        definition: rec.definition || null,
        partOfSpeech: rec.partOfSpeech || null,
        exampleSentence: rec.exampleSentence || null,
        pronunciation: rec.pronunciation || null,
        status: "unknown",
        createdAt: rec.createdAt || new Date().toISOString(),
        updatedAt: rec.updatedAt || new Date().toISOString(),
      });
    }
  }
  return list;
}

export async function markWordStatusKnown(word) {
  const norm = normalizeWord(word);
  if (!norm) return false;

  // 1. Add to known map
  const map = await getKnownMap();
  map[norm] = true;
  await set({ [KEYS.known]: map });

  // 2. Update vocab record status to 'known'
  const records = await get(KEYS.vocabRecords, {});
  const customCefr = await get("vh_custom_cefr", {});
  const nowISO = new Date().toISOString();

  let record = records[norm];
  if (record) {
    record.status = "known";
    record.updatedAt = nowISO;
  } else {
    record = {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `vocab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      word: word,
      normalizedWord: norm,
      cefrLevel: customCefr[norm] || cacheEntry.cefrLevel || getCefrLevel(norm, cacheEntry.pos) || "B1",
      definition: cacheEntry.definition || null,
      partOfSpeech: cacheEntry.pos || null,
      exampleSentence: cacheEntry.example || null,
      pronunciation: cacheEntry.pronunciation || null,
      status: "known",
      createdAt: nowISO,
      updatedAt: nowISO,
    };
  }
  records[norm] = record;
  await set({ [KEYS.vocabRecords]: records });

  // 3. Queue sync event for Supabase
  const queue = await get(KEYS.pendingSync, []);
  const eventId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  queue.push({
    id: eventId,
    eventId,
    entityType: "vocabulary_word",
    entityId: norm,
    operation: "upsert",
    payload: record,
    createdAt: nowISO,
  });
  await set({ [KEYS.pendingSync]: queue });

  try {
    chrome.runtime?.sendMessage({ type: "vh:sync-now" }).catch(() => {});
    chrome.tabs?.query({}, (tabs) => {
      for (const tab of tabs || []) {
        if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "vh:known-changed" }).catch(() => {});
      }
    });
  } catch {}

  await recordKnownAdded(1);
  return true;
}

export async function markWordStatusUnknown(word) {
  const norm = normalizeWord(word);
  if (!norm) return false;

  // 1. Remove from known map
  const map = await getKnownMap();
  delete map[norm];
  await set({ [KEYS.known]: map });



  // 3. Update vocab record status to 'unknown'
  const records = await get(KEYS.vocabRecords, {});
  const customCefr = await get("vh_custom_cefr", {});
  const nowISO = new Date().toISOString();

  let record = records[norm];
  if (record) {
    record.status = "unknown";
    record.updatedAt = nowISO;
  } else {
    record = {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `vocab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      word: word,
      normalizedWord: norm,
      cefrLevel: customCefr[norm] || cacheEntry.cefrLevel || getCefrLevel(norm, cacheEntry.pos) || "B1",
      definition: cacheEntry.definition || null,
      partOfSpeech: cacheEntry.pos || null,
      exampleSentence: cacheEntry.example || null,
      pronunciation: cacheEntry.pronunciation || null,
      status: "unknown",
      createdAt: nowISO,
      updatedAt: nowISO,
    };
  }
  records[norm] = record;
  await set({ [KEYS.vocabRecords]: records });

  // 4. Queue sync operation for Supabase
  const queue = await get(KEYS.pendingSync, []);
  const eventId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  queue.push({
    id: eventId,
    eventId,
    entityType: "vocabulary_word",
    entityId: norm,
    operation: "upsert",
    payload: record,
    createdAt: nowISO,
  });
  await set({ [KEYS.pendingSync]: queue });

  try {
    chrome.runtime?.sendMessage({ type: "vh:sync-now" }).catch(() => {});
    chrome.tabs?.query({}, (tabs) => {
      for (const tab of tabs || []) {
        if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "vh:known-changed" }).catch(() => {});
      }
    });
  } catch {}

  // Cascade: roll back the learned counters (best-effort for today's bucket)
  const stats = await getStats();
  stats.totalLearned = Math.max(0, stats.totalLearned - 1);
  const today = todayStr();
  if ((stats.knownByDate[today] || 0) > 0) stats.knownByDate[today] -= 1;
  await saveStats(stats);
  return true;
}
