// Gate for src/spine/findings.js — the rule that decides what gets refused (ADR-5).
// Ported from legacy test_spine_gate.js. Its history: when the rule was extracted, a
// mutation that made nothing fresh left all 44 legacy gates green. These cases close that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finding, identity, fatalsOf, splitFatals, describe, summary } from '../src/spine/findings.js';

const f = (code, where, level = 'fatal', message = 'x') => finding(level, code, where, message);

test('with no baseline every fatal is fresh', () => {
  const now = [f('A', 'w1'), f('B', 'w2')];
  for (const base of [[], undefined, null]) {
    const r = splitFatals(base, now);
    assert.equal(r.fresh.length, 2);
    assert.equal(r.inherited.length, 0);
  }
});

test('a fatal present in the base is inherited, a new one is fresh', () => {
  const now = [f('A', 'w1'), f('B', 'w2')];
  const r = splitFatals([f('A', 'w1')], now);
  assert.deepEqual(r.fresh.map(x => x.code), ['B']);
  assert.deepEqual(r.inherited.map(x => x.code), ['A']);
  assert.equal(splitFatals(now, now).fresh.length, 0, 'identical file: nothing fresh');
  assert.equal(splitFatals([f('Z', 'w9')], now).fresh.length, 2, 'unrelated base: everything fresh');
});

test('identity is code@where; the message does not count', () => {
  assert.equal(identity(f('A', 'w1')), 'A@w1');
  const base = [f('A', 'w1', 'fatal', '3 vertices broken')];
  const now = [f('A', 'w1', 'fatal', '47 vertices broken')];
  assert.equal(splitFatals(base, now).fresh.length, 0, 'same defect, different count in the message');
  assert.equal(splitFatals([f('A', 'w1')], [f('A', 'w2')]).fresh.length, 1, 'same code elsewhere is fresh');
  assert.equal(splitFatals([f('A', 'w1')], [f('B', 'w1')]).fresh.length, 1, 'other code same place is fresh');
});

test('only fatals count, and a base warning never excuses a fatal', () => {
  const now = [f('A', 'w1', 'warn'), f('B', 'w2')];
  assert.deepEqual(splitFatals([], now).fresh.map(x => x.code), ['B']);
  assert.equal(splitFatals([f('B', 'w2', 'warn')], [f('B', 'w2')]).fresh.length, 1);
  assert.equal(fatalsOf(now).length, 1);
  assert.equal(fatalsOf(null).length, 0);
});

test('describe gives "where: message" lines; summary counts', () => {
  assert.deepEqual(describe([f('A', 'bones/root', 'fatal', 'parent missing')]), ['bones/root: parent missing']);
  assert.deepEqual(describe(null), []);
  assert.equal(summary([]), 'clean');
  assert.equal(summary([f('A', 'x', 'warn')]), '1 warning');
  assert.equal(summary([f('A', 'x'), f('B', 'y', 'warn'), f('C', 'z', 'warn')]), '1 fatal, 2 warnings');
  assert.equal(summary([f('A', 'x'), f('B', 'y')]), '2 fatals');
});

test('a finding carries stable code and params beside the English message', () => {
  const x = finding('warn', 'curve-time', 'a/b', 'msg', { cx: 0.5 });
  assert.deepEqual(x, { level: 'warn', code: 'curve-time', where: 'a/b', message: 'msg', params: { cx: 0.5 } });
  assert.deepEqual(finding('fatal', 'c', 'w', 'm').params, {});
});

test('the base-vs-current rule exists once: no other module rebuilds code@where identity', () => {
  const files = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full); else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(fileURLToPath(new URL('../src/', import.meta.url)));
  const copyOfRule = /\.code\s*\+\s*['"]@|\$\{[^}]*\.code\}@/;
  const copies = files
    .filter(file => !file.split(sep).join('/').endsWith('spine/findings.js'))
    .filter(file => copyOfRule.test(readFileSync(file, 'utf8')));
  assert.deepEqual(copies, [], 'import identity/splitFatals from src/spine/findings.js instead');
});
