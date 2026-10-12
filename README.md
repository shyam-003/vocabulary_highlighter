# Vocabulary Highlighter System

A cross-platform vocabulary learning ecosystem featuring a **Chrome Extension** for discovering vocabulary while reading web pages and a **Mobile Application** (Expo React Native) for learning and reviewing words using FSRS spaced repetition, synchronized via **Supabase PostgreSQL**.

---

## 📁 Repository Structure

```
VocabularyProject/
│
├── extension/                  # Chrome Extension (DISCOVER)
│   ├── manifest.json           # Manifest V3 configuration
│   ├── src/
│   │   ├── background/         # Service worker, dictionary rate limiter, sync alarms
│   │   ├── content/            # DOM text node parser, highlight renderer, word popup card
│   │   ├── lib/
│   │   │   ├── storage.js      # Central chrome.storage.local interface
│   │   │   ├── cefr-data.js    # CEFR dataset abstract provider layer
│   │   │   ├── migration.js    # Safe, idempotent storage migration engine
│   │   │   ├── sync.js         # Extension sync manager & Supabase client with auto-refresh
│   │   │   ├── normalizer.js   # Lemmatizer module
│   │   │   └── dictionary.js   # DictionaryAPI wrapper with 30-day cache
│   │   ├── popup/              # Action popup (toggle, page stats, sync status)
│   │   ├── options/            # Dashboard (word search, edit, streak stats, multi-format import/export)
│   │   └── reader/             # Reading mode overlay
│   └── icons/
│
├── mobile/                     # Mobile Application (LEARN)
│   ├── app/                    # Expo Router file-based navigation
│   │   ├── _layout.tsx         # Root layout
│   │   └── (tabs)/
│   │       ├── index.tsx       # Home tab (Stats, CEFR breakdown, Interactive Monthly Calendar)
│   │       ├── review.tsx      # Review tab (FSRS flashcard interface)
│   │       ├── vocabulary.tsx  # Vocabulary tab (Search, filter, multi-API lookup, "Delete Everywhere")
│   │       └── settings.tsx    # Settings tab (Account auth, Sync status, Data backup & Reset)
│   ├── src/
│   │   ├── components/         # MonthlyCalendar component
│   │   ├── db/sqlite.ts        # Local persistent SQLite & Web fallback storage
│   │   ├── fsrs/fsrs.ts        # FSRS-4.5 spaced repetition scheduler
│   │   ├── services/cefr.ts    # CEFR provider service
│   │   ├── services/dictionary.ts # Multi-API dictionary lookup (FreeDictionaryAPI + Datamuse)
│   │   ├── services/supabase.ts# Supabase auth & client setup
│   │   └── services/sync.ts    # Mobile offline-to-cloud sync manager with auto-refresh
│   ├── package.json
│   └── tsconfig.json
│
├── shared/                     # Shared TypeScript Definitions
│   └── types/index.ts          # VocabularyWord, LearningState, CEFRLevel, SyncPayload
│
└── supabase/
    └── schema.sql              # Supabase PostgreSQL schema, RLS policies, and triggers
```

---

## 🌟 Key Features & Architecture

### 1. Chrome Extension — DISCOVER
* **Goal**: Lightweight, zero-latency reading experience on web pages.
* **Storage**: Local-first in `chrome.storage.local`.
* **Multi-Format Import**: Supports importing `.csv`, `.txt`, and `.json` dictionary files with automatic JSON array parsing, token normalization, and auto-sync.
* **Popup Card**: Displays word, definition, part of speech, example sentence, translation link, CEFR level, and "Known word" action.
* **Granular Control**: Includes options to clear local browser dictionary or delete individual words permanently across all devices.

### 2. Mobile App — LEARN
* **Goal**: Deep, offline-first learning & spaced repetition environment.
* **Storage**: Local-first via `expo-sqlite` with `localStorage` web fallback.
* **FSRS-4.5 Spaced Repetition**: 2-stage reveal interface with 4 FSRS ratings (`Again`, `Hard`, `Good`, `Easy`).
* **Multi-API Word Lookup**: Instant dictionary lookups powered by `FreeDictionaryAPI` with automatic fallback to `Datamuse API` for comprehensive definitions, parts of speech, and example sentences.
* **Interactive Monthly Calendar**:
  * Visual activity dots for daily vocabulary activity.
  * Restricted navigation range bounded between **First Word Learned Month** and **Current Month**.
  * Modal detail views on active dates, with popups disabled on zero-activity days.

---

## 🔄 Cloud Synchronization Architecture

```
Chrome Extension                          Mobile App
 (chrome.storage.local)                  (expo-sqlite)
         │                                     │
         └───────────── Batch Sync ────────────┘
                            │
                            ▼
                   Supabase PostgreSQL
```

* **Payload Chunking**: Batch upserts are chunked in batches of **50 items** to prevent payload limits and API timeouts.
* **PostgREST Conflict Resolution**: Explicit `on_conflict` parameters matching composite unique keys (`user_id,normalized_word` for vocabulary words and `user_id,vocabulary_word_id` for learning states).
* **Automatic Silent Token Refresh**: Built-in OAuth token refresh (`grant_type=refresh_token`) automatically handles expired JWT access tokens (`PGRST303 / 401 Unauthorized`) in the background without throwing errors or interrupting user actions.
* **Database-Driven Deletions**: 
  * The **Supabase Cloud Database** serves as the central truth for deletions.
  * Deleting rows directly on Supabase reconciles and removes those words locally across all synced devices.
  * Local dictionary resets or clears affect the local device only, ensuring cloud backups are never accidentally wiped.

---

## 🛠️ Getting Started

### Chrome Extension
1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select the `extension/` directory.

### Mobile Application
1. Navigate to the `mobile/` directory:
   ```bash
   cd mobile
   npm install
   ```
2. Start the Expo development server:
   ```bash
   npx expo start
   ```

### Supabase Database Setup
1. Create a new Supabase project at [https://supabase.com](https://supabase.com).
2. Open the SQL Editor in your Supabase dashboard and execute `supabase/schema.sql`.
3. Set your project URL and Public Anon Key in one of the following places:
   - **Mobile App**: [mobile/.env](file:///Users/shyam/Projects/swe-projects/vocabulary-highlighter/mobile/.env) (`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`)
   - **Chrome Extension**: [extension/src/lib/supabase-config.js](file:///Users/shyam/Projects/swe-projects/vocabulary-highlighter/extension/src/lib/supabase-config.js) (`DEFAULT_SUPABASE_URL` and `DEFAULT_SUPABASE_ANON_KEY`)
4. Once configured, both the Mobile app and Extension will only prompt for **Email** and **Password** when logging in.
