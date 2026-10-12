# Vocabulary Highlighter — Project Architecture & Technical Report

## 1. Executive Summary

**Vocabulary Highlighter** is an open-source, cross-platform vocabulary learning ecosystem. It seamlessly bridges passive reading with active spaced-repetition memory retention across web browsers and mobile devices.

### Key Capabilities:
- **In-Browser Highlighting (Chrome Extension):** Automatically scans web pages and highlights unknown vocabulary words in real-time.
- **Instant Word Popup Cards:** Clicking any word on a webpage opens a popup card showing its part of speech, CEFR difficulty level, definition, custom example sentence, translation links, and quick actions ("Mark as Known" / "Edit").
- **Spaced-Repetition Study (Mobile App):** Implements the modern **FSRS (Free Spaced Repetition Scheduler)** algorithm to turn saved vocabulary words into interactive review flashcards.
- **Multi-Device Cloud Synchronization:** Syncs words, learning states, and review history seamlessly between Chrome extension local storage, mobile Expo SQLite, and Supabase PostgreSQL.
- **Data Portability:** Supports 5-column CSV and JSON import/export (`word`, `cefr_level`, `meaning`, `part_of_speech`, `example_sentence`).

---

## 2. Technology Stack & Project Structure

```
vocabulary-highlighter/
├── extension/             # Chrome Extension (Manifest V3, Vanilla JS)
│   ├── manifest.json      # Extension manifest configuration
│   ├── src/
│   │   ├── background/    # Service Worker (Background sync, context menus, API pacing)
│   │   ├── content/       # Content scripts (DOM text scanning, word popups, styling)
│   │   ├── lib/           # Storage layer, CEFR data, sync manager, dictionary API
│   │   ├── options/       # Dashboard UI (Dictionary management, metrics, import/export)
│   │   ├── popup/         # Extension toolbar popup
│   │   └── reader/        # Distraction-free Reading Mode
├── mobile/                # Mobile Application (Expo / React Native)
│   ├── app/               # Expo Router screens (Tabs, Flashcards, Settings)
│   ├── src/
│   │   ├── db/            # SQLite database manager & web fallbacks
│   │   ├── fsrs/          # FSRS spaced-repetition scheduling algorithm
│   │   ├── services/      # Supabase client & mobile sync engine
│   │   └── theme.ts       # Design tokens & color system
└── supabase/              # Supabase Cloud Database & RLS Security
    └── schema.sql         # PostgreSQL database schema & auto-provisioning triggers
```

---

## 3. Database Schema (`supabase/schema.sql`)

The database is built on Supabase PostgreSQL with strict Row Level Security (RLS) policies ensuring users can only access their own data.

### Tables & Relationships:

1. **`users`**
   - Primary user profile table linked to `auth.users(id)` via `on delete cascade`.
   - Auto-provisioned by PostgreSQL trigger `on_auth_user_created`.

2. **`vocabulary_words`**
   - Core vocabulary record table.
   - Columns: `id` (UUID), `user_id` (UUID), `word` (text), `normalized_word` (text), `cefr_level` (`A1`–`C2`), `definition` (text), `part_of_speech` (text), `example_sentence` (text), `pronunciation` (text), `created_at`, `updated_at`.
   - Constraint: `unique(user_id, normalized_word)`

3. **`learning_states`**
   - FSRS scheduling parameters for flashcards.
   - Columns: `id` (UUID), `user_id` (UUID), `vocabulary_word_id` (references `vocabulary_words.id` `on delete cascade on update cascade`), `status` (`known`, `new`, `learning`, `review`, `relearning`, `suspended`), `repetitions` (int), `lapses` (int), `difficulty` (float), `stability` (float), `due_at` (timestamptz), `last_reviewed_at` (timestamptz), `updated_at`.
   - Constraint: `unique(user_id, vocabulary_word_id)`

4. **`review_history`**
   - Append-only event store recording card review ratings (`again`, `hard`, `good`, `easy`).
   - Columns: `id` (UUID), `user_id` (UUID), `vocabulary_word_id` (UUID), `event_id` (text unique), `rating` (text), `reviewed_at`, `previous_due_at`, `new_due_at`.

---

## 4. Cloud Synchronization Architecture

Synchronization is designed with an **offline-first** architecture:

1. **Local Writes:** Adding or editing words writes immediately to `chrome.storage.local` (extension) or `Expo SQLite` (mobile), making UI interactions instantaneous.
2. **Pending Queue:** Modifications are recorded as operations in a `pendingSync` queue.
3. **Batch Sync Algorithm (`runBatchSync` / `runMobileSync`):**
   - Pre-fetches existing remote word IDs for the user in 1000-row paginated batches.
   - Sends batch upserts of `vocabulary_words` (50 items per chunk) with header `Prefer: resolution=merge-duplicates,return=representation`.
   - Reads the returned server-assigned primary keys (`id`) for each `normalized_word`.
   - Uses the returned server primary key as `vocabulary_word_id` when upserting `learning_states` and `review_history`.
   - Clears the processed queue upon clean completion.

---

## 5. Standard Export & Import Format

The platform uses a standardized **5-column CSV / JSON format** across all components:

| Column # | Field Name | Description | Example |
|---|---|---|---|
| **1** | `word` | Vocabulary word / lemma | `overthrow` |
| **2** | `cefr_level` | Difficulty rating (`A1`–`C2`) | `B2` |
| **3** | `meaning` | Custom or dictionary definition | `A removal of a ruler or government by force` |
| **4** | `part_of_speech` | Part of speech | `noun` |
| **5** | `example_sentence` | Contextual example sentence | `The military plot to overthrow the government failed.` |

- **CSV Export:** Quotes all fields with standard escaping (`"word","cefr_level","meaning","part_of_speech","example_sentence"`).
- **CSV/JSON Import:** Flexibly parses CSV (comma/tab/semicolon) and JSON arrays/objects, updating `vocabRecords`, `defcache`, and queueing sync.

---

## 6. Recent Technical Resolutions & Fixes

1. **Batch Upsert Key Alignment (`PGRST102`):** Fixed PostgREST batch rejection by guaranteeing all objects in batch upsert payload arrays share identical key signatures.
2. **Foreign Key Primary Key Update Cascade (`23503`):** Prevented primary key mutation conflicts during upsert resolution and added `ON UPDATE CASCADE` to database foreign key constraints.
3. **Conditional Example Sentence Display:** Updated word popup cards to display example sentences if and only if non-empty example text is present. Added inline example sentence editing to both the popup card editor and options dashboard drawer.

---

## 7. How to Run & Build

### Chrome Extension:
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (top right toggle).
3. Click **Load unpacked** and select the `/extension` directory.

### Mobile App (Expo):
```bash
cd mobile
npm install
npx expo start
```

### Type Checking:
```bash
cd mobile
npx tsc --noEmit
```
