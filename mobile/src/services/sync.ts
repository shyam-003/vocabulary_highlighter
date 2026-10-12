import AsyncStorage from '@react-native-async-storage/async-storage';
import { batchDeleteVocabIds, batchUpsertRemoteVocab, getDB, recalculateAndCacheStats } from '../db/sqlite';
import { DEFAULT_SUPABASE_ANON_KEY, DEFAULT_SUPABASE_URL, getSupabaseClient } from './supabase';

export interface MobileSyncStatus {
  status: 'synced' | 'pending' | 'syncing' | 'error' | 'unauthenticated';
  pendingCount: number;
  lastSyncedAt: string | null;
  error?: string | null;
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export async function saveStoredConfig(url: string, key: string) {
  try {
    await AsyncStorage.setItem('vh_supabase_url', url || '');
    await AsyncStorage.setItem('vh_supabase_key', key || '');
  } catch {}
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('vh_supabase_url', url || '');
      localStorage.setItem('vh_supabase_key', key || '');
    }
  } catch {}
  try {
    const db = await getDB();
    if (db && typeof db.runAsync === 'function') {
      await db.runAsync(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('supabase_url', ?)`, [url || '']);
      await db.runAsync(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('supabase_key', ?)`, [key || '']);
    }
  } catch (err) {
    console.warn('Could not save sync_meta to SQLite:', err);
  }
}

export async function getStoredConfig() {
  let url = '';
  let key = '';
  try {
    url = (await AsyncStorage.getItem('vh_supabase_url')) || '';
    key = (await AsyncStorage.getItem('vh_supabase_key')) || '';
  } catch {}

  if (!url || !key) {
    try {
      if (typeof localStorage !== 'undefined') {
        url = url || localStorage.getItem('vh_supabase_url') || '';
        key = key || localStorage.getItem('vh_supabase_key') || '';
      }
    } catch {}
  }

  if (!url || !key) {
    try {
      const db = await getDB();
      if (db && typeof db.getFirstAsync === 'function') {
        const urlRow: any = await db.getFirstAsync(`SELECT value FROM sync_meta WHERE key = 'supabase_url'`);
        const keyRow: any = await db.getFirstAsync(`SELECT value FROM sync_meta WHERE key = 'supabase_key'`);
        url = url || urlRow?.value || '';
        key = key || keyRow?.value || '';
      }
    } catch (err) {
      console.warn('Could not get sync_meta from SQLite:', err);
    }
  }

  return {
    url: url || DEFAULT_SUPABASE_URL || '',
    key: key || DEFAULT_SUPABASE_ANON_KEY || '',
  };
}

export async function clearStoredConfig() {
  try {
    await AsyncStorage.removeItem('vh_supabase_url');
    await AsyncStorage.removeItem('vh_supabase_key');
  } catch {}
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('vh_supabase_url');
      localStorage.removeItem('vh_supabase_key');
    }
  } catch {}
  try {
    const db = await getDB();
    if (db && typeof db.runAsync === 'function') {
      await db.runAsync(`DELETE FROM sync_meta WHERE key = 'supabase_url'`);
      await db.runAsync(`DELETE FROM sync_meta WHERE key = 'supabase_key'`);
    }
  } catch (err) {
    console.warn('Could not clear sync_meta from SQLite:', err);
  }
}

export async function getMobileSyncStatus(): Promise<MobileSyncStatus> {
  let pendingCount = 0;
  let lastSynced: string | null = null;
  let lastError: string | null = null;

  try {
    const db = await getDB();
    const pendingVocabRow: any = await db.getFirstAsync(
      `SELECT COUNT(*) as count FROM vocabulary_words WHERE sync_status = 'pending_upsert'`
    );
    const metaRow: any = await db.getFirstAsync(`SELECT value FROM sync_meta WHERE key = 'last_synced_at'`);
    const errRow: any = await db.getFirstAsync(`SELECT value FROM sync_meta WHERE key = 'last_error'`);

    pendingCount = pendingVocabRow?.count || 0;
    lastSynced = metaRow?.value || null;
    lastError = errRow?.value || null;
  } catch (dbErr) {
    console.warn('getMobileSyncStatus SQLite read warning:', dbErr);
  }

  if (!lastSynced) {
    try {
      lastSynced = (await AsyncStorage.getItem('vh_last_synced_at')) || null;
    } catch {}
    if (!lastSynced && typeof localStorage !== 'undefined') {
      lastSynced = localStorage.getItem('vh_last_synced_at') || null;
    }
  }

  // Check auth session
  let isAuth = false;
  try {
    const cfg = await getStoredConfig();
    const client = getSupabaseClient(cfg.url, cfg.key);
    if (client) {
      const sess = (await client.auth.getSession()).data?.session;
      isAuth = !!sess?.user;
    }
  } catch {}

  let status: 'synced' | 'pending' | 'syncing' | 'error' | 'unauthenticated' = 'synced';
  if (!isAuth) {
    status = 'unauthenticated';
  } else if (lastError) {
    status = 'error';
  } else if (pendingCount > 0) {
    status = 'pending';
  }

  return {
    status,
    pendingCount,
    lastSyncedAt: lastSynced,
    error: lastError,
  };
}

let activeSyncPromise: Promise<any> | null = null;

/**
 * Checks if 24 hours have passed since the last sync. If so, triggers an automatic background sync.
 */
export async function checkDailyAutoSync(supabaseUrl?: string, supabaseAnonKey?: string) {
  try {
    const db = await getDB();
    const metaRow: any = await db.getFirstAsync(`SELECT value FROM sync_meta WHERE key = 'last_synced_at'`);
    let lastSynced = metaRow?.value || null;
    if (!lastSynced) {
      lastSynced = (await AsyncStorage.getItem('vh_last_synced_at')) || null;
    }

    if (lastSynced) {
      const lastTime = new Date(lastSynced).getTime();
      const now = Date.now();
      if (now - lastTime < TWENTY_FOUR_HOURS_MS) {
        // Less than 24 hours, do not sync
        return { ok: true, skipped: true, reason: 'within_24_hours' };
      }
    }

    // >24 hours or never synced: run background sync
    return await runMobileSync(supabaseUrl, supabaseAnonKey, { force: true });
  } catch (e) {
    console.warn('checkDailyAutoSync error:', e);
    return { ok: false, error: String(e) };
  }
}

/**
 * Main Mobile Sync executor.
 */
export async function runMobileSync(
  supabaseUrl?: string,
  supabaseAnonKey?: string,
  options?: { fullSync?: boolean; force?: boolean }
) {
  if (activeSyncPromise) {
    return activeSyncPromise;
  }

  activeSyncPromise = _performMobileSync(supabaseUrl, supabaseAnonKey, options).finally(() => {
    activeSyncPromise = null;
  });
  return activeSyncPromise;
}

async function _performMobileSync(
  supabaseUrl?: string,
  supabaseAnonKey?: string,
  options?: { fullSync?: boolean; force?: boolean }
) {
  const cfg = await getStoredConfig();
  const url = supabaseUrl || cfg.url;
  const key = supabaseAnonKey || cfg.key;
  const db = await getDB();

  if (!url || !key) {
    const msg = 'Missing Supabase URL or Anon Key configuration.';
    await db.runAsync(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('last_error', ?)`, [msg]);
    return { ok: false, reason: 'missing_config', error: msg };
  }

  const client = getSupabaseClient(url, key);
  if (!client) {
    const msg = 'Invalid Supabase client configuration.';
    await db.runAsync(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('last_error', ?)`, [msg]);
    return { ok: false, reason: 'missing_config', error: msg };
  }

  let session = (await client.auth.getSession()).data?.session;
  if (!session?.user) {
    const msg = 'Authentication required. Please log in under Settings.';
    await db.runAsync(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('last_error', ?)`, [msg]);
    return { ok: false, reason: 'not_authenticated', error: msg };
  }

  // Auto-refresh token if close to expiration (within 5 mins) or expired
  const expiresAt = session.expires_at;
  const nowInSec = Math.floor(Date.now() / 1000);
  if (!expiresAt || nowInSec > expiresAt - 300) {
    try {
      const refreshed = await client.auth.refreshSession();
      if (refreshed.data?.session) {
        session = refreshed.data.session;
      }
    } catch (err) {
      console.error('Mobile auto session refresh error:', err);
    }
  }

  const userId = session.user.id;

  try {
    // 1. Gather local pending vocabulary words and push to Supabase
    const pendingWords: any[] = await db.getAllAsync(
      `SELECT * FROM vocabulary_words WHERE sync_status = 'pending_upsert'`
    );

    let pushedCount = 0;
    if (pendingWords && pendingWords.length > 0) {
      const uniquePendingVocabMap = new Map<string, any>();
      for (const w of pendingWords) {
        const norm = (w.normalized_word || w.word || '').toLowerCase().trim();
        if (norm) uniquePendingVocabMap.set(norm, w);
      }

      const uniquePendingList = Array.from(uniquePendingVocabMap.values());

      for (let i = 0; i < uniquePendingList.length; i += 50) {
        const chunk = uniquePendingList.slice(i, i + 50);
        const vocabChunkPayload = chunk.map((w) => {
          const norm = (w.normalized_word || w.word || '').toLowerCase().trim();
          return {
            user_id: userId,
            word: w.word,
            normalized_word: norm,
            cefr_level: w.cefr_level || null,
            definition: w.definition || null,
            part_of_speech: w.part_of_speech || null,
            example_sentence: w.example_sentence || null,
            pronunciation: w.pronunciation || null,
            status: w.status || 'known',
            updated_at: w.updated_at || new Date().toISOString(),
          };
        });

        const { error: vErr } = await client
          .from('vocabulary_words')
          .upsert(vocabChunkPayload, { onConflict: 'user_id,normalized_word' });

        if (vErr) throw vErr;
        pushedCount += chunk.length;
      }

      // Mark local pending words as synced using chunked batch updates
      const markChunkSize = 200;
      for (let i = 0; i < pendingWords.length; i += markChunkSize) {
        const chunk = pendingWords.slice(i, i + markChunkSize);
        const placeholders = chunk.map(() => '?').join(',');
        await db.runAsync(
          `UPDATE vocabulary_words SET sync_status = 'synced' WHERE id IN (${placeholders})`,
          chunk.map((w: any) => w.id)
        );
      }
    }

    // 2. Fetch remote vocabulary from Supabase (Incremental or Full)
    const metaRow: any = await db.getFirstAsync(`SELECT value FROM sync_meta WHERE key = 'last_synced_at'`);
    let lastSynced = metaRow?.value || null;
    if (!lastSynced && typeof localStorage !== 'undefined') {
      lastSynced = localStorage.getItem('vh_last_synced_at') || null;
    }

    const localCountRow: any = await db.getFirstAsync(`SELECT COUNT(*) as count FROM vocabulary_words`);
    const localCount = localCountRow?.count || 0;

    let isFullSync = options?.fullSync || !lastSynced || localCount === 0;

    const remoteVocab: any[] = [];
    let from = 0;
    const step = 1000;

    while (true) {
      let query = client.from('vocabulary_words').select('*');

      if (!isFullSync && lastSynced) {
        query = query
          .gt('updated_at', lastSynced)
          .order('updated_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + step - 1);
      } else {
        query = query
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + step - 1);
      }

      const { data: chunk, error: vocabErr } = await query;
      if (vocabErr) throw vocabErr;
      if (!chunk || chunk.length === 0) break;
      remoteVocab.push(...chunk);
      from += chunk.length;
      if (chunk.length < step) break;

      // Yield to JS event loop between remote pages
      await new Promise((r) => setTimeout(r, 0));
    }

    // 3. Upsert remote records into local SQLite (skip internal stats recalc)
    if (remoteVocab && remoteVocab.length > 0) {
      await batchUpsertRemoteVocab(db, remoteVocab, { skipRecalculate: true });
    }

    // 4. Remove local words deleted remotely (during full sync)
    if (isFullSync && remoteVocab.length > 0) {
      const remoteIdSet = new Set((remoteVocab || []).map((rv: any) => rv.id));
      const remoteWordSet = new Set(
        (remoteVocab || []).map((rv: any) => (rv.normalized_word || rv.word || '').toLowerCase().trim())
      );

      const localSyncedWords: any[] = await db.getAllAsync(
        `SELECT id, normalized_word, word FROM vocabulary_words WHERE sync_status = 'synced'`
      );
      const idsToDelete: string[] = [];
      for (const lw of localSyncedWords || []) {
        const localNorm = (lw.normalized_word || lw.word || '').toLowerCase().trim();
        if (!remoteIdSet.has(lw.id) && !remoteWordSet.has(localNorm)) {
          idsToDelete.push(lw.id);
        }
      }
      if (idsToDelete.length > 0) {
        await batchDeleteVocabIds(db, idsToDelete, { skipRecalculate: true });
      }
    }

    // 5. Update last_synced_at & recalculate stats cache ONCE
    const nowISO = new Date().toISOString();
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('vh_last_synced_at', nowISO);
      }
    } catch {}
    await db.runAsync(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)`, ['last_synced_at', nowISO]);
    await db.runAsync(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)`, ['last_error', '']);
    await recalculateAndCacheStats(db);

    return { ok: true, pushedCount, pulledCount: remoteVocab.length };
  } catch (err: any) {
    const rawMsg = err?.message || String(err);
    let errMsg = rawMsg;
    const isAuthExpired =
      rawMsg.includes('JWT expired') ||
      rawMsg.includes('PGRST303') ||
      rawMsg.includes('401') ||
      rawMsg.includes('invalid_grant') ||
      rawMsg.includes('session has expired') ||
      rawMsg.includes('not_authenticated');

    if (isAuthExpired) {
      errMsg = 'Your login session has expired. Please sign in again under Settings.';
    }

    try {
      await db.runAsync(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)`, ['last_error', errMsg]);
    } catch {}
    return { ok: false, error: errMsg, reason: isAuthExpired ? 'not_authenticated' : 'error' };
  }
}
