// One spelling everywhere: American "license", as the LICENSE file and the MIT text spell it.
// The scan walks the folders (not git), so a clean export without history is gated the same way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEXT = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.html', '.css', '.gd', '.cfg', '.cmd', '.yml', '.txt', '']);
const SKIP = new Set(['node_modules', '.git', '.claude', 'fixtures', 'fonts']);
// Built from parts so this file stays free of the spelling it bans.
const BRITISH = new RegExp('licen' + 'ce', 'i');
// The one place the old spelling is still read: the add-on's command-line flag keeps its alias.
const ALLOWED = new Set(['tools/spine-addon.js']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (TEXT.has(path.extname(entry.name)) && fs.statSync(full).size < 2_000_000) out.push(full);
  }
  return out;
}

test('the project spells it "license" everywhere (one spelling, as LICENSE has it)', () => {
  const bad = [];
  for (const file of walk(ROOT)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => { if (BRITISH.test(line) && !ALLOWED.has(rel)) bad.push(`${rel}:${i + 1}`); });
  }
  assert.deepEqual(bad, []);
  assert.match(fs.readFileSync(path.join(ROOT, 'tools/spine-addon.js'), 'utf8'), /args\.has\('--accept-license'\)/);
});
