// Language gate: code, tool definitions, pages, examples, tests and documents are English (docs/language-rule.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SCANNED_DIRS = ['src', 'web', 'test', 'tools', 'examples', 'locale'];
const SCANNED_EXT = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json', '.cmd']);
// locale/tr.json is the Turkish UI catalog; src/shared/legacy-names.js is the single home
// of legacy names the reader must still accept (docs/language-rule.md).
const EXEMPT = new Set(['locale/tr.json', 'src/shared/legacy-names.js']);
const SKIPPED_DIRS = new Set(['node_modules', 'vendor', 'fixtures']);
// Built from code points so this file stays free of the letters it bans.
const TURKISH_CODE_POINTS = [0xe7, 0x11f, 0x131, 0xf6, 0x15f, 0xfc, 0xc7, 0x11e, 0x130, 0xd6, 0x15e, 0xdc];
const TURKISH_LETTER = new RegExp("[" + String.fromCharCode(...TURKISH_CODE_POINTS) + "]");

function loadWords() {
  return new Set(fs.readFileSync(path.join(HERE, 'language-words.txt'), 'utf8')
    .split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')));
}

function listFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else if (SCANNED_EXT.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

// Splits camelCase, snake_case and kebab-case into lowercase words.
function wordsOf(token) {
  return token.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_\-$]+/).map(w => w.toLowerCase());
}

function findViolations(file, banned) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (EXEMPT.has(rel)) return [];
  const found = [];
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (TURKISH_LETTER.test(line)) found.push(`${rel}:${i + 1} Turkish letter`);
    for (const m of line.matchAll(/[A-Za-z_$][A-Za-z0-9_$-]*/g)) {
      const hit = wordsOf(m[0]).find(w => banned.has(w));
      if (hit) found.push(`${rel}:${i + 1} Turkish word "${hit}" in "${m[0]}"`);
    }
  });
  return found;
}

test('code, pages and tests contain no Turkish letters or Turkish words', () => {
  const banned = loadWords();
  const files = SCANNED_DIRS.flatMap(d => listFiles(path.join(ROOT, d)));
  const violations = files.flatMap(f => findViolations(f, banned));
  assert.deepEqual(violations, [], violations.join('\n'));
});

// Prose is read by every user of a public tool: the documents are English too
// (docs/language-rule.md).
function listDocs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listDocs(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

test('documents contain no Turkish letters', () => {
  const docs = [...listDocs(path.join(ROOT, 'docs')), ...listDocs(path.join(ROOT, 'examples')), ...listDocs(path.join(ROOT, '.github')),
    ...fs.readdirSync(ROOT).filter(n => n.endsWith('.md')).map(n => path.join(ROOT, n))];
  assert.ok(docs.length > 5, 'the documents were found');
  const found = docs.flatMap(file => fs.readFileSync(file, 'utf8').split('\n')
    .flatMap((line, i) => TURKISH_LETTER.test(line) ? [`${path.relative(ROOT, file)}:${i + 1}`] : []));
  assert.deepEqual(found, [], found.join('\n'));
});

test('the gate itself catches a Turkish name and a Turkish letter', () => {
  const banned = loadWords();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-lang-'));
  const probe = path.join(tmp, 'probe.js');
  // The samples are built from parts so this file does not trip its own gate.
  const word = 'kem' + 'ik';
  const letter = String.fromCharCode(0x00e7);
  fs.writeFileSync(probe, `const ${word}Listesi = 1;\nconst ok = "${letter}izgi";\nconst boneList = 2;\n`);
  const violations = findViolations(probe, banned);
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.equal(violations.length, 2, violations.join('\n'));
  assert.ok(violations[0].includes(`"${word}"`), violations[0]);
  assert.match(violations[1], /Turkish letter/);
});
