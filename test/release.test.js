// The release rules (docs/development.md#releasing): one version, stated the same in VERSION and
// package.json, semantic versioning, and a CHANGELOG with an Unreleased section on top and notes
// for every released version.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sectionOf } from '../tools/release-notes.js';

const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;

test('VERSION and package.json state the same semantic version', () => {
  const version = read('VERSION').trim();
  assert.match(version, SEMVER);
  assert.equal(JSON.parse(read('package.json')).version, version);
});

test('CHANGELOG.md starts with Unreleased and has notes for the current version', () => {
  const changelog = read('CHANGELOG.md');
  const headings = changelog.split('\n').filter(l => l.startsWith('## ')).map(l => l.slice(3).replace(/[[\]]/g, '').split(/\s/)[0]);
  assert.equal(headings[0], 'Unreleased', 'the first section collects what is not released yet');
  for (const v of headings.slice(1)) assert.match(v, SEMVER, `"## ${v}" is a version`);
  assert.ok(headings.includes(read('VERSION').trim()), 'the current version has its section');
  assert.ok(sectionOf(changelog, read('VERSION').trim()), 'and it is not empty');
});

test('the notes of one version are its section only', () => {
  const text = '# C\n\n## Unreleased\n\n- next\n\n## [1.2.0] - 2026-01-01\n\n### Added\n- a\n\n## 1.1.0\n\n- b\n';
  assert.equal(sectionOf(text, '1.2.0'), '### Added\n- a');
  assert.equal(sectionOf(text, '1.1.0'), '- b');
  assert.equal(sectionOf(text, '1.1'), null, 'no prefix match');
  assert.equal(sectionOf(text, '9.9.9'), null);
});

test('the package has no runtime dependency, and the developer tools are pinned exactly (ADR-6)', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies']) assert.equal(pkg[field], undefined, `no ${field}`);
  for (const [name, range] of Object.entries(pkg.devDependencies ?? {})) assert.match(range, /^\d+\.\d+\.\d+$/, `${name} is pinned to one version`);
  assert.deepEqual(Object.keys(pkg.devDependencies ?? {}).sort(), ['@types/node', 'eslint', 'typescript'], 'a new developer tool is a maintainer decision');
});
