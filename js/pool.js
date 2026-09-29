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

function buildPoolLegend(){
  var legend = document.getElementById('poolLegend');
  if (!legend) return;
  legend.innerHTML = HSK_ORDER.map(function(h, i){
    var n = i + 1;
    var on = n === poolMaxHsk;
    var label = h === 'hsk79' ? 'HSK7-9' : ('HSK' + hskDisplayNum(h));
    return '<button class="legend-chip' + (on ? '' : ' off') + '" data-max="' + n + '">' +
      '<span class="dot" style="background:' + HSK_COLORS[h] + '"></span>' + label +
      '</button>';
  }).join('');
  Array.prototype.forEach.call(legend.querySelectorAll('.legend-chip'), function(btn){
    btn.onclick = function(){
      poolMaxHsk = parseInt(btn.getAttribute('data-max'), 10);
      savePoolMaxHsk(poolMaxHsk);
      buildPoolLegend();
      buildPoolPanel();
    };
  });
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

function poolCellMarkup(w){
  var p = progress[w.id];
  var title = w.h + ' · ' + w.p + ' · ' + w.e;
  var ring = 'box-shadow:0 0 0 2px ' + (HSK_COLORS[w.hsk] || 'transparent') + ';';
  var fsize = 'font-size:' + hanziFontSizeFor(w.h.length) + 'px;';
  var lvl = (p && p.lvl) || 0;
  if (p && p.seen && lvl > 0) {
    return '<div class="pool-cell learned" data-id="' + w.id + '" style="background:' + levelToColor(lvl) + ';' + ring + fsize + '" title="' + esc(title) + '">' +
      esc(w.h) + '<span class="lvl-badge">' + lvl + '</span></div>';
  }
  return '<div class="pool-cell" data-id="' + w.id + '" style="' + ring + '" title="' + esc(title) + '"></div>';
}

function buildPoolPanel(){
  var panel = document.getElementById('poolPanel');
  if (!panel) return;
  var visible = WORDS.filter(function(w){
    return HSK_ORDER.indexOf(w.hsk) < poolMaxHsk;
  });
  panel.innerHTML = visible.map(poolCellMarkup).join('');
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
