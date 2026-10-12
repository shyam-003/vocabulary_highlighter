// Extension Synchronization Manager & Supabase REST Client
import { KEYS } from "./storage.js";
import { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY } from "./supabase-config.js";

function getStorage(key, fallback) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (res) => resolve(res[key] ?? fallback));
  });
}

function setStorage(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

export async function getAuthConfig() {
  const auth = await getStorage(KEYS.auth, {});
  const session = auth.session || null;
  const user = session?.user || auth.user || null;
  return {
    url: (auth.url || DEFAULT_SUPABASE_URL || "").trim(),
    anonKey: (auth.anonKey || DEFAULT_SUPABASE_ANON_KEY || "").trim(),
    session,
    user,
  };
}

export async function saveAuthSession(session, url = "", anonKey = "") {
  const cur = await getStorage(KEYS.auth, {});
  const sessionWithExpiry = session ? { ...session } : null;
  if (sessionWithExpiry) {
    if (!sessionWithExpiry.expires_at && sessionWithExpiry.expires_in) {
      sessionWithExpiry.expires_at = Math.floor(Date.now() / 1000) + sessionWithExpiry.expires_in;
    }
    if (!sessionWithExpiry.user && cur.session?.user) {
      sessionWithExpiry.user = cur.session.user;
    }
  }
  const next = {
    ...cur,
    url: (url || cur.url || DEFAULT_SUPABASE_URL || "").trim(),
    anonKey: (anonKey || cur.anonKey || DEFAULT_SUPABASE_ANON_KEY || "").trim(),
    session: sessionWithExpiry,
  };
  await setStorage({ [KEYS.auth]: next });
  return next;
}

export async function clearAuthSession() {
  await setStorage({ [KEYS.auth]: { url: "", anonKey: "", session: null } });
}

// Queue a sync operation locally
export async function enqueueSyncOp(entityType, entityId, operation, payload) {
  const queue = await getStorage(KEYS.pendingSync, []);
  const eventId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const op = {
    id: eventId,
    eventId,
    entityType,
    entityId,
    operation,
    payload,
    createdAt: new Date().toISOString(),
  };
  queue.push(op);
  await setStorage({ [KEYS.pendingSync]: queue });
  return op;
}

export async function getSyncStatus() {
  const queue = await getStorage(KEYS.pendingSync, []);
  const meta = await getStorage(KEYS.syncMeta, {});
  return {
    pendingCount: queue.length,
    lastSyncedAt: meta.lastSyncedAt || null,
    error: meta.error || null,
    status: queue.length === 0 ? "synced" : "pending",
  };
}

import { getCefrLevel } from "./cefr-data.js";

function generateUUID() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function isValidUUID(str) {
  return typeof str === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function ensureUUID(id) {
  return isValidUUID(id) ? id : generateUUID();
}

function deduplicateQueue(queue) {
  if (!Array.isArray(queue) || queue.length === 0) return [];
  const map = new Map();
  for (const item of queue) {
    if (!item) continue;
    if (item.entityType === "vocabulary_word" && item.payload?.normalizedWord) {
      const key = item.payload.normalizedWord.toLowerCase().trim();
      map.set(key, item);
    } else {
      const key = item.id || item.eventId || JSON.stringify(item);
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

// Ensures all local structured vocabulary records are enqueued if not yet synced
async function ensureAllRecordsQueued() {
  let rawQueue = await getStorage(KEYS.pendingSync, []);
  let queue = deduplicateQueue(rawQueue);
  if (queue.length !== rawQueue.length) {
    await setStorage({ [KEYS.pendingSync]: queue });
  }
  if (queue.length > 0) return queue;

  const knownMap = await getStorage(KEYS.known, {});
  const records = await getStorage(KEYS.vocabRecords, {});
  const cache = await getStorage(KEYS.defcache, {});
  const customCefr = await getStorage("vh_custom_cefr", {});
  const nowISO = new Date().toISOString();

  let modifiedRecords = false;
  for (const lemma of Object.keys(knownMap)) {
    if (!records[lemma]) {
      const cacheEntry = cache[lemma]?.data || {};
      const wordUuid = generateUUID();
      records[lemma] = {
        id: wordUuid,
        word: lemma,
        normalizedWord: lemma,
        cefrLevel: customCefr[lemma] || cacheEntry.cefrLevel || getCefrLevel(lemma, cacheEntry.pos),
        definition: cacheEntry.definition || null,
        partOfSpeech: cacheEntry.pos || null,
        exampleSentence: cacheEntry.example || null,
        pronunciation: cacheEntry.pronunciation || null,
        createdAt: nowISO,
        updatedAt: nowISO,
      };
      modifiedRecords = true;
    } else {
      const cacheEntry = cache[lemma]?.data || {};
      if (!records[lemma].pronunciation && cacheEntry.pronunciation) {
        records[lemma].pronunciation = cacheEntry.pronunciation;
        records[lemma].updatedAt = nowISO;
        modifiedRecords = true;
      }
    }
  }

  if (modifiedRecords) {
    await setStorage({ [KEYS.vocabRecords]: records });
  }

  const recordList = Object.values(records);
  if (recordList.length === 0) return [];

  const newQueue = recordList.map((record) => {
    const eventId = generateUUID();
    return {
      id: eventId,
      eventId,
      entityType: "vocabulary_word",
      entityId: record.normalizedWord,
      operation: "upsert",
      payload: record,
      createdAt: record.createdAt || nowISO,
    };
  });

  const cleanedNewQueue = deduplicateQueue(newQueue);
  await setStorage({ [KEYS.pendingSync]: cleanedNewQueue });
  return cleanedNewQueue;
}

// Automatic token refresh helper
export async function refreshSupabaseToken(config) {
  const targetUrl = (config?.url || DEFAULT_SUPABASE_URL || "").trim();
  const targetKey = (config?.anonKey || DEFAULT_SUPABASE_ANON_KEY || "").trim();
  const refreshToken = config?.session?.refresh_token;

  if (!targetUrl || !targetKey || !refreshToken) {
    return null;
  }
  try {
    const res = await fetch(`${targetUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: targetKey,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (res.ok) {
      const newSession = await res.json();
      const updatedConfig = await saveAuthSession(newSession, targetUrl, targetKey);
      return updatedConfig;
    } else {
      const errData = await res.json().catch(() => ({}));
      console.warn("Supabase token refresh rejected:", res.status, errData);
      const errStr = (errData.error_description || errData.error || errData.message || "").toLowerCase();
      // Only clear if the refresh token itself is definitively invalid/revoked
      if (res.status === 400 && (errData.error === "invalid_grant" || errStr.includes("invalid refresh token") || errStr.includes("revoked") || errStr.includes("expired"))) {
        await clearAuthSession();
      }
    }
  } catch (err) {
    console.warn("Auto token refresh network error (preserving session for retry):", err);
  }
  return null;
}

async function fetchWithAutoRefresh(url, options, config) {
  let activeConfig = config;
  const targetUrl = (activeConfig.url || DEFAULT_SUPABASE_URL || "").trim();
  const targetKey = (activeConfig.anonKey || DEFAULT_SUPABASE_ANON_KEY || "").trim();

  // Proactively refresh if token expires within 5 minutes
  const expiresAt = activeConfig.session?.expires_at;
  const nowInSec = Math.floor(Date.now() / 1000);
  if (expiresAt && nowInSec >= expiresAt - 300) {
    const refreshed = await refreshSupabaseToken(activeConfig);
    if (refreshed && refreshed.session?.access_token) {
      activeConfig = refreshed;
      options = {
        ...options,
        headers: {
          ...options.headers,
          apikey: targetKey,
          Authorization: `Bearer ${refreshed.session.access_token}`,
        },
      };
    }
  }

  let res = await fetch(url, options);
  if (res.status === 401) {
    const refreshed = await refreshSupabaseToken(activeConfig);
    if (refreshed && refreshed.session?.access_token) {
      const newHeaders = {
        ...options.headers,
        apikey: targetKey,
        Authorization: `Bearer ${refreshed.session.access_token}`,
      };
      res = await fetch(url, { ...options, headers: newHeaders });
    } else {
      const stored = await getAuthConfig();
      if (!stored.session?.refresh_token) {
        await clearAuthSession();
        throw new Error("Your login session has expired. Please sign in again under Settings.");
      }
    }
  }
  return res;
}

let activeSyncPromise = null;

// Perform batched sync with Supabase
export async function runBatchSync() {
  if (activeSyncPromise) {
    return activeSyncPromise;
  }

  activeSyncPromise = _performBatchSync().finally(() => {
    activeSyncPromise = null;
  });
  return activeSyncPromise;
}

async function _performBatchSync() {
  let config = await getAuthConfig();
  if (!config.url || !config.anonKey || !config.session?.access_token) {
    return { ok: false, reason: "not_authenticated", error: "Please sign in to sync vocabulary with the cloud." };
  }

  // Check if session is expired or close to expiry (within 5 minutes)
  const expiresAt = config.session?.expires_at;
  const nowInSec = Math.floor(Date.now() / 1000);
  if (expiresAt && nowInSec >= expiresAt - 300) {
    const refreshed = await refreshSupabaseToken(config);
    if (refreshed && refreshed.session?.access_token) {
      config = refreshed;
    }
  }

  // Ensure all local records are queued for sync, clean & deduplicated
  const rawQueue = await ensureAllRecordsQueued();
  const queue = deduplicateQueue(rawQueue);

  const headers = {
    "Content-Type": "application/json",
    apikey: config.anonKey,
    Authorization: `Bearer ${config.session.access_token}`,
    Prefer: "resolution=merge-duplicates",
  };

  let syncedCount = 0;

  try {
    if (queue.length > 0) {
      // Ensure user profile exists in public.users to satisfy foreign keys
      if (config.user?.id) {
        try {
          await fetchWithAutoRefresh(
            `${config.url}/rest/v1/users`,
            {
              method: "POST",
              headers: {
                ...headers,
                Prefer: "resolution=merge-duplicates",
              },
              body: JSON.stringify([{
                id: config.user.id,
                email: config.user.email || "user@example.com",
                updated_at: new Date().toISOString(),
              }]),
            },
            config
          );
        } catch (e) {
          console.warn("User profile ping:", e);
        }
      }

      const rawVocabItems = [];
      const reviewEvents = [];

      for (const op of queue) {
        if (op.entityType === "vocabulary_word" && op.payload?.normalizedWord) {
          rawVocabItems.push(op.payload);
        } else if (op.entityType === "review_event") {
          reviewEvents.push(op.payload);
        }
      }

      // Deduplicate vocabulary items by normalized word
      const uniqueVocabPayloads = new Map();
      for (const item of rawVocabItems) {
        if (item.normalizedWord) {
          uniqueVocabPayloads.set(item.normalizedWord.toLowerCase().trim(), item);
        }
      }

      // 1. Fetch existing remote vocabulary_words to know which words already exist in the Database
      const existingRemoteMap = new Map();
      try {
        let offset = 0;
        const limit = 1000;
        while (true) {
          const existingRes = await fetchWithAutoRefresh(
            `${config.url}/rest/v1/vocabulary_words?select=id,normalized_word&order=id.asc&limit=${limit}&offset=${offset}`,
            {
              method: "GET",
              headers: {
                apikey: config.anonKey,
                Authorization: `Bearer ${config.session.access_token}`,
              },
            },
            config
          );
          if (!existingRes.ok) break;
          const rows = await existingRes.json();
          if (!Array.isArray(rows) || rows.length === 0) break;
          for (const r of rows) {
            if (r.normalized_word) {
              existingRemoteMap.set(r.normalized_word.toLowerCase().trim(), r.id);
            }
          }
          offset += rows.length;
          if (rows.length < limit) break;
        }
      } catch (e) {
        console.warn("Could not pre-fetch remote vocabulary words:", e);
      }

      // 2. CORE OWNERSHIP RULE:
      // - Extension only INSERTS new words that do not yet exist in the Database.
      // - Extension must NEVER overwrite or update the status of an existing word in the Database.
      const localVocabList = Array.from(uniqueVocabPayloads.values());
      const newWordsToInsert = localVocabList.filter((p) => {
        const norm = (p.normalizedWord || p.word || "").toLowerCase().trim();
        return norm && !existingRemoteMap.has(norm);
      });

      const customCefrPayloadMap = await getStorage("vh_custom_cefr", {});
      let remoteSupportsPronSyn = true;

      // 3. Chunked batch INSERT for genuinely new vocabulary words only
      const VOCAB_CHUNK_SIZE = 100;
      for (let i = 0; i < newWordsToInsert.length; i += VOCAB_CHUNK_SIZE) {
        const chunk = newWordsToInsert.slice(i, i + VOCAB_CHUNK_SIZE);
        const payloadChunk = chunk.map((p) => {
          const normWord = (p.normalizedWord || p.word || "").toLowerCase().trim();
          const rawLvl = customCefrPayloadMap[normWord] || p.cefrLevel || null;
          let finalLevel = null;
          if (typeof rawLvl === "string") {
            const up = rawLvl.trim().toUpperCase();
            if (["A1", "A2", "B1", "B2", "C1", "C2"].includes(up)) {
              finalLevel = up;
            }
          }

          const item = {
            user_id: config.user.id,
            word: p.word || normWord,
            normalized_word: normWord,
            status: p.status || "known",
            cefr_level: finalLevel,
            definition: p.definition || null,
            part_of_speech: p.partOfSpeech || null,
            example_sentence: p.exampleSentence || null,
            updated_at: p.updatedAt || new Date().toISOString(),
          };
          if (remoteSupportsPronSyn) {
            item.pronunciation = p.pronunciation || null;
          }
          return item;
        });

        let res = await fetchWithAutoRefresh(
          `${config.url}/rest/v1/vocabulary_words?on_conflict=user_id,normalized_word`,
          {
            method: "POST",
            headers: {
              ...headers,
              Prefer: "resolution=ignore-duplicates,return=representation",
            },
            body: JSON.stringify(payloadChunk),
          },
          config
        );

        if (!res.ok) {
          const errText = await res.text();
          // Check if remote table lacks newly added columns (pronunciation)
          if (remoteSupportsPronSyn && (errText.includes("pronunciation") || errText.includes("schema cache"))) {
            console.warn("Supabase vocabulary_words missing pronunciation column. Retrying without it.", errText);
            remoteSupportsPronSyn = false;
            const strippedChunk = payloadChunk.map(({ pronunciation, ...rest }) => rest);
            res = await fetchWithAutoRefresh(
              `${config.url}/rest/v1/vocabulary_words?on_conflict=user_id,normalized_word`,
              {
                method: "POST",
                headers: {
                  ...headers,
                  Prefer: "resolution=ignore-duplicates,return=representation",
                },
                body: JSON.stringify(strippedChunk),
              },
              config
            );
            if (!res.ok) {
              const fallbackErr = await res.text();
              throw new Error(`Vocab insert failed (${res.status}): ${fallbackErr}`);
            }
          } else {
            throw new Error(`Vocab insert failed (${res.status}): ${errText}`);
          }
        }

        // Yield to JS event loop between batch chunks
        await new Promise((r) => setTimeout(r, 0));
      }

      syncedCount = newWordsToInsert.length;
      // Clear processed queue
      await setStorage({ [KEYS.pendingSync]: [] });
    }

    // 4. Pull ALL remote vocabulary words from Supabase (Database is the authoritative source of truth)
    const remoteWords = [];
    let offset = 0;
    const limit = 1000;

    while (true) {
      const pullRes = await fetchWithAutoRefresh(
        `${config.url}/rest/v1/vocabulary_words?select=*&order=created_at.asc,id.asc&limit=${limit}&offset=${offset}`,
        {
          method: "GET",
          headers: {
            apikey: config.anonKey,
            Authorization: `Bearer ${config.session.access_token}`,
            "Range-Unit": "items",
            Range: `${offset}-${offset + limit - 1}`,
          },
        },
        config
      );

      if (!pullRes.ok) break;
      const chunk = await pullRes.json();
      if (!Array.isArray(chunk) || chunk.length === 0) break;
      remoteWords.push(...chunk);
      offset += chunk.length;
      if (chunk.length < limit) break;

      // Yield to JS event loop between remote pagination fetches
      await new Promise((r) => setTimeout(r, 0));
    }

    let pulledCount = remoteWords.length;
    if (remoteWords.length > 0) {
      const nextKnown = {};
      const existingRecords = await getStorage(KEYS.vocabRecords, {});
      const nextRecords = { ...existingRecords };
      const customCefrPullMap = await getStorage("vh_custom_cefr", {});

      for (const rw of remoteWords) {
        const lemma = (rw.normalized_word || rw.word || "").toLowerCase().trim();
        if (!lemma) continue;

        // Database status is AUTHORITATIVE for all existing and incoming words
        const status = (rw.status || "known").toLowerCase().trim();
        if (status === "known") {
          nextKnown[lemma] = true;
        }

        const effectiveLevel = customCefrPullMap[lemma] || rw.cefr_level || null;

        nextRecords[lemma] = {
          id: rw.id,
          word: rw.word,
          normalizedWord: lemma,
          cefrLevel: effectiveLevel,
          definition: rw.definition || null,
          partOfSpeech: rw.part_of_speech || null,
          exampleSentence: rw.example_sentence || null,
          pronunciation: rw.pronunciation || null,
          status: status,
          createdAt: rw.created_at,
          updatedAt: rw.updated_at,
        };
      }

      await setStorage({ [KEYS.known]: nextKnown, [KEYS.vocabRecords]: nextRecords });

      // Notify all open tabs to update highlights immediately
      if (typeof chrome !== "undefined" && chrome.tabs?.query) {
        chrome.tabs.query({}, (tabs) => {
          for (const tab of tabs || []) {
            if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "vh:known-changed" }).catch(() => { });
          }
        });
      }
    }

    await setStorage({
      [KEYS.syncMeta]: {
        ...(await getStorage(KEYS.syncMeta, {})),
        lastSyncedAt: new Date().toISOString(),
        error: null,
      },
    });

    return { ok: true, syncedCount, pulledCount };
  } catch (err) {
    const rawMsg = err?.message || String(err);
    let friendlyError = rawMsg;
    const isAuthExpired =
      rawMsg.includes("JWT expired") ||
      rawMsg.includes("PGRST303") ||
      rawMsg.includes("401") ||
      rawMsg.includes("invalid_grant") ||
      rawMsg.includes("session has expired") ||
      rawMsg.includes("not_authenticated");

    if (isAuthExpired) {
      const stored = await getAuthConfig();
      if (!stored.session?.refresh_token) {
        friendlyError = "Your login session has expired. Please sign in again under Settings.";
        await clearAuthSession();
      }
    }

    await setStorage({
      [KEYS.syncMeta]: {
        ...(await getStorage(KEYS.syncMeta, {})),
        error: friendlyError,
      },
    });
    return {
      ok: false,
      error: friendlyError,
      reason: isAuthExpired ? "session_expired" : "error",
    };
  }
}
