// Flashcard session: word pool, session algorithm (port of VBA GetNext2), rating.
"use strict";

// ---------- helpers ----------
function rnd(n){ return Math.floor(Math.random()*n); }

function filteredWords(){
  return WORDS;
}

function ensurePoolFilled(){
  var fw = filteredWords();
  var reviewed = fw.filter(function(w){ return progress[w.id] && progress[w.id].lr; });
  var need = settings.pool - reviewed.length;
  if (need > 0) {
    var fresh = fw.filter(function(w){ return !progress[w.id] || !progress[w.id].lr; })
                  .sort(function(a,b){ return a.id - b.id; });
    for (var i = 0; i < fresh.length && need > 0; i++, need--) {
      progress[fresh[i].id] = { lvl: 0, lr: EPOCH_LONG_AGO, seen: false };
    }
    saveProgress(progress);
  }
}

function activePool(){
  var fw = filteredWords();
  var reviewed = fw.filter(function(w){ return progress[w.id] && progress[w.id].lr; })
                    .sort(function(a,b){ return a.id - b.id; });
  return reviewed.slice(0, settings.pool);
}

function startSession(){
  ensurePoolFilled();
  var pool = activePool();
  if (pool.length === 0) { session = null; render(); return; }
  var n = Math.min(settings.sessionSize, pool.length);

  // Reserve up to 5 slots for the words with the least progress so far (lowest
  // lvl), so weak words keep surfacing instead of being drowned out by chance.
  var leastSlots = Math.min(5, n);
  var byProgress = pool.slice().sort(function(a, b){
    var la = (progress[a.id] && progress[a.id].lvl) || 0;
    var lb = (progress[b.id] && progress[b.id].lvl) || 0;
    if (la !== lb) return la - lb;
    return Math.random() - 0.5;
  });
  var leastProgress = byProgress.slice(0, leastSlots);
  var leastIds = {};
  leastProgress.forEach(function(w){ leastIds[w.id] = true; });

  var rest = pool.filter(function(w){ return !leastIds[w.id]; });
  var shuffledRest = rest.slice().sort(function(){ return Math.random()-0.5; });
  var picked = leastProgress.concat(shuffledRest.slice(0, n - leastProgress.length));
  picked = picked.sort(function(){ return Math.random()-0.5; }); // mix the order

  var sessionPts = {};
  picked.forEach(function(w){ sessionPts[w.id] = 0; });
  session = {
    ids: picked.map(function(w){ return w.id; }),
    sessionPts: sessionPts,
    currentId: null,
    showPinyin: false,
    showTranslationInExamples: false,
    showExamples: false,
    showSolution: false,
    finished: false
  };
  pickNext();
}

function activeWindow(){
  // mirrors GetNext2: scan session.ids from the start, collect up to 7 with sessionPts < 5
  var dictPart = [];
  var prog = 0;
  for (var i = 0; i < session.ids.length; i++){
    var id = session.ids[i];
    if (session.sessionPts[id] < 5) {
      dictPart.push(id);
    } else {
      prog++;
    }
    if (dictPart.length === 7) break;
  }
  return { dictPart: dictPart, prog: prog };
}

function pickNext(){
  var win = activeWindow();
  session.lastWindow = win;
  if (win.dictPart.length === 0) {
    session.finished = true;
    render();
    return;
  }
  var choices = win.dictPart;
  if (choices.length > 1 && session.currentId != null) {
    // Never repeat the card that's currently showing, unless it's the only one left.
    var withoutCurrent = choices.filter(function(id){ return id !== session.currentId; });
    if (withoutCurrent.length > 0) choices = withoutCurrent;
  }
  var candidate = choices[rnd(choices.length)];
  session.currentId = candidate;
  session.generateError = null;
  session.showPinyin = false;
  session.showTranslationInExamples = false;
  session.showExamples = false;
  session.showSolution = false;
  render();
}

function rate(val){
  if (!session || session.currentId == null) return;
  var id = session.currentId;
  var p = progress[id] || { lvl: 0, lr: null, seen: false };
  p.lr = new Date().toISOString();
  p.lvl = Math.min((p.lvl || 0) + val, 100);
  p.seen = true;
  progress[id] = p;
  saveProgress(progress);
  updatePoolCell(id);
  recordActivity();

  if (settings.autoSpeak) {
    var w = WORD_BY_ID[id];
    if (w) speak(w.h);
  }

  session.sessionPts[id] = (session.sessionPts[id] || 0) + val;
  session.showPinyin = true;
  session.showSolution = true;
  render(true);

  setTimeout(function(){
    if (!session || session.streak) return;
    pickNext();
  }, 900);
}
