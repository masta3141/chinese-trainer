// Core: word data lookups, storage keys, activity tracking, shared helpers.
"use strict";

var ALL_WORDS = WORDS_HSK2.concat(WORDS_HSK3);
var WORD_BY_ID = {};
ALL_WORDS.forEach(function(w){ WORD_BY_ID[w.id] = w; });

var STANDARD_LEVELS = {
  hsk2: ['hsk1', 'hsk2', 'hsk3', 'hsk4', 'hsk5', 'hsk6'],
  hsk3: ['hsk1', 'hsk2', 'hsk3', 'hsk4', 'hsk5', 'hsk6', 'hsk79']
};
function wordsForStandard(std){ return std === 'hsk3' ? WORDS_HSK3 : WORDS_HSK2; }

var PROG_KEY = 'hskflash_progress_v1';
var SET_KEY = 'hskflash_settings_v1';
var GEMINI_KEY_STORE = 'hskflash_gemini_key_v1';
var GEMINI_MODEL_STORE = 'hskflash_gemini_model_v1';
var GENERATED_EX_KEY = 'hskflash_generated_examples_v1';
var ACTIVITY_KEY = 'hskflash_activity_days_v1';
var TOTAL_RATINGS_KEY = 'hskflash_total_ratings_v1';
var DAILY_COUNTS_KEY = 'hskflash_daily_counts_v1'; // { 'YYYY-MM-DD': count } — per-day cards-rated count for the stats calendar
var EPOCH_LONG_AGO = '2000-01-01T00:00:00.000Z';

function todayStr(){
  return new Date().toISOString().slice(0, 10);
}
// Local-noon date key for a given year/month(0-based)/day, used by the stats
// calendar. Using noon (rather than local midnight) avoids ever landing on
// a different UTC calendar day, so this lines up with todayStr()'s UTC-date
// convention for the vast majority of timezones/times.
function dateKeyForYMD(y, m, d){
  return new Date(y, m, d, 12, 0, 0).toISOString().slice(0, 10);
}
function loadActivityDays(){
  try { return JSON.parse(localStorage.getItem(ACTIVITY_KEY)) || []; } catch(e) { return []; }
}
function saveActivityDays(days){
  try { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(days)); } catch(e) {}
}
function loadTotalRatings(){
  try { return parseInt(localStorage.getItem(TOTAL_RATINGS_KEY), 10) || 0; } catch(e) { return 0; }
}
function saveTotalRatings(n){
  try { localStorage.setItem(TOTAL_RATINGS_KEY, String(n)); } catch(e) {}
}
function loadDailyCounts(){
  try { return JSON.parse(localStorage.getItem(DAILY_COUNTS_KEY)) || {}; } catch(e) { return {}; }
}
function saveDailyCounts(counts){
  try { localStorage.setItem(DAILY_COUNTS_KEY, JSON.stringify(counts)); } catch(e) {}
}
// Called whenever the user rates a flashcard or a story sentence — feeds
// the streak counter, the all-time "Karten beantwortet" total, and the
// per-day count shown in the stats calendar.
function recordActivity(){
  var days = loadActivityDays();
  var t = todayStr();
  if (days.indexOf(t) === -1) {
    days.push(t);
    saveActivityDays(days);
  }
  saveTotalRatings(loadTotalRatings() + 1);
  var counts = loadDailyCounts();
  counts[t] = (counts[t] || 0) + 1;
  saveDailyCounts(counts);
}
function computeStreak(){
  var days = loadActivityDays();
  var set = {};
  days.forEach(function(d){ set[d] = true; });
  var d = new Date();
  if (!set[todayStr()]) d.setDate(d.getDate() - 1); // not practiced yet today: streak still counts through yesterday
  var streak = 0;
  while (true) {
    var key = d.toISOString().slice(0, 10);
    if (set[key]) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}
var DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite'; // fallback until detectGeminiModels() has run
var DEFAULT_GEMINI_TTS_MODEL = 'gemini-3.8-flash-lite-tts';

var DEFAULT_SETTINGS = { standard: 'hsk2', pool: 300, sessionSize: 20, speak: true, autoSpeak: true, voiceName: '', lang: 'de' };

function esc(s){
  return (s || '').replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
