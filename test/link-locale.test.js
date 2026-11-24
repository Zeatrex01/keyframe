// Every warning and every failure the link download can report has a sentence in BOTH page
// languages, so a new code without a translation fails here. The page renders from the codes
// (web/link-text.js); the server's English text is only the fallback for a code it does not know.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WARNING_CODES, FAILURE_CODES, classifyFailure } from '../src/core/ytdlp.js';
import { linkKey, linkWarnings, linkFailure } from '../web/link-text.js';

const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const dicts = { en: JSON.parse(read('../locale/en.json')), tr: JSON.parse(read('../locale/tr.json')) };
const ytdlpSource = read('../src/core/ytdlp.js');
const linkSource = read('../src/core/link.js');

const codesIn = (source, pattern) => [...source.matchAll(pattern)].map(m => m[1]);

test('every failure code the module can emit is listed and has a key in both locale files', () => {
  const classify = /export function classifyFailure[\s\S]*?\r?\n}\r?\n/.exec(ytdlpSource)[0];
  const emitted = new Set([
    ...codesIn(ytdlpSource, /new StudioError\('([a-z-]+)'/g),
    ...codesIn(linkSource, /new StudioError\('([a-z-]+)'/g),
    ...codesIn(classify, /return '([a-z-]+)'/g),
    ...codesIn(ytdlpSource, /code === 'unknown'/g).map(() => 'unknown'),
  ]);
  for (const code of emitted) assert.ok(FAILURE_CODES.includes(code), `FAILURE_CODES lacks "${code}"`);
  for (const code of FAILURE_CODES) for (const lang of ['en', 'tr']) {
    const key = linkKey('ref.fail', code);
    assert.ok(typeof dicts[lang][key] === 'string' && dicts[lang][key].length > 0, `${lang}.json lacks ${key}`);
  }
  // what the program's own messages classify to is covered by the same list
  for (const text of ['429', 'not a bot', 'private video', 'unsupported url', 'logged in', 'http error 404', 'http error 403', 'getaddrinfo', 'zzz'])
    assert.ok(FAILURE_CODES.includes(classifyFailure(text)), text);
});

test('every warning code has a key in both locale files, with its numbers in the sentence', () => {
  const emitted = new Set(codesIn(ytdlpSource, /warn\.push\(\{ code: '([a-z-]+)'/g).concat(codesIn(ytdlpSource, /notes\.push\(\{ code: '([a-z-]+)'/g)));
  for (const code of emitted) assert.ok(WARNING_CODES.includes(code), `WARNING_CODES lacks "${code}"`);
  for (const code of WARNING_CODES) for (const lang of ['en', 'tr']) {
    const key = linkKey('ref.warn', code);
    assert.ok(typeof dicts[lang][key] === 'string' && dicts[lang][key].length > 0, `${lang}.json lacks ${key}`);
  }
  for (const lang of ['en', 'tr']) {
    assert.match(dicts[lang]['ref.warn.lowFps'], /\{fps\}/);
    assert.match(dicts[lang]['ref.warn.moreVideos'], /\{count\}/);
    assert.match(dicts[lang]['ref.warn.probeFailed'], /\{reason\}/);
  }
});

test('the page renders warnings and failures from codes, and falls back to the server text for an unknown code', () => {
  const t = (key, vars = {}) => String(dicts.tr[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => vars[n] ?? '');
  assert.equal(linkKey('ref.warn', 'low-fps'), 'ref.warn.lowFps');
  assert.equal(linkWarnings(t, { warning: 'x', warnings: [{ code: 'low-fps', fps: 30 }] }), dicts.tr['ref.warn.lowFps'].replace('{fps}', '30'));
  assert.match(linkWarnings(t, { warning: 'x', warnings: [{ code: 'more-videos', count: 2 }, { code: 'fps-unknown' }] }), /^\S+ 2 /);
  assert.equal(linkWarnings(t, { warning: 'English text', warnings: [{ code: 'low-fps', fps: 30 }, { code: 'from-the-future' }] }), 'English text');
  assert.equal(linkWarnings(t, { warning: 'English text' }), 'English text', 'an older server without warnings');
  assert.equal(linkWarnings(t, {}), '');
  assert.match(linkFailure(t, Object.assign(new Error('English'), { code: 'rate-limited' })), /15-30 dakika/);
  assert.equal(linkFailure(t, Object.assign(new Error('Server sentence'), { code: 'from-the-future' })), 'Server sentence');
  assert.equal(linkFailure(t, new Error('No code at all')), 'No code at all');
  assert.match(linkFailure(t, Object.assign(new Error('The download failed. The program said: boom'), { code: 'unknown' })), /: boom$/);
});
