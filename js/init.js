// Init: service worker registration, grid tap info, first render. Loaded last.
"use strict";

// Register the service worker if one is deployed alongside this file (e.g. on
// GitHub Pages). This has no effect on claude.ai artifacts or local file://
// pages — registration just fails silently there, which is fine. Its only
// purpose is to satisfy Chrome's Android install criteria for a proper
// WebAPK-style home-screen icon instead of a browser-badged shortcut.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(function(){});
}

// ---------- grid tap-to-info (mobile has no hover tooltips) ----------
(function initGridTapInfo(){
  var panel = document.getElementById('poolPanel');
  if (!panel) return;
  panel.addEventListener('click', function(e){
    var cell = e.target.closest ? e.target.closest('.pool-cell') : null;
    if (!cell) return;
    var w = WORD_BY_ID[parseInt(cell.getAttribute('data-id'), 10)];
    if (streakEditMode) toggleStreakWord(w);
    else if (poolEditMode) togglePoolWord(w);
    else showWordToast(w);
  });
})();

// ---------- init ----------
applyStaticTranslations();
ensurePoolFilled(); // so the pool size shown before the first round is right
buildPoolLegend();
buildPoolPanel();
render();
// Generated examples load asynchronously from IndexedDB; refresh what shows them.
initExamplesStore().then(function(){
  if (session && !session.finished) render();
  return seedDemoStory(); // example story + narration, once
});
detectGeminiModels(false); // background, at most weekly
maybeShowWelcome();
