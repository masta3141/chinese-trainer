// Gemini: example sentence generation and response parsing.
"use strict";

// ---------- Gemini example generation ----------
// Faithful port of modGemini.bas: FetchMandarinExamples / CallGeminiAPI / ParseApiResponse
// existing: sentences (hanzi) the word already has — Gemini is asked for new
// ones that differ from them ("Weitere Beispiele" on the card).
function buildGeminiPrompt(targetWord, hskLevel, existing){
  return "You are a precise linguistic API for a Mandarin learning app.\n" +
    "TASK: Generate exactly 3 distinct example sentences for the provided Mandarin word.\n" +
    "INPUT PARAMETERS:\n" +
    "- Target Word: " + targetWord + "\n" +
    "- Target Level: " + hskLevel + "\n" +
    (existing && existing.length
      ? "These example sentences already exist:\n" + existing.map(function(h){ return "- " + h; }).join("\n") + "\n" +
        "Create 3 NEW sentences that differ from them in content and structure (other situations, other sentence patterns). Do not repeat or paraphrase them.\n"
      : "") +
    "STRICT OUTPUT RULES:\n" +
    "1. Output MUST contain exactly 3 lines. Nothing else.\n" +
    "2. No introduction, no markdown fences (do NOT use ```), no explanatory text.\n" +
    "3. Every sentence must strictly adhere to the requested HSK level vocabulary limit.\n" +
    "4. Each line MUST follow this exact Pipe-separated format: HANZI|PINYIN|ENGLISH";
}

function parseGeminiResponse(text){
  var lines = text.split(/\n/);
  var out = [];
  lines.forEach(function(line){
    var clean = line.replace(/\r/g, '').trim();
    if (!clean) return;
    var parts = clean.split('|');
    if (parts.length === 3) {
      out.push({ h: parts[0].trim(), p: parts[1].trim(), e: parts[2].trim() });
    }
  });
  return out;
}

function generateExamplesFor(word){
  var apiKey = loadGeminiKey();
  if (!apiKey) {
    openDrawer();
    var f = document.getElementById('inpGeminiKey');
    if (f) f.focus();
    alert(t('geminiKeyMissing'));
    return Promise.reject(new Error('no-key'));
  }
  var model = loadGeminiModel();
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
  var existing = examplesFor(word.id).map(function(ex){ return ex.h; });
  var prompt = buildGeminiPrompt(word.h, word.hsk.toUpperCase(), existing);
  var payload = { contents: [{ parts: [{ text: prompt }] }] };

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(res){
    if (!res.ok) {
      return res.text().then(function(t){
        throw new Error('HTTP ' + res.status + ': ' + t);
      });
    }
    return res.json();
  }).then(function(data){
    var text = data.candidates[0].content.parts[0].text;
    // Drop sentences the word already has (ignoring punctuation/spaces).
    var norm = function(h){ return h.replace(/[\s，。！？、,.!?；;：:“”"']/g, ''); };
    var known = {};
    existing.forEach(function(h){ known[norm(h)] = true; });
    var parsed = parseGeminiResponse(text).filter(function(ex){
      var k = norm(ex.h);
      if (known[k]) return false;
      known[k] = true;
      return true;
    });
    if (parsed.length === 0) throw new Error(existing.length ? 'Keine neuen Sätze erhalten.' : 'Antwort konnte nicht gelesen werden.');
    // Wait until the stored examples are loaded, so they aren't overwritten.
    return (examplesReady || Promise.resolve()).then(function(){
      var key = String(word.id);
      generatedExamples[key] = (generatedExamples[key] || []).concat(parsed);
      saveGeneratedExamplesFor(key);
      return parsed;
    });
  });
}
