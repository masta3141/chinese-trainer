// State: loading/saving progress, settings, fonts, Gemini key; global app state.
"use strict";

function loadGeneratedExamples(){
  try {
    var raw = localStorage.getItem(GENERATED_EX_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return {};
}
function saveGeneratedExamples(g){
  try { localStorage.setItem(GENERATED_EX_KEY, JSON.stringify(g)); } catch(e) {}
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
  var key = String(wordId);
  var base = EXAMPLES[key] || [];
  var gen = generatedExamples[key] || [];
  return base.concat(gen);
}

var session = null; // { ids: [...], sessionPts: {id:0}, currentId, awaitingNext, mastered: [] }
