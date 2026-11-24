// Gate for src/understand/describe.js: the clip in sentences must say what the human said.
// Ported from legacy test_describe.js and the describe half of test_briefs.js.
//
// The ident example's spec carries a human's one-line description of each clip, and
// this gate holds the describer to it:
//   the loop   - "light sweep passes once (alpha 0 at both ends), glow breathes
//                 1 -> 1.05 -> 1; first frame == last -> no flicker"
//   the reveal - "name rises with a ~5% overshoot-settle, staggered follow-through
//                 (line -> word -> games), then a hold"; and hidden everywhere at t=0
// plus the bug the example was born from: a timeline whose first key sits after t=0 SNAPS
// from the setup pose. It is flagged, and told apart as masked (alpha 0) or visible.
//
// Clip names are the owner's data: tests find each clip by what it keys, never by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describeAnimation, movesOf, seriesOf, alphaOfHex } from '../src/understand/describe.js';
import { isStudioError } from '../src/shared/errors.js';

const readJson = name => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}/${name}.json`, import.meta.url), 'utf8'));
const IDENT = readJson('ident');
const clone = o => structuredClone(o);
const lastKeyTime = animation => Math.max(...Object.values(animation.bones ?? {}).flatMap(t => Object.values(t))
  .concat(Object.values(animation.slots ?? {}).flatMap(t => Object.values(t))).flat().map(k => k.time ?? 0));
// The seamless loop is the 4 s clip; the reveal keys the wordmark bone; the flash moves
// the sweep bone with its first key after t=0.
const clipNames = sk => {
  const names = Object.keys(sk.animations);
  return {
    loop: names.find(n => lastKeyTime(sk.animations[n]) === 4),
    reveal: names.find(n => sk.animations[n].bones?.b_word),
    flash: names.find(n => (sk.animations[n].bones?.b_sweep?.translate?.[0]?.time ?? 0) > 0),
  };
};
const CLIPS = clipNames(IDENT);

test('the fixture clips are found by what they key', () => {
  assert.equal(new Set(Object.values(CLIPS)).size, 3, JSON.stringify(CLIPS));
  assert.ok(Object.values(CLIPS).every(Boolean));
});

test('the loop: seamless, said the way the spec says it (the origin of this module)', () => {
  const b = describeAnimation(IDENT, CLIPS.loop);
  assert.deepEqual(b.loop, { seamless: true }, 'first frame equals last');
  assert.ok(b.summary.includes('loops seamlessly (first frame equals last)'), b.summary);
  assert.ok(b.summary.includes('b_bloom breathes 1→1.05→1 over 0s–4s'), 'the glow breathes 1 -> 1.05 -> 1');
  assert.ok(b.summary.includes('sweep flashes to 40% and back to 0 over 1.5s–2.5s'),
    'the light passes once: alpha 0 at both ends, named with its window');
  assert.ok(b.summary.includes('b_sweep moves right 640 units (linear) over 0s–4s'), 'the sweep bone travels 640 units');
  assert.equal(b.duration, 4);
  const breathe = b.shapes.find(s => s.kind === 'breathe' && s.actor === 'b_bloom');
  assert.deepEqual(breathe, { kind: 'breathe', actor: 'b_bloom', field: 'scale', from: 1, peak: 1.05, t0: 0, t1: 4 });
  // The pass happens ONCE: one rise and one fall of the sweep's alpha, nothing else.
  const sweepAlpha = b.shapes.filter(s => s.actor === 'sweep');
  assert.equal(sweepAlpha.length, 1);
  assert.deepEqual(sweepAlpha[0], { kind: 'breathe', actor: 'sweep', field: 'alpha', from: 0, peak: 0.4, t0: 1.5, t1: 2.5 });
});

test('the loop exemption for an invisible bone bites only while it is invisible', () => {
  // The sweep bone parks off-frame at a different x. It is invisible at both ends, so it
  // must NOT count as a loop break (the eye is the judge). Prove the exemption bites:
  const visible = clone(IDENT);
  visible.animations[CLIPS.loop].slots.sweep.rgba[4].color = 'ffffff40'; // visible at the end
  const b = describeAnimation(visible, CLIPS.loop);
  assert.equal(b.loop.seamless, false);
  assert.ok(b.loop.breaks.includes('b_sweep.x -320→320'), JSON.stringify(b.loop));
});

test('the reveal: hidden at t=0, staggered, an overshoot that settles, then a hold', () => {
  const b = describeAnimation(IDENT, CLIPS.reveal);
  assert.equal(b.opening.hiddenSlots.length, b.opening.keyedSlots, JSON.stringify(b.opening));
  assert.ok(b.opening.keyedSlots >= 5);
  assert.ok(b.summary.includes('Everything keyed starts hidden'), 'the paragraph opens with that');
  assert.match(b.stagger, /0s [^→]*line[^→]*→ 0.5s [^→]*word[^→]*→ 1.15s games/, 'line -> word -> games, with times');
  const over = b.shapes.find(s => s.kind === 'overshoot' && s.actor === 'b_word');
  assert.deepEqual(over, { kind: 'overshoot', actor: 'b_word', field: 'y', percent: 20, settleAt: 1.42 });
  assert.ok(b.summary.includes('b_word rises 15 units (eased) over 0.5s–1.2s with a 20% overshoot, settling by 1.42s'),
    'the sentence carries the numbers it was made from');
  const hold = b.holds.find(h => h.end);
  assert.ok(hold && hold.t1 - hold.t0 >= 1.2, JSON.stringify(b.holds));
  assert.ok(b.summary.includes('Then everything holds for the last 1.3s.'));
  assert.equal(b.loop.seamless, false, 'a one-shot is not called a loop');
  assert.ok(b.summary.includes('Not a loop: 7 fields end where it did not start'));
});

test('the setup-pose snap is named, and told apart as masked or visible', () => {
  const b = describeAnimation(IDENT, CLIPS.reveal);
  const s = b.snaps.find(x => x.actor === 'b_word' && x.field === 'y');
  assert.deepEqual(s, { actor: 'b_word', field: 'y', t: 0.5, from: 0, to: -12, masked: true },
    'a 12-unit snap at 0.5 s, masked by alpha 0');
  assert.ok(b.summary.includes('it snaps 12 at 0.5s, invisible because its slots are at alpha 0 then'));
  const p = describeAnimation(IDENT, CLIPS.flash);
  const v = p.snaps.find(x => x.actor === 'b_sweep');
  assert.deepEqual(v, { actor: 'b_sweep', field: 'x', t: 0.1, from: 0, to: -300, masked: false });
  assert.ok(p.summary.includes('it snaps 300 at 0.1s — visible, this is the setup-pose pop'), p.summary);
  // The fix the example teaches: key t=0. Then there is nothing to flag.
  const fixed = clone(IDENT);
  fixed.animations[CLIPS.reveal].bones.b_word.translate.unshift({ time: 0, x: 0, y: -12 });
  assert.equal(describeAnimation(fixed, CLIPS.reveal).snaps.length, 0);
});

test('a bone with a hidden slot of its own still pops visibly when its children show (legacy bug)', () => {
  // Legacy judged "masked" by the bone's OWN slots only: the parent's empty frame is
  // hidden, so it called the pop masked, though the child art jumps on screen.
  const sk = {
    skeleton: { spine: '4.2' },
    bones: [{ name: 'root' }, { name: 'parent', parent: 'root' }, { name: 'child', parent: 'parent' }],
    slots: [{ name: 'frame', bone: 'parent', attachment: 'f', color: 'ffffff00' }, { name: 'art', bone: 'child', attachment: 'a' }],
    skins: [{ name: 'default', attachments: { frame: { f: { width: 4, height: 4 } }, art: { a: { width: 4, height: 4 } } } }],
    animations: { pop: { bones: { parent: { translate: [{ time: 0.5, x: 0, y: 20 }, { time: 1, x: 0, y: 30 }] } } } },
  };
  const b = describeAnimation(sk, 'pop');
  assert.equal(b.snaps[0].masked, false, 'the child art is visible: this is the pop');
  assert.ok(b.summary.includes('visible, this is the setup-pose pop'));
  // With the child hidden too, the snap really is masked.
  sk.slots[1].color = 'ffffff00';
  assert.equal(describeAnimation(sk, 'pop').snaps[0].masked, true);
});

test('a late timeline that holds one value still snaps, and is reported (legacy missed it)', () => {
  // A single key at 0.5 s: no move between keys, but the bone jumps from the setup pose.
  const sk = {
    skeleton: { spine: '4.2' }, bones: [{ name: 'root' }, { name: 'k', parent: 'root' }],
    slots: [{ name: 's', bone: 'k', attachment: 'g' }],
    skins: [{ name: 'default', attachments: { s: { g: { width: 4, height: 4 } } } }],
    animations: { jump: { bones: { k: { translate: [{ time: 0.5, x: 0, y: 20 }] } },
      slots: { s: { rgba: [{ time: 0, color: 'ffffffff' }, { time: 1, color: 'ffffff00' }] } } } },
  };
  const b = describeAnimation(sk, 'jump');
  assert.deepEqual(b.snaps, [{ actor: 'k', field: 'y', t: 0.5, from: 0, to: 20, masked: false }]);
  assert.ok(b.summary.includes('k.y has its first key at 0.5s (20) while the setup pose is 0'), b.summary);
  assert.equal(b.actors, 1, 'only the fading slot is an actor');
  delete sk.animations.jump.slots;
  const still = describeAnimation(sk, 'jump');
  assert.equal(still.actors, 0);
  assert.ok(!still.summary.includes('Nothing moves'), 'a snap is a change on screen');
  assert.equal(still.snaps.length, 1);
});

test('a bone that drives a visible weighted mesh is not excused from the loop check', () => {
  const sk = {
    skeleton: { spine: '4.2' },
    bones: [{ name: 'root' }, { name: 'holder', parent: 'root' }, { name: 'driver', parent: 'root' }],
    slots: [{ name: 'skin', bone: 'holder', attachment: 'm' }, { name: 'marker', bone: 'driver', attachment: 'r', color: 'ffffff00' }],
    skins: [{ name: 'default', attachments: {
      skin: { m: { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], hull: 3,
        vertices: [1, 2, 0, 0, 1, 1, 2, 10, 0, 1, 1, 2, 10, 10, 1] } },
      marker: { r: { width: 2, height: 2 } } } }],
    animations: { drift: { bones: { driver: { translate: [{ time: 0, x: 0, y: 0 }, { time: 1, x: 30, y: 0 }] } } } },
  };
  const b = describeAnimation(sk, 'drift');
  assert.equal(b.loop.seamless, false, 'the mesh weighted to the driver moves on screen');
  assert.deepEqual(b.loop.breaks, ['driver.x 0→30']);
});

test('alpha reads as the official parser reads it: a missing value is 0, rgba2 carries alpha in light', () => {
  // Legacy read a missing alpha value as 1 and skipped rgba2.
  const s = seriesOf('slot', 'alpha', [{ time: 0 }, { time: 1, value: 1 }], { alpha: 1 })[0];
  assert.deepEqual(s.points.map(p => p.v), [0, 1]);
  const two = seriesOf('slot', 'rgba2', [{ time: 0, light: 'ffffff00', dark: '000000' }, { time: 1, light: 'ffffffff', dark: '000000' }], { alpha: 1 })[0];
  assert.deepEqual(two.points.map(p => p.v), [0, 1]);
  const sk = {
    skeleton: { spine: '4.2' }, bones: [{ name: 'root' }],
    slots: [{ name: 's', bone: 'root', attachment: 'g' }],
    skins: [{ name: 'default', attachments: { s: { g: { width: 4, height: 4 } } } }],
    animations: {
      tinted: { slots: { s: { rgba2: [{ time: 0, light: 'ffffff00', dark: '000000' }, { time: 1, light: 'ffffffff', dark: '000000' }] } } },
      bare: { slots: { s: { alpha: [{ time: 0 }, { time: 1, value: 1 }] } } },
    },
  };
  for (const name of ['tinted', 'bare']) {
    const b = describeAnimation(sk, name);
    assert.deepEqual(b.opening.hiddenSlots, ['s'], name);
    assert.ok(b.summary.includes('s fades in (linear) over 0s–1s.'), b.summary);
  }
  assert.equal(alphaOfHex('ffffff80'), 128 / 255);
  assert.equal(alphaOfHex('ff0000'), 1, 'a six-digit colour is opaque');
  assert.equal(alphaOfHex(undefined), 1);
});

test('plain shapes on a synthetic rig', () => {
  const rig = {
    skeleton: { spine: '4.2' }, bones: [{ name: 'root' }, { name: 'k', parent: 'root' }],
    slots: [{ name: 's', bone: 'k', attachment: 'g' }],
    skins: [{ name: 'default', attachments: { s: { g: { width: 4, height: 4 } } } }],
    animations: {
      swing: { bones: { k: { rotate: [{ time: 0, value: 0 }, { time: 0.5, value: 20 }, { time: 1, value: 0 }] } } },
      hide: { slots: { s: { attachment: [{ time: 0, name: 'g' }, { time: 0.4, name: null }] } } },
      hold: { bones: { k: { translate: [{ time: 0, x: 0, y: 0 }, { time: 0.2, x: 10, y: 0 }, { time: 2, x: 10, y: 0 }] } } },
      still: { bones: { k: { rotate: [{ time: 0, value: 5 }, { time: 1, value: 5 }] } } },
      sway: { bones: { k: { translatex: [{ time: 0, value: 0 }, { time: 0.5, value: -8 }, { time: 1, value: 0 }],
        translatey: [{ time: 0, value: 0 }, { time: 0.5, value: 6 }, { time: 1, value: 0 }] } } },
      spin: { bones: { k: { rotate: [{ time: 0, value: 0 }, { time: 1, value: -90, curve: 'stepped' }, { time: 2, value: -90 }] } },
        ik: { chain: [{ mix: 1 }] } },
    },
  };
  const a = describeAnimation(rig, 'swing');
  assert.ok(a.summary.includes('k swings 20° counter-clockwise and back over 0s–1s'), a.summary);
  assert.equal(a.loop.seamless, true, 'and it loops (0 -> 20 -> 0)');
  const b = describeAnimation(rig, 'hide');
  assert.ok(b.summary.includes('s hides (stepped) over 0s–0.4s'), b.summary);
  assert.deepEqual(b.loop.breaks, ['s.attachment g→null']);
  const c = describeAnimation(rig, 'hold');
  assert.ok(c.summary.includes('k moves right 10 units (linear) over 0s–0.2s'), c.summary);
  assert.ok(c.summary.includes('holds for the last 1.8s'), c.summary);
  const d = describeAnimation(rig, 'still');
  assert.equal(d.actors, 0);
  assert.ok(d.summary.includes('Nothing moves: no bone or slot timeline changes a value.'));
  const e = describeAnimation(rig, 'sway');
  assert.ok(e.summary.includes('k sways left 8 units and back over 0s–1s; bobs up 6 units and back over 0s–1s.'), e.summary);
  const f = describeAnimation(rig, 'spin');
  assert.ok(f.summary.includes('k rotates 90° clockwise (linear) over 0s–1s.'), f.summary);
  assert.ok(f.summary.includes('The clip also keys constraint mix on: ik.'));
});

test('moves merge in one direction and split on a reversal', () => {
  const s = { field: 'y', points: [0, 5, 10, 4, 4, 9].map((v, i) => ({ t: i, v, curve: i === 1 ? 'bezier' : 'linear' })) };
  assert.deepEqual(movesOf(s), [
    { t0: 0, t1: 2, from: 0, to: 10, curve: 'mixed' },
    { t0: 2, t1: 3, from: 10, to: 4, curve: 'linear' },
    { t0: 4, t1: 5, from: 4, to: 9, curve: 'linear' },
  ]);
});

test('an unknown animation is refused by name, not with an empty brief', () => {
  assert.throws(() => describeAnimation(IDENT, 'missing'), err =>
    isStudioError(err, 'unknown-animation') && err.details.available.length === 3);
});

test('the brief follows the file: an edited amplitude shows up', () => {
  const edited = clone(IDENT);
  const scale = edited.animations[CLIPS.loop].bones.b_bloom.scale;
  scale[1].x = 1.2;
  scale[1].y = 1.2;
  assert.ok(describeAnimation(edited, CLIPS.loop).summary.includes('b_bloom breathes 1→1.2→1'));
});

test('the paragraphs are cheaper than the JSON they describe (measured)', () => {
  const raw = JSON.stringify(IDENT.animations).length;
  const brief = Object.keys(IDENT.animations).map(n => describeAnimation(IDENT, n).summary).join('\n').length;
  assert.ok(brief < raw * 0.8, `${brief} vs ${raw} chars`);
});

test('end to end on nova: a reveal with two masked snaps', () => {
  const nova = readJson('nova');
  const [name] = Object.keys(nova.animations);
  const b = describeAnimation(nova, name);
  assert.ok(b.summary.includes('Everything keyed starts hidden (alpha 0 at t=0) and is fully visible by the end — a reveal.'), b.summary);
  assert.ok(b.summary.includes('b_title rises 15 units (eased) over 0.25s–0.9s with a 20% overshoot, settling by 1.05s'));
  assert.deepEqual(b.snaps, [
    { actor: 'b_title', field: 'y', t: 0.25, from: 0, to: -12, masked: true },
    { actor: 'b_bar', field: 'sx', t: 0.55, from: 1, to: 0, masked: true },
  ]);
  assert.equal(b.stagger, '0s b_orb, orb → 0.25s b_title, title → 0.55s b_bar, bar → 0.95s tag');
});
