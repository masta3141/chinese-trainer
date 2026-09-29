// Speech: browser TTS voices, read aloud, story narration, speech recognition.
"use strict";

// ---------- speech ----------
var speechOn = settings.speak;
var cachedVoices = [];
function refreshVoices(){
  try { cachedVoices = ('speechSynthesis' in window) ? window.speechSynthesis.getVoices() : []; } catch(e) { cachedVoices = []; }
}
refreshVoices();
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = function(){
    refreshVoices();
    if (drawer && drawer.classList.contains('show')) buildVoiceSelect();
  };
}

function chineseVoices(){
  return cachedVoices.filter(function(v){ return v.lang && v.lang.toLowerCase().indexOf('zh') === 0; });
}

function findVoiceByName(name){
  if (!name) return null;
  var match = cachedVoices.filter(function(v){ return v.name === name; });
  return match.length ? match[0] : null;
}

// Same as speakWithVoice, but resolves once the utterance actually finishes —
// used by the story reader so it can wait for the auto-speak to end before
// advancing to the next sentence, instead of a fixed timeout.
function speakWithVoiceAsync(text){
  return new Promise(function(resolve){
    if (!text || !('speechSynthesis' in window)) { resolve(); return; }
    try {
      window.speechSynthesis.cancel();
      var voice = findVoiceByName(settings.voiceName);
      var u = new SpeechSynthesisUtterance(text);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else { u.lang = 'zh-CN'; }
      u.rate = 0.85;
      u.onend = function(){ resolve(); };
      u.onerror = function(){ resolve(); };
      window.speechSynthesis.speak(u);
    } catch(e) { resolve(); }
  });
}

function speakWithVoice(text, voice){
  if (!text || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    } else {
      u.lang = 'zh-CN';
    }
    u.rate = 0.85;
    window.speechSynthesis.speak(u);
  } catch(e) {}
}

function speak(text){
  if (!speechOn || !text) return;
  speakWithVoice(text, findVoiceByName(settings.voiceName));
}

// ---------- story narration (Chinese slow → English → Chinese slow, per sentence) ----------
var narrating = false;
var narrationToken = 0;

function speakAsync(text, lang, rate, voice){
  return new Promise(function(resolve){
    if (!text || !('speechSynthesis' in window)) { resolve(); return; }
    try {
      var u = new SpeechSynthesisUtterance(text);
      if (voice && lang === 'zh-CN') { u.voice = voice; u.lang = voice.lang; }
      else { u.lang = lang; }
      u.rate = rate;
      u.onend = function(){ resolve(); };
      u.onerror = function(){ resolve(); };
      window.speechSynthesis.speak(u);
    } catch(e) { resolve(); }
  });
}
function narrationSleep(ms){
  return new Promise(function(resolve){ setTimeout(resolve, ms); });
}
function stopNarration(){
  narrationToken++;
  narrating = false;
  try { window.speechSynthesis.cancel(); } catch(e) {}
}
function narrateSentences(sentences, startIdx, onStep, onDone){
  narrating = true;
  var myToken = ++narrationToken;
  var zhVoice = findVoiceByName(settings.voiceName);

  function step(i){
    if (!narrating || myToken !== narrationToken) return;
    if (i >= sentences.length) { narrating = false; onDone(); return; }
    onStep(i);
    var sent = sentences[i];
    function alive(){ return myToken === narrationToken; }
    speakAsync(sent.h, 'zh-CN', 0.6, zhVoice)
      .then(function(){ if (!alive()) return Promise.reject('stopped'); return narrationSleep(280); })
      .then(function(){ if (!alive()) return Promise.reject('stopped'); return speakAsync(sent.e, 'en-US', 1.0); })
      .then(function(){ if (!alive()) return Promise.reject('stopped'); return narrationSleep(280); })
      .then(function(){ if (!alive()) return Promise.reject('stopped'); return speakAsync(sent.h, 'zh-CN', 0.6, zhVoice); })
      .then(function(){ if (!alive()) return Promise.reject('stopped'); return narrationSleep(1100); })
      .then(function(){ if (!alive()) return Promise.reject('stopped'); step(i + 1); })
      .catch(function(){ /* narration was stopped mid-sentence — do nothing further */ });
  }
  step(startIdx);
}
function narrateStory(story, startIdx, onStep, onDone){
  return narrateSentences(story.sentences, startIdx, onStep, onDone);
}

// ---------- speech recognition ("Selbst versuchen" in story sentences) ----------
// Just for fun, no scoring: the user speaks the sentence, the browser's
// speech recognition (Chrome/Edge → Google, Safari → Apple; not in Firefox)
// transcribes it, and Gemini adds pinyin + translation to whatever was heard.
var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
var tryRec = null;

function normalizeHanzi(text){
  return String(text || '').replace(/[\s，。！？、,.!?；;：:“”"'‘’（）()…—\-]/g, '');
}

function buildAnnotateTranscriptPrompt(hanzi){
  return "You are a precise linguistic API for a Mandarin learning app.\n" +
    "TASK: The following Mandarin text was produced by speech recognition of a learner. Add pinyin (with tone marks) and an English translation.\n" +
    "TEXT: \"" + hanzi + "\"\n" +
    "Do NOT correct or change the text, even if it seems wrong or nonsensical — translate literally what is there. You may add Chinese punctuation.\n" +
    "STRICT OUTPUT RULES:\n" +
    "1. Output MUST contain exactly 1 line. Nothing else.\n" +
    "2. Format: HANZI|PINYIN|ENGLISH\n" +
    "3. No introduction, no markdown fences, no numbering, no explanatory text.";
}

function annotateTranscript(hanzi){
  var apiKey = loadGeminiKey();
  if (!apiKey) return Promise.reject(new Error('no-key'));
  var model = loadGeminiModel();
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
  var payload = { contents: [{ parts: [{ text: buildAnnotateTranscriptPrompt(hanzi) }] }] };

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(res){
    if (!res.ok) return res.text().then(function(t){ throw new Error('HTTP ' + res.status + ': ' + t); });
    return res.json();
  }).then(function(data){
    var parsed = parseGeminiResponse(data.candidates[0].content.parts[0].text);
    if (!parsed.length) throw new Error('Antwort konnte nicht gelesen werden.');
    return parsed[0];
  });
}

function stopTryListening(){
  if (!tryRec) return;
  var rec = tryRec;
  tryRec = null;
  try { rec.abort(); } catch(e) {}
  var tr = storiesState.tryResult;
  if (tr && tr.status === 'listening') storiesState.tryResult = null;
}

// result object lives in storiesState.tryResult and is only shown while the
// same story sentence is open: {storyId, idx, status, h, p, e, msg}
function startTryListening(storyId, idx, target){
  stopTryListening();
  stopNarration();
  var st = storiesState;
  var tr = { storyId: storyId, idx: idx, status: 'listening', h: '', p: '', e: '', msg: '' };
  st.tryResult = tr;

  var rec = new SpeechRec();
  rec.lang = 'zh-CN';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  tryRec = rec;
  var finalText = '';
  var failed = false;

  rec.onresult = function(e){
    var interim = '';
    finalText = '';
    for (var i = 0; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    tr.h = finalText + interim;
    var el = document.getElementById('tryHeard');
    if (el) el.textContent = tr.h;
  };
  rec.onerror = function(e){
    if (tryRec !== rec) return;
    failed = true;
    tr.status = 'error';
    tr.msg = e.error === 'no-speech' ? t('tryNoSpeech')
      : (e.error === 'not-allowed' || e.error === 'service-not-allowed') ? t('tryMicDenied')
      : tf('tryError', e.error);
  };
  rec.onend = function(){
    if (tryRec !== rec) return;
    tryRec = null;
    if (st.tryResult !== tr) return;
    var heard = (finalText || tr.h).trim();
    if (!failed && !heard) { tr.status = 'error'; tr.msg = t('tryNoSpeech'); }
    if (tr.status === 'error') { renderStories(); return; }
    tr.h = heard;
    // Spoken exactly right → reuse the story's own pinyin/translation, no API call.
    if (normalizeHanzi(heard) === normalizeHanzi(target.h)) {
      tr.h = target.h; tr.p = target.p; tr.e = target.e;
      tr.status = 'done';
      renderStories();
      return;
    }
    tr.status = 'processing';
    renderStories();
    annotateTranscript(heard).then(function(r){
      if (st.tryResult !== tr) return;
      tr.h = r.h; tr.p = r.p; tr.e = r.e;
      tr.status = 'done';
      renderStories();
    }).catch(function(err){
      if (st.tryResult !== tr) return;
      tr.status = 'done';
      tr.msg = err.message === 'no-key' ? t('tryNoKey') : t('errorPrefix') + err.message;
      renderStories();
    });
  };

  try { rec.start(); } catch(e) {
    tryRec = null;
    tr.status = 'error';
    tr.msg = tf('tryError', e.message);
  }
  renderStories();
}

function renderTryBox(tr){
  if (tr.status === 'listening') {
    return '<div class="try-box"><div class="try-label">' + esc(t('tryListening')) + '</div>' +
      '<div class="try-h" id="tryHeard">' + esc(tr.h) + '</div></div>';
  }
  if (tr.status === 'error') {
    return '<div class="try-box"><div class="try-msg">' + esc(tr.msg) + '</div></div>';
  }
  return '<div class="try-box"><div class="try-label">' + esc(t('tryHeardLabel')) + '</div>' +
    '<div class="try-h">' + esc(tr.h) + '</div>' +
    (tr.status === 'processing' ? '<div class="try-msg">' + esc(t('tryProcessing')) + '</div>' : '') +
    (tr.p ? '<div class="try-p">' + esc(tr.p) + '</div>' : '') +
    (tr.e ? '<div class="try-e">' + esc(tr.e) + '</div>' : '') +
    (tr.msg ? '<div class="try-msg">' + esc(tr.msg) + '</div>' : '') +
  '</div>';
}
