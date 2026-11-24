// Every script in the tree parses, including the ones no gate imports (launchers, example builders),
// so a broken file is found here and not by the first person who runs it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'vendor', 'fixtures', '.git']);

function scripts(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scripts(full, out);
    else if (/\.(m|c)?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

const parses = file => new Promise(resolve => execFile(process.execPath, ['--check', file], err => resolve(!err)));

test('every script parses', async () => {
  const files = ['src', 'web', 'tools', 'examples', 'test'].flatMap(d => scripts(path.join(ROOT, d)));
  assert.ok(files.length > 100, `${files.length} scripts found`);
  const broken = [];
  for (let i = 0; i < files.length; i += 16) {
    const batch = files.slice(i, i + 16);
    const ok = await Promise.all(batch.map(parses));
    batch.forEach((f, j) => { if (!ok[j]) broken.push(path.relative(ROOT, f)); });
  }
  assert.deepEqual(broken, []);
});
