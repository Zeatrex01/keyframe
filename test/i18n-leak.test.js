// Gate: switching the language redraws every label, and no text of one language is hard-coded
// where the other is shown. Every exported render function of the page that reads the catalog
// (t()) and needs no argument must be reached from setLang (web/ui.js), directly or through
// another render function; otherwise its labels stay in the language the page started in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const WEB = 'web';
const TURKISH = /[\u011e\u011f\u015e\u015f\u0130\u0131]/;

/** name -> { usesCatalog, needsArgs, calls } for every exported function of the page. */
function functions() {
  const out = new Map();
  for (const file of fs.readdirSync(WEB).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(WEB, file), 'utf8');
    for (const m of src.matchAll(/export (?:async )?function (\w+)\s*\(([^)]*)\)\s*\{/g)) {
      let depth = 0, end = m.index + m[0].length - 1;
      for (; end < src.length; end++) { if (src[end] === '{') depth++; else if (src[end] === '}' && --depth === 0) break; }
      const body = src.slice(m.index + m[0].length - 1, end);
      const needsArgs = m[2].split(',').map(a => a.trim()).filter(Boolean).some(a => !a.includes('='));
      out.set(m[1], { file, usesCatalog: /\bt\(/.test(body), needsArgs, calls: new Set([...body.matchAll(/\b(\w+)\(/g)].map(c => c[1])) });
    }
  }
  return out;
}

test('switching the language redraws every label drawn from the catalog', () => {
  const all = functions();
  const reached = new Set(['setLang']);
  const queue = ['setLang'];
  while (queue.length) {
    // only through other render functions: a loader or a status update redraws when something changed, not always
    for (const name of all.get(queue.shift())?.calls ?? []) if (/^render/.test(name) && all.has(name) && !reached.has(name)) { reached.add(name); queue.push(name); }
  }
  const missed = [...all].filter(([name, f]) => /^render/.test(name) && f.usesCatalog && !f.needsArgs && !reached.has(name)).map(([name, f]) => `${f.file}: ${name}`);
  assert.deepEqual(missed, [], 'call these from setLang (web/ui.js) so their labels follow the language');
});

test('the English catalog and the page hold no Turkish text, and both catalogs have the same keys', () => {
  const en = JSON.parse(fs.readFileSync('locale/en.json', 'utf8'));
  const tr = JSON.parse(fs.readFileSync('locale/tr.json', 'utf8'));
  assert.deepEqual(Object.entries(en).filter(([, v]) => TURKISH.test(String(v))).map(([k]) => k), []);
  assert.deepEqual(Object.keys(en).sort(), Object.keys(tr).sort());
  const pages = [...fs.readdirSync(WEB).filter(f => /\.(js|html)$/.test(f)).map(f => path.join(WEB, f))];
  assert.deepEqual(pages.filter(f => TURKISH.test(fs.readFileSync(f, 'utf8'))), [], 'page text comes from locale/*.json only');
  // a role, a mode or a section is named by a catalog key, never written into the page
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  for (const word of ['Director', 'Art Director', 'Senior Animator', 'Researcher']) assert.ok(!new RegExp(`>${word}<`).test(html), `${word} is hard-coded in index.html`);
});
