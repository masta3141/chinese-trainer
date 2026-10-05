// Full backup: one JSON file with all app data — every hskflash_* localStorage
// entry plus both IndexedDBs (example sentences and TTS audio, binary data as
// base64). The Gemini API key is left out on purpose, so the file can be kept
// anywhere; short-lived bookkeeping (TTS call log, model check) too.
"use strict";

var BACKUP_FORMAT = 'hskflash-backup-v1';
var LAST_BACKUP_KEY = 'hskflash_last_backup_v1';
var BACKUP_SKIP_KEYS = [GEMINI_KEY_STORE, GEMINI_MODEL_STORE, 'hskflash_gemini_tts_model_v1', 'hskflash_gemini_models_checked_v1',
  'hskflash_tts_call_log_v1', 'hskflash_tts_batch_v1'];

// ---- binary-safe (de)serialisation of IndexedDB values ----
function bytesToBase64(bytes){
  var s = '';
  for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToByteArray(b64){
  var s = atob(b64), out = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function encodeBackupValue(v){
  if (v instanceof ArrayBuffer) return { __bin: 'ArrayBuffer', b64: bytesToBase64(new Uint8Array(v)) };
  if (ArrayBuffer.isView(v)) {
    return { __bin: v.constructor.name, b64: bytesToBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
  }
  if (Array.isArray(v)) return v.map(encodeBackupValue);
  if (v && typeof v === 'object') {
    var o = {};
    Object.keys(v).forEach(function(k){ o[k] = encodeBackupValue(v[k]); });
    return o;
  }
  return v;
}
function decodeBackupValue(v){
  if (Array.isArray(v)) return v.map(decodeBackupValue);
  if (v && typeof v === 'object') {
    if (v.__bin) {
      var bytes = base64ToByteArray(v.b64);
      if (v.__bin === 'ArrayBuffer') return bytes.buffer;
      var Ctor = window[v.__bin] || Uint8Array;
      return new Ctor(bytes.buffer, 0, bytes.byteLength / (Ctor.BYTES_PER_ELEMENT || 1));
    }
    var o = {};
    Object.keys(v).forEach(function(k){ o[k] = decodeBackupValue(v[k]); });
    return o;
  }
  return v;
}

// ---- IndexedDB helpers (the stores are opened through the app's own openers) ----
function readWholeStore(openDb, storeName){
  return openDb().then(function(db){
    return new Promise(function(resolve, reject){
      var out = {};
      var req = db.transaction(storeName, 'readonly').objectStore(storeName).openCursor();
      req.onsuccess = function(){
        var cur = req.result;
        if (cur) { out[cur.key] = encodeBackupValue(cur.value); cur.continue(); } else resolve(out);
      };
      req.onerror = function(){ reject(req.error); };
    });
  }).catch(function(){ return {}; });
}
function replaceWholeStore(openDb, storeName, entries){
  return openDb().then(function(db){
    return new Promise(function(resolve, reject){
      var tx = db.transaction(storeName, 'readwrite');
      var store = tx.objectStore(storeName);
      store.clear();
      Object.keys(entries || {}).forEach(function(k){ store.put(decodeBackupValue(entries[k]), k); });
      tx.oncomplete = function(){ resolve(); };
      tx.onerror = function(){ reject(tx.error); };
    });
  });
}

function buildFullBackup(){
  var ls = {};
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (k.indexOf('hskflash_') === 0 && BACKUP_SKIP_KEYS.indexOf(k) < 0) ls[k] = localStorage.getItem(k);
  }
  return Promise.all([
    readWholeStore(openExamplesDB, EXAMPLES_STORE),
    readWholeStore(openAudioDB, AUDIO_STORE)
  ]).then(function(r){
    return { format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), localStorage: ls, examples: r[0], audio: r[1] };
  });
}

// Replaces all app data with the backup and reloads the app.
function restoreFullBackup(data){
  if (!data || data.format !== BACKUP_FORMAT || typeof data.localStorage !== 'object') {
    return Promise.reject(new Error('invalid'));
  }
  var remove = [];
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (k.indexOf('hskflash_') === 0 && BACKUP_SKIP_KEYS.indexOf(k) < 0) remove.push(k);
  }
  remove.forEach(function(k){ localStorage.removeItem(k); });
  Object.keys(data.localStorage).forEach(function(k){
    if (k.indexOf('hskflash_') === 0 && BACKUP_SKIP_KEYS.indexOf(k) < 0) localStorage.setItem(k, data.localStorage[k]);
  });
  return Promise.all([
    replaceWholeStore(openExamplesDB, EXAMPLES_STORE, data.examples),
    replaceWholeStore(openAudioDB, AUDIO_STORE, data.audio)
  ]).then(function(){
    setTimeout(function(){ location.reload(); }, 50);
  });
}

// ---- settings UI ----
function showBackupInfo(){
  var el = document.getElementById('backupInfo');
  if (!el) return;
  var last = 0;
  try { last = parseInt(localStorage.getItem(LAST_BACKUP_KEY), 10) || 0; } catch(e) {}
  var days = Math.floor((Date.now() - last) / 86400000);
  el.textContent = (!last ? t('backupNever') : days === 0 ? t('backupToday') : tf('backupDaysAgo', days)) + ' ' + t('backupKeyNote');
}

document.getElementById('btnBackupAll').onclick = function(){
  var btn = this;
  btn.disabled = true;
  btn.textContent = '…';
  buildFullBackup().then(function(data){
    var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'hskflash-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
    try { localStorage.setItem(LAST_BACKUP_KEY, String(Date.now())); } catch(e) {}
  }).catch(function(err){
    alert(t('errorPrefix') + err.message);
  }).then(function(){
    btn.disabled = false;
    btn.textContent = t('exportBtn');
    showBackupInfo();
  });
};
document.getElementById('btnRestoreAll').onclick = function(){
  document.getElementById('inpRestoreFile').click();
};
document.getElementById('inpRestoreFile').onchange = function(e){
  var file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(){
    var data;
    try { data = JSON.parse(reader.result); } catch(err) { alert(t('importInvalidJson')); return; }
    if (!data || data.format !== BACKUP_FORMAT) { alert(t('backupInvalid')); return; }
    if (!confirm(t('backupRestoreConfirm'))) return;
    restoreFullBackup(data).catch(function(err){ alert(t('errorPrefix') + err.message); });
  };
  reader.readAsText(file);
};
