// Navigation: mobile swipe carousel, tabs and view switching.
"use strict";

// ---------- mobile swipe carousel (Vokabeln | Karten | Geschichten | Satzinseln | Statistiken | Audio) ----------
var PAGE_NAMES = ['grid', 'cards', 'stories', 'islands', 'stats', 'audio'];
var currentPage = 1; // start centered on Karten
var learnArea = document.getElementById('learnArea');

function isMobileLayout(){
  return window.matchMedia('(max-width: 820px)').matches;
}

function safeRenderStories(){
  try {
    renderStories();
  } catch (e) {
    document.getElementById('storiesView').innerHTML =
      '<div class="stories-wrap"><div class="empty-note">' + esc(t('storiesErrorPrefix')) + '<br>' +
      esc(e.message) + '<br><br>' + esc(t('storiesErrorNote')) + '</div></div>';
  }
}
function safeRenderIslands(){
  try {
    renderIslands();
  } catch (e) {
    document.getElementById('islandsView').innerHTML =
      '<div class="stories-wrap"><div class="empty-note">' + esc(t('islandsErrorPrefix')) + '<br>' +
      esc(e.message) + '<br><br>' + esc(t('storiesErrorNote')) + '</div></div>';
  }
}
function safeRenderStatsTab(){
  try {
    renderStatsTab();
  } catch (e) {
    document.getElementById('statsPageView').innerHTML =
      '<div class="stats-wrap"><div class="empty-note">' + esc(t('statsErrorPrefix')) + '<br>' +
      esc(e.message) + '<br><br>' + esc(t('storiesErrorNote')) + '</div></div>';
  }
}
function safeRenderAudioTab(){
  try {
    renderAudioTab();
  } catch (e) {
    document.getElementById('audioView').innerHTML =
      '<div class="stories-wrap"><div class="empty-note">' + esc(t('audioErrorPrefix')) +
      esc(e.message) + '<br><br>' + esc(t('storiesErrorNote')) + '</div></div>';
  }
}

function updateTabsAndDots(view){
  var activeTabEl = null;
  ['tabGrid', 'tabCards', 'tabStories', 'tabIslands', 'tabStats', 'tabAudio'].forEach(function(id, i){
    var el = document.getElementById(id);
    if (!el) return;
    var isActive = PAGE_NAMES[i] === view;
    el.classList.toggle('active', isActive);
    if (isActive) activeTabEl = el;
  });
  Array.prototype.forEach.call(document.querySelectorAll('.swipe-dots .sdot'), function(dot){
    dot.classList.toggle('on', dot.getAttribute('data-dot') === String(PAGE_NAMES.indexOf(view)));
  });
  // The tab bar itself scrolls horizontally (more tabs than fit on a phone
  // screen) — without this it stays wherever the user last scrolled it, so
  // swiping to a page like "Audio" can leave its own tab out of view even
  // though the content is showing. Keep the active tab scrolled into view
  // whenever the page changes, whether via tab tap or carousel swipe.
  // Scrolled manually (NOT via scrollIntoView): scrollIntoView walks up
  // every scrollable ancestor, and .app — clipped with overflow-x:hidden
  // so the carousel track's translateX positioning works — technically
  // counts as one, since its .learn-area child is laid out 600% wide.
  // scrollIntoView would happily give .app itself a nonzero scrollLeft,
  // which silently shifts the entire carousel out of alignment.
  var tabsContainer = document.querySelector('.view-tabs');
  if (activeTabEl && tabsContainer) {
    var target = activeTabEl.offsetLeft - (tabsContainer.clientWidth - activeTabEl.offsetWidth) / 2;
    target = Math.max(0, Math.min(target, tabsContainer.scrollWidth - tabsContainer.clientWidth));
    if (tabsContainer.scrollTo) tabsContainer.scrollTo({ left: target, behavior: 'smooth' });
    else tabsContainer.scrollLeft = target;
  }
}

function applyCarouselTransform(){
  if (!learnArea) return;
  var mobile = isMobileLayout();
  learnArea.classList.toggle('carousel', mobile);
  if (mobile) {
    learnArea.style.transform = 'translateX(-' + (currentPage * (100 / PAGE_NAMES.length)) + '%)';
    document.getElementById('cardsView').style.display = '';
    document.getElementById('storiesView').style.display = '';
    document.getElementById('islandsView').style.display = '';
    document.getElementById('statsPageView').style.display = '';
    document.getElementById('audioView').style.display = '';
  } else {
    // Restore proper desktop show/hide state — otherwise a view left visible
    // for the mobile carousel (display:'') stays visible on multiple panes at once.
    learnArea.style.transform = '';
    var desktopView = PAGE_NAMES[currentPage] === 'grid' ? 'cards' : PAGE_NAMES[currentPage];
    document.getElementById('cardsView').style.display = desktopView === 'cards' ? '' : 'none';
    document.getElementById('storiesView').style.display = desktopView === 'stories' ? '' : 'none';
    document.getElementById('islandsView').style.display = desktopView === 'islands' ? '' : 'none';
    document.getElementById('statsPageView').style.display = desktopView === 'stats' ? '' : 'none';
    document.getElementById('audioView').style.display = desktopView === 'audio' ? '' : 'none';
    updateTabsAndDots(desktopView);
  }
}

function goToPage(n){
  currentPage = Math.max(0, Math.min(PAGE_NAMES.length - 1, n));
  var view = PAGE_NAMES[currentPage];
  if (view !== 'stories' && view !== 'islands' && typeof stopNarration === 'function') stopNarration();
  applyCarouselTransform();
  updateTabsAndDots(view);
  if (view === 'stories') safeRenderStories();
  if (view === 'islands') safeRenderIslands();
  if (view === 'stats') safeRenderStatsTab();
  if (view === 'audio') safeRenderAudioTab();
}

function switchView(view){
  if (isMobileLayout()) {
    goToPage(PAGE_NAMES.indexOf(view));
    return;
  }
  // Desktop: no grid tab (sidebar is always visible), plain show/hide of the views.
  if (view === 'grid') return;
  if (view !== 'stories' && view !== 'islands') stopNarration();
  currentPage = PAGE_NAMES.indexOf(view);
  document.getElementById('tabCards').classList.toggle('active', view === 'cards');
  document.getElementById('tabStories').classList.toggle('active', view === 'stories');
  document.getElementById('tabIslands').classList.toggle('active', view === 'islands');
  document.getElementById('tabStats').classList.toggle('active', view === 'stats');
  document.getElementById('tabAudio').classList.toggle('active', view === 'audio');
  document.getElementById('cardsView').style.display = view === 'cards' ? '' : 'none';
  document.getElementById('storiesView').style.display = view === 'stories' ? '' : 'none';
  document.getElementById('islandsView').style.display = view === 'islands' ? '' : 'none';
  document.getElementById('statsPageView').style.display = view === 'stats' ? '' : 'none';
  document.getElementById('audioView').style.display = view === 'audio' ? '' : 'none';
  if (view === 'stories') safeRenderStories();
  if (view === 'islands') safeRenderIslands();
  if (view === 'stats') safeRenderStatsTab();
  if (view === 'audio') safeRenderAudioTab();
}

// Swipe / drag detection anywhere on screen (not just over the carousel track).
// Only acts when horizontal movement clearly dominates, so vertical scrolling
// and normal taps/clicks anywhere on the page are never hijacked.
(function initSwipe(){
  var startX = 0, startY = 0, dragDX = 0, dragging = false, decided = false, horizontal = false;
  var pageWidth = 0;

  function drawerOpen(){
    return drawer && drawer.classList.contains('show');
  }
  function getPoint(e){
    if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }
  function onDown(e){
    if (!isMobileLayout() || drawerOpen()) return;
    var p = getPoint(e);
    startX = p.x; startY = p.y; dragDX = 0;
    dragging = true; decided = false; horizontal = false;
    pageWidth = learnArea.getBoundingClientRect().width / PAGE_NAMES.length;
    learnArea.style.transition = 'none';
  }
  function onMove(e){
    if (!dragging) return;
    var p = getPoint(e);
    var dx = p.x - startX, dy = p.y - startY;
    if (!decided) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        decided = true;
        horizontal = Math.abs(dx) > Math.abs(dy) * 1.2;
      }
    }
    if (horizontal) {
      if (e.cancelable) e.preventDefault(); // claim the gesture: stop native scroll/back-swipe
      dragDX = dx;
      var basePx = -currentPage * pageWidth;
      var next = basePx + dx;
      var min = -(PAGE_NAMES.length - 1) * pageWidth, max = 0;
      if (next > max) next = max + (next - max) * 0.3; // rubber-band at the edges
      if (next < min) next = min + (next - min) * 0.3;
      learnArea.style.transform = 'translateX(' + next + 'px)';
    }
  }
  function onUp(){
    if (!dragging) return;
    dragging = false;
    learnArea.style.transition = '';
    if (!horizontal) return;
    var threshold = pageWidth * 0.18;
    var target = currentPage;
    // Physical drag: content follows the finger. Dragging left reveals the
    // next page to the right; dragging right reveals the page to the left.
    if (dragDX < -threshold) target = currentPage + 1;
    else if (dragDX > threshold) target = currentPage - 1;
    goToPage(target);
  }
  document.addEventListener('touchstart', onDown, { passive: true });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onUp, { passive: true });
  document.addEventListener('touchcancel', onUp, { passive: true });
  document.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
})();

window.addEventListener('resize', applyCarouselTransform);
applyCarouselTransform();

var tabGridBtn = document.getElementById('tabGrid');
var tabCardsBtn = document.getElementById('tabCards');
var tabStoriesBtn = document.getElementById('tabStories');
var tabIslandsBtn = document.getElementById('tabIslands');
var tabStatsBtn = document.getElementById('tabStats');
var tabAudioBtn = document.getElementById('tabAudio');
if (tabGridBtn) tabGridBtn.onclick = function(){ switchView('grid'); };
if (tabCardsBtn) tabCardsBtn.onclick = function(){ switchView('cards'); };
if (tabStoriesBtn) tabStoriesBtn.onclick = function(){ switchView('stories'); };
if (tabIslandsBtn) tabIslandsBtn.onclick = function(){ switchView('islands'); };
if (tabStatsBtn) tabStatsBtn.onclick = function(){ switchView('stats'); };
if (tabAudioBtn) tabAudioBtn.onclick = function(){ switchView('audio'); };
