// The formatting rules of .editorconfig, enforced: every tracked text file is UTF-8 with LF line
// ends (CRLF only for .cmd), ends with one newline, carries no trailing spaces (Markdown may, for
// a hard line break) and indents with spaces. A formatter is not a dependency: these are the rules
// that make diffs clean on every machine, and they are cheap to check.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { packageFiles } from '../src/core/zip.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEXT = /\.(js|mjs|cjs|json|md|css|html|yml|yaml|cmd|webmanifest|txt|ts|atlas)$|^(VERSION|LICENSE)$/;
const SKIP = /^(vendor|test\/fixtures|node_modules)\//;

function tracked() {
  try { return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean); }
  // Not a git checkout (a downloaded zip, a clean export with no history): every file a package
  // would carry is held to the same rules.
  catch { return packageFiles(ROOT); }
}

/** Every rule a file breaks, as short sentences. */
export function formatProblems(rel, text) {
  const problems = [];
  const cmd = rel.endsWith('.cmd');
  if (!text.length) return problems;
  if (!text.endsWith('\n')) problems.push('does not end with a newline');
  if (/\n\n$/.test(text.replace(/\r/g, '')) && !rel.endsWith('.md')) problems.push('ends with more than one newline');
  if (cmd ? /[^\r]\n/.test(text) : text.includes('\r')) problems.push(cmd ? 'a .cmd file must use CRLF' : 'uses CR line ends (LF only)');
  if (text.charCodeAt(0) === 0xfeff) problems.push('starts with a byte order mark');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const bare = line.replace(/\r$/, '');
    if (!rel.endsWith('.md') && /[ \t]+$/.test(bare)) problems.push(`line ${i + 1}: trailing whitespace`);
    if (/\.(js|json|css|html|yml|yaml)$/.test(rel) && /^\t/.test(bare)) problems.push(`line ${i + 1}: indented with a tab`);
  });
  return problems;
}

test('the rules catch what they are for', () => {
  assert.deepEqual(formatProblems('a.js', 'x\n'), []);
  assert.deepEqual(formatProblems('a.js', 'x'), ['does not end with a newline']);
  assert.deepEqual(formatProblems('a.js', 'x \n'), ['line 1: trailing whitespace']);
  assert.deepEqual(formatProblems('a.md', 'x  \n'), [], 'a Markdown hard break is allowed');
  assert.deepEqual(formatProblems('a.js', 'x\r\n'), ['uses CR line ends (LF only)']);
  assert.deepEqual(formatProblems('a.cmd', 'x\r\n'), []);
  assert.deepEqual(formatProblems('a.cmd', 'x\n'), ['a .cmd file must use CRLF']);
  assert.deepEqual(formatProblems('a.js', '\tx\n'), ['line 1: indented with a tab']);
  assert.deepEqual(formatProblems('a.js', 'x\n\n'), ['ends with more than one newline']);
});

test('every tracked text file follows .editorconfig', t => {
  const files = tracked();
  if (!files) return t.skip('not a git checkout');
  const bad = [];
  for (const rel of files) {
    if (SKIP.test(rel) || !TEXT.test(path.basename(rel)) && !TEXT.test(rel)) continue;
    let text;
    try { text = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; } // deleted in the working tree
    for (const p of formatProblems(rel, text)) bad.push(`${rel}: ${p}`);
  }
  assert.deepEqual(bad.slice(0, 30), [], `${bad.length} formatting problem(s)`);
});
