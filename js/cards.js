// Cards view: rendering of the flashcard session and start screen.
"use strict";

// ---------- rendering ----------
var main = document.getElementById('main');
var statsStrip = document.getElementById('statsStrip');

// Start/finished screen card for the regular, free-form session — same layout
// as the Power-Streak card below it. The grid shows the funnel:
// all words of the standard → pool → words per round → words in focus.
function renderFreeCard(finished){
  var total = WORDS.length;
  var pool = Math.min(settings.pool, total);
  var round = Math.min(settings.sessionSize, pool);
  var focus = Math.min(7, round); // window size of activeWindow()
  var cells = [[total, 'freeFcTotal'], [pool, 'freeFcPool'], [round, 'freeFcRound'], [focus, 'freeFcFocus']];
  return '<div class="panel mode-card">' +
      '<div class="mode-head"><span class="mode-icon">🎴</span>' +
        '<span class="mode-title">' + esc(t('freeTitle')) + '</span></div>' +
      '<div class="mode-motto">' + esc(finished ? t('finishedTitle') : t('freeMotto')) + '</div>' +
      '<p>' + esc(finished ? t('finishedDesc') : t('freeStatus')) + '</p>' +
      '<div class="mode-grid">' +
        cells.map(function(c){
          return '<div class="mode-cell"><div class="n">' + c[0] + '</div><div class="l">' + esc(t(c[1])) + '</div></div>';
        }).join('') +
      '</div>' +
      '<div class="mode-note">' + esc(t('freeNote')) + '</div>' +
      '<div class="mode-btns"><button class="btn-primary" id="' + (finished ? 'btnAgain' : 'btnStart') + '">' +
        esc(finished ? t('newRoundBtn') : t('startBtn')) + '</button></div>' +
      '<details class="mode-info"><summary>' + esc(t('streakHowTitle')) + '</summary>' +
        '<p>' + esc(tf('freeHowText', total, pool, round)) + '</p></details>' +
    '</div>';
}

function render(justAnswered){
  renderStats();

  if (!session) {
    main.innerHTML = renderFreeCard(false) + renderStreakCard();
    document.getElementById('btnStart').onclick = startSession;
    wireStreakCard();
    return;
  }

  if (session.finished) {
    main.innerHTML = renderFreeCard(true) + renderStreakCard();
    document.getElementById('btnAgain').onclick = startSession;
    wireStreakCard();
    return;
  }

  var w = WORD_BY_ID[session.currentId];
  var examples = examplesFor(w.id);
  var barText, dotsHtml = '', rateHtml;

  if (session.streak) {
    var sOpen = powerStreak.open;
    var sCard = powerStreak.cards[w.id];
    var isNewCard = sOpen.newIds[w.id] && !sOpen.rated[w.id];
    var newLeft = sOpen.queue.filter(function(id){ return sOpen.newIds[id] && !sOpen.rated[id]; }).length;
    barText = sOpen.reviewOnly
      ? tf('streakReviewBar', sOpen.queue.length)
      : tf('streakBar', powerStreak.level, newLeft, sOpen.queue.length - newLeft) + (isNewCard ? ' · ' + t('streakNewCard') : '');
    var sClock = sOpen.reviewOnly ? sOpen.clock : powerStreak.clock;
    // Intervals are previewed only for the first rating; repeats in the same stage don't reschedule.
    var ivls = [0, 1, 2, 3].map(function(g){
      if (sOpen.rated[w.id]) return '';
      if (g === 0) return streakIvlLabel(0);
      var r = streakSchedule(sCard, g, sClock, sOpen.reviewOnly);
      return r ? streakIvlLabel(r.ivl) : '=';
    });
    rateHtml =
      '<button class="rate-btn" style="background:' + levelToColor(4) + '" data-grade="0">' + esc(t('rateNochmal')) + '<span class="val">' + esc(ivls[0]) + '</span></button>' +
      '<button class="rate-btn" style="background:' + levelToColor(28) + '" data-grade="1">' + esc(t('rateSchwer')) + '<span class="val">' + esc(ivls[1]) + '</span></button>' +
      '<button class="rate-btn" style="background:' + levelToColor(58) + '" data-grade="2">' + esc(t('rateGut')) + '<span class="val">' + esc(ivls[2]) + '</span></button>' +
      '<button class="rate-btn" style="background:' + levelToColor(92) + '" data-grade="3">' + esc(t('rateLeicht')) + '<span class="val">' + esc(ivls[3]) + '</span></button>';
  } else {
    var win = session.lastWindow || activeWindow();
    barText = tf('sessionBar', win.prog, win.dictPart.length, session.ids.length);
    dotsHtml = session.ids.slice(0, Math.min(session.ids.length, 20)).map(function(id){
      var cls = 'dot';
      if (session.sessionPts[id] >= 5) cls += ' done';
      else if (id === session.currentId) cls += ' active';
      return '<span class="' + cls + '"></span>';
    }).join('');
    rateHtml =
      '<button class="rate-btn" style="background:' + levelToColor(4) + '" data-val="0">' + esc(t('rateNochmal')) + '<span class="val">+0</span></button>' +
      '<button class="rate-btn" style="background:' + levelToColor(28) + '" data-val="1">' + esc(t('rateSchwer')) + '<span class="val">+1</span></button>' +
      '<button class="rate-btn" style="background:' + levelToColor(58) + '" data-val="2">' + esc(t('rateGut')) + '<span class="val">+2</span></button>' +
      '<button class="rate-btn" style="background:' + levelToColor(92) + '" data-val="5">' + esc(t('rateLeicht')) + '<span class="val">+5</span></button>';
  }

  var exHtml = '';
  if (examples.length) {
    exHtml = examples.map(function(ex, i){
      var row = '<div class="ex-row"><div class="ex-h">' +
        '<button class="ex-speak-btn" data-ex-idx="' + i + '" title="' + esc(t('sentenceSpeak')) + '">🔊</button> ' +
        esc(ex.h) + '</div>';
      if (session.showTranslationInExamples || session.showPinyin) {
        row += '<div class="ex-p">' + esc(ex.p) + '</div>';
      }
      if (session.showTranslationInExamples) {
        row += '<div class="ex-e">' + esc(ex.e) + '</div>';
      }
      row += '</div>';
      return row;
    }).join('') +
      (session.generating
        ? '<div class="ex-e">' + esc(t('generatingExamples')) + '</div>'
        : '<button class="hint-btn" id="btnGenExamples">' + esc(t('moreExamplesBtn')) + '</button>') +
      (session.generateError ? '<div class="ex-e" style="margin-top:8px;color:var(--seal);">' + esc(session.generateError) + '</div>' : '');
  } else if (session.generating) {
    exHtml = '<div class="ex-e">' + esc(t('generatingExamples')) + '</div>';
  } else {
    exHtml = '<div class="ex-e" style="margin-bottom:10px;">' + esc(t('noExamples')) + '</div>' +
      '<button class="hint-btn" id="btnGenExamples">' + esc(t('generateExamplesBtn')) + '</button>' +
      (session.generateError ? '<div class="ex-e" style="margin-top:8px;color:var(--seal);">' + esc(session.generateError) + '</div>' : '');
  }

  main.innerHTML =
    '<div class="session-bar">' +
      '<span>' + esc(barText) + '</span>' +
      '<span class="dots">' + dotsHtml + '</span>' +
    '</div>' +
    '<div class="card">' +
      '<span class="hsk-badge">' + w.hsk.replace('hsk','HSK ') + '</span>' +
      '<span class="rank-note">#' + w.id + '</span>' +
      '<div class="hanzi" id="hanziText" title="' + esc(t('speakTitle')) + '">' + esc(w.h) + '</div>' +
      '<div class="pinyin-line">' + (session.showPinyin ? esc(w.p) : '') + '</div>' +
      '<div class="hint-row">' +
        '<button class="hint-btn' + (session.showPinyin ? ' on' : '') + '" id="btnTogglePinyin">' + esc(session.showPinyin ? t('pinyinHide') : t('pinyinShow')) + '</button>' +
        '<button class="hint-btn' + (session.showSolution ? ' on' : '') + '" id="btnSolution">' + esc(t('translationBtn')) + '</button>' +
        '<button class="hint-btn' + (session.showExamples ? ' on' : '') + '" id="btnExamples">' + esc(t('examplesBtn')) + '</button>' +
        '<button class="hint-btn" id="btnRead">' + esc(t('readBtn')) + '</button>' +
      '</div>' +
      '<div class="solution-line">' + (session.showSolution ? esc(w.e) : '') + '</div>' +
      '<div class="examples-box' + (session.showExamples ? ' show' : '') + '">' +
        (examples.length ? '<label class="hint-btn' + (session.showTranslationInExamples ? ' on' : '') + '" id="btnExTranslation" style="margin-bottom:10px;">' + esc(t('translationInExamples')) + '</label>' : '') +
        exHtml +
      '</div>' +
      '<div class="feedback-toast">' + (justAnswered ? esc(t('savedToast')) : '') + '</div>' +
      '<div class="rate-row">' + rateHtml + '</div>' +
    '</div>';

  document.getElementById('hanziText').onclick = function(){ speak(w.h); };
  document.getElementById('btnRead').onclick = function(){ speak(w.h); };
  document.getElementById('btnTogglePinyin').onclick = function(){
    session.showPinyin = !session.showPinyin;
    render();
  };
  document.getElementById('btnSolution').onclick = function(){
    session.showSolution = !session.showSolution;
    render();
  };
  document.getElementById('btnExamples').onclick = function(){
    session.showExamples = !session.showExamples;
    render();
  };
  var exT = document.getElementById('btnExTranslation');
  if (exT) exT.onclick = function(){
    session.showTranslationInExamples = !session.showTranslationInExamples;
    render();
  };

  Array.prototype.forEach.call(document.querySelectorAll('.ex-speak-btn'), function(btn){
    btn.onclick = function(){
      var i = parseInt(btn.getAttribute('data-ex-idx'), 10);
      var ex = examples[i];
      if (ex) speak(ex.h);
    };
  });

  var btnGen = document.getElementById('btnGenExamples');
  if (btnGen) btnGen.onclick = function(){
    session.generating = true;
    session.generateError = null;
    render();
    generateExamplesFor(w).then(function(){
      session.generating = false;
      session.showExamples = true;
      render();
    }).catch(function(err){
      session.generating = false;
      if (err.message !== 'no-key') {
        session.generateError = t('errorPrefix') + err.message;
      }
      render();
    });
  };

  Array.prototype.forEach.call(document.querySelectorAll('.rate-btn'), function(btn){
    btn.onclick = session.streak
      ? function(){ rateStreak(parseInt(btn.getAttribute('data-grade'), 10)); }
      : function(){ rate(parseInt(btn.getAttribute('data-val'), 10)); };
  });
}
