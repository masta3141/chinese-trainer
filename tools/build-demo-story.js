#!/usr/bin/env node
// Builds data/demo-story.json — the example story with its narration that is
// shipped to every user (so the stories and audio features can be seen
// without a Gemini key) — from a full app backup.
//
//   node tools/build-demo-story.js <hskflash-backup.json> <story id>
//
// The narration is converted from raw PCM to MP3 (vendored lamejs, mono,
// 48 kbit/s) to keep the download small; the app decodes it back to PCM when
// it seeds the story on the first start (seedDemoStory in js/stories.js).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const [backupFile, storyId] = process.argv.slice(2);
if (!backupFile || !storyId) { console.error('usage: node tools/build-demo-story.js <backup.json> <story id>'); process.exit(1); }

const ROOT = path.resolve(__dirname, '..');
const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor/lamejs/lame.min.js'), 'utf8'), ctx);
const lamejs = ctx.lamejs;

const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
const stories = JSON.parse(backup.localStorage.hskflash_stories_v1 || '[]');
const recordings = JSON.parse(backup.localStorage.hskflash_audio_recordings_v1 || '[]');
const story = stories.find(s => s.id === storyId);
if (!story) throw new Error('story not found: ' + storyId);
const rec = recordings.find(r => r.storyId === storyId && r.done >= r.totalSteps);
if (!rec) throw new Error('no finished recording for ' + storyId);

function toMp3(pcmBytes, sampleRate){
  const samples = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength / 2);
  const enc = new lamejs.Mp3Encoder(1, sampleRate, 48);
  const chunks = [];
  for (let i = 0; i < samples.length; i += 1152) {
    const out = enc.encodeBuffer(samples.subarray(i, i + 1152));
    if (out.length) chunks.push(Buffer.from(out));
  }
  const end = enc.flush();
  if (end.length) chunks.push(Buffer.from(end));
  return Buffer.concat(chunks);
}

let fmt = null, pcmTotal = 0, mp3Total = 0;
const audio = {};
Object.keys(backup.audio).filter(k => k.indexOf(rec.id + ':') === 0).forEach(k => {
  const v = backup.audio[k];
  const pcm = Buffer.from(v.pcm.b64, 'base64');
  fmt = v.fmt;
  if (fmt.channels !== 1 || fmt.bitsPerSample !== 16) throw new Error('unexpected audio format ' + JSON.stringify(fmt));
  const mp3 = toMp3(new Uint8Array(pcm), fmt.sampleRate);
  pcmTotal += pcm.length; mp3Total += mp3.length;
  audio[k] = mp3.toString('base64');
});

const out = {
  format: 'hskflash-demo-story-v1',
  story: Object.assign({}, story, { currentIdx: 0, demo: true }),
  recording: Object.assign({}, rec, { demo: true }),
  fmt: fmt,
  audio: audio
};
fs.writeFileSync(path.join(ROOT, 'data/demo-story.json'), JSON.stringify(out));
console.log('story "' + story.title.h + '" with ' + story.sentences.length + ' sentences, ' + Object.keys(audio).length + ' audio parts');
console.log('audio: ' + (pcmTotal / 1e6).toFixed(2) + ' MB PCM -> ' + (mp3Total / 1e6).toFixed(2) + ' MB MP3; file ' +
  (fs.statSync(path.join(ROOT, 'data/demo-story.json')).size / 1e6).toFixed(2) + ' MB');
