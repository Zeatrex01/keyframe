// Gate for src/understand/critique.js: the quality mirror. Ported from legacy test_quality.js.
//
// The contract this gate holds:
//   1. It TELLS APART dead motion from built motion (if it cannot, the tool is worthless).
//   2. Every finding carries a NUMBER and a CONCRETE fix.
//   3. It separates gross ERRORS from taste (scale <= 0 is an error; equal spacing is not).
//   4. A MIRROR, NOT A JUDGE: no finding is fatal, nothing blocks a write.
//   5. It measures consistently: the last key's curve is not counted, a dead channel does
//      not enter the rhythm measures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { critiqueAnimation, curveProfile, spacing, anticipation, overshoot, longestHold } from '../src/understand/critique.js';
import { fatalsOf } from '../src/spine/findings.js';
import { isStudioError } from '../src/shared/errors.js';

const rig = animation => ({ skeleton: { spine: '4.2' }, bones: [{ name: 'root' }, { name: 'k', parent: 'root' }],
  slots: [], skins: [], animations: { a: animation } });
const run = animation => critiqueAnimation(rig(animation), 'a');
const codes = r => r.findings.map(f => f.code);
const byCode = (r, code) => r.findings.find(f => f.code === code);
const readJson = name => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}/${name}.json`, import.meta.url), 'utf8'));

test('dead motion is caught: two linear keys, no preparation', () => {
  // Exactly what another model produces unprompted.
  const r = run({ bones: { k: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 90 }] } } });
  assert.equal(r.verdict, 'mechanical');
  assert.ok(codes(r).includes('two-key'), codes(r).join(','));
  assert.ok(codes(r).includes('no-anticipation'), 'the missing anticipation is reported');
  const f = byCode(r, 'two-key');
  assert.match(f.params.fix, /add a key/i, 'the fix says what to do');
  assert.equal(f.params.measure.movingChannels, 1, 'the finding carries a number');
  assert.equal(f.params.severity, 'weak');
  assert.equal(f.where, 'animations/a');
});

test('built motion passes clean: no false alarms', () => {
  // anticipation (-8) + main move + overshoot (96 back to 90) + a hold (0.75..1.1)
  const r = run({ bones: { k: { rotate: [
    { time: 0, value: 0, curve: [0.1, 0, 0.2, -5] },
    { time: 0.15, value: -8, curve: [0.2, -8, 0.4, 100] },
    { time: 0.5, value: 96, curve: [0.55, 96, 0.7, 90] },
    { time: 0.75, value: 90 },
    { time: 1.1, value: 90 }] } } });
  assert.equal(r.measures.anticipations, 1, 'anticipation measured');
  assert.equal(r.measures.overshoots, 1, 'overshoot measured');
  assert.ok(r.measures.longestHold >= 0.3, `hold measured: ${r.measures.longestHold}`);
  assert.ok(r.measures.linearRatio < 0.5, 'curve variety seen');
  for (const code of ['constant-speed', 'two-key', 'no-anticipation']) assert.ok(!codes(r).includes(code), code);
  assert.equal(r.verdict, 'good');
});

test('constant speed: many keys, all linear, perfectly even', () => {
  const keys = Array.from({ length: 8 }, (_, i) => ({ time: i / 7, value: i * 10 }));
  const r = run({ bones: { k: { rotate: keys } } });
  assert.ok(codes(r).includes('constant-speed'), codes(r).join(','));
  assert.ok(codes(r).includes('even-spacing'), 'perfectly equal spacing caught (the trace of sampling)');
  assert.equal(byCode(r, 'constant-speed').params.measure.linearRatio, 1, 'linear ratio given as a number');
  assert.equal(byCode(r, 'constant-speed').params.severity, 'weak');
});

test('a mostly linear clip gets the milder constant-speed note', () => {
  // 3 of 4 segments linear: 0.75, between the 0.6 and 0.9 thresholds.
  const r = run({ bones: { k: { rotate: [
    { time: 0, value: 0, curve: [0.1, 0, 0.2, 10] }, { time: 0.3, value: 20 }, { time: 0.5, value: 30 },
    { time: 0.9, value: 25 }, { time: 1, value: 0 }] } } });
  const f = byCode(r, 'constant-speed');
  assert.equal(f.params.severity, 'look');
  assert.equal(f.params.measure.linearRatio, 0.75);
});

test('an error is kept apart from taste', () => {
  const r = run({ bones: { k: { scale: [{ time: 0, x: 1, y: 1 }, { time: 1, x: 0, y: 0 }] } } });
  const f = byCode(r, 'scale-zero');
  assert.equal(f.params.severity, 'error');
  assert.equal(r.verdict, 'faulty', 'faulty, not a matter of taste');
  assert.match(f.params.fix, /alpha|attachment/, 'the right alternative is named');
  assert.equal(f.where, 'animations/a/bones/k/scale');
  assert.deepEqual(f.params.measure, { time: 1, x: 0, y: 0 });
  // Even spacing is NOT an error. First prove the critique ran (a `!some` on an empty
  // list is true too: if critique stopped producing findings this would pass silently),
  // then ask what it did not say.
  const even = Array.from({ length: 6 }, (_, i) => ({ time: i / 5, value: i * 5 }));
  const r2 = run({ bones: { k: { rotate: even } } });
  assert.ok(r2.findings.length > 0, 'the critique actually ran');
  assert.ok(!r2.findings.some(x => x.params.severity === 'error'), r2.verdict);
});

test('the 4.2 split channels are measured too (legacy was blind to them)', () => {
  const r = run({ bones: { k: { translatey: [{ time: 0, value: 0 }, { time: 1, value: 40 }] } } });
  assert.equal(r.measures.movingChannels, 1, 'translatey is a moving channel');
  assert.ok(codes(r).includes('two-key'));
  const zero = run({ bones: { k: { scalex: [{ time: 0, value: 1 }, { time: 1, value: 0 }] } } });
  const f = byCode(zero, 'scale-zero');
  assert.equal(f.where, 'animations/a/bones/k/scalex');
  assert.equal(zero.verdict, 'faulty');
  // A scalex key without a value reads as 1, as the official parser reads it: not zero.
  const neutral = run({ bones: { k: { scalex: [{ time: 0 }, { time: 1, value: 2 }] } } });
  assert.ok(!codes(neutral).includes('scale-zero'));
  assert.equal(neutral.measures.movingChannels, 1);
});

test('a symmetric sweep is moving and a sign flip is not a hold (legacy measured the magnitude)', () => {
  // x -320 -> +320 has the same vector length at both ends; legacy called it a dead channel.
  const sweep = run({ bones: { k: { translate: [{ time: 0, x: -320, y: 0 }, { time: 4, x: 320, y: 0 }] } } });
  assert.equal(sweep.measures.movingChannels, 1);
  assert.ok(codes(sweep).includes('two-key'));
  // +10 -> -10 over half a second is a move, not a hold.
  const flip = run({ bones: { k: { translate: [{ time: 0, x: 0, y: 0 }, { time: 0.5, x: 10, y: 0 }, { time: 1, x: -10, y: 0 }] } } });
  assert.equal(flip.measures.longestHold, 0);
  assert.deepEqual(longestHold([{ time: 0 }, { time: 1 }], [[10, -10], [0, 0]]), { duration: 0, time: null });
  assert.deepEqual(longestHold([{ time: 0 }, { time: 1 }], [[10, 10], [3, 3]]), { duration: 1, time: 0 });
});

test('a jump past 180 degrees in a short time is reported', () => {
  const r = run({ bones: { k: { rotate: [{ time: 0, value: 0 }, { time: 0.1, value: 270 }, { time: 1, value: 270 }] } } });
  const f = byCode(r, 'sudden-turn');
  assert.ok(f, codes(r).join(','));
  assert.match(f.params.fix, /not the shortest way/, "Spine's turning behaviour is explained");
  assert.deepEqual(f.params.measure, { time: 0.1, degrees: 270 });
  // The same jump spread over a second is a deliberate spin, not a surprise.
  const slow = run({ bones: { k: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 270 }] } } });
  assert.ok(!codes(slow).includes('sudden-turn'));
});

test('nothing ever stops: a long clip with no hold', () => {
  const r = run({ bones: { k: { rotate: [
    { time: 0, value: 0, curve: [0.2, 0, 0.4, 20] }, { time: 0.6, value: 20, curve: [0.8, 20, 1, -20] },
    { time: 1.3, value: -20, curve: [1.5, -20, 1.8, 0] }, { time: 2, value: 0 }] } } });
  const f = byCode(r, 'no-hold');
  assert.deepEqual(f.params.measure, { duration: 2, longestHold: 0 });
  // A hold of 0.3 s is enough to read.
  const held = run({ bones: { k: { rotate: [
    { time: 0, value: 0, curve: [0.2, 0, 0.4, 20] }, { time: 0.6, value: 20 }, { time: 0.9, value: 20, curve: [1, 20, 1.2, 0] },
    { time: 2, value: 0 }] } } });
  assert.ok(!codes(held).includes('no-hold'));
});

test('no colour timeline at all is an info note, and only on clips long enough to need one', () => {
  const r = run({ bones: { k: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 90 }] } } });
  assert.equal(byCode(r, 'no-alpha').params.severity, 'info');
  const short = run({ bones: { k: { rotate: [{ time: 0, value: 0 }, { time: 0.5, value: 90 }] } } });
  assert.ok(!codes(short).includes('no-alpha'));
  const withSlots = run({ bones: { k: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 90 }] } },
    slots: { s: { rgba: [{ color: 'ffffffff' }] } } });
  assert.ok(!codes(withSlots).includes('no-alpha'));
});

test('the measures are consistent with themselves', () => {
  // The last key's curve is not counted: a two-key channel is not "half linear".
  assert.deepEqual(curveProfile([{ time: 0 }, { time: 1 }]), { segments: 1, linear: 1, bezier: 0, stepped: 0, linearRatio: 1 });
  assert.deepEqual(curveProfile([{ time: 0, curve: 'stepped' }, { time: 1, curve: [0.2, 0, 0.8, 1] }, { time: 2, curve: [1, 1, 1, 1] }]),
    { segments: 2, linear: 0, bezier: 1, stepped: 1, linearRatio: 0 });
  // A dead channel (never changes) is counted, but not as moving.
  const r = run({ bones: { k: {
    rotate: [{ time: 0, value: 0 }, { time: 1, value: 0 }],
    translate: [{ time: 0, x: 0, y: 0 }, { time: 0.5, x: 30, y: 0 }, { time: 1, x: 0, y: 0 }] } } });
  assert.equal(r.measures.channels, 2);
  assert.equal(r.measures.movingChannels, 1);
  // Empty or one-key input does not crash.
  for (const broken of [{ bones: { k: { rotate: [] } } }, { bones: { k: { rotate: [{ time: 0, value: 0 }] } } }, { bones: {} }, {}]) {
    assert.doesNotThrow(() => run(broken));
  }
});

test('spacing and hold units return their numbers', () => {
  assert.equal(spacing([{ time: 0 }, { time: 1 }]), null, 'needs three keys');
  assert.deepEqual(spacing([{ time: 0 }, { time: 0.5 }, { time: 1 }]), { mean: 0.5, variation: 0 });
  assert.deepEqual(spacing([{ time: 0 }, { time: 0.25 }, { time: 1 }]), { mean: 0.5, variation: 0.5 });
  const keys = [{ time: 0 }, { time: 0.2 }, { time: 0.7 }, { time: 1 }];
  assert.deepEqual(longestHold(keys, [0, 5, 5, 0]), { duration: 0.5, time: 0.2 });
  assert.deepEqual(longestHold(keys, [0, 1, 2, 3]), { duration: 0, time: null });
});

test('a mirror, not a judge: the output says so and nothing is fatal', () => {
  const r = run({ bones: { k: { scale: [{ time: 0, x: 1, y: 1 }, { time: 0.1, x: 0, y: 0 }],
    rotate: [{ time: 0, value: 0 }, { time: 0.1, value: 270 }, { time: 1.5, value: 0 }] } } });
  assert.match(r.note, /MIRROR/, 'the output says it never blocks');
  assert.match(r.note, /can be intended/, 'mechanical motion is called legitimate (machine, robot, UI)');
  assert.ok(r.findings.length >= 3);
  assert.deepEqual(fatalsOf(r.findings), [], 'even an error-severity finding never blocks a write');
  for (const f of r.findings) {
    assert.deepEqual(Object.keys(f), ['level', 'code', 'where', 'message', 'params'], 'the findings shape');
    assert.ok(f.message.length > 10 && f.params.fix.length > 10, `${f.code} has a message and a fix`);
  }
});

test('a move that returns home is still measured, and direction is kept (blind spot, 2026-08-18)', () => {
  // (a) The textbook jump: preparation present, and the fall is NOT an overshoot.
  const jump = [0, -6, 60, 12, 0];
  assert.equal(anticipation(jump).present, true, JSON.stringify(anticipation(jump)));
  assert.equal(overshoot(jump).present, false, 'a large return is the next move, not an overshoot');
  // From a real shot (a hat rotate): preparation +4, main -102, settle -95.
  const hat = [0, 4, -102, -95, -93, 0];
  assert.equal(anticipation(hat).present, true);
  assert.equal(overshoot(hat).present, true);
  // (b) Direction: a dip down before a rise. With magnitudes both would look positive.
  const r = run({ bones: { k: { translate: [
    { time: 0, x: 0, y: 0 },
    { time: 0.2, x: 0, y: -4, curve: [0.2, 0, 0.3, 95] },
    { time: 0.6, x: 0, y: 95, curve: [0.65, 95, 0.75, 88] },
    { time: 0.8, x: 0, y: 88 },
    { time: 1.2, x: 0, y: 0 }] } } });
  assert.equal(r.measures.anticipations, 1, 'a dip DOWN before a move UP keeps its sign');
  assert.equal(r.measures.overshoots, 1);
  // No false alarms: a straight path, a take-off with no preparation, a metronome swing.
  assert.equal(anticipation([0, 10, 20, 30]).present, false);
  assert.equal(overshoot([0, 10, 20, 30]).present, false);
  assert.equal(anticipation([0, 60, 12, 0]).present, false);
  assert.equal(anticipation([0, 10, 0, -10, 0]).present, false);
  assert.equal(overshoot([0, 10, 0, -10, 0]).present, false);
});

test('the counter-move window is 2% to 50% of the main move, both ends exclusive', () => {
  // main move 0 -> 100 starts at index 1; the preparation is the step before it.
  assert.equal(anticipation([1, 0, 100]).present, false, '1% is noise');
  assert.equal(anticipation([3, 0, 100, 100]).present, true, '3% is a preparation');
  assert.equal(anticipation([0, -30, 100]).ratio, 0.231);
  assert.equal(overshoot([0, 100, 51]).present, true, '49% still settles');
  assert.equal(overshoot([0, 100, 40]).present, false, '60% is the next move');
  assert.equal(anticipation([0, 0]).present, false);
  assert.deepEqual(anticipation([5, 5, 5]), { present: false });
  assert.equal(anticipation([0, 50, 100]).note, 'the main move starts on the first key');
  assert.equal(overshoot([0, 50, 100]).note, 'the main move ends on the last key');
});

test('an unknown animation is refused by name, with the ones that exist', () => {
  assert.throws(() => critiqueAnimation(rig({}), 'missing'), err =>
    isStudioError(err, 'unknown-animation') && err.details.animation === 'missing' && err.details.available.includes('a'));
});

test('end to end on the real fixtures: every clip gets a verdict with its numbers', () => {
  const ident = readJson('ident');
  const names = Object.keys(ident.animations);
  const results = Object.fromEntries(names.map(n => [n, critiqueAnimation(ident, n)]));
  // The loop is the 4 s clip: a sweep and a breathing glow, both on linear keys.
  const loopName = names.find(n => results[n].measures.duration === 4);
  const loop = results[loopName];
  assert.deepEqual(loop.measures, { duration: 4, channels: 2, movingChannels: 2, linearRatio: 1,
    anticipations: 0, overshoots: 0, longestHold: 0, slotChannels: 2 });
  assert.equal(loop.verdict, 'mechanical', 'every segment is linear, which the mirror reports');
  assert.deepEqual(codes(loop), ['constant-speed', 'even-spacing', 'no-anticipation', 'no-hold']);
  // The reveal is the clip that keys the wordmark bone: the word rise overshoots
  // (-12 -> 3 -> 0) and so does the glow (scale 0.4 -> 1.06 -> 1).
  const revealName = names.find(n => ident.animations[n].bones?.b_word);
  assert.equal(results[revealName].measures.overshoots, 2);
  assert.ok(results[revealName].measures.longestHold >= 1.5, 'the reveal ends on a hold');
  // The horizon line spreads from scale x 0: the legacy rule calls any scale <= 0 an error,
  // so the reveal reads 'faulty'. Pinned as ported; whether a spread from 0 should be
  // exempt is the owner's call (open question for the owner).
  assert.equal(results[revealName].verdict, 'faulty');
  // The fixture's reveal also carries a real defect the mirror must name: the glow and the line
  // sit on scale 1 at two keys while the bezier between them pulls toward 0, so they vanish
  // mid-hold (seen in rendered frames).
  assert.deepEqual([...new Set(codes(results[revealName]))].sort(), ['hold-drifts', 'scale-zero']);
  assert.match(results[revealName].findings.find(f => f.code === 'hold-drifts').message, /leaves and comes back/);
  assert.equal(byCode(results[revealName], 'scale-zero').where, `animations/${revealName}/bones/b_line/scale`);
  for (const r of Object.values(results)) assert.deepEqual(fatalsOf(r.findings), []);

  const nova = readJson('nova');
  const [novaName] = Object.keys(nova.animations);
  const n = critiqueAnimation(nova, novaName);
  assert.deepEqual(n.measures, { duration: 3, channels: 3, movingChannels: 3, linearRatio: 0.857,
    anticipations: 0, overshoots: 1, longestHold: 2.2, slotChannels: 4 }, 'the title rise overshoots and settles, then holds');
  assert.equal(n.verdict, 'faulty', 'the bar also spreads from scale x 0');
  assert.ok(!codes(n).includes('hold-drifts'), 'a one-unit handle offset on a translate hold is not visible and not reported');
});
