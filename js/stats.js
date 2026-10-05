// Stats tab: stats strip, calendar, detail charts.
"use strict";

function renderStats(){
  var fw = filteredWords();
  var mastered = fw.filter(function(w){ return progress[w.id] && progress[w.id].lvl >= 40; }).length;
  statsStrip.innerHTML =
    '<span><b>' + activePool().length + '</b> / ' + WORDS.length + ' ' + esc(t('statsInPool')) + '</span>' +
    '<span><b>' + mastered + '</b> ' + esc(t('statsMastered')) + '</span>' +
    '<span><b>' + settings.sessionSize + '</b> ' + esc(t('statsPerRound')) + '</span>';
}

function pickMotivationMessage(streak, pct, learned){
  if (learned === 0) return t('motivationNone');
  if (streak >= 7) return tf('motivationStreak7', streak);
  if (streak >= 2) return tf('motivationStreak2', streak);
  if (pct >= 75) return tf('motivationPct75', pct);
  if (pct >= 25) return tf('motivationPct25', pct);
  return t('motivationDefault');
}

// ---------- Stats calendar: one swipeable month, days heat-highlighted by
// how many cards were rated that day. Lives above the progress-distribution
// section on the Statistik tab. monthOffset is session-only (0 = current
// month, -1 = previous month, …), not persisted — always opens on today's
// month, matching the ephemeral "picker" state used elsewhere in the app. ----------
var calendarState = { monthOffset: 0 };
// Which detail-stats panel (if any) is expanded below the calendar, plus the
// bar chart's granularity toggle. Session-only, like calendarState.
var statsDetailState = { open: null, barGranularity: 'day' }; // open: null | 'bars' | 'curve'
var CAL_LOCALE_MAP = { de: 'de-DE', en: 'en-US', fr: 'fr-FR', es: 'es-ES' };
function calLocale(){
  return CAL_LOCALE_MAP[(settings && settings.lang) || 'de'] || 'de-DE';
}
// Same mastery bands as the "Fortschrittsverteilung" section, factored out
// so the progress curve chart uses exactly the same categorization/colors.
function computeMasteryBands(){
  var fw = WORDS;
  var bandsDef = [
    { key: 'notStarted', label: t('bandNotStarted'), min: 0, max: 0, color: 'var(--hairline)' },
    { key: 'started', label: t('bandStarted'), min: 1, max: 24, color: levelToColor(12) },
    { key: 'ongoing', label: t('bandOngoing'), min: 25, max: 49, color: levelToColor(37) },
    { key: 'advanced', label: t('bandAdvanced'), min: 50, max: 74, color: levelToColor(62) },
    { key: 'mastered', label: t('bandMastered'), min: 75, max: 100, color: levelToColor(90) }
  ];
  var counts = bandsDef.map(function(b){
    return fw.filter(function(w){
      var lvl = (progress[w.id] && progress[w.id].lvl) || 0;
      return lvl >= b.min && lvl <= b.max;
    }).length;
  });
  return { bands: bandsDef, counts: counts, total: fw.length };
}
// Heat bucket for a day's count: 0 = no activity, 1-4 = light..heavy.
function calHeatBucket(count){
  if (!count || count <= 0) return 0;
  if (count < 5) return 1;
  if (count < 10) return 2;
  if (count < 20) return 3;
  return 4;
}
function buildCalendarHtml(){
  var counts = loadDailyCounts();
  var legacyDays = {};
  loadActivityDays().forEach(function(d){ legacyDays[d] = true; });
  var now = new Date();
  var base = new Date(now.getFullYear(), now.getMonth() + calendarState.monthOffset, 1);
  var year = base.getFullYear();
  var month = base.getMonth();
  var monthTitle = base.toLocaleDateString(calLocale(), { month: 'long', year: 'numeric' });
  var todayKey = dateKeyForYMD(now.getFullYear(), now.getMonth(), now.getDate());

  // Monday-first weekday header, localized.
  var weekdayFmt = new Intl.DateTimeFormat(calLocale(), { weekday: 'short' });
  var weekdayLabels = [1,2,3,4,5,6,7].map(function(iso){
    // 2024-01-01 is a Monday — a fixed, known-good anchor to read weekday names off.
    return weekdayFmt.format(new Date(2024, 0, iso));
  });
  var weekdaysHtml = weekdayLabels.map(function(w){ return '<div class="cal-weekday">' + esc(w) + '</div>'; }).join('');

  var firstOfMonth = new Date(year, month, 1);
  var startWeekday = (firstOfMonth.getDay() + 6) % 7; // 0=Monday .. 6=Sunday
  var daysInMonth = new Date(year, month + 1, 0).getDate();

  var cellsHtml = '';
  for (var i = 0; i < startWeekday; i++) cellsHtml += '<div class="cal-day cal-day-empty"></div>';
  for (var day = 1; day <= daysInMonth; day++) {
    var key = dateKeyForYMD(year, month, day);
    var count = counts[key] || 0;
    var bucket = calHeatBucket(count);
    if (bucket === 0 && legacyDays[key]) bucket = 1; // practiced before per-day counts existed: show a light mark
    var isToday = key === todayKey;
    var cls = 'cal-day cal-heat-' + bucket + (isToday ? ' cal-today' : '');
    var titleAttr = count > 0 ? tf('calCardsTooltip', count) : t('calNoActivityTooltip');
    cellsHtml +=
      '<div class="' + cls + '" title="' + esc(titleAttr) + '">' +
        '<span class="cal-day-num">' + day + '</span>' +
        (count > 0 ? '<span class="cal-day-count">' + count + '</span>' : '') +
      '</div>';
  }

  return (
    '<div class="stats-section-title">' + esc(t('calSectionTitle')) + '</div>' +
    '<div class="cal-widget" data-cal-widget>' +
      '<div class="cal-header">' +
        '<button class="cal-nav-btn" data-cal-prev aria-label="' + esc(t('calPrevMonth')) + '">‹</button>' +
        '<div class="cal-title">' + esc(monthTitle) + '</div>' +
        '<button class="cal-nav-btn" data-cal-next aria-label="' + esc(t('calNextMonth')) + '">›</button>' +
        '<div class="cal-detail-icons">' +
          '<button class="cal-icon-btn' + (statsDetailState.open === 'bars' ? ' active' : '') + '" data-cal-icon="bars" title="' + esc(t('calDetailListTitle')) + '">📊</button>' +
          '<button class="cal-icon-btn' + (statsDetailState.open === 'curve' ? ' active' : '') + '" data-cal-icon="curve" title="' + esc(t('calDetailChartTitle')) + '">📈</button>' +
        '</div>' +
      '</div>' +
      '<div class="cal-weekdays">' + weekdaysHtml + '</div>' +
      '<div class="cal-grid" data-cal-grid>' + cellsHtml + '</div>' +
      buildStatsDetailHtml() +
    '</div>'
  );
}

// ---------- Detail-stats panels opened from the calendar's 2 icons ----------
function aggregateDailyCounts(granularity){
  var counts = loadDailyCounts();
  var now = new Date();
  var labelFmt, buckets = [];
  if (granularity === 'month') {
    var monthFmt = new Intl.DateTimeFormat(calLocale(), { month: 'short' });
    for (var m = 11; m >= 0; m--) {
      var d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      var prefix = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      var sum = 0;
      Object.keys(counts).forEach(function(k){ if (k.indexOf(prefix) === 0) sum += counts[k]; });
      buckets.push({ label: monthFmt.format(d), value: sum });
    }
  } else if (granularity === 'year') {
    var years = {};
    Object.keys(counts).forEach(function(k){ years[k.slice(0, 4)] = true; });
    years[String(now.getFullYear())] = true;
    Object.keys(years).sort().forEach(function(y){
      var sum = 0;
      Object.keys(counts).forEach(function(k){ if (k.indexOf(y) === 0) sum += counts[k]; });
      buckets.push({ label: y, value: sum });
    });
  } else { // 'day' — last 14 days including today
    var dayFmt = new Intl.DateTimeFormat(calLocale(), { day: 'numeric', month: 'numeric' });
    for (var i = 13; i >= 0; i--) {
      var dd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      var key = dateKeyForYMD(dd.getFullYear(), dd.getMonth(), dd.getDate());
      buckets.push({ label: dayFmt.format(dd), value: counts[key] || 0 });
    }
  }
  return buckets;
}
function buildBarsDetailHtml(){
  var buckets = aggregateDailyCounts(statsDetailState.barGranularity);
  var max = Math.max.apply(null, buckets.map(function(b){ return b.value; }).concat([1]));
  var hasAny = buckets.some(function(b){ return b.value > 0; });
  var barsHtml = buckets.map(function(b){
    var pct = Math.max(2, Math.round(b.value / max * 100));
    return (
      '<div class="cal-bar-col">' +
        '<div class="cal-bar-value">' + (b.value > 0 ? b.value : '') + '</div>' +
        '<div class="cal-bar-track"><div class="cal-bar-fill" style="height:' + pct + '%;"></div></div>' +
        '<div class="cal-bar-label">' + esc(b.label) + '</div>' +
      '</div>'
    );
  }).join('');
  var granOpts = ['day', 'month', 'year'].map(function(g){
    var lbl = g === 'day' ? t('calGranDay') : (g === 'month' ? t('calGranMonth') : t('calGranYear'));
    return '<button class="cal-gran-btn' + (statsDetailState.barGranularity === g ? ' selected' : '') + '" data-cal-gran="' + g + '">' + esc(lbl) + '</button>';
  }).join('');
  return (
    '<div class="cal-detail-panel">' +
      '<div class="cal-detail-head">' +
        '<span class="cal-detail-title">' + esc(t('calBarsTitle')) + '</span>' +
        '<button class="cal-detail-close" data-cal-close aria-label="' + esc(t('calCloseDetail')) + '">✕</button>' +
      '</div>' +
      '<div class="cal-gran-row">' + granOpts + '</div>' +
      (hasAny
        ? '<div class="cal-bars-row">' + barsHtml + '</div>'
        : '<div class="empty-note" style="padding:10px 0;">' + esc(t('calBarsNoData')) + '</div>') +
    '</div>'
  );
}
function buildEstimatedProgressSeries(){
  var counts = loadDailyCounts();
  var allKeys = {};
  loadActivityDays().forEach(function(d){ allKeys[d] = true; });
  Object.keys(counts).forEach(function(d){ allKeys[d] = true; });
  var today = todayStr();
  allKeys[today] = true;
  var sortedDays = Object.keys(allKeys).sort();
  var weights = sortedDays.map(function(d){ return counts[d] || 1; });
  var totalWeight = weights.reduce(function(a, b){ return a + b; }, 0) || 1;
  var mastery = computeMasteryBands();
  var learnedTotal = mastery.counts[1] + mastery.counts[2] + mastery.counts[3] + mastery.counts[4];
  var cum = 0;
  var series = sortedDays.map(function(d, i){
    cum += weights[i];
    return { date: d, value: Math.round(learnedTotal * cum / totalWeight) };
  });
  if (series.length) series[series.length - 1].value = learnedTotal; // exact today, no rounding drift
  return { series: series, ceiling: mastery.total, mastery: mastery, learnedTotal: learnedTotal };
}
function hskLevelThresholds(){
  // Cumulative word counts per HSK level of the currently active standard,
  // e.g. [150, 300, 600, ...] — the value at which that level is "complete".
  var order = HSK_ORDER || [];
  var counts = {};
  order.forEach(function(lv){ counts[lv] = 0; });
  WORDS.forEach(function(w){ if (counts.hasOwnProperty(w.hsk)) counts[w.hsk]++; });
  var cum = 0;
  return order.map(function(lv){ cum += counts[lv]; return { level: lv, upTo: cum }; });
}
function buildCurveDetailHtml(){
  var data = buildEstimatedProgressSeries();
  var W = 300, H = 130, PAD_L = 4, PAD_R = 4, PAD_T = 6, PAD_B = 6;
  var innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  var ceiling = data.ceiling || 1;
  var levels = hskLevelThresholds();

  // Scale the y-axis so TODAY's value sits at 75% height instead of always
  // stretching to the full 5000/9226 ceiling — that makes early progress
  // visible instead of a flat line hugging the bottom. The real ceiling can
  // end up above the visible area in that case (never below it).
  var visualMax = Math.min(ceiling, Math.max(data.learnedTotal / 0.75, 1));
  if (!isFinite(visualMax) || visualMax <= 0) visualMax = ceiling;

  function yFor(v, max){ var mx = max || visualMax; return PAD_T + innerH - (Math.max(0, Math.min(v, mx)) / mx) * innerH; }
  var n = data.series.length;
  function xFor(i){ return n <= 1 ? PAD_L : PAD_L + (i / (n - 1)) * innerW; }
  var linePts = data.series.map(function(p, i){ return xFor(i) + ',' + yFor(p.value); }).join(' ');
  var areaPts = linePts + ' ' + xFor(n - 1) + ',' + (PAD_T + innerH) + ' ' + xFor(0) + ',' + (PAD_T + innerH);

  // Horizontal color bands under the curve, sized by TODAY's mastery composition
  // (started/ongoing/advanced/mastered) — not a per-day historical breakdown,
  // which isn't tracked, but the current proportional split, clipped to the
  // area under the growth curve.
  var m = data.mastery;
  var cumStarted = m.counts[1];
  var cumOngoing = cumStarted + m.counts[2];
  var cumAdvanced = cumOngoing + m.counts[3];
  var cumMastered = cumAdvanced + m.counts[4]; // === data.learnedTotal
  var bandStops = [
    { from: 0, to: cumStarted, color: m.bands[1].color },
    { from: cumStarted, to: cumOngoing, color: m.bands[2].color },
    { from: cumOngoing, to: cumAdvanced, color: m.bands[3].color },
    { from: cumAdvanced, to: cumMastered, color: m.bands[4].color }
  ];
  var clipId = 'calCurveClip';
  var bandRectsHtml = bandStops.map(function(b){
    if (b.to <= b.from) return '';
    var yTop = yFor(b.to), yBot = yFor(b.from);
    return '<rect x="' + PAD_L + '" y="' + yTop + '" width="' + innerW + '" height="' + Math.max(0, yBot - yTop) + '" fill="' + b.color + '" clip-path="url(#' + clipId + ')"></rect>';
  }).join('');
  var todayLabel = data.series.length ? new Date(data.series[data.series.length - 1].date).toLocaleDateString(calLocale(), { day: 'numeric', month: 'short' }) : '';
  var startLabel = data.series.length ? new Date(data.series[0].date).toLocaleDateString(calLocale(), { day: 'numeric', month: 'short' }) : '';

  // HSK level reference lines — only the ones that fall within the visible
  // (zoomed) range are drawn; higher levels (and the real ceiling, if it's
  // above visualMax) are simply left off rather than compressing everything.
  var levelLinesHtml = levels.map(function(lv, i){
    if (lv.upTo > visualMax) return '';
    var y = yFor(lv.upTo);
    if (y < PAD_T + 1) return '';
    var label = 'HSK' + (i + 1);
    return (
      '<line x1="' + PAD_L + '" y1="' + y + '" x2="' + (PAD_L + innerW) + '" y2="' + y + '" stroke="var(--hairline)" stroke-width="1" stroke-dasharray="2,3" opacity="0.9"></line>' +
      '<text x="' + (PAD_L + innerW - 2) + '" y="' + (y - 2) + '" text-anchor="end" font-size="7" fill="var(--ink-faint)">' + esc(label) + '</text>'
    );
  }).join('');
  var ceilingLineHtml = '';
  if (ceiling <= visualMax + 0.0001) {
    var ceilingY = yFor(ceiling);
    ceilingLineHtml = '<line x1="' + PAD_L + '" y1="' + ceilingY + '" x2="' + (PAD_L + innerW) + '" y2="' + ceilingY + '" stroke="var(--ink-faint)" stroke-width="1" stroke-dasharray="3,3"></line>';
  }

  var svg =
    '<svg class="cal-curve-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
      '<defs><clipPath id="' + clipId + '"><polygon points="' + areaPts + '"></polygon></clipPath></defs>' +
      '<rect x="' + PAD_L + '" y="' + PAD_T + '" width="' + innerW + '" height="' + innerH + '" fill="var(--hairline)" opacity="0.35"></rect>' +
      bandRectsHtml +
      levelLinesHtml +
      ceilingLineHtml +
      '<polyline points="' + linePts + '" fill="none" stroke="var(--ink)" stroke-width="2"></polyline>' +
    '</svg>';

  return (
    '<div class="cal-detail-panel">' +
      '<div class="cal-detail-head">' +
        '<span class="cal-detail-title">' + esc(t('calCurveTitle')) + '</span>' +
        '<button class="cal-detail-close" data-cal-close aria-label="' + esc(t('calCloseDetail')) + '">✕</button>' +
      '</div>' +
      '<div class="cal-curve-ceiling">' + esc(tf('calCurveCeilingLabel', ceiling)) + '</div>' +
      svg +
      '<div class="cal-curve-axis"><span>' + esc(startLabel) + '</span><span>' + esc(todayLabel) + '</span></div>' +
      '<p class="drawer-note" style="margin-top:6px;">' + esc(t('calCurveEstimateNote')) + '</p>' +
    '</div>'
  );
}
function buildStatsDetailHtml(){
  if (statsDetailState.open === 'bars') return buildBarsDetailHtml();
  if (statsDetailState.open === 'curve') return buildCurveDetailHtml();
  return '';
}
function wireStatsDetailHandlers(root){
  var widget = root.querySelector('[data-cal-widget]');
  if (!widget) return;
  Array.prototype.forEach.call(widget.querySelectorAll('[data-cal-icon]'), function(btn){
    btn.onclick = function(){
      var which = btn.getAttribute('data-cal-icon');
      statsDetailState.open = (statsDetailState.open === which) ? null : which;
      renderStatsTab();
    };
  });
  var closeBtn = widget.querySelector('[data-cal-close]');
  if (closeBtn) closeBtn.onclick = function(){ statsDetailState.open = null; renderStatsTab(); };
  Array.prototype.forEach.call(widget.querySelectorAll('[data-cal-gran]'), function(btn){
    btn.onclick = function(){
      statsDetailState.barGranularity = btn.getAttribute('data-cal-gran');
      renderStatsTab();
    };
  });
}
function wireCalendarHandlers(root){
  var widget = root.querySelector('[data-cal-widget]');
  if (!widget) return;
  var prevBtn = widget.querySelector('[data-cal-prev]');
  var nextBtn = widget.querySelector('[data-cal-next]');
  if (prevBtn) prevBtn.onclick = function(){ calendarState.monthOffset -= 1; renderStatsTab(); };
  if (nextBtn) nextBtn.onclick = function(){ calendarState.monthOffset += 1; renderStatsTab(); };
  // Basic horizontal-swipe support on the day grid: left = next month, right = previous.
  var grid = widget.querySelector('[data-cal-grid]');
  if (grid) {
    var touchStartX = null, touchStartY = null;
    grid.addEventListener('touchstart', function(e){
      if (!e.touches || !e.touches.length) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    grid.addEventListener('touchend', function(e){
      if (touchStartX === null) return;
      var endX = (e.changedTouches && e.changedTouches[0] && e.changedTouches[0].clientX) || touchStartX;
      var endY = (e.changedTouches && e.changedTouches[0] && e.changedTouches[0].clientY) || touchStartY;
      var dx = endX - touchStartX;
      var dy = endY - touchStartY;
      touchStartX = null; touchStartY = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        calendarState.monthOffset += (dx < 0 ? 1 : -1);
        renderStatsTab();
      }
    }, { passive: true });
  }
}

function renderStatsTab(){
  var root = document.getElementById('statsPageView');
  if (!root) return;
  var fw = WORDS; // active standard, unfiltered — the true full deck
  var total = fw.length;
  var learned = fw.filter(function(w){ return progress[w.id] && progress[w.id].lvl > 0; }).length;
  var mastered = fw.filter(function(w){ return progress[w.id] && progress[w.id].lvl >= 40; }).length;
  var streak = computeStreak();
  var totalRatings = loadTotalRatings();
  var learnedPct = total ? Math.round(learned / total * 100) : 0;

  var bands = [
    { label: t('bandNotStarted'), min: 0, max: 0, color: 'var(--hairline)' },
    { label: t('bandStarted'), min: 1, max: 24, color: levelToColor(12) },
    { label: t('bandOngoing'), min: 25, max: 49, color: levelToColor(37) },
    { label: t('bandAdvanced'), min: 50, max: 74, color: levelToColor(62) },
    { label: t('bandMastered'), min: 75, max: 100, color: levelToColor(90) }
  ];
  var counts = bands.map(function(b){
    return fw.filter(function(w){
      var lvl = (progress[w.id] && progress[w.id].lvl) || 0;
      return lvl >= b.min && lvl <= b.max;
    }).length;
  });
  var barHtml = bands.map(function(b, i){
    var pct = total ? (counts[i] / total * 100) : 0;
    return '<div class="seg" style="width:' + pct + '%;background:' + b.color + ';"></div>';
  }).join('');
  var legendHtml = bands.map(function(b, i){
    return '<span><span class="lg-dot" style="background:' + b.color + '"></span>' + esc(b.label) + ' (' + counts[i] + ')</span>';
  }).join('');

  var hskRowsHtml = HSK_ORDER.map(function(h){
    var wordsInLevel = fw.filter(function(w){ return w.hsk === h; });
    var learnedInLevel = wordsInLevel.filter(function(w){ return progress[w.id] && progress[w.id].lvl > 0; }).length;
    // Segmented bar: one colored piece per mastery band (same red/yellow/green/blue
    // scheme as the overall distribution chart), sized to that band's real share —
    // so e.g. "10 gemeistert" shows as an actual blue slice, not just one flat color.
    var levelBandCounts = bands.map(function(b){
      return wordsInLevel.filter(function(w){
        var lvl = (progress[w.id] && progress[w.id].lvl) || 0;
        return lvl >= b.min && lvl <= b.max;
      }).length;
    });
    var segHtml = bands.map(function(b, i){
      if (i === 0 || !wordsInLevel.length) return ''; // skip "Nicht begonnen" — that's just the bare track
      var pct = levelBandCounts[i] / wordsInLevel.length * 100;
      if (pct <= 0) return '';
      return '<span class="hsk-bar-seg" style="width:' + pct + '%;background:' + b.color + ';" title="' + esc(b.label + ': ' + levelBandCounts[i]) + '"></span>';
    }).join('');
    return '<div class="hsk-progress-row">' +
      '<span class="hsk-name">' + esc(hskLabel(h)) + '</span>' +
      '<span class="hsk-bar-track">' + segHtml + '</span>' +
      '<span class="hsk-count">' + learnedInLevel + ' / ' + wordsInLevel.length + '</span>' +
    '</div>';
  }).join('');

  // --- Word/character frequency coverage (SUBTLEX-CH corpus) ---
  var learnedWordsList = fw.filter(function(w){ return progress[w.id] && progress[w.id].lvl > 0; });
  var coveredWordCount = 0;
  learnedWordsList.forEach(function(w){
    var f = FREQ_DATA.wordFreq[w.h];
    if (f) coveredWordCount += f;
  });
  var wordCoveragePct = FREQ_DATA.totalWordCorpus ? (coveredWordCount / FREQ_DATA.totalWordCorpus * 100) : 0;

  var learnedCharsSet = {};
  learnedWordsList.forEach(function(w){
    for (var ci = 0; ci < w.h.length; ci++) learnedCharsSet[w.h[ci]] = true;
  });
  var coveredCharCount = 0;
  Object.keys(learnedCharsSet).forEach(function(c){
    var cf = FREQ_DATA.charFreq[c];
    if (cf) coveredCharCount += cf;
  });
  var charCoveragePct = FREQ_DATA.totalCharCorpus ? (coveredCharCount / FREQ_DATA.totalCharCorpus * 100) : 0;

  var notLearnedWithFreq = fw.filter(function(w){
    return !(progress[w.id] && progress[w.id].lvl > 0) && FREQ_DATA.wordFreq[w.h];
  });
  notLearnedWithFreq.sort(function(a, b){ return FREQ_DATA.wordFreq[b.h] - FREQ_DATA.wordFreq[a.h]; });
  var seenHanzi = {};
  var nextWords = [];
  for (var nwi = 0; nwi < notLearnedWithFreq.length && nextWords.length < 8; nwi++) {
    var cand = notLearnedWithFreq[nwi];
    if (seenHanzi[cand.h]) continue; // same hanzi can appear as multiple entries (e.g. across standards)
    seenHanzi[cand.h] = true;
    nextWords.push(cand);
  }
  var nextWordsHtml = nextWords.length
    ? nextWords.map(function(w){
        return '<div class="freq-word-row">' +
          '<span class="freq-word-h">' + esc(w.h) + '</span>' +
          '<span class="freq-word-p">' + esc(w.p) + '</span>' +
          '<span class="freq-word-e">' + esc(w.e) + '</span>' +
        '</div>';
      }).join('')
    : '<div class="empty-note" style="padding:12px 0;">' + esc(t('nextWordsEmpty')) + '</div>';

  var freqHtml =
    '<div class="stats-section-title">' + esc(t('freqSectionTitle')) + '</div>' +
    '<div class="stat-cards">' +
      '<div class="stat-card"><div class="stat-value">' + wordCoveragePct.toFixed(1) + '<span class="unit">%</span></div><div class="stat-label">' + esc(t('freqCoverageWords')) + '</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + charCoveragePct.toFixed(1) + '<span class="unit">%</span></div><div class="stat-label">' + esc(t('freqCoverageChars')) + '</div></div>' +
    '</div>' +
    '<p class="drawer-note" style="margin:-10px 0 16px;">' + esc(t('freqNote')) + '</p>' +
    '<div class="stats-section-title">' + esc(t('nextWordsTitle')) + '</div>' +
    '<p style="font-size:12px;color:var(--ink-faint);margin:0 0 10px;">' + esc(t('nextWordsDesc')) + '</p>' +
    nextWordsHtml;

  var storiesHtml =
    '<div class="stats-section-title">' + esc(t('storiesStatsTitle')) + '</div>' +
    '<div class="stat-cards">' +
      '<div class="stat-card"><div class="stat-value">' + sentencesRead + '</div><div class="stat-label">' + esc(t('storiesSentencesReadLabel')) + '</div></div>' +
    '</div>';

  var motivation = pickMotivationMessage(streak, learnedPct, learned);

  root.innerHTML =
    '<div class="stats-wrap">' +
      '<h2 style="margin:0 0 14px;font-size:16px;">' + esc(t('statsTitle')) + '</h2>' +
      '<div class="stats-motivation">' + esc(motivation) + '</div>' +
      '<div class="stat-cards">' +
        '<div class="stat-card streak"><div class="stat-value">' + streak + '<span class="unit">' + esc(t('streakLabel')) + '</span></div><div class="stat-label">' + esc(t('streakSub')) + '</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + learnedPct + '<span class="unit">%</span></div><div class="stat-label">' + esc(tf('learnedOf', learned, total)) + '</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + mastered + '</div><div class="stat-label">' + esc(t('masteredLabel')) + '</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + totalRatings + '</div><div class="stat-label">' + esc(t('totalRatingsLabelLocal')) + '</div></div>' +
      '</div>' +
      buildCalendarHtml() +
      '<div class="stats-section-title">' + esc(t('distributionTitle')) + '</div>' +
      '<div class="level-dist-bar">' + barHtml + '</div>' +
      '<div class="level-dist-legend">' + legendHtml + '</div>' +
      '<div class="stats-section-title">' + esc(t('hskProgressTitle')) + '</div>' +
      hskRowsHtml +
      freqHtml +
      storiesHtml +
    '</div>';
  wireCalendarHandlers(root);
  wireStatsDetailHandlers(root);
}
