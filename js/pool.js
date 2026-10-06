// Pool overview (left panel): HSK colors, level filter, standard switch.
"use strict";

// ---------- pool overview (left panel) ----------
var HSK_COLORS = {
  hsk1: '#b98f4a',
  hsk2: '#6b8a5a',
  hsk3: '#4a8c8c',
  hsk4: '#7a5a8c',
  hsk5: '#a3597a',
  hsk6: '#4f6b9c',
  hsk79: '#7a4a3a'
};
function hskDisplayNum(key){
  key = String(key || '');
  if (key === 'hsk79') return '9';
  if (key.indexOf('hsk') === 0) return key.slice(3);
  return key; // already a bare number/string, e.g. legacy data
}
function hskLabel(key){
  if (key === 'hsk79') return 'HSK 7–9';
  return 'HSK ' + hskDisplayNum(key);
}
var HSK_MAX_KEY = 'hskflash_pool_max_hsk_v1';
function loadPoolMaxHsk(){
  try {
    var raw = localStorage.getItem(HSK_MAX_KEY);
    if (raw) {
      var n = parseInt(raw, 10);
      if (n >= 1 && n <= HSK_ORDER.length) return n;
    }
  } catch(e) {}
  return HSK_ORDER.length;
}
function savePoolMaxHsk(n){
  try { localStorage.setItem(HSK_MAX_KEY, String(n)); } catch(e) {}
}
var poolMaxHsk = loadPoolMaxHsk();

// Extra grid filters next to the HSK chips: only pool words, and progress
// buckets (0–24, 25–49, 50–74, 75–100; several can be on, none = no filter).
var GRID_FILTER_KEY = 'hskflash_grid_filter_v1';
var LVL_BUCKETS = [[0, 24], [25, 49], [50, 74], [75, 100]];
function loadGridFilter(){
  try {
    var f = JSON.parse(localStorage.getItem(GRID_FILTER_KEY));
    if (f && typeof f === 'object') return { pool: !!f.pool, streak: !!f.streak, lvl: Array.isArray(f.lvl) ? f.lvl : [] };
  } catch(e) {}
  return { pool: false, streak: false, lvl: [] };
}
function saveGridFilter(f){
  try { localStorage.setItem(GRID_FILTER_KEY, JSON.stringify(f)); } catch(e) {}
}
var gridFilter = loadGridFilter();
// Text search in the grid: hanzi (substring), pinyin without tones (spaces,
// tone numbers and apostrophes ignored, v/u also match ü; "nihao", "ni3hao",
// "niha" all find "nǐ hǎo") and the English meaning (substring).
var gridSearch = '';
var gridSearchTimer = null;
(function(){
  var filterBtn = document.getElementById('btnGridFilter');
  if (filterBtn) filterBtn.onclick = function(){ gridFilterOpen = !gridFilterOpen; buildPoolLegend(); };
  var input = document.getElementById('gridSearch');
  if (!input) return;
  input.addEventListener('input', function(){
    clearTimeout(gridSearchTimer);
    gridSearchTimer = setTimeout(function(){
      gridSearch = input.value.trim();
      buildPoolPanel();
    }, 150);
  });
})();
var searchKeys = {}; // wordId -> {p, e}, built lazily
function plainPinyin(s){
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/v/g, 'u').replace(/[^a-z]/g, '');
}
function wordMatchesSearch(w, q){
  if (/[\u3400-\u9fff]/.test(q)) return w.h.indexOf(q.replace(/[^\u3400-\u9fff]/g, '')) >= 0;
  var k = searchKeys[w.id];
  if (!k) k = searchKeys[w.id] = { p: plainPinyin(w.p), e: w.e.toLowerCase() };
  var qp = plainPinyin(q);
  if (qp && k.p.indexOf(qp) >= 0) return true;
  var qe = q.toLowerCase().trim();
  return !!qe && k.e.indexOf(qe) >= 0;
}

// Relevance while searching: 0 exact (hanzi, toneless pinyin or meaning),
// 1 pinyin/meaning starts with the query, 2 any other substring match.
function searchRank(w, q){
  var k = searchKeys[w.id], qp = plainPinyin(q), qe = q.toLowerCase().trim();
  if (w.h === q || (qp && k.p === qp) || k.e === qe) return 0;
  if ((qp && k.p.indexOf(qp) === 0) || k.e.indexOf(qe) === 0) return 1;
  return 2;
}

function lvlBucket(lvl){
  for (var i = LVL_BUCKETS.length - 1; i >= 0; i--) if (lvl >= LVL_BUCKETS[i][0]) return i;
  return 0;
}

function switchStandard(newStd){
  settings.standard = newStd;
  WORDS = wordsForStandard(newStd);
  HSK_ORDER = STANDARD_LEVELS[newStd];
  poolMaxHsk = HSK_ORDER.length;
  savePoolMaxHsk(poolMaxHsk);
  saveSettings(settings);
  session = null;
  buildPoolLegend();
  buildPoolPanel();
  render();
}

// Filter area above the grid: the search field and a "Filter" button are
// always visible; HSK levels, pool/streak, progress buckets and the tap mode
// sit in a panel that opens from that button. An active tap mode keeps its
// hint visible even when the panel is closed.
var gridFilterOpen = false;
function activeGridFilterCount(){
  return (poolMaxHsk < HSK_ORDER.length ? 1 : 0) + (gridFilter.pool ? 1 : 0) + (gridFilter.streak ? 1 : 0) + (gridFilter.lvl.length ? 1 : 0);
}
function buildPoolLegend(){
  var legend = document.getElementById('poolLegend');
  if (!legend) return;
  var count = activeGridFilterCount();
  var btn = document.getElementById('btnGridFilter');
  if (btn) {
    btn.textContent = t('gridFilterBtn') + (count ? ' · ' + count : '') + (gridFilterOpen ? ' ▴' : ' ▾');
    btn.classList.toggle('active', gridFilterOpen || count > 0);
  }
  var hskChips = HSK_ORDER.map(function(h, i){
    var n = i + 1;
    var label = h === 'hsk79' ? 'HSK7-9' : ('HSK' + hskDisplayNum(h));
    return '<button class="legend-chip' + (n === poolMaxHsk ? '' : ' off') + '" data-max="' + n + '">' +
      '<span class="dot" style="background:' + HSK_COLORS[h] + '"></span>' + label + '</button>';
  }).join('');
  var lvlChips = LVL_BUCKETS.map(function(b, i){
    var on = gridFilter.lvl.indexOf(i) >= 0;
    return '<button class="legend-chip' + (on ? '' : ' off') + '" data-lvl-bucket="' + i + '" title="' + esc(tf('gridFilterLvlTitle', b[0], b[1])) + '">' +
      '<span class="dot" style="background:' + levelToColor((b[0] + b[1]) / 2) + '"></span>' + b[0] + '–' + b[1] + '</button>';
  }).join('');
  var mode = streakEditMode ? 'streak' : poolEditMode ? 'pool' : 'info';
  var seg = function(id, m, label){ return '<button class="seg-btn' + (mode === m ? ' active' : '') + '" id="' + id + '">' + esc(label) + '</button>'; };
  var row = function(label, content){ return '<div class="gf-row"><span class="gf-label">' + esc(label) + '</span><div class="gf-items">' + content + '</div></div>'; };
  legend.innerHTML =
    '<div class="grid-filter-panel' + (gridFilterOpen ? ' open' : '') + '">' +
      row(t('gfHsk'), hskChips) +
      row(t('gfShow'),
        '<button class="legend-chip' + (gridFilter.pool ? '' : ' off') + '" id="btnFilterPool">' + esc(t('gridFilterPool')) + '</button>' +
        '<button class="legend-chip' + (gridFilter.streak ? '' : ' off') + '" id="btnFilterStreak">' + esc(t('gridFilterStreak')) + '</button>') +
      row(t('gfProgress'), lvlChips) +
      row(t('gfTap'), '<div class="seg">' + seg('btnTapInfo', 'info', t('gfTapInfo')) + seg('btnPoolEdit', 'pool', t('gfTapPool')) + seg('btnStreakEdit', 'streak', t('gfTapStreak')) + '</div>') +
      (count ? '<button class="hint-btn gf-reset" id="btnGridFilterReset">' + esc(t('gfReset')) + '</button>' : '') +
    '</div>' +
    (mode === 'pool' ? '<div class="pool-edit-hint">' + esc(t('poolEditHint')) + '</div>' : '') +
    (mode === 'streak' ? '<div class="pool-edit-hint">' + esc(t('streakEditHint')) + '</div>' : '');

  function refresh(){ saveGridFilter(gridFilter); buildPoolLegend(); buildPoolPanel(); }
  Array.prototype.forEach.call(legend.querySelectorAll('.legend-chip[data-max]'), function(b){
    b.onclick = function(){ poolMaxHsk = parseInt(b.getAttribute('data-max'), 10); savePoolMaxHsk(poolMaxHsk); refresh(); };
  });
  Array.prototype.forEach.call(legend.querySelectorAll('[data-lvl-bucket]'), function(b){
    b.onclick = function(){
      var i = parseInt(b.getAttribute('data-lvl-bucket'), 10);
      var at = gridFilter.lvl.indexOf(i);
      if (at >= 0) gridFilter.lvl.splice(at, 1); else gridFilter.lvl.push(i);
      refresh();
    };
  });
  document.getElementById('btnFilterPool').onclick = function(){ gridFilter.pool = !gridFilter.pool; refresh(); };
  document.getElementById('btnFilterStreak').onclick = function(){ gridFilter.streak = !gridFilter.streak; refresh(); };
  // Tap mode: tapping the active mode again goes back to "Info".
  document.getElementById('btnTapInfo').onclick = function(){ poolEditMode = streakEditMode = false; buildPoolLegend(); };
  document.getElementById('btnPoolEdit').onclick = function(){ poolEditMode = mode !== 'pool'; streakEditMode = false; buildPoolLegend(); };
  document.getElementById('btnStreakEdit').onclick = function(){ streakEditMode = mode !== 'streak'; poolEditMode = false; buildPoolLegend(); };
  var reset = document.getElementById('btnGridFilterReset');
  if (reset) reset.onclick = function(){
    poolMaxHsk = HSK_ORDER.length;
    savePoolMaxHsk(poolMaxHsk);
    gridFilter = { pool: false, streak: false, lvl: [] };
    refresh();
  };
}

function levelToColor(lvl){
  var stops = [
    { p: 0,   c: [192, 72, 58] },   // red
    { p: 25,  c: [209, 165, 58] },  // yellow
    { p: 50,  c: [91, 149, 116] },  // green
    { p: 75,  c: [68, 114, 168] },  // blue (from here on: 75-100 stays blue)
    { p: 100, c: [52, 95, 140] }    // deeper blue
  ];
  var v = Math.max(0, Math.min(100, lvl));
  var lo = stops[0], hi = stops[stops.length - 1];
  for (var i = 0; i < stops.length - 1; i++) {
    if (v >= stops[i].p && v <= stops[i+1].p) { lo = stops[i]; hi = stops[i+1]; break; }
  }
  var span = (hi.p - lo.p) || 1;
  var t = (v - lo.p) / span;
  var r = Math.round(lo.c[0] + (hi.c[0]-lo.c[0]) * t);
  var g = Math.round(lo.c[1] + (hi.c[1]-lo.c[1]) * t);
  var b = Math.round(lo.c[2] + (hi.c[2]-lo.c[2]) * t);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function hanziFontSizeFor(len){
  if (len <= 2) return 19;
  if (len === 3) return 14;
  return 11; // 4+ characters
}

// Info text for a word (hanzi · pinyin · meaning · level), shown as a toast
// when a word is tapped — in the vocabulary grid and in story sentences.
function wordInfoText(w){
  var p = progress[w.id];
  var lvlPart = (p && p.seen && p.lvl > 0) ? (' · ' + t('cellLevelLabel') + ' ' + p.lvl) : '';
  return w.h + ' · ' + w.p + ' · ' + w.e + lvlPart;
}
var wordToastTimer = null;
function showToast(text){
  var toast = document.getElementById('gridInfoToast');
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(wordToastTimer);
  wordToastTimer = setTimeout(function(){ toast.classList.remove('show'); }, 2600);
}
function showWordToast(w){
  if (w) showToast(wordInfoText(w));
}

// Ids of the current active pool, for the check mark on grid cells; refreshed
// by buildPoolPanel().
var poolIdSet = {};
// "✎ Pool anpassen" / "✎ Streak anpassen": while on, tapping a grid cell
// adds/removes that word (only one of the two modes at a time).
var poolEditMode = false;
var streakEditMode = false;

function poolCellMarkup(w){
  var p = progress[w.id];
  var inPool = (poolIdSet[w.id] ? ' in-pool' : '') + (powerStreak.cards[w.id] ? ' in-streak' : '');
  var title = w.h + ' · ' + w.p + ' · ' + w.e;
  var ring = 'box-shadow:0 0 0 2px ' + (HSK_COLORS[w.hsk] || 'transparent') + ';';
  var fsize = 'font-size:' + hanziFontSizeFor(w.h.length) + 'px;';
  var lvl = (p && p.lvl) || 0;
  if (p && p.seen && lvl > 0) {
    return '<div class="pool-cell learned' + inPool + '" data-id="' + w.id + '" style="background:' + levelToColor(lvl) + ';' + ring + fsize + '" title="' + esc(title) + '">' +
      esc(w.h) + '<span class="lvl-badge">' + lvl + '</span></div>';
  }
  // Not learned yet: an empty tile — except while searching, so you can see what was found.
  var peek = gridSearch ? '<span class="peek" style="' + fsize + '">' + esc(w.h) + '</span>' : '';
  return '<div class="pool-cell' + inPool + '" data-id="' + w.id + '" style="' + ring + '" title="' + esc(title) + '">' + peek + '</div>';
}

function buildPoolPanel(){
  var panel = document.getElementById('poolPanel');
  if (!panel) return;
  poolIdSet = {};
  activePool().forEach(function(w){ poolIdSet[w.id] = true; });
  var visible = WORDS.filter(function(w){
    if (HSK_ORDER.indexOf(w.hsk) >= poolMaxHsk) return false;
    if (gridSearch && !wordMatchesSearch(w, gridSearch)) return false;
    if (gridFilter.pool && !poolIdSet[w.id]) return false;
    if (gridFilter.streak && !powerStreak.cards[w.id]) return false;
    if (gridFilter.lvl.length) {
      var lvl = (progress[w.id] && progress[w.id].lvl) || 0;
      if (gridFilter.lvl.indexOf(lvlBucket(lvl)) < 0) return false;
    }
    return true;
  });
  if (gridSearch) {
    var rank = {};
    visible.forEach(function(w){ rank[w.id] = searchRank(w, gridSearch); });
    visible.sort(function(a, b){ return (rank[a.id] - rank[b.id]) || (a.id - b.id); });
  }
  panel.innerHTML = visible.map(poolCellMarkup).join('');
}

// Pool edit mode: tapping a word adds it to the pool or removes it.
function toggleStreakWord(w){
  var on = !powerStreak.cards[w.id];
  setWordInStreak(w, on);
  updatePoolCell(w.id);
  if (!session) render();
  showToast(tf(on ? 'streakAddedToast' : 'streakRemovedToast', w.h));
}
function togglePoolWord(w){
  var on = !poolIdSet[w.id];
  setWordInPool(w, on);
  poolPoolChanged();
  showToast(tf(on ? 'poolAddedToast' : 'poolRemovedToast', w.h));
}
// After a manual pool change: refresh check marks and the numbers shown.
function poolPoolChanged(){
  buildPoolPanel();
  renderStats();
  if (!session) render();
}

function updatePoolCell(id){
  var panel = document.getElementById('poolPanel');
  if (!panel) return;
  var cell = panel.querySelector('.pool-cell[data-id="' + id + '"]');
  if (!cell) return;
  var w = WORD_BY_ID[id];
  var tmp = document.createElement('div');
  tmp.innerHTML = poolCellMarkup(w);
  cell.replaceWith(tmp.firstElementChild);
}
