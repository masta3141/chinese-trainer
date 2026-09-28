# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

"HSK Vokabeltrainer" — an installable, offline-capable PWA for learning Chinese HSK vocabulary (flashcards, Gemini-generated stories and example sentences, "Satzinseln" topic sentence sets, stats, TTS audio recordings). Deployed as static files on GitHub Pages. UI default language is German; comments and code are in English.

There is **no build system, package manager, linter, or test suite**. The whole app is plain ES5-style JavaScript (`var`, `function`, no modules) inside one IIFE in `index.html`. To run locally, serve the directory over HTTP (the service worker won't register from `file://`):

```
python3 -m http.server 8000
```

## Files

- `index.html` (~1.9 MB, ~6000 lines) — the entire app: CSS (`<style>`), markup, four embedded JSON data blocks, and all JS.
- `sw.js` — service worker: stale-while-revalidate cache for same-origin GETs only; cross-origin requests (Gemini API, Google Fonts, CDN) pass through. **Bump `CACHE_NAME`** when shell files change, and keep `APP_SHELL` in sync with deployed files.
- `manifest.json`, icons, screenshots — PWA metadata.

## Working with index.html

Lines ~1464–1467 are single JSON lines of 100 KB–1 MB each. **Never Read the whole file or grep without limiting output** — use `grep -n ... | cut -c1-200`, and `Read` with `offset`/`limit` on the relevant range. Sections in the JS are marked with `// ---------- <name> ----------` comments; grep for those to navigate.

Embedded data (`<script type="application/json">`, parsed at startup):
- `words-data` → `WORDS_HSK2`: 5000 HSK 2.0 words, ids 1–5000
- `words-hsk3-data` → `WORDS_HSK3`: 9226 HSK 3.0 words, ids 100001+ (level keys include `hsk79`)
- Word shape: `{id, hsk: 'hsk1'..., h: hanzi, p: pinyin, e: English}`
- `examples-data` → `EXAMPLES`: built-in example sentences keyed by word id string
- `freq-data` → `FREQ_DATA`: SUBTLEX-CH word/char frequencies used for coverage stats

Editing these data blocks means rewriting a single huge line — do it with a script (e.g. Python regex on the `<script id="...">` block), not with Edit.

## Architecture

- **State lives entirely in the browser.** `localStorage` keys are all prefixed `hskflash_` and versioned `_v1` (progress, settings, stories, islands, recordings, activity, Gemini key/model, TTS quota log, etc.). Per-sentence TTS audio goes in IndexedDB (`hskflash_audio_db`). Loaders contain in-place migrations (e.g. dropping leftovers of a reverted SRS/"Karteikasten" experiment) — preserve backward compatibility with existing saved data when changing shapes. Export/import of progress and generated examples is JSON (`format: 'hskflash-progress-v1'` etc.).
- **Progress model:** `progress[wordId] = {lvl: 0..100, lr: ISO date | null, seen: bool}`. Seeded for *both* standards so switching `settings.standard` (`hsk2`/`hsk3`) keeps each set's progress. A word enters the active pool when `lr` is set (placeholder `EPOCH_LONG_AGO` for pool-filled but unreviewed words). `ensurePoolFilled`/`activePool` keep the pool at `settings.pool` words in id order.
- **Session algorithm** (`startSession`, `activeWindow`, `pickNext`, `rate`): ported from an older VBA app (`GetNext2`, `modGemini.bas`). Session picks `sessionSize` words, reserving up to 5 slots for lowest-`lvl` words; cards are drawn from a sliding window of the first 7 words with `sessionPts < 5`. `rate(val)` adds to both persistent `lvl` and `sessionPts`.
- **Views/tabs:** six views (`PAGE_NAMES = grid, cards, stories, islands, stats, audio`) rendered into `#cardsView`, `#storiesView`, etc. via `render*()` functions building HTML strings (escape user/AI text with `esc()`). On mobile they form a swipe carousel (`switchView`, `goToPage`); desktop uses tabs plus a left pool panel.
- **Gemini integration:** direct browser `fetch` to `generativelanguage.googleapis.com/v1beta/models/<model>:generateContent?key=<user key>` — the API key is user-entered and stored in localStorage; there is no backend. Used for example sentences, stories, island sentences, sentence translation, and TTS (`GEMINI_TTS_MODEL`). TTS is rate-limited client-side (`TTS_BATCH_PAUSE_MS`, optional rolling-24h `TTS_MAX_PER_DAY`). MP3 export uses `lamejs` from jsDelivr, falling back to WAV.
- **i18n:** `I18N` object with `de`, `en`, `fr`, `es` dictionaries; `t(key)` / `tf(key, ...args)` with `{0}` placeholders, falling back to `de`. Static markup uses `data-i18n`, `data-i18n-placeholder`, `data-i18n-title`. **When adding UI text, add the key to all four languages.**
