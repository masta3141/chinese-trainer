// TTS: Gemini text-to-speech, WAV helpers, IndexedDB audio cache, rate limits.
"use strict";

// ---------- story audio export (Gemini TTS + Google Cloud TTS) ----------
var GEMINI_TTS_MODEL = 'gemini-3.8-flash-lite-tts';
var TTS_VOICES = [
  { id: 'Puck', gender: 'm' },
  { id: 'Charon', gender: 'm' },
  { id: 'Kore', gender: 'f' },
  { id: 'Leda', gender: 'f' },
  // "Fun" voices: same Gemini TTS mechanism, but the user picks one
  // over-the-top delivery style (see TTS_FUN_STYLES) that then narrates
  // the ENTIRE story, instead of the plain teacher-style pacing.
  { id: 'Orus', gender: 'm', fun: true },
  { id: 'Zephyr', gender: 'f', fun: true }
];
// Google Cloud TTS uses a separate, language-specific voice catalog (unlike
// Speed is simplified to two tiers. Gemini has no real speed parameter and
// only approximates it via a style description.
var TTS_SPEED_STYLES = {
  'slow': 'speaking slowly and clearly, like a teacher helping a language learner',
  'normal': 'speaking at a natural, normal conversational pace'
};
// Delivery styles for the two "fun" Gemini voices (Orus/Zephyr). The user
// picks ONE of these in the picker, and it then narrates the whole story
// consistently (stored per-recording as rec.funStyle) — applied to all 3
// parts of every sentence via speech_metadata.style, overriding the
// normal slow/normal pacing style. `label` is the short, i18n'd tag shown
// both as the picker button text and in the tiny params line under the
// progress bar; `directive` is the (untranslated, English) instruction
// sent to the Gemini API, same as the other English style strings above.
// Cloud TTS has no equivalent free-text style field, so fun styles only
// exist on the Gemini backend.
var TTS_FUN_STYLES = [
  { key: 'villain', directive: 'like an over-the-top soap-opera villain revealing a shocking plot twist' },
  { key: 'radio', directive: 'in a sultry, seductive late-night radio host voice' },
  { key: 'raspy', directive: 'in a rough, raspy just-woke-up voice' },
  { key: 'sick', directive: 'as if you have a bad head cold and a stuffy nose' },
  { key: 'whisper', directive: 'in a hushed, conspiratorial whisper, as if sharing a secret' },
  { key: 'gameshow', directive: 'like an overly enthusiastic game show host announcing the grand prize' },
  { key: 'posh', directive: 'in a posh, exaggerated aristocratic accent' },
  { key: 'sleepy', directive: 'like you are fighting to stay awake, drowsy and sleepy' },
  { key: 'robot', directive: 'like a glitchy, monotone robot slowly running out of battery' },
  { key: 'nervous', directive: 'in a nervous, stammering voice, terrified of making a mistake' },
  { key: 'trailer', directive: 'like an epic movie-trailer narrator building suspense' },
  { key: 'supervillain', directive: 'like a cartoon supervillain gloating over an evil plan' },
  { key: 'lovestruck', directive: 'in a dreamy, love-struck sigh, hopelessly infatuated' },
  { key: 'sergeant', directive: 'like a strict drill sergeant barking orders' }
];
var TTS_FUN_STYLE_DEFAULT = TTS_FUN_STYLES[0].key;
function funStyleDirective(key){
  var entry = TTS_FUN_STYLES.filter(function(f){ return f.key === key; })[0] || TTS_FUN_STYLES[0];
  return entry.directive;
}
function funStyleLabel(key){
  var entry = TTS_FUN_STYLES.filter(function(f){ return f.key === key; })[0];
  return entry ? t('funStyle_' + entry.key) : '';
}
// Older saved stories may still carry a legacy 3-tier speed key ('0.5'/'0.75'/'1');
// map those onto the current 2-tier scheme so resuming them keeps working.
function normalizeSpeedKey(sp){
  if (sp === 'slow' || sp === 'normal') return sp;
  if (sp === '1') return 'normal';
  return 'slow'; // '0.5', '0.75', or unset
}
// Quota pacing: exactly one TTS generation (title or sentence) is allowed at
// a time, then a mandatory TTS_BATCH_PAUSE_MS pause before the next one —
// comfortably under Gemini's real per-minute quota (no more back-to-back
// bursts). This pause is UNCONDITIONAL — it applies no matter what the
// "quota enabled" setting says, because Gemini enforces its own per-minute
// limit regardless of any setting in this app. TTS_MAX_PER_DAY is a
// separate, optional rolling-24h cap that the "quota enabled" setting does
// control (see checkTtsRateLimit / loadTtsQuotaEnabled).
var TTS_BATCH_SIZE = 1;
var TTS_BATCH_PAUSE_MS = 7 * 1000; // 7 seconds between every single generation call, always enforced
var TTS_MAX_PER_DAY = 8; // rolling 24h window, not a midnight reset — optional, tied to the setting
var TTS_LOG_KEY = 'hskflash_tts_call_log_v1';
var TTS_BATCH_KEY = 'hskflash_tts_batch_v1';
var TTS_QUOTA_ENABLED_KEY = 'hskflash_tts_quota_enabled_v1';
function loadTtsBatchState(){
  try {
    var v = JSON.parse(localStorage.getItem(TTS_BATCH_KEY));
    if (v && typeof v.count === 'number' && typeof v.windowStart === 'number') return v;
  } catch(e) {}
  return { count: 0, windowStart: 0 };
}
function saveTtsBatchState(st){
  try { localStorage.setItem(TTS_BATCH_KEY, JSON.stringify(st)); } catch(e) {}
}
function loadTtsQuotaEnabled(){
  try {
    var raw = localStorage.getItem(TTS_QUOTA_ENABLED_KEY);
    return raw === null ? true : raw === '1';
  } catch(e) { return true; }
}
function saveTtsQuotaEnabled(v){
  try { localStorage.setItem(TTS_QUOTA_ENABLED_KEY, v ? '1' : '0'); } catch(e) {}
}

function base64ToBytes(b64){
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Parses a RIFF/WAVE file returned by the TTS API into its format info + raw PCM bytes.
function parseWav(bytes){
  var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var pos = 12; // skip "RIFF"(4) + size(4) + "WAVE"(4)
  var fmt = { channels: 1, sampleRate: 24000, bitsPerSample: 16 };
  var dataBytes = null;
  while (pos + 8 <= bytes.length) {
    var id = String.fromCharCode(bytes[pos], bytes[pos+1], bytes[pos+2], bytes[pos+3]);
    var size = dv.getUint32(pos + 4, true);
    var body = pos + 8;
    if (id === 'fmt ') {
      fmt.channels = dv.getUint16(body + 2, true);
      fmt.sampleRate = dv.getUint32(body + 4, true);
      fmt.bitsPerSample = dv.getUint16(body + 14, true);
    } else if (id === 'data') {
      dataBytes = bytes.subarray(body, body + size);
    }
    pos = body + size + (size % 2); // chunks are word-aligned
  }
  return { fmt: fmt, pcm: dataBytes || new Uint8Array(0) };
}

var STORY_SENTENCE_GAP_MS = 2000; // pause between sentences in the downloaded story audio

function silencePcm(ms, fmt){
  var bytesPerSample = fmt.bitsPerSample / 8;
  var numSamples = Math.round(fmt.sampleRate * (ms / 1000));
  return new Uint8Array(numSamples * fmt.channels * bytesPerSample);
}

function buildWavBlob(pcmChunks, fmt){
  var totalLen = pcmChunks.reduce(function(sum, c){ return sum + c.length; }, 0);
  var buffer = new ArrayBuffer(44 + totalLen);
  var dv = new DataView(buffer);
  var byteRate = fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8);
  var blockAlign = fmt.channels * (fmt.bitsPerSample / 8);
  function writeStr(offset, str){ for (var i = 0; i < str.length; i++) dv.setUint8(offset + i, str.charCodeAt(i)); }
  writeStr(0, 'RIFF');
  dv.setUint32(4, 36 + totalLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, fmt.channels, true);
  dv.setUint32(24, fmt.sampleRate, true);
  dv.setUint32(28, byteRate, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, fmt.bitsPerSample, true);
  writeStr(36, 'data');
  dv.setUint32(40, totalLen, true);
  var out = new Uint8Array(buffer);
  var offset = 44;
  pcmChunks.forEach(function(chunk){ out.set(chunk, offset); offset += chunk.length; });
  return new Blob([out], { type: 'audio/wav' });
}

// ---- IndexedDB: persistent store for per-sentence audio (can grow to several
// MB across a story generated over many days — too big for localStorage) ----
var AUDIO_DB_NAME = 'hskflash_audio_db';
var AUDIO_STORE = 'sentenceAudio';
var audioDbPromise = null;
function openAudioDB(){
  if (audioDbPromise) return audioDbPromise;
  audioDbPromise = new Promise(function(resolve, reject){
    if (!('indexedDB' in window)) { reject(new Error('no-indexeddb')); return; }
    var req = indexedDB.open(AUDIO_DB_NAME, 1);
    req.onupgradeneeded = function(e){
      var db = e.target.result;
      if (!db.objectStoreNames.contains(AUDIO_STORE)) db.createObjectStore(AUDIO_STORE);
    };
    req.onsuccess = function(e){ resolve(e.target.result); };
    req.onerror = function(){ reject(req.error); };
  });
  return audioDbPromise;
}
function idbGet(key){
  return openAudioDB().then(function(db){
    return new Promise(function(resolve, reject){
      var req = db.transaction(AUDIO_STORE, 'readonly').objectStore(AUDIO_STORE).get(key);
      req.onsuccess = function(){ resolve(req.result || null); };
      req.onerror = function(){ reject(req.error); };
    });
  });
}
function idbSet(key, value){
  return openAudioDB().then(function(db){
    return new Promise(function(resolve, reject){
      var tx = db.transaction(AUDIO_STORE, 'readwrite');
      tx.objectStore(AUDIO_STORE).put(value, key);
      tx.oncomplete = function(){ resolve(); };
      tx.onerror = function(){ reject(tx.error); };
    });
  });
}
function idbDeletePrefix(prefix){
  return openAudioDB().then(function(db){
    return new Promise(function(resolve, reject){
      var tx = db.transaction(AUDIO_STORE, 'readwrite');
      var store = tx.objectStore(AUDIO_STORE);
      var req = store.openCursor();
      req.onsuccess = function(e){
        var cursor = e.target.result;
        if (!cursor) return;
        if (String(cursor.key).indexOf(prefix) === 0) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = function(){ resolve(); };
      tx.onerror = function(){ reject(tx.error); };
    });
  });
}

// ---- Rate limiter: a mandatory TTS_BATCH_PAUSE_MS pause after every single
// call, plus a max of TTS_MAX_PER_DAY calls per rolling 24h window — shared
// globally across all stories/recordings since it tracks the same API key. ----
function loadTtsLog(){
  try { return JSON.parse(localStorage.getItem(TTS_LOG_KEY)) || []; } catch(e) { return []; }
}
function saveTtsLog(log){
  try { localStorage.setItem(TTS_LOG_KEY, JSON.stringify(log)); } catch(e) {}
}
function pruneTtsLog(log){
  var cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return log.filter(function(ts){ return ts > cutoff; });
}
function recordTtsCall(){
  var log = pruneTtsLog(loadTtsLog());
  log.push(Date.now());
  saveTtsLog(log);
  // The pacing window is tracked unconditionally — it always starts a
  // fresh TTS_BATCH_PAUSE_MS window after every single call, regardless of
  // the optional "quota enabled" setting (that setting only affects the
  // TTS_MAX_PER_DAY check below in checkTtsRateLimit).
  saveTtsBatchState({ count: 1, windowStart: Date.now() });
}
// Returns { canProceed:true } | { canProceed:false, dailyLimitReached:true, nextSlotAt } | { canProceed:false, waitMs }
function checkTtsRateLimit(){
  // Optional daily cap — only enforced when the user has turned it on.
  if (loadTtsQuotaEnabled()) {
    var log = pruneTtsLog(loadTtsLog());
    saveTtsLog(log);
    if (log.length >= TTS_MAX_PER_DAY) {
      var oldest = Math.min.apply(null, log);
      return { canProceed: false, dailyLimitReached: true, nextSlotAt: oldest + 24 * 60 * 60 * 1000 };
    }
  }
  // Mandatory per-call pacing — always enforced, independent of the setting
  // above, because Gemini's own per-minute limit applies either way.
  var batch = loadTtsBatchState();
  var now = Date.now();
  if (now - batch.windowStart >= TTS_BATCH_PAUSE_MS) return { canProceed: true }; // pause window elapsed (or no call yet)
  return { canProceed: false, dailyLimitReached: false, waitMs: Math.max(500, (batch.windowStart + TTS_BATCH_PAUSE_MS) - now) };
}

// Shared low-level Gemini TTS call: sends an arbitrary list of
// {text, speech_metadata} parts in one request and returns the parsed WAV
// (fmt + pcm) of the single continuous audio response covering all parts
// in order. Both per-sentence narration and the English title clip use this.
function callGeminiTTSParts(parts, voiceId){
  var apiKey = loadGeminiKey();
  if (!apiKey) return Promise.reject(new Error('no-key'));
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(GEMINI_TTS_MODEL) + ':generateContent?key=' + encodeURIComponent(apiKey);
  var payload = {
    contents: [{ role: 'user', parts: parts }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { voice: voiceId || 'Kore' } }
    }
  };
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(res){
    if (!res.ok) return res.text().then(function(t){ throw new Error('HTTP ' + res.status + ': ' + t); });
    return res.json();
  }).then(function(data){
    var b64 = data.candidates[0].content.parts[0].inlineData.data;
    return parseWav(base64ToBytes(b64));
  });
}

// One Gemini TTS call per sentence: 3 parts (slow Chinese, English, slow Chinese
// again), each with its own speech_metadata.style — the model returns one
// continuous WAV covering all three in order.
function callSentenceTTS(sent, voiceId, speedKey, funStyleKey){
  var voiceEntry = TTS_VOICES.filter(function(v){ return v.id === voiceId; })[0];
  var isFun = !!(voiceEntry && voiceEntry.fun);
  // Fun voices ignore the normal slow/normal pacing style and instead use
  // the one style the user picked for this story (falling back to the
  // first style for older stories saved before this was selectable),
  // applied to all 3 parts (both Chinese repetitions and the English
  // translation) so the whole story keeps one consistent "character".
  var slowStyle = isFun ? ('speaking ' + funStyleDirective(funStyleKey || TTS_FUN_STYLE_DEFAULT)) : TTS_SPEED_STYLES[normalizeSpeedKey(speedKey)];
  var enStyle = isFun ? slowStyle : 'natural conversational pace';
  return callGeminiTTSParts([
    { text: sent.h, speech_metadata: { style: slowStyle } },
    { text: sent.e, speech_metadata: { style: enStyle } },
    { text: sent.h, speech_metadata: { style: slowStyle } }
  ], voiceId);
}

// Single-part call that reads just the story's English title aloud — used
// to prefix every narrated recording with a spoken title before the
// sentences begin.
function callTitleTTS(titleEn, voiceId, speedKey, funStyleKey){
  var voiceEntry = TTS_VOICES.filter(function(v){ return v.id === voiceId; })[0];
  var isFun = !!(voiceEntry && voiceEntry.fun);
  var style = isFun ? ('speaking ' + funStyleDirective(funStyleKey || TTS_FUN_STYLE_DEFAULT)) : TTS_SPEED_STYLES[normalizeSpeedKey(speedKey)];
  return callGeminiTTSParts([
    { text: titleEn, speech_metadata: { style: style } }
  ], voiceId);
}


// Per-story narration state now lives entirely in the recordings module
// below (findNextMissingRecordingStep / startOrResumeRecordingAudio) —
// every 🔊 click creates and drives its own recording rather than a single
// per-story generation loop.

// Transient (non-persisted) per-story UI status: blocked-until time or last
// error, shown under the progress row. Cleared on the next successful step.
var audioStatus = {};

// Cloud TTS voice ids are long/technical (cmn-CN-Chirp3-HD-Puck); shows the
// short persona name where we have one, falling back to the raw id (older
// saved stories may still carry a pre-Chirp3 Wavenet voice id).
function voiceDisplayLabel(voiceId){
  var entry = TTS_VOICES.filter(function(v){ return v.id === voiceId; })[0];
  return entry && entry.label ? entry.label : voiceId;
}

function buildAudioPickerHtml(s){
  var choice = storiesState.pickerChoice || { voice: null, speed: 'slow', funStyle: null };
  var voiceList = TTS_VOICES;
  var voiceOpts = voiceList.map(function(v){
    var label = (v.fun ? '🎭 ' : '') + (v.label || v.id) + ' (' + t(v.gender === 'm' ? 'audioVoiceMale' : 'audioVoiceFemale') + ')';
    return '<button class="audio-opt' + (choice.voice === v.id ? ' selected' : '') + '" data-pick-voice="' + v.id + '">' + esc(label) + '</button>';
  }).join('');
  var selectedVoiceEntry = voiceList.filter(function(v){ return v.id === choice.voice; })[0];
  var isFunChoice = !!(selectedVoiceEntry && selectedVoiceEntry.fun);
  var funStyleOpts = TTS_FUN_STYLES.map(function(f){
    return '<button class="audio-opt' + (choice.funStyle === f.key ? ' selected' : '') + '" data-pick-fun-style="' + f.key + '">' + esc(funStyleLabel(f.key)) + '</button>';
  }).join('');
  var speedOpts = ['slow', 'normal'].map(function(sp){
    return '<button class="audio-opt' + (choice.speed === sp ? ' selected' : '') + '" data-pick-speed="' + sp + '">' + esc(t(sp === 'slow' ? 'audioSpeedSlow' : 'audioSpeedNormal')) + '</button>';
  }).join('');
  return '<div class="audio-picker" data-picker-id="' + s.id + '">' +
    '<div class="audio-picker-label">' + esc(t('audioPickVoice')) + '</div>' +
    '<div class="audio-picker-row">' + voiceOpts + '</div>' +
    (isFunChoice ?
      '<p class="drawer-note" style="margin:4px 0 8px;">' + esc(t('audioFunVoiceNote')) + '</p>' +
      '<div class="audio-picker-label">' + esc(t('audioPickFunStyle')) + '</div>' +
      '<div class="audio-picker-row">' + funStyleOpts + '</div>'
      : '') +
    '<div class="audio-picker-label">' + esc(t('audioPickSpeed')) + '</div>' +
    '<div class="audio-picker-row">' + speedOpts + '</div>' +
    '<div class="audio-picker-actions">' +
      '<button class="btn-primary" data-audio-start="' + s.id + '"' + ((choice.voice && (!isFunChoice || choice.funStyle)) ? '' : ' disabled') + ' style="flex:1;padding:9px;font-size:13px;">' + esc(t('audioStartBtn')) + '</button>' +
      '<button class="hint-btn" data-audio-cancel-picker="' + s.id + '">' + esc(t('audioCancelBtn')) + '</button>' +
    '</div>' +
  '</div>';
}

// Resolves the Gemini API key needed to start/resume a recording's audio.
function ensureGeminiKey(){
  var apiKey = loadGeminiKey();
  if (!apiKey) return Promise.reject(new Error('no-key'));
  return Promise.resolve(apiKey);
}

function reportAudioAuthError(s, err){
  var msg = err && err.message;
  if (msg === 'no-key') {
    openDrawer();
    var f = document.getElementById('inpGeminiKey');
    if (f) f.focus();
    return;
  }
  audioStatus[s.id] = { error: msg || 'error' };
  renderStories();
}

function wireAudioRowHandlers(root, stories){
  Array.prototype.forEach.call(root.querySelectorAll('[data-audio-open-picker]'), function(btn){
    btn.onclick = function(e){
      e.stopPropagation();
      storiesState.audioPickerFor = btn.getAttribute('data-audio-open-picker');
      storiesState.pickerChoice = { voice: null, speed: 'slow', funStyle: null };
      renderStories();
    };
  });
  Array.prototype.forEach.call(root.querySelectorAll('[data-audio-cancel-picker]'), function(btn){
    btn.onclick = function(e){
      e.stopPropagation();
      storiesState.audioPickerFor = null;
      renderStories();
    };
  });
  Array.prototype.forEach.call(root.querySelectorAll('[data-pick-voice]'), function(btn){
    btn.onclick = function(e){
      e.stopPropagation();
      storiesState.pickerChoice = storiesState.pickerChoice || { voice: null, speed: 'slow', funStyle: null };
      var newVoiceId = btn.getAttribute('data-pick-voice');
      storiesState.pickerChoice.voice = newVoiceId;
      // Switching to a non-fun voice clears any previously chosen fun
      // style so a stale style can't silently carry over to Start.
      var entry = TTS_VOICES.filter(function(v){ return v.id === newVoiceId; })[0];
      if (!entry || !entry.fun) storiesState.pickerChoice.funStyle = null;
      renderStories();
    };
  });
  Array.prototype.forEach.call(root.querySelectorAll('[data-pick-fun-style]'), function(btn){
    btn.onclick = function(e){
      e.stopPropagation();
      storiesState.pickerChoice = storiesState.pickerChoice || { voice: null, speed: 'slow', funStyle: null };
      storiesState.pickerChoice.funStyle = btn.getAttribute('data-pick-fun-style');
      renderStories();
    };
  });
  Array.prototype.forEach.call(root.querySelectorAll('[data-pick-speed]'), function(btn){
    btn.onclick = function(e){
      e.stopPropagation();
      storiesState.pickerChoice = storiesState.pickerChoice || { voice: null, speed: 'slow', funStyle: null };
      storiesState.pickerChoice.speed = btn.getAttribute('data-pick-speed');
      renderStories();
    };
  });
  // Starting narration creates a brand-new, independent recording (rather
  // than mutating the story) so the same story can be narrated again later
  // with a different voice/speed without losing the earlier version — all
  // generated recordings are listed and managed in the Audio tab.
  Array.prototype.forEach.call(root.querySelectorAll('[data-audio-start]'), function(btn){
    btn.onclick = function(e){
      e.stopPropagation();
      var id = btn.getAttribute('data-audio-start');
      var s = stories.filter(function(x){ return x.id === id; })[0];
      var choice = storiesState.pickerChoice;
      if (!s || !choice || !choice.voice) return;
      var voiceEntry = TTS_VOICES.filter(function(v){ return v.id === choice.voice; })[0];
      var isFunChoice = !!(voiceEntry && voiceEntry.fun);
      if (isFunChoice && !choice.funStyle) return; // a style must be picked for fun voices
      storiesState.audioPickerFor = null;
      // Must call ensureGeminiKey() synchronously right here (inside the
      // click handler) for consistency with the pattern used elsewhere,
      // even though the Gemini key path never needs a popup.
      ensureGeminiKey().then(function(){
        var rec = createRecording(s, choice.voice, choice.speed, isFunChoice ? choice.funStyle : null);
        storiesState.activeRecordingFor = storiesState.activeRecordingFor || {};
        storiesState.activeRecordingFor[s.id] = rec.id;
        delete recordingStatus[rec.id];
        renderStories();
        startOrResumeRecordingAudio(rec, makeRecordingCallbacks(rec));
      }).catch(function(err){
        reportAudioAuthError(s, err);
      });
    };
  });
  Array.prototype.forEach.call(root.querySelectorAll('[data-audio-cancel]'), function(btn){
    btn.onclick = function(e){
      e.stopPropagation();
      cancelRecordingAudio(btn.getAttribute('data-audio-cancel'));
      renderStories();
    };
  });
  // Shown in place of the hourglass whenever the last attempt failed —
  // lets the person just tap ▶ to pick up right where it left off,
  // instead of having to switch to the Audio tab.
  Array.prototype.forEach.call(root.querySelectorAll('[data-audio-resume]'), function(btn){
    btn.onclick = function(e){
      e.stopPropagation();
      var id = btn.getAttribute('data-audio-resume');
      var rec = recordings.filter(function(r){ return r.id === id; })[0];
      if (!rec) return;
      delete recordingStatus[rec.id];
      renderStories();
      startOrResumeRecordingAudio(rec, makeRecordingCallbacks(rec));
    };
  });
}
