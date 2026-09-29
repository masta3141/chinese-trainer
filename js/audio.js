// Audio tab: narration recordings, MP3/WAV export and playback.
"use strict";

// ---------- Audio tab: independently-kept narration recordings ----------
// Each time a story is narrated (🔊 in the Geschichten tab), a new, fully
// self-contained "recording" entry is created here — decoupled from the
// live `stories` array so the same story can be narrated multiple times
// (different voice/speed/style) with every generation kept as its own
// entry, and so a recording keeps working even if the source story is
// later edited or deleted. IndexedDB audio bytes live under
// `recording.id + ':title'` (the spoken English title) and
// `recording.id + ':' + sentenceIndex`, parallel to (and reusing) the
// existing idbGet/idbSet/idbDeletePrefix helpers.
var AUDIO_RECORDINGS_KEY = 'hskflash_audio_recordings_v1';
function loadRecordings(){
  try { return JSON.parse(localStorage.getItem(AUDIO_RECORDINGS_KEY)) || []; } catch(e) { return []; }
}
function saveRecordings(list){
  try { localStorage.setItem(AUDIO_RECORDINGS_KEY, JSON.stringify(list)); } catch(e) {}
}
var recordings = loadRecordings();

function newRecordingId(){
  return 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// Creates a new, independent recording entry for a story (snapshotting its
// title + sentence text so the recording survives story edits/deletion),
// and persists it. Does not start generation — call
// startOrResumeRecordingAudio() for that.
function createRecording(story, voiceId, speedKey, funStyleKey){
  var rec = {
    id: newRecordingId(),
    storyId: story.id,
    titleH: story.title.h,
    titleE: story.title.e,
    hsk: story.hsk,
    sentences: story.sentences.map(function(s){ return { h: s.h, e: s.e }; }),
    voiceId: voiceId,
    speed: speedKey,
    funStyle: funStyleKey || null,
    createdAt: Date.now(),
    done: 0, // number of completed steps (0 = title, 1..N = sentences)
    totalSteps: 1 + story.sentences.length
  };
  recordings.push(rec);
  saveRecordings(recordings);
  return rec;
}

// Migrates the OLD single-recording-per-story audio fields (s.audioVoice /
// s.audioSpeed / s.audioFunStyle / s.audioDone) — from before the Audio tab
// existed — into a recording entry, reusing the story's id as the
// recording id so its already-generated sentence audio (stored under
// `story.id + ':' + idx` in IndexedDB) is found unchanged. The English
// title clip didn't exist yet under the old scheme, so it's simply missing
// and gets generated (or backfilled) the next time this recording resumes.
// The legacy fields are stripped from the story afterwards so this runs only
// once — otherwise deleting the migrated recording would bring it back on
// the next load.
function migrateLegacyStoryAudio(){
  var changed = false, storiesChanged = false;
  stories.forEach(function(s){
    if (!s.audioVoice) return;
    var alreadyMigrated = recordings.some(function(r){ return r.id === s.id; });
    var legacy = { voice: s.audioVoice, speed: s.audioSpeed, funStyle: s.audioFunStyle, done: s.audioDone };
    delete s.audioVoice; delete s.audioSpeed; delete s.audioFunStyle; delete s.audioDone;
    storiesChanged = true;
    if (alreadyMigrated) return;
    recordings.push({
      id: s.id,
      storyId: s.id,
      titleH: s.title.h,
      titleE: s.title.e,
      hsk: s.hsk,
      sentences: s.sentences.map(function(x){ return { h: x.h, e: x.e }; }),
      voiceId: legacy.voice,
      speed: legacy.speed,
      funStyle: legacy.funStyle || null,
      createdAt: Date.now(),
      done: legacy.done || 0,
      totalSteps: 1 + s.sentences.length
    });
    changed = true;
  });
  if (changed) saveRecordings(recordings);
  if (storiesChanged) saveStories(stories);
}
migrateLegacyStoryAudio();

// Resolves the next missing IndexedDB step for a recording: the title clip
// first (step 0), then each sentence in order (step 1..N).
function findNextMissingRecordingStep(rec){
  return idbGet(rec.id + ':title').then(function(titleVal){
    if (!titleVal) return 0;
    var i = 0;
    function check(){
      if (i >= rec.sentences.length) return -1;
      return idbGet(rec.id + ':' + i).then(function(val){
        if (!val) return i + 1;
        i++;
        return check();
      });
    }
    return check();
  });
}

var recordingGenActive = {}; // recordingId -> true while a generation loop is running
function isRecordingAudioActive(id){ return !!recordingGenActive[id]; }

function startOrResumeRecordingAudio(rec, callbacks){
  if (recordingGenActive[rec.id]) return;
  recordingGenActive[rec.id] = true;

  function loop(){
    if (!recordingGenActive[rec.id]) return; // was cancelled
    findNextMissingRecordingStep(rec).then(function(step){
      if (step === -1) {
        recordingGenActive[rec.id] = false;
        callbacks.onDone();
        return;
      }
      var rl = checkTtsRateLimit();
      if (!rl.canProceed) {
        if (rl.dailyLimitReached) {
          recordingGenActive[rec.id] = false;
          callbacks.onBlocked(rl.nextSlotAt);
        } else {
          callbacks.onWaiting(rl.waitMs);
          setTimeout(loop, rl.waitMs);
        }
        return;
      }
      recordTtsCall();
      var call = step === 0
        ? callTitleTTS(rec.titleE, rec.voiceId, rec.speed, rec.funStyle).then(function(result){ return idbSet(rec.id + ':title', result); })
        : callSentenceTTS(rec.sentences[step - 1], rec.voiceId, rec.speed, rec.funStyle).then(function(result){ return idbSet(rec.id + ':' + (step - 1), result); });
      call.then(function(){
        callbacks.onProgress(step + 1, rec.totalSteps);
        setTimeout(loop, 300);
      }).catch(function(err){
        recordingGenActive[rec.id] = false;
        callbacks.onError(err);
      });
    });
  }
  loop();
}
function cancelRecordingAudio(id){
  recordingGenActive[id] = false;
}

// Transient (non-persisted) per-recording UI status, mirroring audioStatus.
var recordingStatus = {};

function makeRecordingCallbacks(rec){
  return {
    onProgress: function(current, total){
      rec.done = current;
      saveRecordings(recordings);
      delete recordingStatus[rec.id];
      safeRenderAudioTab();
      safeRenderStories();
    },
    onDone: function(){
      delete recordingStatus[rec.id];
      safeRenderAudioTab();
      safeRenderStories();
    },
    onBlocked: function(nextSlotAt){
      recordingStatus[rec.id] = { blockedUntil: nextSlotAt };
      safeRenderAudioTab();
      safeRenderStories();
    },
    onWaiting: function(){
      safeRenderAudioTab();
      safeRenderStories();
    },
    onError: function(err){
      recordingStatus[rec.id] = { error: err.message };
      safeRenderAudioTab();
      safeRenderStories();
    }
  };
}

// Builds a full WAV Blob for a recording (title clip + gap + each sentence,
// gapped) from whatever has been generated so far — works with a partially
// completed recording, same contiguous-prefix approach as downloadStoryAudio.
// Gathers the raw PCM chunks (title clip + gapped sentences) for a
// recording — the shared groundwork behind both the WAV blob used for
// playback and the MP3 blob used for downloads.
function collectRecordingPcm(rec){
  var chunks = [];
  var fmt = { channels: 1, sampleRate: 24000, bitsPerSample: 16 };
  return idbGet(rec.id + ':title').then(function(titleVal){
    if (!titleVal) throw new Error('nothing generated yet');
    fmt = titleVal.fmt;
    chunks.push(titleVal.pcm);
    var i = 0;
    function next(){
      if (i >= rec.sentences.length) return Promise.resolve();
      return idbGet(rec.id + ':' + i).then(function(val){
        if (!val) return; // stop at first missing sentence
        chunks.push(silencePcm(STORY_SENTENCE_GAP_MS, fmt));
        fmt = val.fmt;
        chunks.push(val.pcm);
        i++;
        return next();
      });
    }
    return next();
  }).then(function(){
    return { chunks: chunks, fmt: fmt };
  });
}

function buildRecordingAudioBlob(rec){
  return collectRecordingPcm(rec).then(function(res){
    return buildWavBlob(res.chunks, res.fmt);
  });
}

// Reads a little-endian 16-bit PCM byte buffer into an Int16Array, the
// sample format lamejs expects.
function pcmBytesToInt16Array(pcmBytes){
  var n = Math.floor(pcmBytes.length / 2);
  var out = new Int16Array(n);
  var dv = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  for (var i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true);
  return out;
}

var MP3_BITRATE_KBPS = 96; // plenty for spoken-word narration, ~6x smaller than the WAV

function encodePcmToMp3(samples, sampleRate, channels){
  var encoder = new lamejs.Mp3Encoder(channels || 1, sampleRate, MP3_BITRATE_KBPS);
  var blockSize = 1152; // lamejs's fixed per-frame sample count
  var mp3Chunks = [];
  for (var i = 0; i < samples.length; i += blockSize) {
    var mp3buf = encoder.encodeBuffer(samples.subarray(i, i + blockSize));
    if (mp3buf.length > 0) mp3Chunks.push(mp3buf);
  }
  var end = encoder.flush();
  if (end.length > 0) mp3Chunks.push(end);
  return new Blob(mp3Chunks, { type: 'audio/mpeg' });
}

// Builds a compressed MP3 download for a recording. Falls back to WAV
// (resolving with ext:'wav') if the lamejs encoder didn't load — e.g. the
// CDN script was blocked or the page is offline without it cached —
// so a download always succeeds, just uncompressed in that rare case.
function buildRecordingDownloadBlob(rec){
  if (typeof lamejs === 'undefined' || !lamejs.Mp3Encoder) {
    return buildRecordingAudioBlob(rec).then(function(blob){ return { blob: blob, ext: 'wav' }; });
  }
  return collectRecordingPcm(rec).then(function(res){
    var totalLen = res.chunks.reduce(function(sum, c){ return sum + c.length; }, 0);
    var pcmAll = new Uint8Array(totalLen);
    var offset = 0;
    res.chunks.forEach(function(c){ pcmAll.set(c, offset); offset += c.length; });
    var samples = pcmBytesToInt16Array(pcmAll);
    var blob = encodePcmToMp3(samples, res.fmt.sampleRate, res.fmt.channels);
    return { blob: blob, ext: 'mp3' };
  }).catch(function(){
    return buildRecordingAudioBlob(rec).then(function(blob){ return { blob: blob, ext: 'wav' }; });
  });
}

function deleteRecording(id){
  cancelRecordingAudio(id);
  return idbDeletePrefix(id + ':').then(function(){
    recordings = recordings.filter(function(r){ return r.id !== id; });
    saveRecordings(recordings);
    delete recordingStatus[id];
  });
}

// ---------- Audio tab: playback + list rendering ----------
// A single persistent <audio> element drives real background/lock-screen
// playback (unlike the Web Speech API used for "Vorlesen" elsewhere in the
// app), paired with the Media Session API so play/pause/next/previous work
// from the lock screen or notification shade even with the screen off —
// this is well supported on Desktop/Android; iOS Safari/PWA is more
// restrictive about backgrounded tabs, a platform limitation, not a bug here.
var audioPlayerEl = document.getElementById('audioPlayer');
var playbackState = { queue: [], index: -1, blobUrl: null, loading: false };

function stopPlayback(){
  if (audioPlayerEl) audioPlayerEl.pause();
  if (playbackState.blobUrl) { URL.revokeObjectURL(playbackState.blobUrl); playbackState.blobUrl = null; }
  playbackState.queue = [];
  playbackState.index = -1;
  playbackState.loading = false;
  safeRenderAudioTab();
}

function updateMediaSession(rec){
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: rec.titleE,
      artist: rec.titleH,
      album: 'HSK Flashcards'
    });
    navigator.mediaSession.setActionHandler('play', function(){ if (audioPlayerEl) audioPlayerEl.play(); });
    navigator.mediaSession.setActionHandler('pause', function(){ if (audioPlayerEl) audioPlayerEl.pause(); });
    navigator.mediaSession.setActionHandler('previoustrack', function(){
      if (playbackState.index > 0) { playbackState.index--; playCurrentInQueue(); }
    });
    navigator.mediaSession.setActionHandler('nexttrack', function(){ advancePlayback(); });
  } catch(e) { /* Media Session not fully supported — playback itself still works */ }
}

function playCurrentInQueue(){
  var id = playbackState.queue[playbackState.index];
  var rec = recordings.filter(function(r){ return r.id === id; })[0];
  if (!rec) { advancePlayback(); return; }
  playbackState.loading = true;
  safeRenderAudioTab();
  buildRecordingAudioBlob(rec).then(function(blob){
    if (playbackState.blobUrl) URL.revokeObjectURL(playbackState.blobUrl);
    playbackState.blobUrl = URL.createObjectURL(blob);
    playbackState.loading = false;
    audioPlayerEl.src = playbackState.blobUrl;
    audioPlayerEl.play().catch(function(){ /* autoplay may need a user gesture; the click that got us here counts as one */ });
    updateMediaSession(rec);
    safeRenderAudioTab();
  }).catch(function(err){
    recordingStatus[rec.id] = { error: err.message };
    playbackState.loading = false;
    advancePlayback();
  });
}

function advancePlayback(){
  playbackState.index++;
  if (playbackState.index >= playbackState.queue.length) {
    stopPlayback();
    return;
  }
  playCurrentInQueue();
}

if (audioPlayerEl) {
  audioPlayerEl.onended = function(){ advancePlayback(); };
  // Keep the Audio tab's top play/pause button in sync even when playback
  // is paused/resumed from outside the tab (lock screen, headset button,
  // Media Session handlers).
  audioPlayerEl.onplay = function(){ safeRenderAudioTab(); };
  audioPlayerEl.onpause = function(){ safeRenderAudioTab(); };
}

function recordingMeta(rec){
  return (rec.hsk ? hskLabel(rec.hsk) : 'HSK') + ' · ' + tf('storiesSentencesCount', rec.sentences.length);
}

// Which completed recordings are checked for the "play checked entries
// back to back" playlist, keyed by recording id. Not persisted — a fresh
// session simply starts with everything checked (the common case: play
// everything). Session-only, like the other transient UI state above.
var audioTabChecked = {};
function isRecChecked(id){ return audioTabChecked[id] !== false; }

function playCheckedRecordings(orderedIds, list){
  var checkedIds = orderedIds.filter(function(id){
    var rec = list.filter(function(r){ return r.id === id; })[0];
    return rec && rec.done >= rec.totalSteps && isRecChecked(id);
  });
  if (!checkedIds.length) return;
  playbackState.queue = checkedIds;
  playbackState.index = 0;
  playCurrentInQueue();
}

function renderAudioTab(){
  var root = document.getElementById('audioView');
  if (!root) return;
  var list = recordings.slice().reverse(); // newest first
  var orderedIds = list.map(function(r){ return r.id; });
  var isPlaybackActive = playbackState.index >= 0 && playbackState.queue.length > 0;
  var isPaused = isPlaybackActive && audioPlayerEl && audioPlayerEl.paused;

  var itemsHtml = list.length
    ? list.map(function(rec){
        var complete = rec.done >= rec.totalSteps;
        var active = isRecordingAudioActive(rec.id);
        var blockedUntil = recordingStatus[rec.id] && recordingStatus[rec.id].blockedUntil;
        var errMsg = recordingStatus[rec.id] && recordingStatus[rec.id].error;
        var isCurrentInQueue = playbackState.index >= 0 && playbackState.queue[playbackState.index] === rec.id;
        var isPlaying = isCurrentInQueue && audioPlayerEl && !audioPlayerEl.paused;
        var isPausedHere = isCurrentInQueue && audioPlayerEl && audioPlayerEl.paused;
        var dateLabel = new Date(rec.createdAt).toLocaleDateString(calLocale ? calLocale() : undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        var subLine = esc(rec.titleH) + ' · ' + esc(recordingMeta(rec)) + '<br>' +
          esc(dateLabel + (rec.voiceId ? ' · ' : '')) + esc(rec.voiceId ? (function(){
            var v = voiceDisplayLabel(rec.voiceId);
            if (rec.funStyle) v += ' 🎭 ' + funStyleLabel(rec.funStyle);
            return v + ' · ' + t(normalizeSpeedKey(rec.speed) === 'slow' ? 'audioSpeedSlow' : 'audioSpeedNormal');
          })() : '');

        // Every button lives in the top row now, right next to the title —
        // only a bare progress bar (no controls of its own) drops to a
        // second, slim row while a recording is still generating.
        var topRightHtml = '<div style="display:flex;align-items:center;gap:8px;">';
        var audioRowHtml = '';
        if (!complete) {
          topRightHtml += active
            ? '<button class="audio-mini-btn hint-btn on" data-rec-cancel="' + rec.id + '">⏸</button>'
            : '<button class="audio-mini-btn hint-btn" data-rec-resume="' + rec.id + '" title="' + esc(t('audioResumeTitle')) + '">▶</button>';
          if (rec.done > 0) topRightHtml += '<button class="audio-mini-btn hint-btn" data-rec-delete="' + rec.id + '" title="' + esc(t('audioDeleteTitle')) + '">✕</button>';
          var pct = rec.totalSteps ? (rec.done / rec.totalSteps * 100) : 0;
          audioRowHtml =
            '<div class="story-audio-row" data-id="' + rec.id + '">' +
              '<div class="story-audio-bar"><div class="story-audio-fill" style="width:' + pct + '%"></div></div>' +
              '<span class="story-audio-label">' + rec.done + ' / ' + rec.totalSteps + '</span>' +
            '</div>' +
            (blockedUntil ? '<div class="audio-mini-note" style="padding:0 2px;">' + esc(tf('audioBlockedUntil', new Date(blockedUntil).toLocaleString())) + '</div>' : '') +
            (errMsg ? '<div class="audio-mini-note" style="padding:0 2px;color:var(--seal);">' + esc(t('audioFailedShort')) + '</div>' : '');
        } else {
          topRightHtml +=
            '<button class="audio-mini-btn hint-btn" data-rec-download="' + rec.id + '" title="' + esc(t('audioDownloadTitle')) + '">⬇</button>' +
            '<button class="audio-mini-btn hint-btn" data-rec-delete="' + rec.id + '" title="' + esc(t('audioDeleteTitle')) + '">✕</button>';
          if (isPlaying) audioRowHtml = '<div class="audio-mini-note" style="padding:0 2px;">' + esc(t('audioPlayingNote')) + '</div>';
          else if (isPausedHere) audioRowHtml = '<div class="audio-mini-note" style="padding:0 2px;">' + esc(t('audioPausedNote')) + '</div>';
        }
        topRightHtml += '</div>';

        var checkboxHtml = complete
          ? '<input type="checkbox" class="audio-rec-check" data-rec-check="' + rec.id + '"' + (isRecChecked(rec.id) ? ' checked' : '') + '>'
          : '<span style="width:16px;display:inline-block;"></span>';

        return '<div class="story-card' + (isCurrentInQueue ? ' audio-rec-playing' : '') + '" style="cursor:default;" data-id="' + rec.id + '">' +
          '<div class="story-card-toprow">' +
            '<div style="display:flex;align-items:flex-start;gap:10px;min-width:0;">' +
              checkboxHtml +
              '<div style="min-width:0;"><div class="story-title-en" style="font-size:13.5px;font-weight:600;margin-bottom:1px;">' + esc(rec.titleE) + '</div>' +
              '<div class="story-meta">' + subLine + '</div></div>' +
            '</div>' +
            topRightHtml +
          '</div>' +
          audioRowHtml +
        '</div>';
      }).join('')
    : '<div class="empty-note">' + esc(t('audioTabEmpty')) + '</div>';

  var anyPlayable = list.some(function(r){ return r.done >= r.totalSteps; });
  var playAllIcon = isPlaybackActive ? (isPaused ? '▶' : '⏸') : '▶';
  var playAllTitle = isPlaybackActive ? (isPaused ? t('audioPlayTitle') : t('audioPauseTitle')) : t('audioPlayTitle');

  root.innerHTML = '<div class="stories-wrap">' +
    '<div class="story-toprow"><h2 style="margin:0;font-size:16px;">' + esc(t('tabAudio')) + '</h2>' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
      (isPlaybackActive ? '<button class="btn-primary" id="audioStopBtn" title="' + esc(t('audioStopTitle')) + '" style="padding:9px 14px;font-size:15px;">⏹</button>' : '') +
      '<button class="btn-primary" id="audioPlayAllBtn" title="' + esc(playAllTitle) + '" style="padding:9px 18px;font-size:15px;"' + (anyPlayable ? '' : ' disabled') + '>' + playAllIcon + '</button>' +
      '</div></div>' +
    itemsHtml +
  '</div>';

  var playAllBtn = document.getElementById('audioPlayAllBtn');
  if (playAllBtn) {
    playAllBtn.onclick = function(){
      if (isPlaybackActive) {
        if (isPaused) audioPlayerEl.play(); else audioPlayerEl.pause();
        safeRenderAudioTab();
      } else {
        playCheckedRecordings(orderedIds, list);
      }
    };
  }
  var stopBtn = document.getElementById('audioStopBtn');
  if (stopBtn) {
    stopBtn.onclick = function(){ stopPlayback(); };
  }
  Array.prototype.forEach.call(root.querySelectorAll('[data-rec-check]'), function(box){
    box.onchange = function(){
      audioTabChecked[box.getAttribute('data-rec-check')] = box.checked;
    };
  });
  Array.prototype.forEach.call(root.querySelectorAll('[data-rec-download]'), function(btn){
    btn.onclick = function(){
      var id = btn.getAttribute('data-rec-download');
      var rec = recordings.filter(function(r){ return r.id === id; })[0];
      if (!rec) return;
      buildRecordingDownloadBlob(rec).then(function(res){
        var url = URL.createObjectURL(res.blob);
        var a = document.createElement('a');
        var safeName = rec.titleH.replace(/[\\/:*?"<>|]/g, '').slice(0, 40) || 'story';
        a.href = url;
        a.download = 'hskflash-' + safeName + '.' + res.ext;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
      }).catch(function(err){
        recordingStatus[id] = { error: err.message };
        safeRenderAudioTab();
      });
    };
  });
  Array.prototype.forEach.call(root.querySelectorAll('[data-rec-delete]'), function(btn){
    btn.onclick = function(){
      var id = btn.getAttribute('data-rec-delete');
      if (!confirm(t('audioDeleteConfirm'))) return;
      if (playbackState.queue.indexOf(id) !== -1) stopPlayback();
      deleteRecording(id).then(safeRenderAudioTab);
    };
  });
  Array.prototype.forEach.call(root.querySelectorAll('[data-rec-resume]'), function(btn){
    btn.onclick = function(){
      var id = btn.getAttribute('data-rec-resume');
      var rec = recordings.filter(function(r){ return r.id === id; })[0];
      if (!rec) return;
      ensureGeminiKey().then(function(){
        delete recordingStatus[rec.id];
        safeRenderAudioTab();
        startOrResumeRecordingAudio(rec, makeRecordingCallbacks(rec));
      }).catch(function(err){
        if (err && err.message === 'no-key') {
          openDrawer();
          var f = document.getElementById('inpGeminiKey');
          if (f) f.focus();
        }
      });
    };
  });
  Array.prototype.forEach.call(root.querySelectorAll('[data-rec-cancel]'), function(btn){
    btn.onclick = function(){
      cancelRecordingAudio(btn.getAttribute('data-rec-cancel'));
      safeRenderAudioTab();
    };
  });
}
