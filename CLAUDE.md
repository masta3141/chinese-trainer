# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

"HSK Vokabeltrainer" — an installable, offline-capable PWA for learning Chinese HSK vocabulary (flashcards, Gemini-generated stories and example sentences, "Satzinseln" topic sentence sets, stats, TTS audio recordings). Deployed as static files on GitHub Pages. UI default language is German; comments and code are in English.

There is **no build system, package manager, linter, or test suite**. The app is plain ES5-style JavaScript (`var`, `function`, no modules) in classic `<script>` files that share the global scope. To run locally, serve the directory over HTTP (the service worker won't register from `file://`):

```
python3 -m http.server 8000
```

## Files

- `index.html` — markup only, plus the `<link>`/`<script>` tags.
- `css/app.css` — all styles.
- `data/` — the big data sets (single huge lines, 150 KB–1 MB):
  - `words-hsk2.js` → `WORDS_HSK2`: 5000 HSK 2.0 words, ids 1–5000
  - `words-hsk3.js` → `WORDS_HSK3`: 9226 HSK 3.0 words, ids 100001+ (level keys include `hsk79`)
  - Word shape: `{id, hsk: 'hsk1'..., h: hanzi, p: pinyin, e: English}`
  - `examples-seed.json`: starter example sentences (`{wordId: [{h,p,e}, ...]}`, ~1200 words), fetched once on the first start to fill the examples IndexedDB (see below) — not a global, not loaded on every start
  - `freq.js` → `FREQ_DATA`: SUBTLEX-CH word/char frequencies used for coverage stats
- `js/*.js` — the app, one file per area, loaded in this order (see `index.html`):
  `core` (constants, storage keys, activity, `esc`) → `i18n` → `state` (load/save progress, settings, fonts; global state) → `session` (flashcard session) → `streak` (Power-Streak + own SRS) → `gemini` (example sentences) → `stories` → `tts` (Gemini TTS, WAV, IndexedDB) → `audio` (recordings, export, Audio tab) → `islands` → `navigation` (carousel, tabs) → `pool` (left pool panel) → `speech` (browser TTS, narration, speech recognition) → `cards` (`render()` of the cards view) → `stats` → `settings` (drawer, import/export, language switcher) → `welcome` (first-start introduction dialog) → `init` (SW registration, first render; must stay last).
- `sw.js` — service worker: network first (revalidated with `cache: 'no-cache'`), cache only as offline fallback, for same-origin GETs only; cross-origin requests (Gemini API, Google Fonts, CDN) pass through. **Bump `CACHE_NAME`** when any shell file changes, and keep `APP_SHELL` in sync with the `<link>`/`<script>` tags in `index.html`.
- `impressum.html` — legal notice (Impressum) and privacy policy (DE + EN summary), linked at the bottom of the settings drawer; also the privacy-policy URL for the Play Store.
- `manifest.json`, icons, screenshots — PWA metadata.

## Working with the code

- All `js/*.js` files start with `"use strict";` and declare globals. **Load order matters for code that runs at load time**: top-level statements (e.g. `var powerStreak = loadStreak();`) may only use functions/vars from the same or an earlier file. Function bodies can reference anything, since they run after all files are loaded. New top-level names must not collide with other files or with browser globals (`name`, `status`, `open`, `close`, …).
- **Never Read or grep the `data/` files without limiting output** (`grep ... | cut -c1-200`). Editing them means rewriting a single huge line — do it with a script, not with Edit.
- Sections inside the JS files are marked with `// ---------- <name> ----------` comments.

## Architecture

- **State lives entirely in the browser.** `localStorage` keys are all prefixed `hskflash_` and versioned `_v1` (progress, settings, stories, islands, recordings, activity, Gemini key/model, TTS quota log, etc.). Per-sentence TTS audio goes in IndexedDB (`hskflash_audio_db`); example sentences in IndexedDB too (`hskflash_examples_db`, one record per word id, mirrored in memory in `generatedExamples` and loaded by `initExamplesStore()` at startup; filled once from `data/examples-seed.json`, flag `hskflash_examples_seeded_v1`; the old localStorage blob `hskflash_generated_examples_v1` is migrated once). Users add more per word with "Weitere Beispiele" on the card. Loaders contain in-place migrations (e.g. dropping leftovers of a reverted SRS/"Karteikasten" experiment) — preserve backward compatibility with existing saved data when changing shapes. Export/import of progress and generated examples is JSON (`format: 'hskflash-progress-v1'` etc.).
- **Progress model:** `progress[wordId] = {lvl: 0..100, lr: ISO date | null, seen: bool}`. Seeded for *both* standards so switching `settings.standard` (`hsk2`/`hsk3`) keeps each set's progress. A word enters the active pool when `lr` is set (placeholder `EPOCH_LONG_AGO` for pool-filled but unreviewed words). `ensurePoolFilled`/`basePool` keep the base pool at `settings.pool` words in id order; on top, single words can be added/removed by hand ("✎ Pool anpassen" in the grid, "Satz in den Pool" in stories), stored separately in `poolOverrides` (`hskflash_pool_overrides_v1`, wordId → true/false). `activePool()` = base + added − removed and is what sessions, the streak and the UI use. The grid also marks Power-Streak words (🔥) and "✎ Streak anpassen" adds/removes streak cards directly (`setWordInStreak` in js/streak.js; hand-added cards have `last: null` and are introduced as new words in the next stage).
- **Session algorithm** (`startSession`, `activeWindow`, `pickNext`, `rate`): ported from an older VBA app (`GetNext2`, `modGemini.bas`). Session picks `sessionSize` words, reserving up to 5 slots for lowest-`lvl` words; cards are drawn from a sliding window of the first 7 words with `sessionPts < 5`. `rate(val)` adds to both persistent `lvl` and `sessionPts`.
- **Views/tabs:** six views (`PAGE_NAMES = grid, cards, stories, islands, stats, audio`) rendered into `#cardsView`, `#storiesView`, etc. via `render*()` functions building HTML strings (escape user/AI text with `esc()`). On mobile they form a swipe carousel (`switchView`, `goToPage`); desktop uses tabs plus a left pool panel.
- **Gemini integration:** direct browser `fetch` to `generativelanguage.googleapis.com/v1beta/models/<model>:generateContent?key=<user key>` — the API key is user-entered and stored in localStorage; there is no backend. Used for example sentences, stories, island sentences, sentence translation, and TTS. Models are not user-configurable: `detectGeminiModels()` (js/state.js) lists the key's models (`GET /v1beta/models`, on key save and weekly at startup) and stores the newest stable `gemini-X.Y-flash-lite` (else `-flash`) as text model and `…-flash-lite-tts` (else `…-flash-tts`) as TTS model; `DEFAULT_GEMINI_MODEL`/`DEFAULT_GEMINI_TTS_MODEL` in js/core.js are the fallbacks. TTS is rate-limited client-side (`TTS_BATCH_PAUSE_MS`, optional rolling-24h `TTS_MAX_PER_DAY`). MP3 export uses `lamejs` from jsDelivr, falling back to WAV.
- **i18n:** `I18N` object with `de`, `en`, `fr`, `es` dictionaries; `t(key)` / `tf(key, ...args)` with `{0}` placeholders, falling back to `de`. Static markup uses `data-i18n`, `data-i18n-placeholder`, `data-i18n-title`. **When adding UI text, add the key to all four languages.**
