// State: loading/saving progress, settings, fonts, Gemini key; global app state.
"use strict";

// Example sentences live in their own IndexedDB (one record per word id:
// [{h,p,e}, ...]) and are mirrored in memory in `generatedExamples`, so
// examplesFor() stays synchronous. On the first start in a browser the store
// is filled once from data/examples-seed.json (only words without examples
// yet); after that the user extends them with "Weitere Beispiele". Older
// versions kept generated examples as one JSON blob in localStorage
// (GENERATED_EX_KEY); that is moved over on the first start and then removed.
// Without IndexedDB, localStorage stays in use.
var EXAMPLES_SEED_URL = 'data/examples-seed.json';
var EXAMPLES_SEEDED_KEY = 'hskflash_examples_seeded_v1';
var EXAMPLES_DB_NAME = 'hskflash_examples_db';
var EXAMPLES_STORE = 'examples';
var examplesDbPromise = null;
var examplesUseIdb = 'indexedDB' in window;
var examplesReady = null; // set by initExamplesStore(); generation waits for it before merging

function openExamplesDB(){
  if (examplesDbPromise) return examplesDbPromise;
  examplesDbPromise = new Promise(function(resolve, reject){
    var req = indexedDB.open(EXAMPLES_DB_NAME, 1);
    req.onupgradeneeded = function(e){
      var db = e.target.result;
      if (!db.objectStoreNames.contains(EXAMPLES_STORE)) db.createObjectStore(EXAMPLES_STORE);
    };
    req.onsuccess = function(e){ resolve(e.target.result); };
    req.onerror = function(){ reject(req.error); };
  });
  return examplesDbPromise;
}
// Runs fn(store) in one readwrite transaction; resolves when it is committed.
function examplesTx(fn){
  return openExamplesDB().then(function(db){
    return new Promise(function(resolve, reject){
      var tx = db.transaction(EXAMPLES_STORE, 'readwrite');
      fn(tx.objectStore(EXAMPLES_STORE));
      tx.oncomplete = function(){ resolve(); };
      tx.onerror = function(){ reject(tx.error); };
    });
  });
}
function loadLegacyGeneratedExamples(){
  try {
    var raw = localStorage.getItem(GENERATED_EX_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return null;
}
function loadGeneratedExamples(){
  // Synchronous part only: without IndexedDB the localStorage blob is the store.
  return examplesUseIdb ? {} : (loadLegacyGeneratedExamples() || {});
}
// Loads all records into generatedExamples (and migrates the old localStorage blob).
function initExamplesStore(){
  if (!examplesUseIdb) { examplesReady = Promise.resolve(); return examplesReady; }
  examplesReady = openExamplesDB().then(function(db){
    return new Promise(function(resolve, reject){
      var loaded = {};
      var req = db.transaction(EXAMPLES_STORE, 'readonly').objectStore(EXAMPLES_STORE).openCursor();
      req.onsuccess = function(){
        var cur = req.result;
        if (cur) { loaded[cur.key] = cur.value; cur.continue(); } else resolve(loaded);
      };
      req.onerror = function(){ reject(req.error); };
    });
  }).then(function(loaded){
    var legacy = loadLegacyGeneratedExamples();
    var migrate = legacy ? Object.keys(legacy).filter(function(k){ return !loaded[k]; }) : [];
    migrate.forEach(function(k){ loaded[k] = legacy[k]; });
    Object.keys(loaded).forEach(function(k){ generatedExamples[k] = loaded[k]; });
    if (!legacy) return;
    return examplesTx(function(store){
      migrate.forEach(function(k){ store.put(legacy[k], k); });
    }).then(function(){
      try { localStorage.removeItem(GENERATED_EX_KEY); } catch(e) {}
    });
  }).catch(function(){
    // IndexedDB unusable (e.g. blocked in private mode): fall back to localStorage.
    examplesUseIdb = false;
    var legacy = loadLegacyGeneratedExamples() || {};
    Object.keys(legacy).forEach(function(k){ generatedExamples[k] = legacy[k]; });
  }).then(seedExamples);
  return examplesReady;
}
// One-time fill from the shipped seed file. If it can't be fetched (offline on
// the very first start) it is simply tried again on the next start.
function seedExamples(){
  try { if (localStorage.getItem(EXAMPLES_SEEDED_KEY)) return; } catch(e) { return; }
  return fetch(EXAMPLES_SEED_URL).then(function(res){
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }).then(function(seed){
    var add = Object.keys(seed).filter(function(k){ return !(generatedExamples[k] && generatedExamples[k].length); });
    add.forEach(function(k){ generatedExamples[k] = seed[k]; });
    var saved = !examplesUseIdb
      ? Promise.resolve(saveGeneratedExamples(generatedExamples))
      : examplesTx(function(store){ add.forEach(function(k){ store.put(seed[k], k); }); });
    return saved.then(function(){
      try { localStorage.setItem(EXAMPLES_SEEDED_KEY, '1'); } catch(e) {}
    });
  }).catch(function(){});
}
// Saves the sentences of one word (after generating examples for it).
function saveGeneratedExamplesFor(key){
  if (!examplesUseIdb) { saveGeneratedExamples(generatedExamples); return; }
  examplesTx(function(store){ store.put(generatedExamples[key], key); }).catch(function(){});
}
// Replaces the whole store with g (import).
function saveGeneratedExamples(g){
  if (!examplesUseIdb) {
    try { localStorage.setItem(GENERATED_EX_KEY, JSON.stringify(g)); } catch(e) {}
    return;
  }
  examplesTx(function(store){
    store.clear();
    Object.keys(g).forEach(function(k){ store.put(g[k], k); });
  }).catch(function(){});
}
function loadGeminiKey(){
  try { return localStorage.getItem(GEMINI_KEY_STORE) || ''; } catch(e) { return ''; }
}
function saveGeminiKey(k){
  try { localStorage.setItem(GEMINI_KEY_STORE, k); } catch(e) {}
}
function loadGeminiModel(){
  try { return localStorage.getItem(GEMINI_MODEL_STORE) || DEFAULT_GEMINI_MODEL; } catch(e) { return DEFAULT_GEMINI_MODEL; }
}
function saveGeminiModel(m){
  try { localStorage.setItem(GEMINI_MODEL_STORE, m || DEFAULT_GEMINI_MODEL); } catch(e) {}
}
var GEMINI_TTS_MODEL_STORE = 'hskflash_gemini_tts_model_v1';
var GEMINI_MODELS_CHECKED_KEY = 'hskflash_gemini_models_checked_v1';
var GEMINI_MODELS_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
function loadGeminiTtsModel(){
  try { return localStorage.getItem(GEMINI_TTS_MODEL_STORE) || DEFAULT_GEMINI_TTS_MODEL; } catch(e) { return DEFAULT_GEMINI_TTS_MODEL; }
}

// Picks the newest stable model whose id matches one of the patterns, in
// order of preference (e.g. "gemini-3.5-flash-lite"; preview/exp/dated
// variants don't match). ids: model ids without the "models/" prefix.
function pickNewestModel(ids, patterns){
  for (var i = 0; i < patterns.length; i++) {
    var best = null, bestVer = null;
    ids.forEach(function(id){
      var m = patterns[i].exec(id);
      if (!m) return;
      var ver = m[1].split('.').map(Number);
      if (!bestVer || ver[0] > bestVer[0] || (ver[0] === bestVer[0] && (ver[1] || 0) > (bestVer[1] || 0))) { best = id; bestVer = ver; }
    });
    if (best) return best;
  }
  return null;
}
// Asks the Gemini API which models this key can use and stores the newest
// fitting text and TTS model. Runs at most once a week unless forced (new
// key); on any failure the previously stored or default models stay.
function detectGeminiModels(force){
  var key = loadGeminiKey();
  if (!key) return Promise.resolve();
  try {
    var last = parseInt(localStorage.getItem(GEMINI_MODELS_CHECKED_KEY), 10) || 0;
    if (!force && Date.now() - last < GEMINI_MODELS_RECHECK_MS) return Promise.resolve();
  } catch(e) {}
  return fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=' + encodeURIComponent(key))
    .then(function(res){ if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(function(data){
      var ids = (data.models || []).filter(function(m){
        return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0;
      }).map(function(m){ return String(m.name).replace(/^models\//, ''); });
      var text = pickNewestModel(ids, [/^gemini-(\d+(?:\.\d+)?)-flash-lite$/, /^gemini-(\d+(?:\.\d+)?)-flash$/]);
      var tts = pickNewestModel(ids, [/^gemini-(\d+(?:\.\d+)?)-flash-lite-tts$/, /^gemini-(\d+(?:\.\d+)?)-flash-tts$/]);
      if (text) saveGeminiModel(text);
      if (tts) { try { localStorage.setItem(GEMINI_TTS_MODEL_STORE, tts); } catch(e) {} }
      try { localStorage.setItem(GEMINI_MODELS_CHECKED_KEY, String(Date.now())); } catch(e) {}
    })
    .catch(function(){});
}

function loadProgress(){
  try {
    var raw = localStorage.getItem(PROG_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      // Migration: older saves may lack the 'seen' flag used by the pool overview.
      // Infer it from a real review date (not the pool-fill placeholder) or a nonzero level.
      var changed = false;
      Object.keys(parsed).forEach(function(id){
        var p = parsed[id];
        if (typeof p.seen === 'undefined') {
          p.seen = !!((p.lr && p.lr !== EPOCH_LONG_AGO) || (p.lvl && p.lvl > 0));
          changed = true;
        }
        // Migration: remove leftover SRS ("Karteikasten-Modus") data from a
        // since-reverted experiment, so pool cells show plain point numbers
        // again instead of interval badges like "1d"/"8d".
        if (p.srs) {
          delete p.srs;
          changed = true;
        }
      });
      if (changed) saveProgress(parsed);
      return parsed;
    }
  } catch(e) {}
  // First run: every word starts at level 0, unseen. Uses ALL_WORDS (both HSK
  // 2.0 and 3.0) so a progress entry exists regardless of which standard is active.
  var seeded = {};
  ALL_WORDS.forEach(function(w){
    seeded[w.id] = { lvl: 0, lr: null, seen: false };
  });
  saveProgress(seeded);
  return seeded;
}
function saveProgress(p){
  try { localStorage.setItem(PROG_KEY, JSON.stringify(p)); } catch(e) {}
}
function loadSettings(){
  try {
    var raw = localStorage.getItem(SET_KEY);
    if (raw) {
      var s = JSON.parse(raw);
      // Migration: drop leftover fields from a since-reverted Karteikasten/SRS experiment.
      if ('learnMode' in s || 'srsNewPerDay' in s) {
        delete s.learnMode;
        delete s.srsNewPerDay;
        try { localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch(e2) {}
      }
      return Object.assign({}, DEFAULT_SETTINGS, s);
    }
  } catch(e) {}
  return Object.assign({}, DEFAULT_SETTINGS);
}
function saveSettings(s){
  try { localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch(e) {}
}

var FONT_KEY = 'hskflash_fonts_v1';
var DEFAULT_FONTS = { family: 'serif', hanziSize: 72, exampleSize: 16 };
var FONT_STACKS = {
  serif: "'Noto Serif SC', serif",
  sans: "'Noto Sans SC', sans-serif",
  brush: "'Ma Shan Zheng', cursive",
  system: "-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif"
};
function loadFonts(){
  try {
    var raw = localStorage.getItem(FONT_KEY);
    if (raw) return Object.assign({}, DEFAULT_FONTS, JSON.parse(raw));
  } catch(e) {}
  return Object.assign({}, DEFAULT_FONTS);
}
function saveFonts(f){
  try { localStorage.setItem(FONT_KEY, JSON.stringify(f)); } catch(e) {}
}
function applyFonts(){
  var root = document.documentElement.style;
  root.setProperty('--hanzi-font', FONT_STACKS[fonts.family] || FONT_STACKS.serif);
  root.setProperty('--hanzi-size', 'clamp(' + Math.round(fonts.hanziSize * 0.62) + 'px, 16vw, ' + fonts.hanziSize + 'px)');
  root.setProperty('--example-size', fonts.exampleSize + 'px');
}

var progress = loadProgress();
var settings = loadSettings();
var fonts = loadFonts();
applyFonts();
try { localStorage.removeItem('hskflash_srs_new_today_v1'); } catch(e) {} // leftover from a reverted SRS experiment

var WORDS = wordsForStandard(settings.standard);
var HSK_ORDER = STANDARD_LEVELS[settings.standard];
var generatedExamples = loadGeneratedExamples();

function examplesFor(wordId){
  return generatedExamples[String(wordId)] || [];
}

var session = null; // { ids: [...], sessionPts: {id:0}, currentId, awaitingNext, mastered: [] }
