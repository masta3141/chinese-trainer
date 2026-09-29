// Gemini: example sentence generation and response parsing.
"use strict";

// ---------- Gemini example generation ----------
// Faithful port of modGemini.bas: FetchMandarinExamples / CallGeminiAPI / ParseApiResponse
function buildGeminiPrompt(targetWord, hskLevel){
  return "You are a precise linguistic API for a Mandarin learning app.\n" +
    "TASK: Generate exactly 3 distinct example sentences for the provided Mandarin word.\n" +
    "INPUT PARAMETERS:\n" +
    "- Target Word: " + targetWord + "\n" +
    "- Target Level: " + hskLevel + "\n" +
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
  var prompt = buildGeminiPrompt(word.h, word.hsk.toUpperCase());
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
    var parsed = parseGeminiResponse(text);
    if (parsed.length === 0) throw new Error('Antwort konnte nicht gelesen werden.');
    var key = String(word.id);
    generatedExamples[key] = (generatedExamples[key] || []).concat(parsed);
    saveGeneratedExamples(generatedExamples);
    return parsed;
  });
}
