#!/usr/bin/env node
// Smoke test: serves the app locally, opens it in a fresh headless Chrome
// profile, clicks through the main flows and reports every JS error and
// every failed expectation. Gemini is replaced by a mock, so no API key or
// network is needed and nothing costs money. Your real app data is never
// touched (throwaway profile).
//
//   node tools/smoke-test.js           run headless
//   node tools/smoke-test.js --show    watch it in a visible Chrome window
//
// Needs Node 22+ (built-in fetch/WebSocket) and Chrome/Chromium. Set CHROME
// to the browser binary if it isn't found automatically. Exit code 0 = all ok.
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SHOW = process.argv.includes('--show');
const STEP_TIMEOUT_MS = 15000;

// ---------- static file server ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml'
};
function startServer(){
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------- Chrome + DevTools protocol ----------
function findChrome(){
  if (process.env.CHROME) return process.env.CHROME;
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(mac)) return mac;
  for (const name of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    const r = cp.spawnSync('which', [name], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  throw new Error('Chrome not found — set the CHROME environment variable.');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launchChrome(profile){
  const args = ['--no-first-run', '--no-default-browser-check', '--disable-gpu', '--user-data-dir=' + profile,
    '--remote-debugging-port=0', '--window-size=1280,900', 'about:blank'];
  if (!SHOW) args.unshift('--headless=new');
  const proc = cp.spawn(findChrome(), args, { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  return { proc, ws };
}

function cdp(ws, onEvent){
  let id = 0;
  const pending = {};
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending[msg.id]) { pending[msg.id](msg); delete pending[msg.id]; }
    else if (msg.method) onEvent(msg);
  };
  return (method, params) => new Promise((resolve, reject) => {
    const i = ++id;
    const timer = setTimeout(() => reject(new Error('CDP timeout: ' + method)), STEP_TIMEOUT_MS);
    pending[i] = msg => { clearTimeout(timer); resolve(msg); };
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
}

// ---------- Gemini mock and other page stubs (injected before the app loads) ----------
const PAGE_STUBS = `
(function(){
  var seed = 12345;
  Math.random = function(){ seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  // pretend to be a German phone, so the first start picks German
  Object.defineProperty(navigator, 'languages', { get: function(){ return ['de-DE', 'en-US']; } });
  window.confirm = function(){ return true; };
  // Don't let downloads (e.g. "Alles sichern") really start: Chrome would show a
  // desktop notification. Record the file name instead.
  window.__downloads = [];
  var realClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function(){
    if (this.hasAttribute('download')) { window.__downloads.push(this.download); return; }
    return realClick.apply(this, arguments);
  };
  window.alert = function(){};
  window.__spoken = [];
  if (window.speechSynthesis) window.speechSynthesis.speak = function(u){ window.__spoken.push(u.text); };
  window.__prompts = [];
  var n = 0;
  var SENT = ['我们去公园。|Wǒmen qù gōngyuán.|We go to the park.', '今天天气很好。|Jīntiān tiānqì hěn hǎo.|The weather is nice today.',
    '我想喝水。|Wǒ xiǎng hē shuǐ.|I want to drink water.', '他是我的朋友。|Tā shì wǒ de péngyou.|He is my friend.'];
  function reply(text){ return Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: text }] } }] }), { status: 200 })); }
  var realFetch = window.fetch;
  window.fetch = function(url, opts){
    url = String(url);
    if (url.indexOf('generativelanguage.googleapis.com') < 0) return realFetch.apply(this, arguments);
    if (url.indexOf('/v1beta/models?') >= 0) {
      var g = ['generateContent'];
      return Promise.resolve(new Response(JSON.stringify({ models: [
        { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: g },
        { name: 'models/gemini-9.9-flash-lite', supportedGenerationMethods: g },
        { name: 'models/gemini-9.9-flash-lite-preview-01-2030', supportedGenerationMethods: g },
        { name: 'models/gemini-9.9-flash-lite-tts', supportedGenerationMethods: g }
      ] }), { status: 200 }));
    }
    var prompt = JSON.parse(opts.body).contents[0].parts[0].text;
    window.__prompts.push(prompt);
    n++;
    var count = parseInt((/Number of sentences: (\\d+)/.exec(prompt) || [])[1], 10) || 3;
    var lines = [];
    if (/short story/.test(prompt)) {
      lines.push('小故事|Xiǎo gùshi|A short story');
      for (var i = 0; i < count; i++) lines.push(SENT[i % SENT.length]);
    } else if (/Translate the following English sentence/.test(prompt)) {
      lines.push('我想喝咖啡。|Wǒ xiǎng hē kāfēi.|I would like a coffee.');
    } else if (/speech recognition/.test(prompt)) {
      lines.push('我们去公园。|Wǒmen qù gōngyuán.|We go to the park.');
    } else if (/example sentences/.test(prompt)) {
      for (var k = 0; k < 3; k++) lines.push('例句' + n + '_' + k + '。|lìjù|example ' + n + '_' + k);
    } else {
      for (var j = 0; j < count; j++) lines.push('句子' + n + '_' + j + '。|jùzi|sentence ' + n + '_' + j);
    }
    return reply(lines.join('\\n'));
  };
})();`;

// ---------- test runner ----------
async function main(){
  const server = await startServer();
  const base = 'http://127.0.0.1:' + server.address().port + '/index.html';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hsk-smoke-'));
  const errors = [];
  const foreign = []; // requests to anything but the local server (Gemini is mocked inside the page)
  const results = [];
  let chrome;

  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail });
    console.log((ok ? '  \x1b[32m✓\x1b[0m ' : '  \x1b[31m✗\x1b[0m ') + name + (!ok && detail !== undefined ? '  → ' + JSON.stringify(detail) : ''));
  };

  try {
    chrome = await launchChrome(profile);
    const send = cdp(chrome.ws, msg => {
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push((d.exception && d.exception.description) || d.text);
      }
      if (msg.method === 'Network.requestWillBeSent') {
        const u = msg.params.request.url;
        if (!/^(data:|blob:|about:|chrome)/.test(u) && u.indexOf(base.replace('/index.html', '')) !== 0) foreign.push(u);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push('console.error: ' + msg.params.args.map(a => a.value || a.description).join(' '));
      }
    });
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result.exceptionDetails) throw new Error('evaluate failed: ' + expr.slice(0, 80) + ' → ' +
        ((r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text));
      return r.result.result.value;
    };
    const click = (sel) => ev('(function(){ var e = document.querySelector(' + JSON.stringify(sel) + '); if (!e) throw new Error("missing ' + sel.replace(/"/g, "'") + '"); e.click(); return true; })()');
    const exists = (sel) => ev('!!document.querySelector(' + JSON.stringify(sel) + ')');
    const count = (sel) => ev('document.querySelectorAll(' + JSON.stringify(sel) + ').length');
    async function waitFor(expr, ms){
      const until = Date.now() + (ms || 5000);
      while (Date.now() < until) { if (await ev(expr)) return true; await sleep(100); }
      return false;
    }
    async function load(){ await send('Page.navigate', { url: base }); await waitFor('typeof render === "function" && document.readyState === "complete"', 10000); await sleep(400); }
    async function reload(){ await send('Page.reload'); await sleep(300); await waitFor('typeof render === "function" && document.readyState === "complete"', 10000); await sleep(400); }

    // A failure inside one area is recorded and the run continues with the next area.
    async function section(name, fn){
      console.log(name);
      try { await fn(); } catch (e) { check(name + ': finished without aborting', false, e.message.split('\n')[0]); }
    }

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_STUBS });

    await section('First start', async () => {
      await load();
      check('welcome dialog on first start', await exists('#welcomeBackdrop'));
    check('first start follows the device language', (await ev('settings.lang')) === 'de');
    check('device language detection with fallback to English',
      (await ev('detectDeviceLang(["fr-CA"])')) === 'fr' && (await ev('detectDeviceLang(["ja-JP", "es-MX"])')) === 'es' && (await ev('detectDeviceLang(["ja-JP"])')) === 'en');
      await ev('document.getElementById("welcomeDontShow").checked = true; document.getElementById("welcomeGo").click(); true');
      await reload();
      check('welcome dialog stays hidden after "Nicht mehr anzeigen"', !(await exists('#welcomeBackdrop')));
      check('start screen shows free practice and streak cards', (await count('.mode-card')) === 2);
      // the demo story with its narration is added once in the background
      await waitFor('stories.some(function(s){ return s.demo; }) && recordings.some(function(r){ return r.demo; })', 15000);
      check('demo story and its recording are seeded on the first start',
        (await ev('stories.filter(function(s){ return s.demo; }).length')) === 1 &&
        (await ev('recordings.filter(function(r){ return r.demo && r.done >= r.totalSteps; }).length')) === 1);
      check('demo narration is decoded to PCM for every part',
        await ev('(function(){ var r = recordings.filter(function(x){ return x.demo; })[0]; var keys = [r.id + ":title"]; ' +
          'for (var i = 0; i < r.totalSteps - 1; i++) keys.push(r.id + ":" + i); ' +
          'return Promise.all(keys.map(idbGet)).then(function(vs){ return vs.every(function(v){ return v && v.pcm && v.pcm.length > 10000 && v.fmt.sampleRate === 24000; }); }); })()'));
      // seeding again (e.g. flag lost) must not duplicate the story or touch existing audio
      await ev('(function(){ var r = recordings.filter(function(x){ return x.demo; })[0]; window.__demoKey = r.id + ":0"; localStorage.removeItem("hskflash_demo_seeded_v1"); ' +
        'return idbSet(window.__demoKey, { fmt: { channels: 1, sampleRate: 24000, bitsPerSample: 16 }, pcm: new Uint8Array([9, 9, 9]) }).then(seedDemoStory).then(function(){ return true; }); })()');
      check('re-seeding keeps existing audio and adds no duplicate',
        JSON.stringify(await ev('idbGet(window.__demoKey).then(function(v){ return Array.from(v.pcm); })')) === '[9,9,9]' &&
        (await ev('stories.filter(function(s){ return s.demo; }).length')) === 1);
    check('MP3 encoder (vendored lamejs) is loaded', await ev('typeof lamejs === "function"'));
    });
    await section('Gemini key and model detection', async () => {
      await ev('localStorage.setItem("hskflash_gemini_key_v1", "FAKE"); true');
      await ev('detectGeminiModels(true)');
      check('newest stable flash-lite model is picked (preview ignored)', (await ev('loadGeminiModel()')) === 'gemini-9.9-flash-lite', await ev('loadGeminiModel()'));
      check('TTS model is picked', (await ev('loadGeminiTtsModel()')) === 'gemini-9.9-flash-lite-tts', await ev('loadGeminiTtsModel()'));
    });
    await section('Free practice', async () => {
      await click('#btnStart');
      check('a card is shown', await exists('#hanziText'));
      for (let i = 0; i < 6; i++) {
        await click('.rate-btn[data-val="' + [2, 5, 1, 0, 2, 5][i] + '"]');
        await sleep(1000);
      }
      check('ratings are saved to progress', (await ev('Object.keys(progress).filter(function(k){ return progress[k].lvl > 0; }).length')) > 0);
      // pause, reload, resume the free round
      const roundIds = JSON.stringify(await ev('session.ids'));
      const roundPts = JSON.stringify(await ev('session.sessionPts'));
      await click('#btnPause');
      check('"Pause" goes back to the start screen with "Fortsetzen"', !(await ev('!!session')) && await exists('#btnResume'));
      await reload();
      check('paused free round survives a reload', await exists('#btnResume'));
      await click('#btnResume');
      check('"Fortsetzen" continues the same round with its points',
        JSON.stringify(await ev('session.ids')) === roundIds && JSON.stringify(await ev('session.sessionPts')) === roundPts);
      await click('#btnExamples');
      const exBefore = await ev('examplesFor(session.currentId).length');
      await click('#btnGenExamples');
      await waitFor('examplesFor(session.currentId).length > ' + exBefore);
      check('"(Weitere) Beispiele" adds 3 sentences', (await ev('examplesFor(session.currentId).length')) === exBefore + 3, { before: exBefore, after: await ev('examplesFor(session.currentId).length') });
    });
    await section('Power-Streak', async () => {
      await reload();
      await click('#btnStreak');
      // pause in the middle of the stage and continue
      await click('.rate-btn[data-grade="2"]'); await sleep(1000);
      const left = await ev('powerStreak.open.queue.length');
      await click('#btnPause');
      await reload();
      check('paused streak stage keeps its remaining cards', !(await ev('!!session')) && (await ev('powerStreak.open.queue.length')) === left && (await ev('powerStreak.level')) === 1);
      await click('#btnStreak');
      check('"Weitermachen" continues the same stage', (await ev('powerStreak.level')) === 1 && (await ev('!!(session && session.streak)')));
      for (let i = 0; i < 30 && await exists('.rate-btn[data-grade]'); i++) { await click('.rate-btn[data-grade="2"]'); await sleep(1000); }
      check('stage 1 done: streak 1 with 5 cards', (await ev('powerStreak.level')) === 1 && (await ev('Object.keys(powerStreak.cards).length')) === 5,
        { level: await ev('powerStreak.level'), cards: await ev('Object.keys(powerStreak.cards).length') });
      check('"Nur wiederholen" is offered', await exists('#btnStreakReview'));
      await click('#btnStreakReview');
      for (let i = 0; i < 30 && await exists('.rate-btn[data-grade]'); i++) { await click('.rate-btn[data-grade="1"]'); await sleep(1000); }
      check('review-only round keeps the streak level', (await ev('powerStreak.level')) === 1);
    // SRS rules on a reviewed card with an 8-day interval
    const card = '({ ease: 2.5, ivl: 8, due: 10, last: 2, reps: 3, lapses: 0 })';
    check('Nochmal makes a card due right away', (await ev('streakSchedule(' + card + ', 0, 10, false).ivl')) === 0 &&
      (await ev('streakSchedule(' + card + ', 0, 13, true).ivl')) === 0);
    check('Schwer halves the interval and never grows it', (await ev('streakSchedule(' + card + ', 1, 10, false).ivl')) === 4 &&
      (await ev('streakSchedule({ ease: 2.5, ivl: 1, due: 10, last: 9, reps: 1, lapses: 0 }, 1, 10, false).ivl')) === 1);
    check('Gut grows the interval', (await ev('streakSchedule(' + card + ', 2, 10, false).ivl')) > 8);
    });
    await section('Vocabulary grid', async () => {
      await ev('switchView("grid"); true');
      await sleep(300);
      check('pool check marks match the pool', (await count('.pool-cell.in-pool')) === (await ev('activePool().length')),
        { checks: await count('.pool-cell.in-pool'), pool: await ev('activePool().length') });
      check('streak flames match the streak cards', (await count('.pool-cell.in-streak')) === (await ev('Object.keys(powerStreak.cards).length')));
      await click('#btnFilterPool');
      check('filter "Nur Pool" shows exactly the pool', (await count('.pool-cell')) === (await ev('activePool().length')));
      await click('#btnFilterPool');
      await ev('var i = document.getElementById("gridSearch"); i.value = "xie4xie"; i.dispatchEvent(new Event("input")); true');
      await sleep(400);
      check('search "xie4xie" finds 谢谢 first', (await ev('WORD_BY_ID[document.querySelector(".pool-cell").getAttribute("data-id")].h')) === '谢谢');
      await ev('var i = document.getElementById("gridSearch"); i.value = ""; i.dispatchEvent(new Event("input")); true');
      await sleep(400);
      const poolBefore = await ev('activePool().length');
      await click('#btnPoolEdit');
      await ev('document.querySelectorAll(".pool-cell")[999].click(); true');
      check('"Pool anpassen" adds a word', (await ev('activePool().length')) === poolBefore + 1);
      await ev('document.querySelectorAll(".pool-cell")[999].click(); true');
      check('…and removes it again', (await ev('activePool().length')) === poolBefore);
      const cardsBefore = await ev('Object.keys(powerStreak.cards).length');
      await click('#btnStreakEdit');
      await ev('document.querySelectorAll(".pool-cell")[999].click(); true');
      check('"Streak anpassen" adds a card', (await ev('Object.keys(powerStreak.cards).length')) === cardsBefore + 1);
      await ev('document.querySelectorAll(".pool-cell")[999].click(); true');
      check('…and removes it again', (await ev('Object.keys(powerStreak.cards).length')) === cardsBefore);
      await click('#btnStreakEdit');
    });
    await section('Stories', async () => {
      await ev('switchView("stories"); true');
      await click('#btnNewStory');
      await click('#btnGenStory');
      await waitFor('!!document.getElementById("btnAdoptStory")');
      await click('#btnAdoptStory');
      await sleep(300);
      check('story sentence is split into word spans', (await count('#sentHanzi .sent-word')) > 0);
      await click('#sentHanzi .sent-word');
      check('tapping a word shows its info', (await ev('document.getElementById("gridInfoToast").textContent')).indexOf('·') > 0);
      await click('#btnSentToPool');
      await click('#btnBackToLibrary2');
      check('demo story shows its badge in the library, the own story not', (await count('#storiesView .story-card .demo-badge')) === 1 && (await count('#storiesView .story-card')) === 2);
      await ev('switchView("audio"); true'); await sleep(300);
      check('demo recording shows its badge in the audio tab', (await count('#audioView .demo-badge')) === 1);
      await ev('switchView("stories"); true');
      await click('.story-card[data-id]:not(:has(.demo-badge)) [data-toprow-id]');
      check('"Satz in den Pool" reports a result', (await ev('document.getElementById("gridInfoToast").textContent')).length > 0);
    });
    await section('Sentence islands', async () => {
      await ev('switchView("islands"); true');
      await click('#btnNewIsland');
      await ev('document.getElementById("inpNewIslandName").value = "Smoke"; document.getElementById("inpNewIslandHsk").value = "hsk2"; true');
      await click('#btnCreateIsland');
      await click('.story-card');
      await click('#btnAddSentences');
      await waitFor('!!document.getElementById("btnAcceptAllCand")');
      check('island prompt asks for its HSK level', /HSK 2 or below/.test(await ev('__prompts[__prompts.length - 1]')));
      await click('#btnAcceptAllCand');
      check('accepted sentences are added to the island', (await ev('islands[islands.length - 1].sentences.length')) > 0);
    });
    await section('Stats, audio, settings', async () => {
      await ev('switchView("stats"); true'); await sleep(300);
      check('stats tab renders', (await ev('document.getElementById("statsPageView").innerText.length')) > 50);
      await ev('switchView("audio"); true'); await sleep(300);
      await ev('switchView("cards"); true');
      await click('#btnSettings');
      await ev('var p = document.getElementById("inpPool"); p.value = 50; p.dispatchEvent(new Event("change")); true');
      // Base pool follows the setting; the number shown includes words added by hand.
      const strip = parseInt(await ev('document.getElementById("statsStrip").innerText'), 10);
      check('pool size change applies right away', (await ev('basePool().length')) === 50 && strip === (await ev('activePool().length')),
        { base: await ev('basePool().length'), shown: strip, pool: await ev('activePool().length') });
      await ev('var p = document.getElementById("inpPool"); p.value = 300; p.dispatchEvent(new Event("change")); closeDrawer(); true');
      await click('.lang-option[data-lang="en"]');
      check('language switch translates the UI', (await ev('document.getElementById("tabCards").textContent')) === 'Cards');
      await click('.lang-option[data-lang="de"]');
    });
    await section('Mobile layout', async () => {
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await sleep(500);
      check('mobile carousel is active', await ev('document.getElementById("learnArea").classList.contains("carousel")'));
      await send('Emulation.clearDeviceMetricsOverride');
    });
    await section('Full backup and restore', async () => {
      // Audio is stored as {fmt, pcm: Uint8Array view}; use a sub-view like the app does.
      await ev('idbSet("smoke:0", { fmt: { sampleRate: 24000 }, pcm: new Uint8Array([1, 2, 3, 250]).subarray(1) }).then(function(){ return true; })');
      const before = { examples: await ev('Object.keys(generatedExamples).length'), level: await ev('powerStreak.level') };
      const raw = await ev('buildFullBackup().then(function(d){ window.__bk = JSON.stringify(d); return window.__bk; })');
      const bk = JSON.parse(raw);
      check('backup contains progress, streak, stories and islands', ['hskflash_progress_v1', 'hskflash_streak_v1', 'hskflash_stories_v1', 'hskflash_islands_v1'].every(k => k in bk.localStorage));
      check('backup contains example sentences and audio', Object.keys(bk.examples).length === before.examples && !!bk.audio['smoke:0'],
        { examples: Object.keys(bk.examples).length, expected: before.examples, audio: Object.keys(bk.audio) });
      check('backup leaves out the API key', !('hskflash_gemini_key_v1' in bk.localStorage));
      await click('#btnSettings');
      await click('#btnBackupAll');
      await waitFor('!!localStorage.getItem("hskflash_last_backup_v1")', 8000);
      check('"Alles sichern" button offers the backup file and notes the date',
        /^hskflash-backup-.*\.json$/.test((await ev('window.__downloads.join(",")'))) && /heute/.test(await ev('document.getElementById("backupInfo").textContent')),
        { downloads: await ev('window.__downloads'), info: await ev('document.getElementById("backupInfo").textContent') });
      await ev('closeDrawer(); true');
      // wipe everything, then restore (the app reloads itself)
      await ev('Object.keys(localStorage).filter(function(k){ return k.indexOf("hskflash_") === 0 && k !== "hskflash_gemini_key_v1"; }).forEach(function(k){ localStorage.removeItem(k); }); ' +
        'Promise.all([replaceWholeStore(openExamplesDB, EXAMPLES_STORE, {}), replaceWholeStore(openAudioDB, AUDIO_STORE, {})]).then(function(){ return true; })');
      await ev('restoreFullBackup(JSON.parse(window.__bk)).then(function(){ return true; })');
      await sleep(800);
      await waitFor('typeof render === "function" && document.readyState === "complete"', 10000);
      await sleep(600);
      check('restore brings back streak, story and island', (await ev('powerStreak.level')) === before.level && (await ev('stories.length')) === 2 && (await ev('islands.length')) === 1);
      check('restore brings back the example sentences', (await ev('Object.keys(generatedExamples).length')) === before.examples);
      check('restore brings back the audio bytes exactly', JSON.stringify(await ev('idbGet("smoke:0").then(function(v){ return Array.from(v.pcm); })')) === '[2,3,250]');
      check('API key survives a restore', (await ev('localStorage.getItem("hskflash_gemini_key_v1")')) === 'FAKE');
    });

    await section('Persistence and offline cache', async () => {
      await reload();
      check('streak, story and island survive a reload',
        (await ev('powerStreak.level')) === 1 && (await ev('stories.length')) === 2 && (await ev('islands.length')) === 1);
      const shell = (fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').match(/var APP_SHELL = \[([\s\S]*?)\];/) || ['', ''])[1].match(/'[^']+'/g) || [];
      await waitFor('caches.keys().then(function(k){ return k.length > 0; })', 8000);
      const cached = await ev('caches.keys().then(function(ks){ return caches.open(ks[0]); }).then(function(c){ return c.keys(); }).then(function(r){ return r.length; })');
      check('service worker caches every APP_SHELL file (' + shell.length + ')', cached >= shell.length, { cached, appShell: shell.length });
    });
  } catch (e) {
    check('test run finished without aborting', false, e.message);
  } finally {
    check('no JavaScript errors', errors.length === 0, errors.slice(0, 5));
    check('no requests to third-party servers', foreign.length === 0, foreign.slice(0, 5));
    if (chrome) { try { chrome.ws.close(); } catch (e) {} chrome.proc.kill(); }
    server.close();
    await sleep(300);
    fs.rmSync(profile, { recursive: true, force: true });
  }

  const failed = results.filter(r => !r.ok).length;
  console.log('\n' + (failed ? '\x1b[31m✗ ' + failed + ' of ' + results.length + ' checks failed\x1b[0m' : '\x1b[32m✓ all ' + results.length + ' checks passed\x1b[0m'));
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
