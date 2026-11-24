// Gate: a file URL becomes a path through fileURLToPath, never `.pathname`, which on Windows gives
// "/C:/..." and then "C:\C:\..." once joined (found on the owner's Windows machine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIRS = ['src', 'tools', 'test', 'e2e', 'examples', 'integrations'];

test('no source turns a file URL into a path with .pathname', () => {
  const offenders = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (/\.(c|m)?js$/.test(e.name) && abs !== fileURLToPath(import.meta.url)) {
        fs.readFileSync(abs, 'utf8').split('\n').forEach((line, i) => {
          if (/(import\.meta\.url|new URL\([^)]*\))\)?\.pathname/.test(line)) offenders.push(`${path.relative(ROOT, abs)}:${i + 1}`);
        });
      }
    }
  };
  for (const d of DIRS) if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
  assert.deepEqual(offenders, [], 'use fileURLToPath(new URL(...))');
});
