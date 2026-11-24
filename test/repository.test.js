// What a public repository owes the people who use it: one version, the documents a newcomer and a
// security reporter look for, and every setting the code reads written down in the README.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function sources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('the package and the VERSION file name the same version', () => {
  assert.equal(JSON.parse(read('package.json')).version, read('VERSION').trim());
});

test('the documents a newcomer and a security reporter look for are there', () => {
  for (const file of ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md', '.github/pull_request_template.md'])
    assert.ok(fs.existsSync(path.join(ROOT, file)), file);
  assert.match(read('SECURITY.md'), /security\/advisories\/new/, 'a private way to report');
  assert.match(read('README.md'), /SECURITY\.md/);
});

test('every environment setting the code reads is documented in the README', () => {
  const used = new Set();
  for (const file of [...sources(path.join(ROOT, 'src')), ...sources(path.join(ROOT, 'tools'))])
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/\bKS_[A-Z_]+\b/g)) used.add(m[0]);
  assert.ok(used.size >= 4, [...used].join(', '));
  const readme = read('README.md');
  const missing = [...used].filter(name => !readme.includes(`\`${name}\``));
  assert.deepEqual(missing, []);
});

test('the code is MIT and ships no Spine runtime code; the README says how the Spine add-on is licensed', () => {
  assert.equal(JSON.parse(read('package.json')).license, 'MIT');
  const license = read('LICENSE');
  assert.match(license, /^MIT License/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'vendor')), 'no vendored runtime: the Spine add-on downloads it on the owner\'s consent');
  for (const file of [...sources(path.join(ROOT, 'src')), ...sources(path.join(ROOT, 'web')), ...sources(path.join(ROOT, 'tools'))]) {
    // The runtime bundle's own markers: its copyright header and its namespace declaration.
    assert.ok(!/Copyright \(c\) 2013-\d{4}, Esoteric Software|var spine\s*=\s*\(/.test(fs.readFileSync(file, 'utf8')), `${file} carries no Spine runtime code`);
  }
  const readme = read('README.md');
  assert.match(readme, /Spine Runtimes License/);
  assert.match(readme, /own Spine (Editor )?licen[cs]e/);
  assert.match(read('NOTICE'), /Spine add-on/);
});

test('npm start, studio, mcp and test are scripts', () => {
  const { scripts } = JSON.parse(read('package.json'));
  for (const name of ['start', 'studio', 'mcp', 'test']) assert.ok(scripts[name], name);
});
