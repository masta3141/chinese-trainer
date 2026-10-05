// Welcome dialog: short introduction on the first start (what to begin with,
// what the tabs are for), with a "don't show again" checkbox. Can be reopened
// with the (i) button in the header.
"use strict";

var WELCOME_HIDDEN_KEY = 'hskflash_welcome_hidden_v1';

function welcomeHidden(){
  try { return localStorage.getItem(WELCOME_HIDDEN_KEY) === '1'; } catch(e) { return false; }
}

function showWelcome(){
  if (document.getElementById('welcomeBackdrop')) return;
  var tabs = [
    ['tabGrid', 'welcomeTabGrid'], ['tabCards', 'welcomeTabCards'], ['tabStories', 'welcomeTabStories'],
    ['tabIslands', 'welcomeTabIslands'], ['tabStats', 'welcomeTabStats'], ['tabAudio', 'welcomeTabAudio']
  ];
  var backdrop = document.createElement('div');
  backdrop.className = 'welcome-backdrop';
  backdrop.id = 'welcomeBackdrop';
  backdrop.innerHTML =
    '<div class="welcome-box" role="dialog" aria-modal="true" aria-labelledby="welcomeTitle">' +
      '<h2 id="welcomeTitle">' + esc(t('welcomeTitle')) + '</h2>' +
      '<p>' + esc(t('welcomeIntro')) + '</p>' +
      '<h3>' + esc(t('welcomeStartTitle')) + '</h3>' +
      '<p>' + esc(t('welcomeStart')) + '</p>' +
      '<h3>' + esc(t('welcomeTabsTitle')) + '</h3>' +
      '<ul class="welcome-tabs">' +
        tabs.map(function(tb){
          return '<li><strong>' + esc(t(tb[0])) + '</strong> – ' + esc(t(tb[1])) + '</li>';
        }).join('') +
      '</ul>' +
      '<p class="welcome-key">🔑 ' + esc(t('welcomeKeyHint')) + '</p>' +
      '<div class="welcome-foot">' +
        '<label class="welcome-check"><input type="checkbox" id="welcomeDontShow"' + (welcomeHidden() ? ' checked' : '') + '> ' +
          esc(t('welcomeDontShow')) + '</label>' +
        '<button class="btn-primary" id="welcomeGo">' + esc(t('welcomeGo')) + '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(backdrop);

  function close(){
    var hide = document.getElementById('welcomeDontShow').checked;
    try { localStorage.setItem(WELCOME_HIDDEN_KEY, hide ? '1' : '0'); } catch(e) {}
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  }
  function onKey(e){ if (e.key === 'Escape') close(); }
  document.getElementById('welcomeGo').onclick = close;
  backdrop.addEventListener('click', function(e){ if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  document.getElementById('welcomeGo').focus({ preventScroll: true });
}

function maybeShowWelcome(){
  if (!welcomeHidden()) showWelcome();
}

document.getElementById('btnShowWelcome').onclick = showWelcome;
