import { Platform } from 'react-native';
import { getCefrLevel } from '../services/cefr';

export interface LocalVocabWord {
  id: string;
  word: string;
  normalized_word: string;
  cefr_level: string | null;
  definition: string | null;
  part_of_speech: string | null;
  example_sentence: string | null;
  pronunciation?: string | null;
  status: 'known' | 'unknown' | string;
  created_at: string;
  updated_at: string;
  sync_status?: 'synced' | 'pending_upsert' | 'pending_delete';
}

export interface CachedStats {
  totalCount: number;
  knownCount: number;
  unknownCount: number;
  cefrDist: Record<string, number>;
}

const DEFAULT_CEFR_DIST: Record<string, number> = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 };

export function formatStatusLabel(status?: string): string {
  const st = (status || 'known').toLowerCase();
  return st === 'unknown' ? 'Unknown' : 'Known';
}

// In-memory / LocalStorage web fallback for Platform.OS === 'web'
class WebDatabaseFallback {
  private getStorage(key: string, fallback: any) {
    try {
      const v = typeof localStorage !== 'undefined' ? localStorage.getItem(`vh_web_${key}`) : null;
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  }

  private setStorage(key: string, val: any) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(`vh_web_${key}`, JSON.stringify(val));
      }
    } catch {}
  }

  async execAsync(_sql: string) {}

  async getAllAsync(query: string, params: any[] = []): Promise<any[]> {
    const vocab = this.getStorage('vocab', []);
    const queue = this.getStorage('queue', []);

    if (query.includes('GROUP BY cefr_level') || query.includes('SELECT COALESCE(cefr_level') || query.includes('SELECT cefr_level')) {
      const counts: Record<string, number> = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 };
      vocab.forEach((v: any) => {
        const k = (v.cefr_level || 'B1').toUpperCase().trim();
        if (counts[k] !== undefined) counts[k]++;
        else counts.B1++;
      });
      return Object.entries(counts).map(([cefr_level, count]) => ({ cefr_level, count }));
    }

    if (query.includes('GROUP BY status') || query.includes('COALESCE(status') || query.includes('SELECT status')) {
      let known = 0;
      let unknown = 0;
      vocab.forEach((v: any) => {
        const k = String(v.status || 'known').toLowerCase().trim();
        if (k === 'unknown') unknown++;
        else known++;
      });
      return [
        { status: 'known', count: known },
        { status: 'unknown', count: unknown },
      ];
    }

    if (query.includes('strftime') && query.includes('date_str')) {
      const counts: Record<string, number> = {};
      vocab.forEach((v: any) => {
        const d = (v.created_at || '').slice(0, 10);
        if (d) counts[d] = (counts[d] || 0) + 1;
      });
      return Object.entries(counts).map(([date_str, count]) => ({ date_str, count }));
    }

    if (query.includes('FROM vocabulary_words')) {
      let list = vocab.map((v: any) => ({
        ...v,
        status: v.status || 'known',
        cefr_level: v.cefr_level || 'B1',
      }));

      if (params[0] && query.includes('LIKE')) {
        const q = String(params[0]).replace(/%/g, '').toLowerCase().trim();
        list = list.filter((item: any) =>
          (item.word || '').toLowerCase().startsWith(q) || (item.normalized_word || '').toLowerCase().startsWith(q)
        );
      }

      if (params[0] && query.includes('cefr_level =')) {
        list = list.filter((item: any) => (item.cefr_level || 'B1') === params[0]);
      }

      if (query.includes("status = 'known'")) {
        list = list.filter((item: any) => (item.status || 'known').toLowerCase() === 'known');
      } else if (query.includes("status = 'unknown'")) {
        list = list.filter((item: any) => (item.status || 'known').toLowerCase() === 'unknown');
      } else if (query.includes('status = ?')) {
        const targetStatus = String(params[params.length - 1] || 'known').toLowerCase();
        list = list.filter((item: any) => (item.status || 'known').toLowerCase() === targetStatus);
      }

      list.sort((a: any, b: any) => {
        const wordA = (a.normalized_word || a.word || '').trim().toLowerCase();
        const wordB = (b.normalized_word || b.word || '').trim().toLowerCase();
        return wordA.localeCompare(wordB);
      });

      return list;
    }

    if (query.includes('FROM sync_queue')) {
      return queue;
    }

    return [];
  }

  async getFirstAsync(query: string, params: any[] = []): Promise<any> {
    const vocab = this.getStorage('vocab', []);
    const meta = this.getStorage('meta', {});

    if (query.includes('COUNT(*) as count FROM vocabulary_words')) {
      if (query.includes("sync_status = 'pending_upsert'")) {
        const pending = vocab.filter((v: any) => v.sync_status === 'pending_upsert');
        return { count: pending.length };
      }
      return { count: vocab.length };
    }

    if (query.includes('COUNT(*) as count FROM sync_queue')) {
      const queue = this.getStorage('queue', []);
      return { count: queue.length };
    }

    if (query.includes('SELECT value FROM sync_meta')) {
      let key = params[0];
      if (!key) {
        const match = query.match(/key\s*=\s*'([^']+)'/i);
        if (match) key = match[1];
      }
      return { value: key ? (meta[key] || null) : null };
    }

    if (query.includes('FROM vocabulary_words WHERE normalized_word = ?')) {
      const norm = String(params[0] || '').toLowerCase().trim();
      const found = vocab.find((v: any) => (v.normalized_word || '').toLowerCase().trim() === norm);
      return found || null;
    }

    if (query.includes('FROM vocabulary_words WHERE id = ?')) {
      const id = params[0];
      const found = vocab.find((v: any) => v.id === id);
      return found || null;
    }

    return null;
  }

  async runAsync(query: string, params: any[] = []) {
    const vocab = this.getStorage('vocab', []);
    const queue = this.getStorage('queue', []);
    const meta = this.getStorage('meta', {});

    if (query.includes('INSERT INTO vocabulary_words') || query.includes('ON CONFLICT(normalized_word)')) {
      const [id, word, normalized_word, cefr_level, definition, part_of_speech, example_sentence, pronunciation, status, created_at, updated_at] = params;
      const norm = (normalized_word || word || '').toLowerCase().trim();
      const idx = vocab.findIndex((v: any) => (v.normalized_word || '').toLowerCase().trim() === norm);
      const rec = {
        id: id || `vocab_${Date.now()}`,
        word,
        normalized_word: norm,
        cefr_level: cefr_level || 'B1',
        definition: definition || null,
        part_of_speech: part_of_speech || null,
        example_sentence: example_sentence || null,
        pronunciation: pronunciation || null,
        status: status || 'known',
        created_at: created_at || new Date().toISOString(),
        updated_at: updated_at || new Date().toISOString(),
        sync_status: 'synced',
      };
      if (idx >= 0) vocab[idx] = { ...vocab[idx], ...rec };
      else vocab.push(rec);
      this.setStorage('vocab', vocab);
    } else if (query.includes('UPDATE vocabulary_words SET')) {
      const id = params[params.length - 1];
      const idx = vocab.findIndex((v: any) => v.id === id);
      if (idx >= 0) {
        if (query.includes("sync_status = 'synced'")) {
          vocab[idx].sync_status = 'synced';
        }
        this.setStorage('vocab', vocab);
      }
    } else if (query.includes('INSERT INTO sync_queue')) {
      const [id, event_id, entity_type, entity_id, operation, payload, created_at] = params;
      queue.push({ id, event_id, entity_type, entity_id, operation, payload, created_at });
      this.setStorage('queue', queue);
    } else if (query.includes('DELETE FROM sync_queue')) {
      const qid = params[0];
      const nextQ = queue.filter((q: any) => q.id !== qid);
      this.setStorage('queue', nextQ);
    } else if (query.includes('DELETE FROM vocabulary_words')) {
      this.setStorage('vocab', []);
    } else if (query.includes('INSERT OR REPLACE INTO sync_meta') || query.includes('INSERT INTO sync_meta')) {
      let key = params[0];
      let val = params[1];
      if (params.length === 1) {
        const match = query.match(/VALUES\s*\(\s*'([^']+)'\s*,\s*\?\s*\)/i);
        if (match) {
          key = match[1];
          val = params[0];
        }
      }
      if (key) {
        meta[key] = val;
        this.setStorage('meta', meta);
      }
    } else if (query.includes('DELETE FROM sync_meta')) {
      const key = params[0];
      if (key) {
        delete meta[key];
        this.setStorage('meta', meta);
      }
    }
  }

  async batchUpsertRemoteVocab(items: any[]) {
    if (!items || items.length === 0) return;
    const vocab = this.getStorage('vocab', []);
    const vocabMap = new Map<string, any>(vocab.map((v: any) => [v.normalized_word, v]));

    for (const item of items) {
      const norm = item.normalized_word;
      if (!norm) continue;
      const existing = vocabMap.get(norm);
      const rec = {
        id: item.id || existing?.id,
        word: item.word,
        normalized_word: norm,
        cefr_level: item.cefr_level || existing?.cefr_level || null,
        definition: item.definition || existing?.definition || null,
        part_of_speech: item.part_of_speech || existing?.part_of_speech || null,
        example_sentence: item.example_sentence || existing?.example_sentence || null,
        pronunciation: item.pronunciation || existing?.pronunciation || null,
        status: item.status || existing?.status || 'known',
        created_at: item.created_at || existing?.created_at || new Date().toISOString(),
        updated_at: item.updated_at || new Date().toISOString(),
        sync_status: 'synced',
      };
      vocabMap.set(norm, rec);
    }

    this.setStorage('vocab', Array.from(vocabMap.values()));
  }

  async batchDeleteVocabIds(ids: string[]) {
    if (!ids || ids.length === 0) return;
    const idSet = new Set(ids);
    const vocab = this.getStorage('vocab', []);
    const newVocab = vocab.filter((v: any) => !idSet.has(v.id));
    this.setStorage('vocab', newVocab);
  }
}

export async function batchUpsertRemoteVocab(
  db: any,
  items: any[],
  options?: { skipRecalculate?: boolean }
) {
  if (!items || items.length === 0) return;

  if (Platform.OS === 'web') {
    if ((db as any).batchUpsertRemoteVocab) {
      await (db as any).batchUpsertRemoteVocab(items);
      if (!options?.skipRecalculate) {
        await recalculateAndCacheStats(db);
      }
      return;
    }
  }

  // Multi-row insert in chunks of 50 (50 * 11 = 550 params, well under SQLite 999 limit)
  const chunkSize = 50;
  const nowISO = new Date().toISOString();

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const validVocab = chunk.filter((item: any) => item.word && item.normalized_word);
    if (validVocab.length === 0) continue;

    const valuePlaceholders = validVocab.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')`).join(', ');
    const params: any[] = [];

    for (const item of validVocab) {
      params.push(
        item.id ?? null,
        item.word,
        item.normalized_word,
        item.cefr_level ?? null,
        item.definition ?? null,
        item.part_of_speech ?? null,
        item.example_sentence ?? null,
        item.pronunciation ?? null,
        item.status || 'known',
        item.created_at || nowISO,
        item.updated_at || nowISO
      );
    }

    const vocabSql = `
      INSERT INTO vocabulary_words (
        id, word, normalized_word, cefr_level, definition, part_of_speech, example_sentence, pronunciation, status, created_at, updated_at, sync_status
      ) VALUES ${valuePlaceholders}
      ON CONFLICT(normalized_word) DO UPDATE SET
        id = excluded.id,
        word = excluded.word,
        definition = CASE WHEN vocabulary_words.sync_status = 'pending_upsert' THEN vocabulary_words.definition ELSE COALESCE(excluded.definition, vocabulary_words.definition) END,
        cefr_level = CASE WHEN vocabulary_words.sync_status = 'pending_upsert' THEN vocabulary_words.cefr_level ELSE COALESCE(excluded.cefr_level, vocabulary_words.cefr_level) END,
        part_of_speech = CASE WHEN vocabulary_words.sync_status = 'pending_upsert' THEN vocabulary_words.part_of_speech ELSE COALESCE(excluded.part_of_speech, vocabulary_words.part_of_speech) END,
        example_sentence = CASE WHEN vocabulary_words.sync_status = 'pending_upsert' THEN vocabulary_words.example_sentence ELSE COALESCE(excluded.example_sentence, vocabulary_words.example_sentence) END,
        pronunciation = CASE WHEN vocabulary_words.sync_status = 'pending_upsert' THEN vocabulary_words.pronunciation ELSE COALESCE(excluded.pronunciation, vocabulary_words.pronunciation) END,
        status = CASE WHEN vocabulary_words.sync_status = 'pending_upsert' THEN vocabulary_words.status ELSE COALESCE(excluded.status, vocabulary_words.status) END,
        updated_at = excluded.updated_at,
        sync_status = CASE WHEN vocabulary_words.sync_status = 'pending_upsert' THEN 'pending_upsert' ELSE 'synced' END
    `;

    await db.runAsync(vocabSql, params);

    // Yield to JS event loop every 200 items to keep UI responsive
    if (i % 200 === 0 && i > 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  if (!options?.skipRecalculate) {
    await recalculateAndCacheStats(db);
  }
}

export async function batchDeleteVocabIds(
  db: any,
  ids: string[],
  options?: { skipRecalculate?: boolean }
) {
  if (!ids || ids.length === 0) return;

  if (Platform.OS === 'web') {
    if ((db as any).batchDeleteVocabIds) {
      await (db as any).batchDeleteVocabIds(ids);
      if (!options?.skipRecalculate) {
        await recalculateAndCacheStats(db);
      }
      return;
    }
  }

  const chunkSize = 200;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    try {
      if (typeof db.runAsync === 'function') {
        await db.runAsync(`DELETE FROM vocabulary_words WHERE id IN (${placeholders})`, chunk);
      }
    } catch (err) {
      console.warn('batchDeleteVocabIds error:', err);
    }
    if (i > 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  if (!options?.skipRecalculate) {
    await recalculateAndCacheStats(db);
  }
}

let dbPromise: Promise<any> | null = null;
let dbInstance: any = null;

export async function getDB() {
  if (dbInstance) return dbInstance;
  if (Platform.OS === 'web') {
    dbInstance = new WebDatabaseFallback();
    return dbInstance;
  }
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    try {
      const SQLite = await import('expo-sqlite');
      const db = await SQLite.openDatabaseAsync('vocab_highlighter.db');
      await initTables(db);
      dbInstance = db;
      return db;
    } catch (err) {
      dbPromise = null;
      throw err;
    }
  })();

  return dbPromise;
}

async function initTables(db: any) {
  if (Platform.OS === 'web') return;
  try {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS vocabulary_words (
        id TEXT PRIMARY KEY,
        word TEXT NOT NULL,
        normalized_word TEXT NOT NULL UNIQUE,
        cefr_level TEXT,
        definition TEXT,
        part_of_speech TEXT,
        example_sentence TEXT,
        pronunciation TEXT,
        status TEXT NOT NULL DEFAULT 'known',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT DEFAULT 'synced'
      );

      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_local_vocab_norm ON vocabulary_words(normalized_word);
      CREATE INDEX IF NOT EXISTS idx_local_vocab_cefr ON vocabulary_words(cefr_level);
      CREATE INDEX IF NOT EXISTS idx_local_vocab_created ON vocabulary_words(created_at);
      CREATE INDEX IF NOT EXISTS idx_local_vocab_status ON vocabulary_words(status);
    `);

    // Clean up legacy tables if they exist
    try {
      await db.execAsync(`
        DROP TABLE IF EXISTS learning_states;
        DROP TABLE IF EXISTS review_history;
      `);
    } catch {}

    // Add status column to vocabulary_words if missing in existing database
    try {
      await db.execAsync(`ALTER TABLE vocabulary_words ADD COLUMN status TEXT DEFAULT 'known';`);
    } catch {}
    try {
      await db.execAsync(`ALTER TABLE vocabulary_words ADD COLUMN pronunciation TEXT;`);
    } catch {}
  } catch (err) {
    console.warn('initTables warning:', err);
  }
}

/**
 * Recalculates full stats from SQLite once and stores in sync_meta.
 */
export async function recalculateAndCacheStats(db?: any): Promise<CachedStats> {
  const activeDb = db || (await getDB());

  const totalRow: any = await activeDb.getFirstAsync(`SELECT COUNT(*) as count FROM vocabulary_words`);
  const totalCount = Number(totalRow?.count) || 0;

  const cefrDist: Record<string, number> = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 };
  const cefrRows: any[] = await activeDb.getAllAsync(
    `SELECT COALESCE(cefr_level, 'B1') as cefr_level, COUNT(*) as count FROM vocabulary_words GROUP BY cefr_level`
  );
  for (const r of cefrRows || []) {
    const lvl = String(r?.cefr_level || 'B1').toUpperCase().trim();
    const cnt = Number(r?.count) || 0;
    if (cefrDist[lvl] !== undefined) {
      cefrDist[lvl] = cnt;
    } else {
      cefrDist.B1 = (cefrDist.B1 || 0) + cnt;
    }
  }

  let knownCount = 0;
  let unknownCount = 0;
  const statusRows: any[] = await activeDb.getAllAsync(
    `SELECT COALESCE(status, 'known') as status, COUNT(*) as count FROM vocabulary_words GROUP BY status`
  );
  for (const r of statusRows || []) {
    const st = String(r?.status || 'known').toLowerCase().trim();
    const cnt = Number(r?.count) || 0;
    if (st === 'unknown') unknownCount += cnt;
    else knownCount += cnt;
  }

  // Fallback: If status counts were 0 but totalCount > 0, treat all as known
  if (knownCount === 0 && unknownCount === 0 && totalCount > 0) {
    knownCount = totalCount;
  }

  const cached: CachedStats = {
    totalCount,
    knownCount,
    unknownCount,
    cefrDist,
  };

  try {
    await activeDb.runAsync(
      `INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)`,
      ['cefr_stats_cache', JSON.stringify(cached)]
    );
  } catch (e) {
    console.warn('Could not save cefr_stats_cache to sync_meta:', e);
  }

  return cached;
}

/**
 * Incrementally updates cached stats without re-scanning the database.
 */
export async function updateCachedStatsDelta(
  db: any,
  delta: {
    totalDelta?: number;
    addCefr?: string | null;
    removeCefr?: string | null;
    statusChange?: { from?: string; to: string };
  }
) {
  try {
    const metaRow: any = await db.getFirstAsync(`SELECT value FROM sync_meta WHERE key = ?`, ['cefr_stats_cache']);
    let cached: CachedStats;
    if (metaRow?.value) {
      cached = JSON.parse(metaRow.value);
    } else {
      return await recalculateAndCacheStats(db);
    }

    if (delta.totalDelta) {
      cached.totalCount = Math.max(0, (Number(cached.totalCount) || 0) + delta.totalDelta);
    }

    if (!cached.cefrDist) cached.cefrDist = { ...DEFAULT_CEFR_DIST };

    if (delta.removeCefr) {
      const rLvl = String(delta.removeCefr).toUpperCase().trim();
      if (cached.cefrDist[rLvl] !== undefined) {
        cached.cefrDist[rLvl] = Math.max(0, (Number(cached.cefrDist[rLvl]) || 0) - 1);
      }
    }

    if (delta.addCefr) {
      const aLvl = String(delta.addCefr).toUpperCase().trim();
      if (cached.cefrDist[aLvl] !== undefined) {
        cached.cefrDist[aLvl] = (Number(cached.cefrDist[aLvl]) || 0) + 1;
      } else {
        cached.cefrDist.B1 = (Number(cached.cefrDist.B1) || 0) + 1;
      }
    }

    if (delta.statusChange) {
      const fromSt = (delta.statusChange.from || 'known').toLowerCase().trim();
      const toSt = delta.statusChange.to.toLowerCase().trim();
      if (fromSt !== toSt) {
        if (fromSt === 'known') cached.knownCount = Math.max(0, (Number(cached.knownCount) || 0) - 1);
        if (fromSt === 'unknown') cached.unknownCount = Math.max(0, (Number(cached.unknownCount) || 0) - 1);
        if (toSt === 'known') cached.knownCount = (Number(cached.knownCount) || 0) + 1;
        if (toSt === 'unknown') cached.unknownCount = (Number(cached.unknownCount) || 0) + 1;
      }
    }

    await db.runAsync(
      `INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)`,
      ['cefr_stats_cache', JSON.stringify(cached)]
    );
  } catch (e) {
    console.warn('updateCachedStatsDelta error, recalculating fresh:', e);
    await recalculateAndCacheStats(db);
  }
}

/**
 * Total vocabulary count and CEFR level distribution (instant 0ms read from cache).
 */
export async function getVocabularyStats(): Promise<CachedStats> {
  const db = await getDB();
  try {
    const metaRow: any = await db.getFirstAsync(`SELECT value FROM sync_meta WHERE key = ?`, ['cefr_stats_cache']);
    if (metaRow?.value) {
      const parsed = JSON.parse(metaRow.value) as CachedStats;
      const total = Number(parsed.totalCount);
      const known = Number(parsed.knownCount);
      const unknown = Number(parsed.unknownCount);
      if (!isNaN(total) && !isNaN(known) && !isNaN(unknown) && parsed.cefrDist) {
        // If total words exist but both known and unknown are 0 or CEFR counts sum to 0, recalculate
        const cefrSum = Object.values(parsed.cefrDist).reduce((sum, c) => sum + (Number(c) || 0), 0);
        if (total > 0 && (known + unknown === 0 || cefrSum === 0)) {
          return await recalculateAndCacheStats(db);
        }
        return {
          totalCount: total,
          knownCount: known,
          unknownCount: unknown,
          cefrDist: parsed.cefrDist,
        };
      }
    }
  } catch {}

  // Compute on demand if cache not yet populated or invalid
  return await recalculateAndCacheStats(db);
}

/**
 * Retrieves all vocabulary words (Fast direct table query).
 */
export async function getAllVocabulary(filter?: { search?: string; cefr?: string; status?: string }): Promise<LocalVocabWord[]> {
  const db = await getDB();
  let query = `SELECT * FROM vocabulary_words WHERE 1=1`;
  const params: any[] = [];

  const rawSearch = filter?.search ? filter.search.trim().toLowerCase() : '';

  if (rawSearch) {
    query += ` AND (LOWER(TRIM(word)) LIKE ? OR LOWER(TRIM(normalized_word)) LIKE ?)`;
    params.push(`${rawSearch}%`, `${rawSearch}%`);
  }

  if (filter?.cefr) {
    query += ` AND cefr_level = ?`;
    params.push(filter.cefr);
  }

  if (filter?.status) {
    const target = filter.status.toLowerCase();
    if (target === 'known') {
      query += ` AND (status = 'known' OR status IS NULL)`;
    } else if (target === 'unknown') {
      query += ` AND status = 'unknown'`;
    }
  }

  query += ` ORDER BY normalized_word ASC`;

  const rows = await db.getAllAsync(query, params);
  return (rows as LocalVocabWord[]).map((r) => ({
    ...r,
    status: r.status || 'known',
    cefr_level: r.cefr_level || 'B1',
  }));
}

/**
 * Updates a vocabulary word's definition, example sentence, CEFR level, or status.
 */
export async function updateVocabularyWordDetails(
  wordId: string,
  updates: {
    word?: string;
    definition?: string;
    exampleSentence?: string;
    pronunciation?: string | null;
    cefrLevel?: string | null;
    status?: string;
  }
) {
  const db = await getDB();
  const nowISO = new Date().toISOString();

  // Find existing word to track CEFR/status delta
  const existingRow: any = await db.getFirstAsync(`SELECT * FROM vocabulary_words WHERE id = ?`, [wordId]);
  const oldCefr = existingRow?.cefr_level || null;
  const oldStatus = existingRow?.status || 'known';

  if (Platform.OS === 'web') {
    const vocab = (db as any).getStorage ? (db as any).getStorage('vocab', []) : [];
    const idx = vocab.findIndex((v: any) => v.id === wordId);
    if (idx >= 0) {
      if (updates.word !== undefined && updates.word.trim()) {
        vocab[idx].word = updates.word.trim();
        vocab[idx].normalized_word = updates.word.trim().toLowerCase();
      }
      if (updates.definition !== undefined) vocab[idx].definition = updates.definition;
      if (updates.exampleSentence !== undefined) vocab[idx].example_sentence = updates.exampleSentence;
      if (updates.pronunciation !== undefined) vocab[idx].pronunciation = updates.pronunciation;
      if (updates.cefrLevel !== undefined) vocab[idx].cefr_level = updates.cefrLevel;
      if (updates.status !== undefined) vocab[idx].status = updates.status;
      vocab[idx].updated_at = nowISO;
      vocab[idx].sync_status = 'pending_upsert';
      if ((db as any).setStorage) (db as any).setStorage('vocab', vocab);
    }
  } else {
    const fields: string[] = [];
    const params: any[] = [];

    if (updates.word !== undefined && updates.word.trim()) {
      fields.push('word = ?', 'normalized_word = ?');
      params.push(updates.word.trim(), updates.word.trim().toLowerCase());
    }
    if (updates.definition !== undefined) {
      fields.push('definition = ?');
      params.push(updates.definition);
    }
    if (updates.exampleSentence !== undefined) {
      fields.push('example_sentence = ?');
      params.push(updates.exampleSentence);
    }
    if (updates.cefrLevel !== undefined) {
      fields.push('cefr_level = ?');
      params.push(updates.cefrLevel);
    }
    if (updates.pronunciation !== undefined) {
      fields.push('pronunciation = ?');
      params.push(updates.pronunciation);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      params.push(updates.status);
    }

    if (fields.length > 0) {
      fields.push("updated_at = ?", "sync_status = 'pending_upsert'");
      params.push(nowISO, wordId);

      await db.runAsync(`UPDATE vocabulary_words SET ${fields.join(', ')} WHERE id = ?`, params);
    }
  }

  // Update cached stats delta
  const cefrChanged = updates.cefrLevel !== undefined && updates.cefrLevel !== oldCefr;
  const statusChanged = updates.status !== undefined && updates.status !== oldStatus;

  if (cefrChanged || statusChanged) {
    await updateCachedStatsDelta(db, {
      removeCefr: cefrChanged ? oldCefr : undefined,
      addCefr: cefrChanged ? updates.cefrLevel : undefined,
      statusChange: statusChanged ? { from: oldStatus, to: updates.status! } : undefined,
    });
  }
}

/**
 * Inserts a new vocabulary word into the local SQLite database.
 */
export async function addNewVocabularyWord(wordData: {
  word: string;
  definition?: string;
  exampleSentence?: string;
  partOfSpeech?: string;
  pronunciation?: string | null;
  cefrLevel?: string | null;
  status?: string;
}): Promise<LocalVocabWord> {
  const db = await getDB();
  const cleanWord = wordData.word.trim();
  const normalized = cleanWord.toLowerCase();
  const nowISO = new Date().toISOString();

  const id = `vocab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const cefr = wordData.cefrLevel || getCefrLevel(cleanWord, wordData.partOfSpeech) || 'B1';
  const status = wordData.status || 'known';

  if (Platform.OS === 'web') {
    const vocab = (db as any).getStorage ? (db as any).getStorage('vocab', []) : [];
    const existingIdx = vocab.findIndex((v: any) => v.normalized_word === normalized);

    const rec = {
      id: existingIdx >= 0 ? vocab[existingIdx].id : id,
      word: cleanWord,
      normalized_word: normalized,
      cefr_level: cefr,
      definition: wordData.definition || null,
      part_of_speech: wordData.partOfSpeech || null,
      example_sentence: wordData.exampleSentence || null,
      pronunciation: wordData.pronunciation || null,
      status,
      created_at: nowISO,
      updated_at: nowISO,
      sync_status: 'pending_upsert',
    };

    if (existingIdx >= 0) vocab[existingIdx] = rec;
    else vocab.push(rec);

    if ((db as any).setStorage) (db as any).setStorage('vocab', vocab);

    await updateCachedStatsDelta(db, {
      totalDelta: existingIdx >= 0 ? 0 : 1,
      addCefr: cefr,
      statusChange: { to: status },
    });

    return rec as LocalVocabWord;
  }

  // Native SQLite
  await db.runAsync(
    `INSERT INTO vocabulary_words (id, word, normalized_word, cefr_level, definition, part_of_speech, example_sentence, pronunciation, status, created_at, updated_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_upsert')
     ON CONFLICT(normalized_word) DO UPDATE SET
       definition = COALESCE(excluded.definition, vocabulary_words.definition),
       cefr_level = COALESCE(excluded.cefr_level, vocabulary_words.cefr_level),
       example_sentence = COALESCE(excluded.example_sentence, vocabulary_words.example_sentence),
       pronunciation = COALESCE(excluded.pronunciation, vocabulary_words.pronunciation),
       status = COALESCE(excluded.status, vocabulary_words.status),
       updated_at = excluded.updated_at`,
    [
      id,
      cleanWord,
      normalized,
      cefr,
      wordData.definition || null,
      wordData.partOfSpeech || null,
      wordData.exampleSentence || null,
      wordData.pronunciation || null,
      status,
      nowISO,
      nowISO,
    ]
  );

  const wordRow: any = await db.getFirstAsync(`SELECT * FROM vocabulary_words WHERE normalized_word = ?`, [normalized]);
  const actualId = wordRow?.id || id;

  // Update cached stats delta
  await updateCachedStatsDelta(db, {
    totalDelta: 1,
    addCefr: cefr,
    statusChange: { to: status },
  });

  return {
    id: actualId,
    word: cleanWord,
    normalized_word: normalized,
    cefr_level: cefr,
    definition: wordData.definition || null,
    part_of_speech: wordData.partOfSpeech || null,
    example_sentence: wordData.exampleSentence || null,
    pronunciation: wordData.pronunciation || null,
    status,
    created_at: nowISO,
    updated_at: nowISO,
    sync_status: 'pending_upsert',
  };
}

function toLocalDateString(isoStr: string | null | undefined): string | null {
  if (!isoStr) return null;
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return isoStr.slice(0, 10);
  }
}

/**
 * Retrieves daily vocabulary addition count for heatmap calendar.
 */
export async function getHeatmapActivityData(): Promise<Record<string, number>> {
  const db = await getDB();
  const counts: Record<string, number> = {};

  if (Platform.OS === 'web') {
    const vocab = (db as any).getStorage ? (db as any).getStorage('vocab', []) : [];
    for (const v of vocab) {
      const d = toLocalDateString(v.created_at);
      if (d) {
        counts[d] = (counts[d] || 0) + 1;
      }
    }
    return counts;
  }

  const vocabRows: any[] = await db.getAllAsync(
    `SELECT strftime('%Y-%m-%d', datetime(created_at, 'localtime')) as date_str, COUNT(*) as count FROM vocabulary_words GROUP BY date_str`
  );
  for (const r of vocabRows || []) {
    if (r.date_str) counts[r.date_str] = (counts[r.date_str] || 0) + r.count;
  }

  return counts;
}

/**
 * Retrieves all vocabulary words added on a specific date string (YYYY-MM-DD).
 */
export async function getWordsByDate(dateStr: string): Promise<LocalVocabWord[]> {
  const db = await getDB();

  if (Platform.OS === 'web') {
    const vocab = (db as any).getStorage ? (db as any).getStorage('vocab', []) : [];
    return vocab.filter((v: any) => toLocalDateString(v.created_at) === dateStr);
  }

  const query = `
    SELECT * FROM vocabulary_words
    WHERE strftime('%Y-%m-%d', datetime(created_at, 'localtime')) = ?
    ORDER BY word ASC
  `;

  const rows = await db.getAllAsync(query, [dateStr]);
  return (rows as LocalVocabWord[]).map((r) => ({
    ...r,
    cefr_level: r.cefr_level || 'B1',
    status: r.status || 'known',
  }));
}

/**
 * Retrieves all vocabulary words with status 'unknown' in a single query.
 */
export async function getUnknownVocabulary(): Promise<LocalVocabWord[]> {
  const db = await getDB();

  if (Platform.OS === 'web') {
    const vocab = (db as any).getStorage ? (db as any).getStorage('vocab', []) : [];
    return vocab
      .filter((v: any) => (v.status || 'known').toLowerCase() === 'unknown')
      .map((r: any) => ({
        ...r,
        status: 'unknown',
        cefr_level: r.cefr_level || 'B1',
      }));
  }

  const query = `SELECT * FROM vocabulary_words WHERE status = 'unknown'`;
  const rows = await db.getAllAsync(query);
  return (rows as LocalVocabWord[]).map((r) => ({
    ...r,
    status: 'unknown',
    cefr_level: r.cefr_level || 'B1',
  }));
}

