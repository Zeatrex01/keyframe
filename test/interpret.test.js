// Gate for reading a reference as animation (src/understand/interpret.js): beats in the
// principles' terms, and re-staging for the subject in the brief.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretMotion } from '../src/understand/interpret.js';

const jump = { duration: 1.2, tracks: {
  scale: [{ time: 0, x: 1, y: 1 }, { time: 0.2, x: 1.1, y: 0.85 }, { time: 0.45, x: 0.92, y: 1.2 }, { time: 0.9, x: 1.04, y: 0.97 }, { time: 1.2, x: 1, y: 1 }],
  translate: [{ time: 0, x: 0, y: 0 }, { time: 0.2, x: 0, y: -0.05 }, { time: 0.6, x: 0, y: 1.5 }, { time: 1, x: 0, y: -0.04 }, { time: 1.2, x: 0, y: 0 }],
}, beats: [{ from: 0, to: 1.0, kind: 'move' }, { from: 1.0, to: 1.2, kind: 'hold' }] };

test('a measured jump reads as anticipation, a main move, a peak and a settle', () => {
  const r = interpretMotion(jump);
  assert.equal(r.principles.anticipation.channel, 'translate.y');
  assert.ok(r.principles.anticipation.ratio > 0.02 && r.principles.anticipation.ratio < 0.05);
  assert.ok(r.principles.overshoot, 'it passes its end on the way back');
  assert.ok(r.reading.some(l => l.startsWith('anticipation')) && r.reading.some(l => l.startsWith('peak at 0.6')));
  assert.deepEqual(r.restage, { speed: 1, amount: 1, why: ['the reference already fits the subject: play it as measured'] });
});

test('re-staging fits the clip\'s seconds and exaggerates what would not read at the display size', () => {
  const brief = { subject: 'ui', display: { height: 96 }, clips: [{ name: 'press', seconds: 0.2 }] };
  const tap = { duration: 0.6, tracks: { scale: [{ time: 0, x: 1, y: 1 }, { time: 0.3, x: 0.98, y: 0.98 }, { time: 0.6, x: 1, y: 1 }] }, beats: [] };
  const r = interpretMotion(tap, { brief, clip: 'press' });
  assert.equal(r.restage.speed, 3, '0.6 s of reference into a 0.2 s press');
  assert.equal(r.restage.amount, 2.5, 'a 2% squeeze at 96 px is pushed to 5%');
  assert.equal(r.restage.why.length, 2);
  const typical = interpretMotion({ ...tap, duration: 1.5 }, { brief: { subject: 'ui', clips: [] } });
  assert.equal(typical.restage.speed, 6, 'a button press lasts at most 0.25 s');
});
