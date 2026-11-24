// tools/sync-github.js: the plan that makes the repository's labels and milestones match the files.
// Pure, so it is checked without the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, readWanted } from '../tools/sync-github.js';

const wanted = {
  labels: [
    { name: 'bug', color: 'D73A4A', description: 'Broken' },
    { name: 'feature', color: 'a2eeef', description: 'New', from: ['enhancement'] },
    { name: 'roadmap/now', color: '0e8a16', description: 'Now' },
  ],
  milestones: [{ title: 'v0.3 (Now)', label: 'roadmap/now', description: 'Now' }],
};

test('creates what is missing, renames through `from`, leaves what matches alone', () => {
  const steps = plan(wanted, {
    labels: [{ name: 'bug', color: 'd73a4a', description: 'Broken' }, { name: 'enhancement', color: 'a2eeef', description: 'x' }, { name: 'extra', color: '000000', description: '' }],
    milestones: [], issues: [],
  });
  assert.deepEqual(steps.map(s => [s.kind, s.name ?? s.title, s.current]), [
    ['update-label', 'feature', 'enhancement'],
    ['create-label', 'roadmap/now', undefined],
    ['create-milestone', 'v0.3 (Now)', undefined],
  ]);
});

test('an open issue with a roadmap label and no milestone goes into that milestone; others are left alone', () => {
  const steps = plan(wanted, {
    labels: wanted.labels.map(l => ({ ...l, color: l.color.toLowerCase() })),
    milestones: [{ number: 4, title: 'v0.3 (Now)', description: 'Now', state: 'open' }],
    issues: [
      { number: 1, labels: ['roadmap/now'], milestone: null },
      { number: 2, labels: ['roadmap/now'], milestone: 9 },
      { number: 3, labels: ['bug'], milestone: null },
      { number: 5, labels: ['roadmap/now'], milestone: null, pull: true },
    ],
  });
  assert.deepEqual(steps, [{ kind: 'set-milestone', issue: 1, title: 'v0.3 (Now)', number: 4 }]);
});

test('the files themselves are well formed and every milestone label exists', () => {
  const files = readWanted();
  const names = new Set(files.labels.map(l => l.name));
  assert.equal(names.size, files.labels.length, 'label names are unique');
  for (const l of files.labels) {
    assert.match(l.color, /^[0-9a-f]{6}$/i, `${l.name}: colour`);
    assert.ok(l.description && l.description.length <= 100, `${l.name}: a description GitHub accepts`);
  }
  for (const m of files.milestones) assert.ok(names.has(m.label), `${m.title}: its label ${m.label} is defined`);
  for (const area of ['workflow', 'agent', 'reference', 'ux', 'performance', 'distribution']) assert.ok(names.has(`area/${area}`), `area/${area}`);
});
