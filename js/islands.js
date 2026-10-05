// Sentence islands (Satzinseln): storage, Gemini generation and the islands view.
"use strict";

// ---------- Sentence islands (Satzinseln) ----------
var ISLANDS_KEY = 'hskflash_islands_v1';
function loadIslands(){
  try { return JSON.parse(localStorage.getItem(ISLANDS_KEY)) || []; } catch(e) { return []; }
}
function saveIslands(list){
  try { localStorage.setItem(ISLANDS_KEY, JSON.stringify(list)); } catch(e) {}
}
var islands = loadIslands();

var islandsState = {
  view: 'list',          // 'list' | 'detail' | 'review'
  selectedId: null,
  generating: false,
  generateError: null,
  candidates: null,      // pending sentence candidates awaiting accept/reject, when view === 'review'
  newIslandName: '',
  newIslandDesc: '',
  showNewForm: false,
  editingDescId: null,   // id of the island whose description textarea is open, or null
  ownSentenceDraft: '',
  ownSentenceBusy: false,
  ownSentenceError: null
};

// HSK level of an island (older islands have none: they were generated for
// "roughly HSK 3-4", so HSK 3 is the closest default).
function islandHsk(island){
  return (island && island.hsk) || (HSK_ORDER.indexOf('hsk3') >= 0 ? 'hsk3' : HSK_ORDER[0]);
}
function islandHskSelect(id, selected){
  return '<select id="' + id + '" class="island-hsk-select">' +
    HSK_ORDER.map(function(h){ return '<option value="' + h + '"' + (h === selected ? ' selected' : '') + '>' + esc(hskLabel(h)) + '</option>'; }).join('') +
  '</select>';
}
// Vocabulary instruction for Gemini, e.g. "HSK 3 (HSK 2.0 standard)".
function islandHskInstruction(hskKey){
  var std = settings.standard === 'hsk3' ? 'HSK 3.0' : 'HSK 2.0';
  return "Use only vocabulary and grammar of " + hskLabel(hskKey) + " or below (" + std + " standard). " +
    "If the topic needs a word above that level, rephrase it with simpler words.\n";
}

function buildIslandPrompt(topicName, description, existingSentences, count, hskKey){
  var existingList = existingSentences.map(function(s){ return s.h; }).join('; ');
  return "You are a precise linguistic API for a Mandarin learning app.\n" +
    "TASK: Suggest natural, everyday Mandarin Chinese sentences a learner could actually use or hear in real life.\n" +
    "TOPIC: \"" + topicName + "\"\n" +
    (description ? "SITUATION / CONTEXT DETAILS (follow this closely — it describes exactly what the learner expects): " + description + "\n" : "") +
    "Number of sentences: " + count + "\n" +
    islandHskInstruction(hskKey) +
    (existingList ? "Do not repeat or closely duplicate any of these already-collected sentences: " + existingList + "\n" : "") +
    "STRICT OUTPUT RULES:\n" +
    "1. Output MUST contain exactly " + count + " lines. Nothing else.\n" +
    "2. Each line is one standalone, natural sentence, format: HANZI|PINYIN|ENGLISH\n" +
    "3. No introduction, no markdown fences, no numbering, no explanatory text.";
}

function generateIslandSentences(island, count){
  var apiKey = loadGeminiKey();
  if (!apiKey) {
    openDrawer();
    var f = document.getElementById('inpGeminiKey');
    if (f) f.focus();
    return Promise.reject(new Error('no-key'));
  }
  var model = loadGeminiModel();
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
  var prompt = buildIslandPrompt(island.name, island.description, island.sentences, count, islandHsk(island));
  var payload = { contents: [{ parts: [{ text: prompt }] }] };

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(res){
    if (!res.ok) return res.text().then(function(t){ throw new Error('HTTP ' + res.status + ': ' + t); });
    return res.json();
  }).then(function(data){
    var text = data.candidates[0].content.parts[0].text;
    var parsed = parseGeminiResponse(text);
    if (!parsed.length) throw new Error('Antwort konnte nicht gelesen werden.');
    parsed.forEach(function(s){ s.id = 'sent_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); });
    return parsed;
  });
}

// Lets the user type their own sentence in English and have Gemini translate
// it into natural Mandarin — added directly to the island (no accept/reject
// review step, since it's the user's own content, not a Gemini suggestion).
function buildTranslateSentencePrompt(englishText, hskKey){
  return "You are a precise linguistic API for a Mandarin learning app.\n" +
    "TASK: Translate the following English sentence into natural, everyday Mandarin Chinese that a learner could actually use or hear in real life.\n" +
    "ENGLISH SENTENCE: \"" + englishText + "\"\n" +
    islandHskInstruction(hskKey) +
    "Stay faithful to the original meaning.\n" +
    "STRICT OUTPUT RULES:\n" +
    "1. Output MUST contain exactly 1 line. Nothing else.\n" +
    "2. Format: HANZI|PINYIN|ENGLISH (use the original English sentence, lightly cleaned up if needed, as the ENGLISH field)\n" +
    "3. No introduction, no markdown fences, no numbering, no explanatory text.";
}

function translateOwnSentence(englishText, hskKey){
  var apiKey = loadGeminiKey();
  if (!apiKey) {
    openDrawer();
    var f = document.getElementById('inpGeminiKey');
    if (f) f.focus();
    return Promise.reject(new Error('no-key'));
  }
  var model = loadGeminiModel();
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
  var prompt = buildTranslateSentencePrompt(englishText, hskKey);
  var payload = { contents: [{ parts: [{ text: prompt }] }] };

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(res){
    if (!res.ok) return res.text().then(function(t){ throw new Error('HTTP ' + res.status + ': ' + t); });
    return res.json();
  }).then(function(data){
    var text = data.candidates[0].content.parts[0].text;
    var parsed = parseGeminiResponse(text);
    if (!parsed.length) throw new Error('Antwort konnte nicht gelesen werden.');
    var s = parsed[0];
    s.id = 'sent_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    return s;
  });
}

function renderIslands(){
  var root = document.getElementById('islandsView');
  if (!root) return;
  var ist = islandsState;

  if (ist.view === 'list') {
    var listHtml = islands.length
      ? islands.slice().reverse().map(function(isl){
          return '<div class="story-card" data-id="' + isl.id + '">' +
            '<div class="story-card-toprow">' +
              '<span class="story-title" style="font-family:inherit;font-size:14.5px;font-weight:600;">' + esc(isl.name) + '</span>' +
              '<span class="story-meta" style="white-space:nowrap;">' + esc(hskLabel(islandHsk(isl)) + ' · ' + tf('islandsSentenceCount', isl.sentences.length)) + '</span>' +
            '</div>' +
          '</div>';
        }).join('')
      : '<div class="empty-note">' + esc(t('islandsEmpty')) + '</div>';

    var newFormHtml = ist.showNewForm
      ? '<div class="audio-picker" style="margin-bottom:12px;">' +
          '<div class="audio-picker-label">' + esc(t('islandsNewNamePrompt')) + '</div>' +
          '<input type="text" id="inpNewIslandName" placeholder="' + esc(t('islandsNewNamePlaceholder')) + '" value="' + esc(ist.newIslandName) + '" style="width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid var(--hairline);border-radius:7px;font-family:inherit;font-size:13.5px;background:var(--paper-raised);color:var(--ink);">' +
          '<div class="audio-picker-label" style="margin-top:9px;">' + esc(t('islandsNewDescPrompt')) + '</div>' +
          '<textarea id="inpNewIslandDesc" placeholder="' + esc(t('islandsNewDescPlaceholder')) + '" rows="2" style="width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid var(--hairline);border-radius:7px;font-family:inherit;font-size:13px;background:var(--paper-raised);color:var(--ink);resize:vertical;">' + esc(ist.newIslandDesc) + '</textarea>' +
          '<div class="audio-picker-label" style="margin-top:9px;">' + esc(t('storiesHskLabel')) + '</div>' +
          islandHskSelect('inpNewIslandHsk', ist.newIslandHsk || islandHsk(null)) +
          '<div class="audio-picker-actions">' +
            '<button class="btn-primary" id="btnCreateIsland" style="flex:1;padding:9px;font-size:13px;">' + esc(t('islandsCreateBtn')) + '</button>' +
            '<button class="hint-btn" id="btnCancelNewIsland">' + esc(t('islandsCancelBtn')) + '</button>' +
          '</div>' +
        '</div>'
      : '';

    root.innerHTML =
      '<div class="stories-wrap">' +
        '<div class="story-toprow"><h2 style="margin:0;font-size:16px;">' + esc(t('islandsLibraryTitle')) + '</h2>' +
          '<button class="btn-primary" id="btnNewIsland" style="padding:9px 18px;font-size:13.5px;">' + esc(t('islandsNewBtn')) + '</button></div>' +
        newFormHtml +
        listHtml +
      '</div>';

    var btnNew = document.getElementById('btnNewIsland');
    if (btnNew) btnNew.onclick = function(){
      ist.showNewForm = true;
      ist.newIslandName = '';
      ist.newIslandDesc = '';
      renderIslands();
      setTimeout(function(){ var el = document.getElementById('inpNewIslandName'); if (el) el.focus(); }, 0);
    };
    var btnCancelNew = document.getElementById('btnCancelNewIsland');
    if (btnCancelNew) btnCancelNew.onclick = function(){ ist.showNewForm = false; renderIslands(); };
    var btnCreate = document.getElementById('btnCreateIsland');
    if (btnCreate) btnCreate.onclick = function(){
      var nameInput = document.getElementById('inpNewIslandName');
      var descInput = document.getElementById('inpNewIslandDesc');
      var name = nameInput ? nameInput.value.trim() : '';
      var description = descInput ? descInput.value.trim() : '';
      var hskSel = document.getElementById('inpNewIslandHsk');
      var hsk = hskSel ? hskSel.value : islandHsk(null);
      if (!name) return;
      ist.newIslandHsk = hsk;
      var newIsland = { id: 'island_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), name: name, description: description, hsk: hsk, sentences: [], createdAt: new Date().toISOString() };
      islands.push(newIsland);
      saveIslands(islands);
      ist.showNewForm = false;
      renderIslands();
    };
    var nameField = document.getElementById('inpNewIslandName');
    if (nameField) {
      nameField.onkeydown = function(e){ if (e.key === 'Enter') { var b = document.getElementById('btnCreateIsland'); if (b) b.click(); } };
    }
    Array.prototype.forEach.call(root.querySelectorAll('.story-card'), function(card){
      card.onclick = function(){
        stopNarration();
        ist.selectedId = card.getAttribute('data-id');
        ist.view = 'detail';
        ist.generateError = null;
        renderIslands();
      };
    });
    return;
  }

  if (ist.view === 'detail') {
    var isl = islands.filter(function(x){ return x.id === ist.selectedId; })[0];
    if (!isl) { ist.view = 'list'; renderIslands(); return; }

    var sentHtml = isl.sentences.length
      ? isl.sentences.map(function(s){
          return '<div class="freq-word-row" style="align-items:flex-start;gap:8px;">' +
            '<button class="hint-btn" data-speak-sent="' + s.id + '" style="padding:5px 9px;font-size:12px;flex:0 0 auto;">🔊</button>' +
            '<div style="flex:1;min-width:0;">' +
              '<div class="freq-word-h" style="min-width:0;">' + esc(s.h) + '</div>' +
              '<div class="freq-word-p" style="min-width:0;">' + esc(s.p) + '</div>' +
              '<div class="freq-word-e" style="white-space:normal;overflow:visible;text-overflow:clip;">' + esc(s.e) + '</div>' +
            '</div>' +
            '<button class="hint-btn" data-delete-sent="' + s.id + '" style="padding:5px 9px;font-size:12px;color:var(--seal);flex:0 0 auto;">✕</button>' +
          '</div>';
        }).join('')
      : '<div class="empty-note">' + esc(t('islandsNoSentencesYet')) + '</div>';

    root.innerHTML =
      '<div class="stories-wrap">' +
        '<div class="story-toprow"><button class="hint-btn" id="btnBackToIslandsList">' + esc(t('islandsBackToLibrary')) + '</button>' +
          '<div style="display:flex;gap:8px;">' +
            '<button class="hint-btn' + (narrating ? ' on' : '') + '" id="btnNarrateIsland">' + esc(narrating ? t('islandsStopBtn') : t('islandsNarrateBtn')) + '</button>' +
            '<button class="hint-btn" id="btnDeleteIsland" style="color:var(--seal);">' + esc(t('storiesDeleteBtn')) + '</button>' +
          '</div></div>' +
        '<div class="story-title-block" style="margin-bottom:14px;padding-bottom:12px;">' +
          '<div class="t-h" style="font-size:17px;font-family:inherit;">' + esc(isl.name) + '</div>' +
          '<div class="t-e" style="margin-top:2px;">' + esc(tf('islandsSentenceCount', isl.sentences.length)) + '</div>' +
          '<div class="island-hsk-row"><span>' + esc(t('storiesHskLabel')) + '</span>' + islandHskSelect('selIslandHsk', islandHsk(isl)) + '</div>' +
          (ist.editingDescId === isl.id
            ? '<div style="margin-top:9px;">' +
                '<textarea id="inpEditIslandDesc" rows="2" style="width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid var(--hairline);border-radius:7px;font-family:inherit;font-size:13px;background:var(--paper-raised);color:var(--ink);resize:vertical;">' + esc(isl.description || '') + '</textarea>' +
                '<div class="audio-picker-actions" style="margin-top:6px;">' +
                  '<button class="btn-primary" id="btnSaveIslandDesc" style="flex:1;padding:8px;font-size:12.5px;">' + esc(t('islandsSaveDescBtn')) + '</button>' +
                  '<button class="hint-btn" id="btnCancelIslandDesc">' + esc(t('islandsCancelBtn')) + '</button>' +
                '</div>' +
              '</div>'
            : (isl.description
                ? '<div class="story-meta" style="margin-top:6px;white-space:pre-wrap;">' + esc(isl.description) + '</div><button class="hint-btn" id="btnEditIslandDesc" style="margin-top:6px;font-size:11px;padding:4px 9px;">' + esc(t('islandsEditDescBtn')) + '</button>'
                : '<button class="hint-btn" id="btnEditIslandDesc" style="margin-top:6px;font-size:11px;padding:4px 9px;">' + esc(t('islandsAddDescBtn')) + '</button>')) +
        '</div>' +
        sentHtml +
        '<button class="btn-primary" id="btnAddSentences" style="width:100%;margin-top:14px;"' + (ist.generating ? ' disabled' : '') + '>' +
          esc(ist.generating ? t('islandsGeneratingBtn') : t('islandsAddSentencesBtn')) +
        '</button>' +
        (ist.generateError ? '<div class="ex-e" style="margin-top:8px;color:var(--seal);">' + esc(ist.generateError) + '</div>' : '') +
        '<div class="audio-picker" style="margin-top:14px;">' +
          '<div class="audio-picker-label">' + esc(t('islandsOwnSentenceLabel')) + '</div>' +
          '<input type="text" id="inpOwnSentence" placeholder="' + esc(t('islandsOwnSentencePlaceholder')) + '" value="' + esc(ist.ownSentenceDraft || '') + '" style="width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid var(--hairline);border-radius:7px;font-family:inherit;font-size:13.5px;background:var(--paper-raised);color:var(--ink);">' +
          '<button class="btn-primary" id="btnTranslateOwnSentence" style="width:100%;margin-top:8px;padding:9px;font-size:13px;"' + (ist.ownSentenceBusy ? ' disabled' : '') + '>' +
            esc(ist.ownSentenceBusy ? t('islandsTranslatingBtn') : t('islandsTranslateAddBtn')) +
          '</button>' +
          (ist.ownSentenceError ? '<div class="ex-e" style="margin-top:6px;color:var(--seal);">' + esc(ist.ownSentenceError) + '</div>' : '') +
        '</div>' +
      '</div>';

    document.getElementById('btnBackToIslandsList').onclick = function(){ stopNarration(); ist.view = 'list'; renderIslands(); };
    document.getElementById('selIslandHsk').onchange = function(e){
      isl.hsk = e.target.value;
      saveIslands(islands);
    };
    document.getElementById('btnDeleteIsland').onclick = function(){
      stopNarration();
      if (!confirm(t('islandsDeleteConfirm'))) return;
      islands = islands.filter(function(x){ return x.id !== isl.id; });
      saveIslands(islands);
      ist.view = 'list';
      renderIslands();
    };
    document.getElementById('btnNarrateIsland').onclick = function(){
      if (narrating) { stopNarration(); renderIslands(); return; }
      if (!isl.sentences.length) return;
      narrateSentences(isl.sentences, 0, function(){ renderIslands(); }, function(){ renderIslands(); });
      renderIslands();
    };
    var editDescBtn = document.getElementById('btnEditIslandDesc');
    if (editDescBtn) editDescBtn.onclick = function(){
      ist.editingDescId = isl.id;
      renderIslands();
      setTimeout(function(){ var el = document.getElementById('inpEditIslandDesc'); if (el) el.focus(); }, 0);
    };
    var saveDescBtn = document.getElementById('btnSaveIslandDesc');
    if (saveDescBtn) saveDescBtn.onclick = function(){
      var ta = document.getElementById('inpEditIslandDesc');
      isl.description = ta ? ta.value.trim() : '';
      saveIslands(islands);
      ist.editingDescId = null;
      renderIslands();
    };
    var cancelDescBtn = document.getElementById('btnCancelIslandDesc');
    if (cancelDescBtn) cancelDescBtn.onclick = function(){ ist.editingDescId = null; renderIslands(); };
    var ownInput = document.getElementById('inpOwnSentence');
    if (ownInput) {
      ownInput.onkeydown = function(e){ if (e.key === 'Enter') { var b = document.getElementById('btnTranslateOwnSentence'); if (b) b.click(); } };
    }
    document.getElementById('btnTranslateOwnSentence').onclick = function(){
      var input = document.getElementById('inpOwnSentence');
      var text = input ? input.value.trim() : '';
      if (!text) return;
      var apiKey = loadGeminiKey();
      if (!apiKey) {
        openDrawer();
        var f = document.getElementById('inpGeminiKey');
        if (f) f.focus();
        return;
      }
      ist.ownSentenceDraft = text;
      ist.ownSentenceBusy = true;
      ist.ownSentenceError = null;
      renderIslands();
      translateOwnSentence(text, islandHsk(isl)).then(function(s){
        isl.sentences.push(s);
        saveIslands(islands);
        ist.ownSentenceBusy = false;
        ist.ownSentenceDraft = '';
        renderIslands();
      }).catch(function(err){
        ist.ownSentenceBusy = false;
        if (err.message !== 'no-key') ist.ownSentenceError = t('islandsGenErrorPrefix') + err.message;
        renderIslands();
      });
    };
    document.getElementById('btnAddSentences').onclick = function(){
      var apiKey = loadGeminiKey();
      if (!apiKey) {
        openDrawer();
        var f = document.getElementById('inpGeminiKey');
        if (f) f.focus();
        return;
      }
      ist.generating = true;
      ist.generateError = null;
      renderIslands();
      generateIslandSentences(isl, 6).then(function(candidates){
        ist.generating = false;
        ist.candidates = candidates;
        ist.view = 'review';
        renderIslands();
      }).catch(function(err){
        ist.generating = false;
        if (err.message !== 'no-key') ist.generateError = t('islandsGenErrorPrefix') + err.message;
        renderIslands();
      });
    };
    Array.prototype.forEach.call(root.querySelectorAll('[data-speak-sent]'), function(btn){
      btn.onclick = function(){
        var id = btn.getAttribute('data-speak-sent');
        var s = isl.sentences.filter(function(x){ return x.id === id; })[0];
        if (s) speak(s.h);
      };
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-delete-sent]'), function(btn){
      btn.onclick = function(){
        var id = btn.getAttribute('data-delete-sent');
        if (!confirm(t('islandsDeleteSentenceConfirm'))) return;
        isl.sentences = isl.sentences.filter(function(x){ return x.id !== id; });
        saveIslands(islands);
        renderIslands();
      };
    });
    return;
  }

  if (ist.view === 'review') {
    var isl2 = islands.filter(function(x){ return x.id === ist.selectedId; })[0];
    if (!isl2 || !ist.candidates) { ist.view = 'detail'; renderIslands(); return; }

    var candHtml = ist.candidates.length
      ? ist.candidates.map(function(c){
          return '<div class="freq-word-row" style="align-items:flex-start;gap:8px;">' +
            '<div style="flex:1;min-width:0;">' +
              '<div class="freq-word-h" style="min-width:0;">' + esc(c.h) + '</div>' +
              '<div class="freq-word-p" style="min-width:0;">' + esc(c.p) + '</div>' +
              '<div class="freq-word-e" style="white-space:normal;overflow:visible;text-overflow:clip;">' + esc(c.e) + '</div>' +
            '</div>' +
            '<button class="hint-btn" data-accept-cand="' + c.id + '" style="color:var(--seal);padding:5px 9px;flex:0 0 auto;">✓</button>' +
            '<button class="hint-btn" data-reject-cand="' + c.id + '" style="padding:5px 9px;flex:0 0 auto;">✕</button>' +
          '</div>';
        }).join('')
      : '<div class="empty-note">✓</div>';

    root.innerHTML =
      '<div class="stories-wrap">' +
        '<div class="story-toprow"><h2 style="margin:0;font-size:16px;">' + esc(t('islandsReviewTitle')) + '</h2></div>' +
        '<p style="font-size:12px;color:var(--ink-faint);margin:0 0 12px;">' + esc(t('islandsReviewDesc')) + '</p>' +
        candHtml +
        '<div class="audio-picker-actions" style="margin-top:14px;">' +
          '<button class="btn-secondary" id="btnAcceptAllCand" style="flex:1;">' + esc(t('islandsAcceptAllBtn')) + '</button>' +
          '<button class="btn-secondary" id="btnDiscardAllCand" style="flex:1;">' + esc(t('islandsDiscardAllBtn')) + '</button>' +
        '</div>' +
        '<button class="btn-primary" id="btnDoneReview" style="width:100%;margin-top:10px;">' + esc(t('islandsDoneReviewBtn')) + '</button>' +
      '</div>';

    function backToDetailAfterReview(){
      ist.view = 'detail';
      ist.candidates = null;
      renderIslands();
    }
    function removeCandidateById(id){
      for (var ci = 0; ci < ist.candidates.length; ci++) {
        if (ist.candidates[ci].id === id) return ist.candidates.splice(ci, 1)[0];
      }
      return null;
    }
    Array.prototype.forEach.call(root.querySelectorAll('[data-accept-cand]'), function(btn){
      btn.onclick = function(){
        var accepted = removeCandidateById(btn.getAttribute('data-accept-cand'));
        if (accepted) {
          isl2.sentences.push(accepted);
          saveIslands(islands);
        }
        if (ist.candidates.length === 0) backToDetailAfterReview();
        else renderIslands();
      };
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-reject-cand]'), function(btn){
      btn.onclick = function(){
        removeCandidateById(btn.getAttribute('data-reject-cand'));
        if (ist.candidates.length === 0) backToDetailAfterReview();
        else renderIslands();
      };
    });
    document.getElementById('btnAcceptAllCand').onclick = function(){
      isl2.sentences = isl2.sentences.concat(ist.candidates);
      saveIslands(islands);
      backToDetailAfterReview();
    };
    document.getElementById('btnDiscardAllCand').onclick = function(){
      backToDetailAfterReview();
    };
    document.getElementById('btnDoneReview').onclick = function(){
      backToDetailAfterReview();
    };
    return;
  }
}
