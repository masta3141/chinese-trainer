// Settings drawer: options, import/export, fonts, language switcher.
"use strict";

// ---------- settings drawer ----------
var overlay = document.getElementById('overlay');
var drawer = document.getElementById('drawer');
function buildVoiceSelect(){
  var sel = document.getElementById('inpVoice');
  var note = document.getElementById('voiceNote');
  if (!sel) return;
  refreshVoices();
  var zh = chineseVoices();
  var list = zh.length ? zh : cachedVoices;
  if (list.length === 0) {
    sel.innerHTML = '<option value="">' + esc(t('voiceNoneFound')) + '</option>';
    note.textContent = t('voiceNoneFoundNote');
    return;
  }
  sel.innerHTML = '<option value="">' + esc(t('voiceSystemDefault')) + '</option>' + list.map(function(v){
    var selected = v.name === settings.voiceName ? ' selected' : '';
    return '<option value="' + esc(v.name) + '"' + selected + '>' + esc(v.name) + ' (' + esc(v.lang) + ')</option>';
  }).join('');
  note.textContent = zh.length
    ? tf('voiceFoundNote', zh.length)
    : t('voiceNoneChineseNote');
}

function openDrawer(){
  document.getElementById('inpStandard').value = settings.standard;
  document.getElementById('inpPool').value = settings.pool;
  document.getElementById('inpSession').value = settings.sessionSize;
  document.getElementById('inpAutoSpeak').checked = !!settings.autoSpeak;
  document.getElementById('inpFontFamily').value = fonts.family;
  document.getElementById('inpHanziSize').value = fonts.hanziSize;
  document.getElementById('inpExampleSize').value = fonts.exampleSize;
  document.getElementById('hanziSizeVal').textContent = fonts.hanziSize + 'px';
  document.getElementById('exampleSizeVal').textContent = fonts.exampleSize + 'px';
  document.getElementById('inpGeminiKey').value = loadGeminiKey();
  showGeminiModelInfo();
  showBackupInfo();
  document.getElementById('inpTtsQuotaEnabled').checked = loadTtsQuotaEnabled();
  buildVoiceSelect();
  overlay.classList.add('show');
  drawer.classList.add('show');
}
function closeDrawer(){
  overlay.classList.remove('show');
  drawer.classList.remove('show');
}

document.getElementById('btnSettings').onclick = openDrawer;
overlay.onclick = closeDrawer;

// Pool size and words per round are saved right away; a running round just
// continues, the new values apply from the next round on.
function applyRoundSettings(){
  var pool = parseInt(document.getElementById('inpPool').value, 10);
  var sess = parseInt(document.getElementById('inpSession').value, 10);
  settings.pool = isNaN(pool) || pool < 1 ? DEFAULT_SETTINGS.pool : pool;
  settings.sessionSize = isNaN(sess) || sess < 1 ? DEFAULT_SETTINGS.sessionSize : sess;
  saveSettings(settings);
  ensurePoolFilled();
  buildPoolPanel();
  renderStats();
  if (!session || session.finished) render();
}
document.getElementById('inpPool').onchange = applyRoundSettings;
document.getElementById('inpSession').onchange = applyRoundSettings;

function showGeminiModelInfo(){
  var el = document.getElementById('geminiModelInfo');
  if (el) el.textContent = tf('geminiModelAuto', loadGeminiModel(), loadGeminiTtsModel());
}

document.getElementById('btnSaveGeminiKey').onclick = function(){
  saveGeminiKey(document.getElementById('inpGeminiKey').value.trim());
  detectGeminiModels(true).then(showGeminiModelInfo);
  var btn = document.getElementById('btnSaveGeminiKey');
  btn.textContent = t('geminiSavedToast');
  setTimeout(function(){ btn.textContent = t('geminiSaveBtn'); }, 1500);
};

document.getElementById('btnReset').onclick = function(){
  if (!confirm(t('resetConfirm'))) return;
  var empty = {};
  ALL_WORDS.forEach(function(w){
    empty[w.id] = { lvl: 0, lr: null, seen: false };
  });
  progress = empty;
  saveProgress(progress);
  session = null;
  closeDrawer();
  buildPoolPanel();
  render();
};

function downloadJson(payload, filenamePrefix){
  var json = JSON.stringify(payload, null, 2);
  var blob = new Blob([json], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  var stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = filenamePrefix + '-' + stamp + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
}

document.getElementById('btnExportProgress').onclick = function(){
  downloadJson({ format: 'hskflash-progress-v1', exportedAt: new Date().toISOString(), progress: progress, streak: powerStreak, poolOverrides: poolOverrides }, 'hskflash-progress');
};
document.getElementById('btnExportExamples').onclick = function(){
  downloadJson({ format: 'hskflash-examples-v1', exportedAt: new Date().toISOString(), generatedExamples: generatedExamples }, 'hskflash-examples');
};
document.getElementById('btnExportStories').onclick = function(){
  downloadJson({ format: 'hskflash-stories-v1', exportedAt: new Date().toISOString(), stories: stories }, 'hskflash-stories');
};
document.getElementById('btnExportIslands').onclick = function(){
  downloadJson({ format: 'hskflash-islands-v1', exportedAt: new Date().toISOString(), islands: islands }, 'hskflash-islands');
};

var importTarget = null; // 'progress' | 'examples' | 'stories' | 'islands'
document.getElementById('btnImportProgress').onclick = function(){ importTarget = 'progress'; document.getElementById('inpImportFile').click(); };
document.getElementById('btnImportExamples').onclick = function(){ importTarget = 'examples'; document.getElementById('inpImportFile').click(); };
document.getElementById('btnImportStories').onclick = function(){ importTarget = 'stories'; document.getElementById('inpImportFile').click(); };
document.getElementById('btnImportIslands').onclick = function(){ importTarget = 'islands'; document.getElementById('inpImportFile').click(); };

document.getElementById('inpImportFile').onchange = function(e){
  var file = e.target.files && e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(){
    var data;
    try {
      data = JSON.parse(reader.result);
    } catch(err) {
      alert(t('importInvalidJson'));
      e.target.value = '';
      return;
    }
    if (importTarget === 'progress') {
      if (!data || typeof data.progress !== 'object') { alert(t('importInvalidFormat')); e.target.value = ''; return; }
      if (!confirm(t('importConfirmProgress'))) { e.target.value = ''; return; }
      progress = data.progress;
      saveProgress(progress);
      // Older exports have no streak data — keep the current streak then.
      if (data.streak && typeof data.streak === 'object' && data.streak.cards) {
        powerStreak = data.streak;
        saveStreak(powerStreak);
      }
      if (data.poolOverrides && typeof data.poolOverrides === 'object') {
        poolOverrides = data.poolOverrides;
        savePoolOverrides(poolOverrides);
      }
      session = null;
      buildPoolPanel();
    } else if (importTarget === 'examples') {
      if (!data || typeof data.generatedExamples !== 'object') { alert(t('importInvalidFormat')); e.target.value = ''; return; }
      if (!confirm(t('importConfirmExamples'))) { e.target.value = ''; return; }
      generatedExamples = data.generatedExamples;
      saveGeneratedExamples(generatedExamples);
    } else if (importTarget === 'stories') {
      if (!data || !Array.isArray(data.stories)) { alert(t('importInvalidFormat')); e.target.value = ''; return; }
      if (!confirm(t('importConfirmStories'))) { e.target.value = ''; return; }
      stories = data.stories;
      saveStories(stories);
      storiesState.view = 'library';
    } else if (importTarget === 'islands') {
      if (!data || !Array.isArray(data.islands)) { alert(t('importInvalidFormat')); e.target.value = ''; return; }
      if (!confirm(t('importConfirmIslands'))) { e.target.value = ''; return; }
      islands = data.islands;
      saveIslands(islands);
      islandsState.view = 'list';
    }
    e.target.value = '';
    closeDrawer();
    render();
    var storiesViewEl = document.getElementById('storiesView');
    if (storiesViewEl && storiesViewEl.style.display !== 'none') { try { renderStories(); } catch(err2){} }
    var islandsViewEl = document.getElementById('islandsView');
    if (islandsViewEl && islandsViewEl.style.display !== 'none') { try { renderIslands(); } catch(err2){} }
    var statsViewEl = document.getElementById('statsPageView');
    if (statsViewEl && statsViewEl.style.display !== 'none') { try { renderStatsTab(); } catch(err2){} }
    alert(t('importDone'));
  };
  reader.readAsText(file);
};


document.getElementById('inpAutoSpeak').onchange = function(e){
  settings.autoSpeak = e.target.checked;
  saveSettings(settings);
};

document.getElementById('inpTtsQuotaEnabled').onchange = function(e){
  saveTtsQuotaEnabled(e.target.checked);
};

document.getElementById('inpVoice').onchange = function(e){
  settings.voiceName = e.target.value;
  saveSettings(settings);
};

document.getElementById('inpStandard').onchange = function(e){
  var newStd = e.target.value;
  if (newStd === settings.standard) return;
  var label = newStd === 'hsk3' ? 'HSK 3.0' : 'HSK 2.0';
  if (!confirm(tf('standardSwitchConfirm', label))) {
    e.target.value = settings.standard;
    return;
  }
  switchStandard(newStd);
  closeDrawer();
};

// ---------- font/size live handlers ----------
document.getElementById('inpFontFamily').onchange = function(e){
  fonts.family = e.target.value;
  saveFonts(fonts);
  applyFonts();
};
document.getElementById('inpHanziSize').oninput = function(e){
  fonts.hanziSize = parseInt(e.target.value, 10);
  document.getElementById('hanziSizeVal').textContent = fonts.hanziSize + 'px';
  saveFonts(fonts);
  applyFonts();
};
document.getElementById('inpExampleSize').oninput = function(e){
  fonts.exampleSize = parseInt(e.target.value, 10);
  document.getElementById('exampleSizeVal').textContent = fonts.exampleSize + 'px';
  saveFonts(fonts);
  applyFonts();
};

// ---------- language switcher ----------
var btnLang = document.getElementById('btnLang');
var langPopover = document.getElementById('langPopover');
if (btnLang) btnLang.onclick = function(e){
  e.stopPropagation();
  langPopover.classList.toggle('show');
};
Array.prototype.forEach.call(document.querySelectorAll('.lang-option'), function(btn){
  btn.onclick = function(){
    setLanguage(btn.getAttribute('data-lang'));
    langPopover.classList.remove('show');
  };
});
document.addEventListener('click', function(e){
  if (langPopover && langPopover.classList.contains('show') && !langPopover.contains(e.target) && e.target !== btnLang) {
    langPopover.classList.remove('show');
  }
});
