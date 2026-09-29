// Stories: storage, Gemini story generation and the stories view.
"use strict";

// ---------- HSK Stories ----------
var STORIES_KEY = 'hskflash_stories_v1';
function loadStories(){
  try {
    var raw = localStorage.getItem(STORIES_KEY);
    if (raw) {
      var list = JSON.parse(raw);
      // Migration: stories saved before the HSK 2.0/3.0 split stored hsk as a plain
      // number (e.g. 3). Convert those to the current string key format ("hsk3").
      // Also ensure every story has a currentIdx (resumable reading position).
      var changed = false;
      list.forEach(function(s){
        if (typeof s.hsk === 'number') {
          s.hsk = 'hsk' + s.hsk;
          changed = true;
        }
        if (typeof s.currentIdx !== 'number') {
          s.currentIdx = 0;
          changed = true;
        }
      });
      if (changed) saveStories(list);
      return list;
    }
  } catch(e) {}
  return [];
}
function saveStories(list){
  try { localStorage.setItem(STORIES_KEY, JSON.stringify(list)); } catch(e) {}
}
var stories = loadStories();

// All-time count of story sentences read (rated). Kept separately from the
// stories themselves so restarting or deleting a story never lowers it.
// First run: seed it from the reading positions of the existing stories.
var SENTENCES_READ_KEY = 'hskflash_sentences_read_v1';
function loadSentencesRead(){
  try {
    var raw = localStorage.getItem(SENTENCES_READ_KEY);
    if (raw != null) return parseInt(raw, 10) || 0;
  } catch(e) {}
  var seeded = stories.reduce(function(sum, s){ return sum + Math.min(s.currentIdx || 0, s.sentences.length); }, 0);
  saveSentencesRead(seeded);
  return seeded;
}
function saveSentencesRead(n){
  try { localStorage.setItem(SENTENCES_READ_KEY, String(n)); } catch(e) {}
}
var sentencesRead = loadSentencesRead();

var storiesState = {
  view: 'library',       // 'library' | 'generate' | 'preview' | 'detail'
  form: { count: 6, hsk: 'hsk3', topic: '' },
  generating: false,
  generateError: null,
  draft: null,           // { title:{h,p,e}, sentences:[{h,p,e},...], hsk, count }
  selectedId: null,
  audioPickerFor: null,   // story id currently showing the voice/speed picker, or null
  activeRecordingFor: {}  // storyId -> recordingId of the narration this story card is currently tracking
};

function hskPromptLabel(key){
  return key === 'hsk79' ? '7-9' : key.slice(3);
}

// Greedy longest-match-first: finds which known vocabulary words occur in a sentence,
// so rating a sentence can award progress to the actual words it contains.
function matchWordsInSentence(text, wordList){
  var candidates = wordList.filter(function(w){ return w.h && text.indexOf(w.h) !== -1; });
  candidates.sort(function(a, b){ return b.h.length - a.h.length; });
  var claimed = new Array(text.length).fill(false);
  var matched = [];
  candidates.forEach(function(w){
    var searchFrom = 0;
    var idx;
    while ((idx = text.indexOf(w.h, searchFrom)) !== -1) {
      var free = true;
      for (var i = idx; i < idx + w.h.length; i++) { if (claimed[i]) { free = false; break; } }
      if (free) {
        for (var j = idx; j < idx + w.h.length; j++) { claimed[j] = true; }
        matched.push(w);
        break;
      }
      searchFrom = idx + 1;
    }
  });
  return matched;
}

function buildStoryPrompt(count, hskKey, topic){
  var hsk = hskPromptLabel(hskKey);
  return "You are a precise linguistic API for a Mandarin learning app.\n" +
    "TASK: Write a short story in Mandarin Chinese for a language learner.\n" +
    "INPUT PARAMETERS:\n" +
    "- Number of sentences: " + count + "\n" +
    "- HSK vocabulary level: HSK" + hsk + " (use only vocabulary appropriate for HSK" + hsk + " or below)\n" +
    "- Topic: " + (topic || 'a simple everyday topic of your choice') + "\n" +
    "STRICT OUTPUT RULES:\n" +
    "1. Output MUST contain exactly " + (count + 1) + " lines. Nothing else.\n" +
    "2. The first line is the story title, in the format: HANZI|PINYIN|ENGLISH\n" +
    "3. Each of the next " + count + " lines is one sentence of the story, in order, in the same format: HANZI|PINYIN|ENGLISH\n" +
    "4. No introduction, no markdown fences (do NOT use ```), no explanatory text, no numbering.\n" +
    "5. The sentences must form one coherent short story.";
}

function generateStory(count, hsk, topic){
  var apiKey = loadGeminiKey();
  if (!apiKey) {
    openDrawer();
    var f = document.getElementById('inpGeminiKey');
    if (f) f.focus();
    return Promise.reject(new Error('no-key'));
  }
  var model = loadGeminiModel();
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
  var prompt = buildStoryPrompt(count, hsk, topic);
  var payload = { contents: [{ parts: [{ text: prompt }] }] };

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(res){
    if (!res.ok) {
      return res.text().then(function(t){ throw new Error('HTTP ' + res.status + ': ' + t); });
    }
    return res.json();
  }).then(function(data){
    var text = data.candidates[0].content.parts[0].text;
    var parsed = parseGeminiResponse(text);
    if (parsed.length < 2) throw new Error('Antwort konnte nicht gelesen werden.');
    return { title: parsed[0], sentences: parsed.slice(1), hsk: hsk, count: parsed.length - 1 };
  });
}

function storyMeta(s){
  return (s.hsk ? hskLabel(s.hsk) : 'HSK') + ' · ' + tf('storiesSentencesCount', s.count);
}

function buildAudioParamsLine(voiceId, speed, funStyle){
  if (!voiceId) return '';
  var voiceLabel = voiceDisplayLabel(voiceId);
  if (funStyle) voiceLabel += ' 🎭 ' + funStyleLabel(funStyle);
  var speedLabel = t(normalizeSpeedKey(speed) === 'slow' ? 'audioSpeedSlow' : 'audioSpeedNormal');
  return '<div class="story-audio-params">' + esc(voiceLabel + ' · ' + speedLabel) + '</div>';
}

function storyProgressLabel(s){
  var cur = s.currentIdx || 0;
  if (cur >= s.sentences.length) return t('storiesFinishedLabel');
  if (cur === 0) return t('storiesNotStarted');
  return tf('storiesContinueAt', cur + 1, s.sentences.length);
}

function renderStories(){
  var root = document.getElementById('storiesView');
  var st = storiesState;

  if (st.view === 'library') {
    // Higher HSK levels float to the top, HSK1 sinks to the bottom; within
    // the same level, the most recently created story comes first.
    var sortedStories = stories.map(function(s, idx){ return { s: s, idx: idx }; }).sort(function(a, b){
      var rankA = HSK_ORDER.indexOf(a.s.hsk), rankB = HSK_ORDER.indexOf(b.s.hsk);
      if (rankA !== rankB) return rankB - rankA;
      return b.idx - a.idx;
    }).map(function(x){ return x.s; });
    var listHtml = stories.length
      ? sortedStories.map(function(s){
          // The story card only tracks whichever recording it most recently
          // started (if any) — everything else about past narrations lives
          // in the Audio tab. This keeps re-narrating a story as simple as
          // "tap 🔊, pick options, watch it generate", every time.
          var activeRecId = (st.activeRecordingFor || {})[s.id];
          var activeRec = activeRecId ? recordings.filter(function(r){ return r.id === activeRecId; })[0] : null;
          var active = !!(activeRec && isRecordingAudioActive(activeRec.id));
          var blockedUntil = activeRec && recordingStatus[activeRec.id] && recordingStatus[activeRec.id].blockedUntil;
          var errMsg = activeRec && recordingStatus[activeRec.id] && recordingStatus[activeRec.id].error;
          var showPicker = st.audioPickerFor === s.id;

          // The narrate/status control lives up in the top row now (icon-only,
          // to stay on one line with the title); only an in-progress bar (no
          // button of its own) drops to a second, slim row when there's
          // something to show progress on.
          var hasActiveTracking = !!(activeRec && (active || blockedUntil || errMsg || activeRec.done < activeRec.totalSteps));
          var topRightHtml = '<div style="display:flex;align-items:center;gap:8px;">';
          if (showPicker) {
            // Start/Cancel live in the picker panel below — nothing extra needed here.
          } else if (hasActiveTracking) {
            topRightHtml += active
              ? '<button class="audio-mini-btn hint-btn on" data-audio-cancel="' + activeRec.id + '">⏸</button>'
              : (errMsg
                  ? '<button class="audio-mini-btn hint-btn" data-audio-resume="' + activeRec.id + '" title="' + esc(t('audioResumeTitle')) + '">▶</button>'
                  : (activeRec.done >= activeRec.totalSteps
                      ? '<span class="audio-mini-done">✓</span>'
                      : '<span class="audio-mini-note" title="' + esc(t('audioSeeAudioTab')) + '">⏳</span>'));
          } else {
            topRightHtml += '<button class="audio-mini-btn hint-btn" data-audio-open-picker="' + s.id + '" title="' + esc(t('audioNarrateBtn')) + '">🔊</button>';
          }
          topRightHtml += '<button class="hint-btn" data-restart-id="' + s.id + '" title="' + esc(t('storiesRestartBtn')) + '">↺</button></div>';

          var audioRowHtml = '';
          if (hasActiveTracking) {
            var pct = activeRec.totalSteps ? (activeRec.done / activeRec.totalSteps * 100) : 0;
            audioRowHtml =
              '<div class="story-audio-row" data-id="' + s.id + '">' +
                '<div class="story-audio-bar"><div class="story-audio-fill" style="width:' + pct + '%"></div></div>' +
                '<span class="story-audio-label">' + activeRec.done + ' / ' + activeRec.totalSteps + '</span>' +
              '</div>' +
              buildAudioParamsLine(activeRec.voiceId, activeRec.speed, activeRec.funStyle) +
              (blockedUntil ? '<div class="audio-mini-note" style="padding:0 2px;">' + esc(tf('audioBlockedUntil', new Date(blockedUntil).toLocaleString())) + '</div>' : '') +
              (errMsg ? '<div class="audio-mini-note" style="padding:0 2px;color:var(--seal);">' + esc(t('audioFailedShort')) + '</div>' : '');
          }
          audioRowHtml += (showPicker ? buildAudioPickerHtml(s) : '');

          return '<div class="story-card" data-id="' + s.id + '">' +
            '<div class="story-card-toprow" data-toprow-id="' + s.id + '">' +
              '<div><div class="story-title">' + esc(s.title.h) + '</div><div class="story-title-en">' + esc(s.title.e) + '</div>' +
              '<div class="story-meta">' + esc(storyMeta(s)) + ' · ' + esc(storyProgressLabel(s)) + '</div></div>' +
              topRightHtml +
            '</div>' +
            audioRowHtml +
          '</div>';
        }).join('')
      : '<div class="empty-note">' + esc(t('storiesEmpty')) + '</div>';
    root.innerHTML =
      '<div class="stories-wrap">' +
        '<div class="story-toprow"><h2 style="margin:0;font-size:16px;">' + esc(t('storiesLibraryTitle')) + '</h2>' +
          '<button class="btn-primary" id="btnNewStory" style="padding:9px 18px;font-size:13.5px;">' + esc(t('storiesNewBtn')) + '</button></div>' +
        listHtml +
      '</div>';
    var btnNew = document.getElementById('btnNewStory');
    if (btnNew) btnNew.onclick = function(){ stopNarration(); st.view = 'generate'; renderStories(); };
    Array.prototype.forEach.call(root.querySelectorAll('[data-restart-id]'), function(btn){
      btn.onclick = function(e){
        e.stopPropagation();
        var id = btn.getAttribute('data-restart-id');
        var s = stories.filter(function(x){ return x.id === id; })[0];
        if (!s) return;
        if (!confirm(t('storiesRestartConfirm'))) return;
        s.currentIdx = 0;
        saveStories(stories);
        renderStories();
      };
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-toprow-id]'), function(row){
      row.onclick = function(){
        stopNarration();
        var id = row.getAttribute('data-toprow-id');
        var s = stories.filter(function(x){ return x.id === id; })[0];
        var startAt = (s && s.currentIdx) ? Math.min(s.currentIdx, s.sentences.length) : 0;
        st.selectedId = id;
        st.view = 'detail';
        st.readIdx = Math.min(startAt, s ? s.sentences.length - 1 : 0);
        st.readCurrent = startAt;
        st.readShowPinyin = false;
        st.readShowTranslation = false;
        st.readFinished = s ? startAt >= s.sentences.length : false;
        renderStories();
      };
    });
    wireAudioRowHandlers(root, stories);
    return;
  }

  if (st.view === 'generate') {
    root.innerHTML =
      '<div class="stories-wrap">' +
        '<div class="story-toprow"><h2 style="margin:0;font-size:16px;">' + esc(t('storiesGenTitle')) + '</h2>' +
          '<button class="hint-btn" id="btnBackToLibrary">' + esc(t('storiesBackToLibrary')) + '</button></div>' +
        '<div class="story-form">' +
          '<div class="field"><label for="stCount">' + esc(t('storiesCountLabel')) + '</label>' +
            '<input type="number" id="stCount" min="2" max="30" step="1" value="' + st.form.count + '"></div>' +
          '<div class="field"><label for="stHsk">' + esc(t('storiesHskLabel')) + '</label>' +
            '<select id="stHsk">' +
              HSK_ORDER.map(function(h){ return '<option value="' + h + '"' + (h === st.form.hsk ? ' selected' : '') + '>' + esc(hskLabel(h)) + '</option>'; }).join('') +
            '</select></div>' +
          '<div class="field"><label for="stTopic">' + esc(t('storiesTopicLabel')) + '</label>' +
            '<textarea id="stTopic" placeholder="' + esc(t('storiesTopicPlaceholder')) + '">' + esc(st.form.topic) + '</textarea></div>' +
          '<button class="btn-primary" id="btnGenStory"' + (st.generating ? ' disabled' : '') + '>' + esc(st.generating ? t('storiesGeneratingBtn') : t('storiesGenerateBtn')) + '</button>' +
          (st.generateError ? '<div class="ex-e" style="margin-top:10px;color:var(--seal);">' + esc(st.generateError) + '</div>' : '') +
        '</div>' +
      '</div>';
    document.getElementById('btnBackToLibrary').onclick = function(){ st.view = 'library'; renderStories(); };
    document.getElementById('btnGenStory').onclick = function(){
      st.form.count = parseInt(document.getElementById('stCount').value, 10) || 6;
      st.form.hsk = document.getElementById('stHsk').value || HSK_ORDER[0];
      st.form.topic = document.getElementById('stTopic').value.trim();
      st.generating = true;
      st.generateError = null;
      renderStories();
      generateStory(st.form.count, st.form.hsk, st.form.topic).then(function(draft){
        st.generating = false;
        st.draft = draft;
        st.view = 'preview';
        renderStories();
      }).catch(function(err){
        st.generating = false;
        if (err.message !== 'no-key') st.generateError = t('errorPrefix') + err.message;
        renderStories();
      });
    };
    return;
  }

  if (st.view === 'preview' && st.draft) {
    var d = st.draft;
    root.innerHTML =
      '<div class="stories-wrap">' +
        '<div class="story-title-block">' +
          '<div class="t-h">' + esc(d.title.h) + '</div>' +
          '<div class="t-p">' + esc(d.title.p) + '</div>' +
          '<div class="t-e">' + esc(d.title.e) + '</div>' +
        '</div>' +
        d.sentences.map(function(s, i){
          return '<div class="story-sentence">' +
            '<div class="s-h"><button class="hint-btn" data-speak-idx="' + i + '" style="padding:3px 7px;">🔊</button>' + esc(s.h) + '</div>' +
            '<div class="s-p">' + esc(s.p) + '</div>' +
            '<div class="s-e">' + esc(s.e) + '</div>' +
          '</div>';
        }).join('') +
        '<div class="story-btn-row">' +
          '<button class="btn-primary" id="btnAdoptStory">' + esc(t('storiesAdoptBtn')) + '</button>' +
          '<button class="btn-secondary" id="btnDiscardStory">' + esc(t('storiesDiscardBtn')) + '</button>' +
        '</div>' +
      '</div>';
    Array.prototype.forEach.call(root.querySelectorAll('[data-speak-idx]'), function(btn){
      btn.onclick = function(){
        var i = parseInt(btn.getAttribute('data-speak-idx'), 10);
        speak(d.sentences[i].h);
      };
    });
    document.getElementById('btnAdoptStory').onclick = function(){
      var story = {
        id: 'story_' + Date.now(),
        title: d.title,
        sentences: d.sentences,
        hsk: d.hsk,
        count: d.count,
        currentIdx: 0,
        createdAt: new Date().toISOString()
      };
      stories.push(story);
      saveStories(stories);
      st.draft = null;
      st.selectedId = story.id;
      st.view = 'detail';
      st.readIdx = 0;
      st.readCurrent = 0;
      st.readShowPinyin = false;
      st.readShowTranslation = false;
      st.readFinished = false;
      renderStories();
    };
    document.getElementById('btnDiscardStory').onclick = function(){
      st.draft = null;
      st.view = 'generate';
      renderStories();
    };
    return;
  }

  if (st.view === 'detail') {
    var story = stories.filter(function(s){ return s.id === st.selectedId; })[0];
    if (!story) { st.view = 'library'; renderStories(); return; }

    if (st.readFinished) {
      root.innerHTML =
        '<div class="stories-wrap">' +
          '<div class="story-toprow"><button class="hint-btn" id="btnBackToLibrary2">' + esc(t('storiesBackToLibrary')) + '</button>' +
            '<button class="hint-btn" id="btnDeleteStory" style="color:var(--seal);">' + esc(t('storiesDeleteBtn')) + '</button></div>' +
          '<div class="panel"><h2>' + esc(t('storiesFinishedTitle')) + '</h2>' +
            '<p>' + esc(tf('storiesFinishedDesc', story.title.h)) + '</p>' +
            '<button class="btn-primary" id="btnReadAgain">' + esc(t('storiesRestartBtn')) + '</button></div>' +
        '</div>';
      document.getElementById('btnBackToLibrary2').onclick = function(){ stopNarration(); stopTryListening(); st.tryResult = null; st.view = 'library'; renderStories(); };
      document.getElementById('btnDeleteStory').onclick = function(){
        stopNarration();
        if (!confirm(t('storiesDeleteConfirm'))) return;
        stories = stories.filter(function(s){ return s.id !== story.id; });
        saveStories(stories);
        st.view = 'library';
        renderStories();
      };
      document.getElementById('btnReadAgain').onclick = function(){
        stopNarration();
        st.readIdx = 0;
        st.readCurrent = 0;
        st.readShowPinyin = false;
        st.readShowTranslation = false;
        st.readFinished = false;
        story.currentIdx = 0;
        saveStories(stories);
        renderStories();
      };
      return;
    }

    var idx = st.readIdx || 0;
    var current = typeof st.readCurrent === 'number' ? st.readCurrent : 0;
    var sent = story.sentences[idx];
    var isCurrent = idx === current;
    var tryHere = st.tryResult && st.tryResult.storyId === story.id && st.tryResult.idx === idx;
    var tryListening = tryHere && st.tryResult.status === 'listening';
    var dotsHtml = story.sentences.map(function(s, i){
      var cls = 'dot';
      if (i < current) cls += ' done';
      if (i === idx) cls += ' active';
      return '<span class="' + cls + '" data-dot-idx="' + i + '"></span>';
    }).join('');

    root.innerHTML =
      '<div class="stories-wrap">' +
        '<div class="story-toprow"><button class="hint-btn" id="btnBackToLibrary2">' + esc(t('storiesBackToLibrary')) + '</button>' +
          '<div style="display:flex;gap:8px;">' +
            '<button class="hint-btn' + (narrating ? ' on' : '') + '" id="btnNarrate">' + esc(narrating ? t('storiesStopBtn') : t('storiesNarrateBtn')) + '</button>' +
            '<button class="hint-btn" id="btnDeleteStory" style="color:var(--seal);">' + esc(t('storiesDeleteBtn')) + '</button>' +
          '</div></div>' +
        '<div class="story-title-block" style="margin-bottom:14px;padding-bottom:12px;">' +
          '<div class="t-h" style="font-size:18px;">' + esc(story.title.h) + '</div>' +
          '<div class="t-e" style="margin-top:2px;">' + esc(story.title.e) + '</div>' +
        '</div>' +
        '<div class="session-bar"><span>' + esc(tf('storiesSentenceOf', idx + 1, story.sentences.length)) + (isCurrent ? '' : esc(t('storiesRepetition'))) + '</span>' +
          '<span class="dots">' + dotsHtml + '</span></div>' +
        '<div class="card" style="margin-top:10px;">' +
          '<div class="nav-row">' +
            '<button class="hint-btn" id="btnPrevSent"' + (idx === 0 ? ' disabled' : '') + '>' + esc(t('storiesPrev')) + '</button>' +
            '<button class="hint-btn" id="btnNextSent"' + (idx === story.sentences.length - 1 ? ' disabled' : '') + '>' + esc(t('storiesNext')) + '</button>' +
          '</div>' +
          '<div class="hanzi" id="sentHanzi" style="font-size:clamp(28px,7vw,38px);line-height:1.5;cursor:pointer;margin-top:8px;" title="' + esc(t('speakTitle')) + '">' + esc(sent.h) + '</div>' +
          '<div class="pinyin-line">' + (st.readShowPinyin ? esc(sent.p) : '') + '</div>' +
          '<div class="hint-row">' +
            '<button class="hint-btn' + (st.readShowPinyin ? ' on' : '') + '" id="btnToggleReadPinyin">' + esc(st.readShowPinyin ? t('storiesPinyinHide') : t('storiesPinyinShow')) + '</button>' +
            '<button class="hint-btn' + (st.readShowTranslation ? ' on' : '') + '" id="btnToggleReadTranslation">' + esc(st.readShowTranslation ? t('storiesTranslationHide') : t('storiesTranslationShow')) + '</button>' +
            '<button class="hint-btn" id="btnReadSpeak">' + esc(t('readBtn')) + '</button>' +
            (SpeechRec ? '<button class="hint-btn' + (tryListening ? ' on' : '') + '" id="btnTrySpeak">' + esc(tryListening ? t('tryStopBtn') : t('tryBtn')) + '</button>' : '') +
          '</div>' +
          '<div class="solution-line">' + (st.readShowTranslation ? esc(sent.e) : '') + '</div>' +
          (tryHere ? renderTryBox(st.tryResult) : '') +
          (isCurrent ? '' : '<div class="empty-note" style="padding:8px 0;">' + esc(t('storiesRatingOnlyCurrent')) + '</div>') +
          '<div class="rate-row" style="grid-template-columns:repeat(3,1fr);">' +
            '<button class="rate-btn' + (isCurrent ? '' : ' disabled') + '" style="background:' + levelToColor(4) + '" data-val="0"' + (isCurrent ? '' : ' disabled') + '>' + esc(t('storiesUnderstandNo')) + '<span class="val">+0</span></button>' +
            '<button class="rate-btn' + (isCurrent ? '' : ' disabled') + '" style="background:' + levelToColor(35) + '" data-val="1"' + (isCurrent ? '' : ' disabled') + '>' + esc(t('storiesUnderstandHalf')) + '<span class="val">+1</span></button>' +
            '<button class="rate-btn' + (isCurrent ? '' : ' disabled') + '" style="background:' + levelToColor(90) + '" data-val="2"' + (isCurrent ? '' : ' disabled') + '>' + esc(t('storiesUnderstandYes')) + '<span class="val">+2</span></button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.getElementById('btnBackToLibrary2').onclick = function(){ stopNarration(); stopTryListening(); st.tryResult = null; st.view = 'library'; renderStories(); };
    document.getElementById('btnDeleteStory').onclick = function(){
      stopNarration();
      if (!confirm(t('storiesDeleteConfirm'))) return;
      stories = stories.filter(function(s){ return s.id !== story.id; });
      saveStories(stories);
      st.view = 'library';
      renderStories();
    };
    document.getElementById('btnNarrate').onclick = function(){
      stopTryListening();
      if (narrating) {
        stopNarration();
        renderStories();
        return;
      }
      narrateStory(story, idx, function(i){
        st.readIdx = i;
        st.readShowPinyin = true;
        st.readShowTranslation = true;
        renderStories();
      }, function(){
        renderStories();
      });
      renderStories();
    };
    document.getElementById('sentHanzi').onclick = function(){ speak(sent.h); };
    document.getElementById('btnReadSpeak').onclick = function(){ stopTryListening(); speak(sent.h); };
    var btnTry = document.getElementById('btnTrySpeak');
    if (btnTry) btnTry.onclick = function(){
      // Second tap while listening: stop and use what was heard so far.
      if (tryListening && tryRec) { try { tryRec.stop(); } catch(e) {} return; }
      startTryListening(story.id, idx, sent);
    };
    document.getElementById('btnToggleReadPinyin').onclick = function(){
      st.readShowPinyin = !st.readShowPinyin;
      renderStories();
    };
    document.getElementById('btnToggleReadTranslation').onclick = function(){
      st.readShowTranslation = !st.readShowTranslation;
      renderStories();
    };
    function goToSentence(newIdx){
      stopNarration();
      stopTryListening();
      st.tryResult = null;
      st.readIdx = newIdx;
      st.readShowPinyin = false;
      st.readShowTranslation = false;
      renderStories();
    }
    var btnPrev = document.getElementById('btnPrevSent');
    if (btnPrev) btnPrev.onclick = function(){ if (idx > 0) goToSentence(idx - 1); };
    var btnNext = document.getElementById('btnNextSent');
    if (btnNext) btnNext.onclick = function(){ if (idx < story.sentences.length - 1) goToSentence(idx + 1); };
    Array.prototype.forEach.call(root.querySelectorAll('.dot'), function(dot){
      dot.onclick = function(){ goToSentence(parseInt(dot.getAttribute('data-dot-idx'), 10)); };
    });
    if (isCurrent) {
      Array.prototype.forEach.call(root.querySelectorAll('.rate-row .rate-btn'), function(btn){
        btn.onclick = function(){
          stopNarration();
          stopTryListening();
          st.tryResult = null;
          var val = parseInt(btn.getAttribute('data-val'), 10);
          var matched = matchWordsInSentence(sent.h, WORDS);
          matched.forEach(function(w){
            var p = progress[w.id] || { lvl: 0, lr: null, seen: false };
            p.lr = new Date().toISOString();
            p.lvl = Math.min((p.lvl || 0) + val, 100);
            p.seen = true;
            progress[w.id] = p;
            updatePoolCell(w.id);
          });
          saveProgress(progress);
          recordActivity();
          sentencesRead++;
          saveSentencesRead(sentencesRead);
          renderStats();
          // Reveal pinyin and translation together right away, rather than
          // requiring a separate toggle tap, so there's something to read
          // while (optionally) listening to the auto-speak.
          st.readShowPinyin = true;
          st.readShowTranslation = true;
          renderStories();
          function advance(){
            if (current + 1 >= story.sentences.length) {
              st.readFinished = true;
              story.currentIdx = story.sentences.length;
            } else {
              st.readCurrent = current + 1;
              st.readIdx = current + 1;
              st.readShowPinyin = false;
              st.readShowTranslation = false;
              story.currentIdx = current + 1;
            }
            saveStories(stories);
            renderStories();
          }
          if (settings.autoSpeak) {
            // Wait for the sentence to actually finish being read aloud
            // before moving on, instead of a fixed pause.
            speakWithVoiceAsync(sent.h).then(advance);
          } else {
            setTimeout(advance, 700);
          }
        };
      });
    }
    return;
  }
}
