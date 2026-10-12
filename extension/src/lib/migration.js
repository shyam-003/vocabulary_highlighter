import { KEYS, getKnownMap } from "./storage.js";
import { getCefrLevel } from "./cefr-data.js";
import { normalizeWord } from "./normalizer.js";

const CURRENT_SCHEMA_VERSION = 3;

/**
 * Safely and idempotently migrates existing chrome.storage.local data
 * (from simple `vh_known` boolean map) to structured vocabulary records.
 *
 * CRITICAL MIGRATION GUARANTEES:
 * 1. Existing `vh_known` words receive status = "known" and dueAt = null.
 * 2. Existing words do NOT flood the spaced-repetition review queue.
 * 3. The original `vh_known` map is preserved for zero-latency webpage highlighting.
 * 4. Safe to run multiple times without duplicating or corrupting data.
 */
export async function runStorageMigration() {
  return new Promise((resolve) => {
    chrome.storage.local.get([KEYS.schemaVersion, KEYS.known, KEYS.defcache, KEYS.vocabRecords], async (res) => {
      const currentVer = res[KEYS.schemaVersion] || 1;
      const existingRecords = res[KEYS.vocabRecords] || {};
      const knownMap = await getKnownMap();
      const cacheMap = res[KEYS.defcache] || {};
      const updatedRecords = { ...existingRecords };
      let count = 0;

      for (const wordKey of Object.keys(knownMap)) {
        const lemma = normalizeWord(wordKey);
        if (!lemma) continue;
        const cacheEntry = cacheMap[lemma]?.data || cacheMap[wordKey]?.data || {};

        if (!updatedRecords[lemma]) {
          const nowISO = new Date().toISOString();

          updatedRecords[lemma] = {
            id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `vocab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            word: wordKey,
            normalizedWord: lemma,
            cefrLevel: getCefrLevel(lemma, cacheEntry.pos),
            definition: cacheEntry.definition || null,
            partOfSpeech: cacheEntry.pos || null,
            exampleSentence: cacheEntry.example || null,
            pronunciation: cacheEntry.pronunciation || null,
            createdAt: nowISO,
            updatedAt: nowISO,
            learningState: {
              id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `state_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              vocabularyWordId: lemma,
              status: "known", // Legacy imported words remain in 'known' state
              repetitions: 0,
              lapses: 0,
              difficulty: 5.0,
              stability: 1.0,
              dueAt: null, // NOT due for spaced repetition automatically
              lastReviewedAt: null,
              createdAt: nowISO,
              updatedAt: nowISO,
            },
          };
          count++;
        } else {
          let changed = false;
          if (!updatedRecords[lemma].partOfSpeech && cacheEntry.pos) {
            updatedRecords[lemma].partOfSpeech = cacheEntry.pos;
            changed = true;
          }
          if (!updatedRecords[lemma].pronunciation && cacheEntry.pronunciation) {
            updatedRecords[lemma].pronunciation = cacheEntry.pronunciation;
            changed = true;
          }
          if (changed) {
            updatedRecords[lemma].updatedAt = new Date().toISOString();
            count++;
          }
        }
      }

      if (currentVer < CURRENT_SCHEMA_VERSION || count > 0) {
        chrome.storage.local.get(KEYS.pendingSync, async (syncRes) => {
          const syncQueue = syncRes[KEYS.pendingSync] || [];
          for (const lemma of Object.keys(updatedRecords)) {
            const rec = updatedRecords[lemma];
            if (rec && (!existingRecords[lemma] ||
                existingRecords[lemma].partOfSpeech !== rec.partOfSpeech ||
                existingRecords[lemma].pronunciation !== rec.pronunciation)) {
              const eventId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              syncQueue.push({
                id: eventId,
                eventId,
                entityType: "vocabulary_word",
                entityId: lemma,
                operation: "UPSERT",
                payload: rec,
                createdAt: new Date().toISOString(),
              });
            }
          }

          await chrome.storage.local.set({
            [KEYS.vocabRecords]: updatedRecords,
            [KEYS.pendingSync]: syncQueue,
            [KEYS.schemaVersion]: CURRENT_SCHEMA_VERSION,
          });

          try {
            chrome.runtime?.sendMessage({ type: "vh:sync-now" }).catch(() => {});
          } catch {}

          resolve({ ok: true, migratedCount: count, skipped: false });
        });
      } else {
        resolve({ ok: true, migratedCount: count, skipped: true });
      }
    });
  });
}

/**
 * Automatically scans all stored vocabulary records and fetches missing
 * definitions, part of speech, and pronunciation (IPA) from Datamuse.
 *
 * CRITICAL SAFETY RULES:
 * 1. NEVER overwrites or modifies existing definitions (especially custom/saved definitions).
 * 2. Only fills in missing fields (definition, partOfSpeech, pronunciation).
 * 3. Rates requests politely (60ms delay between words) and saves progress incrementally.
 * 4. Pushes updated records to pendingSync queue for cloud synchronization.
 */
export async function enrichMissingVocabularyDetails(onProgress = null) {
  return new Promise((resolve) => {
    chrome.storage.local.get([KEYS.vocabRecords, KEYS.defcache, KEYS.pendingSync], async (res) => {
      const records = res[KEYS.vocabRecords] || {};
      const cache = res[KEYS.defcache] || {};
      let syncQueue = res[KEYS.pendingSync] || [];

      // Find words that need enrichment
      const wordsToEnrich = Object.keys(records).filter((key) => {
        const r = records[key];
        if (!r) return false;
        const missingDef = !r.definition || r.definition.trim() === "";
        const missingPos = !r.partOfSpeech;
        const missingPron = !r.pronunciation;
        return missingDef || missingPos || missingPron;
      });

      if (wordsToEnrich.length === 0) {
        if (typeof onProgress === "function") onProgress({ total: 0, current: 0, updatedCount: 0, done: true });
        resolve({ ok: true, count: 0, total: 0 });
        return;
      }

      let updatedCount = 0;
      const batchSize = 5;

      for (let i = 0; i < wordsToEnrich.length; i++) {
        const lemma = wordsToEnrich[i];
        const r = records[lemma];
        if (!r) continue;

        try {
          const metaRes = await fetch(`https://api.datamuse.com/words?sp=${encodeURIComponent(lemma)}&md=dpr&ipa=1&max=1`)
            .then((res) => (res.ok ? res.json() : []))
            .catch(() => []);

          let changed = false;

          if (Array.isArray(metaRes) && metaRes.length > 0) {
            const item = metaRes[0];
            const tags = Array.isArray(item.tags) ? item.tags : [];
            const posMap = { n: "noun", v: "verb", adj: "adjective", adv: "adverb" };

            // 1. Definition (ONLY IF MISSING, PRESERVE SAVED/EXISTING DEFINITIONS)
            if (!r.definition || r.definition.trim() === "") {
              if (Array.isArray(item.defs) && item.defs.length > 0) {
                const parts = item.defs[0].split("\t");
                const rawDef = parts[1] || item.defs[0];
                r.definition = rawDef.charAt(0).toUpperCase() + rawDef.slice(1).trim();
                changed = true;
              }
            }

            // 2. Part of Speech (ONLY IF MISSING)
            if (!r.partOfSpeech) {
              if (Array.isArray(item.defs) && item.defs.length > 0) {
                const posCode = item.defs[0].split("\t")[0];
                r.partOfSpeech = posMap[posCode] || posCode || null;
                changed = true;
              } else {
                const foundPosTag = tags.find((t) => typeof t === "string" && posMap[t]);
                if (foundPosTag) {
                  r.partOfSpeech = posMap[foundPosTag];
                  changed = true;
                }
              }
            }

            // 3. Pronunciation (ONLY IF MISSING)
            if (!r.pronunciation) {
              const ipaTag = tags.find((t) => typeof t === "string" && t.startsWith("ipa_pron:"));
              const pronTag = tags.find((t) => typeof t === "string" && t.startsWith("pron:"));
              if (ipaTag) {
                r.pronunciation = `/${ipaTag.replace("ipa_pron:", "").trim()}/`;
                changed = true;
              } else if (pronTag) {
                r.pronunciation = `/${pronTag.replace("pron:", "").trim()}/`;
                changed = true;
              }
            }
          }

          if (changed) {
            r.updatedAt = new Date().toISOString();
            updatedCount++;

            // Update definition cache without overwriting any customDefinition
            const existingCache = cache[lemma]?.data || {};
            cache[lemma] = {
              data: {
                ...existingCache,
                word: r.word || lemma,
                found: true,
                definition: existingCache.definition || r.definition,
                pos: r.partOfSpeech || existingCache.pos,
                pronunciation: r.pronunciation || existingCache.pronunciation,
              },
              ts: Date.now(),
            };

            // Queue for Supabase cloud sync
            const eventId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            syncQueue.push({
              id: eventId,
              eventId,
              entityType: "vocabulary_word",
              entityId: lemma,
              operation: "UPSERT",
              payload: r,
              createdAt: new Date().toISOString(),
            });
          }
        } catch (e) {
          console.warn(`[Enrichment] Failed for ${lemma}:`, e);
        }

        if (typeof onProgress === "function") {
          onProgress({ total: wordsToEnrich.length, current: i + 1, updatedCount, word: lemma });
        }

        // Save in batches of 5 or at the end
        if ((i + 1) % batchSize === 0 || i === wordsToEnrich.length - 1) {
          const liveStore = await chrome.storage.local.get([KEYS.pendingSync]);
          const currentQueue = liveStore[KEYS.pendingSync] || [];
          const mergedQueue = [...currentQueue];
          for (const item of syncQueue) {
            if (!mergedQueue.some((q) => q.entityId === item.entityId && q.operation === item.operation)) {
              mergedQueue.push(item);
            }
          }
          await chrome.storage.local.set({
            [KEYS.vocabRecords]: records,
            [KEYS.defcache]: cache,
            [KEYS.pendingSync]: mergedQueue,
          });
        }

        // Delay to avoid hitting Datamuse rate limits
        await new Promise((r) => setTimeout(r, 60));
      }

      if (typeof onProgress === "function") {
        onProgress({ total: wordsToEnrich.length, current: wordsToEnrich.length, updatedCount, done: true });
      }

      resolve({ ok: true, count: updatedCount, total: wordsToEnrich.length });
    });
  });
}
