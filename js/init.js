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
  var toast = document.getElementById('gridInfoToast');
  if (!panel || !toast) return;
  var hideTimer = null;
  panel.addEventListener('click', function(e){
    var cell = e.target.closest ? e.target.closest('.pool-cell') : null;
    if (!cell) return;
    var id = parseInt(cell.getAttribute('data-id'), 10);
    var w = WORD_BY_ID[id];
    if (!w) return;
    var p = progress[id];
    var lvlPart = (p && p.seen && p.lvl > 0) ? (' · ' + t('cellLevelLabel') + ' ' + p.lvl) : '';
    toast.textContent = w.h + ' · ' + w.p + ' · ' + w.e + lvlPart;
    toast.classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function(){ toast.classList.remove('show'); }, 2600);
  });
})();

// ---------- init ----------
applyStaticTranslations();
buildPoolLegend();
buildPoolPanel();
render();
// Generated examples load asynchronously from IndexedDB; refresh what shows them.
initExamplesStore().then(function(){
  if (session && !session.finished) render();
});
