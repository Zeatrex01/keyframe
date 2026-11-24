// Nothing personal enters the repository: no machine-local config, secret or recording is tracked,
// no tracked text carries a home-folder path or a personal e-mail address, and nothing records a
// person: no quotes, remarks or dated decisions attributed to someone, no translated chat, no
// maintainer name or handle outside the license line and the repository address. Decisions are
// written as product rationale. A public tool's examples use placeholders ("you", "user") instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { packageFiles } from '../src/core/zip.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The tracked files when this is a git checkout, else every file a package would carry.
function trackedFiles() {
  const git = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  if (git.status === 0 && git.stdout) return git.stdout.split('\0').filter(Boolean);
  return packageFiles(ROOT);
}

const MACHINE_LOCAL = /(^|\/)(studio\.config\.json|\.mcp\.json|\.env(\..*)?|settings\.local\.json|\.DS_Store|Thumbs\.db)$|(^|\/)(\.keyframe|\.backup|\.codex|reference|references|logs)\/|\.(mp4|mov|webm|mkv|log|pem|key)$/i;
const TEXT = /\.(js|mjs|cjs|json|md|html|css|txt|yml|yaml|atlas|cmd|webmanifest)$/i;
// A home folder followed by a real-looking user name; the placeholders are allowed.
const HOME_PATH = /(?:\b[A-Za-z]:[\\/]+Users[\\/]+|\/Users\/|\/home\/)(?!(?:you|sen|user|runner|me|name|<)[\\/"'`\s,)])[A-Za-z0-9._-]{2,}/;
// An e-mail address that is not a placeholder or a no-reply address (a URL's user part, after // or :, is not one;
// nor is a file name such as ui@3x.json, icon@1.5x.png or clip@sheet.json).
const EMAIL = /(?<![/:A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@(?!\d+(?:\.\d+)?x\.)(?!(?:example\.(?:com|org|net)|users\.noreply\.github\.com|anthropic\.com|evil\.org)\b)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?!(?:json|png|jpe?g|svg|webp|gif|atlas|skel|txt|js|mjs|cjs|tres|tscn)\b)[A-Za-z]{2,}\b/;

export function personalIn(text) {
  return [HOME_PATH.exec(text)?.[0], EMAIL.exec(text)?.[0]].filter(Boolean);
}

// Remarks attributed to a person. "The owner" is also the product's word for whoever uses the
// studio ("the owner's source is never written"), so only the shapes that record a particular
// person are banned: a dated or quoted remark, a decision or report by someone, translated chat.
const REMARK = [
  /\b[Oo]wner(?:'s)? (?:decision|decided|decisions|amendment|report|brief|hand-over)\b|\(owner pick\)/,
  /\b[Oo]wner(?:'s)?(?: [a-z]+)?,? \(?\d{4}-\d{2}(?:-\d{2})?/,
  /\(\s*[Oo]wner\b[^)]{0,40}\d{4}-\d{2}/,
  /\b(?:the )?owner (?:said|called|rejected|found|noticed|liked|had to)\b/i,
  /\bowner's (?:(?:own |Windows )?PC|machine|computer|live game|own exports|Turkish|screen recording)\b/i,
  /\btranslated from\b|\((?:quote, )?translated\)|\bQuotes? \(translated/i,
  /\bas the owner asked\b/i,
];
// The maintainer's name and handle; the handle is allowed in the license line and the repository address.
const NAME = new RegExp(['\\bene' + 's\\b', '\\baks' + 'u\\b', 'zeat' + 'rex'].join('|'), 'i');
const ALLOWED_HANDLE = new RegExp('(?:https://github\\.com/)?' + 'Zeat' + 'rex01/keyframe(?:-studio)?(?:\\.git)?\\b|Copyright \\(c\\) \\d{4} ' + 'Zeat' + 'rex01\\b', 'g');

/** Remarks about a person, or the maintainer's name outside the allowed places, in one text. */
export function remarksIn(text) {
  const hits = REMARK.map(re => re.exec(text)?.[0]).filter(Boolean);
  const name = NAME.exec(text.replace(ALLOWED_HANDLE, ''))?.[0];
  return name ? [...hits, name] : hits;
}

test('no machine-local config, secret, project working folder or recording is tracked', () => {
  const found = trackedFiles().filter(f => MACHINE_LOCAL.test(f));
  assert.deepEqual(found, []);
});

test('no tracked text carries a home-folder path or a personal e-mail address', () => {
  const found = [];
  for (const rel of trackedFiles()) {
    if (!TEXT.test(rel) || rel.startsWith('vendor/')) continue;
    let text;
    try { text = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
    for (const hit of personalIn(text)) found.push(`${rel}: ${hit}`);
  }
  assert.deepEqual(found, []);
});

test('no tracked text records a person: no quoted or dated remarks, no translated chat, no name', () => {
  const found = [];
  for (const rel of trackedFiles()) {
    if (!TEXT.test(rel) || rel.startsWith('vendor/') || rel === 'test/privacy.test.js') continue;
    let text;
    try { text = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
    text.split('\n').forEach((line, i) => { for (const hit of remarksIn(line)) found.push(`${rel}:${i + 1}: ${hit}`); });
  }
  assert.deepEqual(found, [], found.join('\n'));
});

test('the remark gate catches each shape and lets the product sense of "owner" through', () => {
  for (const bad of ['(owner decision, 2026-11-24)', 'Owner, 2026-08-07: "you burn tokens"', 'the owner said it was slow',
    'tested on the owner\'s Windows PC', 'Quote (translated from Turkish)', 'needs owner decision', 'as the owner asked',
    'Built 2026-11-23 (owner pick)', 'see ' + 'Ene' + 's', 'github.com/' + 'Zeat' + 'rex01/other']) {
    assert.ok(remarksIn(bad).length, bad);
  }
  for (const fine of ['The owner\'s source file is never written.', 'the owner\'s words never reach a shell', 'scenes and genes',
    'https://github.com/' + 'Zeat' + 'rex01/keyframe-studio/issues/10', 'Copyright (c) 2026 ' + 'Zeat' + 'rex01 and the contributors',
    'a decision recorded in docs/concept.md', 'the stop the owner asked for', 'what the owner pointed at', 'the owner\'s pick']) {
    assert.deepEqual(remarksIn(fine), [], fine);
  }
});

test('the gate catches a home path and an address, and lets placeholders through', () => {
  // Built from parts so this file does not trip its own gate.
  const home = ['C:', 'Users', 'alice', 'rig'].join('\\');
  assert.equal(personalIn(home).length, 1);
  assert.equal(personalIn('/' + 'home/bob/x').length, 1);
  assert.equal(personalIn('mail ' + 'bob' + '@' + 'company.io').length, 1);
  assert.equal(personalIn('e.g. C:\\Games\\Hero or /Users/you/hero').length, 0);
  assert.equal(personalIn('https://user:pw@vimeo.com/1 https://user@vimeo.com/1').length, 0, 'a URL user part is not an address');
  assert.equal(personalIn('ui@3x.json icon@1.5x.png sheet@2x.webp clip-press@sheet.json').length, 0, 'a file name is not an address');
  assert.equal(personalIn('mail ' + 'bob' + '@' + '3m.com').length, 1, 'a domain that starts with a digit still counts');
  assert.equal(personalIn('noreply@anthropic.com, a@example.com, 1+x@users.noreply.github.com').length, 0);
  assert.ok(MACHINE_LOCAL.test('examples/cat/.keyframe/chat.jsonl'));
  assert.ok(MACHINE_LOCAL.test('reference/run.mp4'));
  assert.ok(!MACHINE_LOCAL.test('src/mcp/tools/reference.js'));
});
