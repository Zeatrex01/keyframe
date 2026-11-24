// Motion out of pixels, proven on frames drawn from a known motion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backgroundOf, measureFrame, trackFrames, findKeys, fitEase, motionFrom, compareTracks, reconstruct, findCycles } from '../src/understand/track.js';
import { sampleCurve } from '../src/spine/curves/presets.js';

const W = 120, H = 120, GROUND = [23, 21, 31];
// A filled box standing on a floor line, drawn with the given scale and lift (y up), optional alpha.
function draw({ sx = 1, sy = 1, lift = 0, dx = 0, alpha = 1, noise = 0, shade = 0 }) {
  const data = new Uint8ClampedArray(W * H * 4);
  // `shade` paints the ground as a top-to-bottom gradient, like a menu bar.
  for (let i = 0; i < W * H; i++) { const n = (noise ? Math.round((Math.sin(i * 12.9898) * 43758.5453 % 1) * noise) : 0) + Math.round(shade * Math.floor(i / W) / H); data[i * 4] = GROUND[0] + n; data[i * 4 + 1] = GROUND[1] + n; data[i * 4 + 2] = GROUND[2] + n; data[i * 4 + 3] = 255; }
  const w = 40 * sx, h = 50 * sy, bottom = 95 - lift, left = 60 + dx - w / 2, top = bottom - h, right = left + w;
  // Anti-aliased, as a real render is: an edge pixel is covered by the fraction of it inside the box.
  const cover = (lo, hi, p) => Math.max(0, Math.min(hi, p + 1) - Math.max(lo, p));
  for (let y = Math.floor(top); y < Math.ceil(bottom); y++) for (let x = Math.floor(left); x < Math.ceil(right); x++) {
    const c = cover(top, bottom, y) * cover(left, right, x) * alpha, i = (y * W + x) * 4;
    data[i] = GROUND[0] + (240 - GROUND[0]) * c; data[i + 1] = GROUND[1] + (180 - GROUND[1]) * c; data[i + 2] = GROUND[2] + (60 - GROUND[2]) * c;
  }
  return { width: W, height: H, data };
}
const easeAt = (name, u) => { const t = sampleCurve(name, 200); return t[Math.round(Math.max(0, Math.min(1, u)) * 200)][1]; };
// Piecewise motion from keys [{time, value, ease}] sampled at fps.
function play(keys, fps, duration) {
  const out = [];
  for (let i = 0; i <= Math.round(duration * fps); i++) {
    const t = i / fps; let k = 0; while (k + 1 < keys.length - 1 && keys[k + 1].time <= t) k++;
    const a = keys[k], b = keys[k + 1]; const u = Math.max(0, Math.min(1, (t - a.time) / (b.time - a.time)));
    out.push(a.value + (b.value - a.value) * easeAt(a.ease ?? 'linear', u));
  }
  return out;
}

test('the ground comes from the border ring, and a frame gives the element\'s box', () => {
  const frame = draw({});
  const ground = backgroundOf([frame]);
  assert.deepEqual(ground.color, GROUND);
  assert.equal(ground.spread, 0);
  const m = measureFrame(frame, ground, 18);
  assert.deepEqual([Math.round(m.width), Math.round(m.height), m.y1], [40, 50, 95]);
  const squashed = measureFrame(draw({ sy: 0.97 }), ground, 18);
  assert.ok(Math.abs(squashed.height / m.height - 0.97) < 0.004, `a 3% squash (1.5 px) is measured: ${squashed.height / m.height}`);
  assert.equal(measureFrame(draw({ alpha: 0 }), ground, 18), null, 'an invisible element is "not there", not a zero-size box');
});

test('a tap (squash, hop with stretch, landing squash) is recovered: key times, values and the lift', () => {
  const fps = 60;
  const scaleY = play([{ time: 0, value: 1, ease: 'outQuad' }, { time: 0.1, value: 0.8, ease: 'outCubic' }, { time: 0.3, value: 1.2, ease: 'inQuad' }, { time: 0.45, value: 0.9, ease: 'outSine' }, { time: 0.6, value: 1 }, { time: 0.8, value: 1 }], fps, 0.8);
  const lift = play([{ time: 0, value: 0 }, { time: 0.1, value: 0, ease: 'outCubic' }, { time: 0.3, value: 15, ease: 'inQuad' }, { time: 0.45, value: 0 }, { time: 0.8, value: 0 }], fps, 0.8);
  const frames = scaleY.map((sy, i) => draw({ sy, sx: 2 - sy, lift: lift[i] }));
  const track = trackFrames(frames, { fps });
  assert.ok(track.confidence > 0.9, `confidence ${track.confidence}`);
  const motion = motionFrom(track);
  const near = (keys, time) => keys.reduce((a, b) => Math.abs(b.time - time) < Math.abs(a.time - time) ? b : a);
  for (const [time, y] of [[0.1, 0.8], [0.3, 1.2], [0.45, 0.9], [0.6, 1]]) {
    const key = near(motion.tracks.scale, time);
    assert.ok(Math.abs(key.time - time) <= 1.5 / fps, `scale key near ${time} s, found ${key.time}`);
    assert.ok(Math.abs(key.y - y) <= 0.03, `scale y ${y} at ${time} s, found ${key.y}`);
  }
  const top = near(motion.tracks.translate, 0.3);
  assert.ok(Math.abs(top.y - 15 / 50) <= 0.03, `lift is 0.3 of the height, found ${top.y}`);
  assert.equal(near(motion.tracks.scale, 0).y, 1, 'the rest pose is scale 1');
  assert.ok(motion.tracks.scale.length <= 9, `no key per frame: ${motion.tracks.scale.length} keys`);
  assert.ok(motion.fitError <= 0.03, `played back, the keys stay within 3% of the measured motion: ${motion.fitError}`);
  const played = reconstruct(motion);
  assert.ok(Math.abs(played[18].sy - 1.2) < 0.03 && Math.abs(played[6].sy - 0.8) < 0.03, 'the playback hits the stretch and the squash');
  assert.ok(motion.beats.some(b => b.kind === 'hold' && b.from >= 0.55), 'the still tail is reported as a hold');
});

test('the ease of a long move is named, and a short one is marked as a guess', () => {
  const fps = 60;
  for (const ease of ['outCubic', 'inOutSine', 'outBack', 'linear']) {
    const values = play([{ time: 0, value: 0, ease }, { time: 0.5, value: 1 }], fps, 0.5);
    const fit = fitEase(values, 0, values.length - 1);
    assert.equal(fit.ease, ease, `${ease} read as ${fit.ease} (error ${fit.error})`);
  }
  assert.deepEqual(findKeys([0, 0, 0, 0, 0.5, 1, 1, 1, 1], 0.02), [0, 3, 5, 8], 'hold edges are keys');
  assert.deepEqual(findKeys([0, 0.6, 0.98, 1, 0.98, 0.6, 0], 0.02, 6), [0, 3, 6], 'the flat top of a move is not a hold');
  assert.deepEqual(findKeys([0, 0.5, 1, 0.5, 0, 0.5, 1], 0.02), [0, 2, 4, 6], 'turning points are keys');
  const frames = play([{ time: 0, value: 1, ease: 'outQuad' }, { time: 2 / 60, value: 1.3 }, { time: 0.3, value: 1.3 }], fps, 0.3).map(sy => draw({ sy }));
  const fast = motionFrom(trackFrames(frames, { fps, rest: 'first' })).tracks.scale[0];
  assert.equal(fast.guessed, true, 'two frames cannot tell eases apart, and the key says so');
});

test('a fade is read as alpha, a slide as translate, and a busy ground lowers confidence', () => {
  const fps = 30;
  const fade = motionFrom(trackFrames(play([{ time: 0, value: 1, ease: 'linear' }, { time: 0.5, value: 0.2 }], fps, 0.5).map(alpha => draw({ alpha })), { fps, rest: 'first' }));
  assert.ok(Math.abs(fade.tracks.alpha.at(-1).value - 0.2) < 0.05);
  assert.ok(!fade.tracks.scale, 'a pure fade does not read as a scale change');
  const slide = motionFrom(trackFrames(play([{ time: 0, value: -20, ease: 'outCubic' }, { time: 0.5, value: 0 }], fps, 0.5).map(dx => draw({ dx })), { fps, rest: 'last' }));
  assert.ok(Math.abs(slide.tracks.translate[0].x + 20 / 50) < 0.03);
  // The tail of an ease-out is indistinguishable from a hold, so the name may differ (a shorter
  // outQuad for a longer outCubic); what must hold is that the keys reproduce the move.
  assert.ok(slide.fitError <= 0.03, `slide fit error ${slide.fitError}`);
  assert.match(slide.tracks.translate[0].ease, /^out/);
  const noisy = trackFrames([draw({ noise: 90 }), draw({ noise: 90 })], { fps });
  assert.ok(noisy.confidence < 0.5 && /confidence/i.test(noisy.note));
});

test('two tracks are compared per channel, and a late copy is reported as a lag', () => {
  const fps = 60;
  const keys = [{ time: 0, value: 1, ease: 'outCubic' }, { time: 0.2, value: 1.3, ease: 'inOutSine' }, { time: 0.5, value: 1 }, { time: 0.7, value: 1 }];
  const reference = trackFrames(play(keys, fps, 0.7).map(sy => draw({ sy })), { fps, rest: 'last' });
  const same = compareTracks(reference, reference);
  assert.deepEqual([same.lagFrames, same.channels.scaleY.max], [0, 0]);
  const shifted = [{ time: 0, value: 1 }, ...keys.map(k => ({ ...k, time: k.time + 3 / fps }))];
  const late = trackFrames(play(shifted, fps, 0.7).map(sy => draw({ sy })), { fps, rest: 'last' });
  const cmp = compareTracks(reference, late);
  assert.equal(cmp.lagFrames, 3);
  assert.ok(cmp.atBestLag.scaleY.max < cmp.channels.scaleY.max);
  const weak = trackFrames(play(keys.map(k => ({ ...k, value: 1 + (k.value - 1) * 0.5 })), fps, 0.7).map(sy => draw({ sy })), { fps, rest: 'last' });
  assert.ok(Math.abs(compareTracks(reference, weak).channels.scaleY.max - 0.15) < 0.03, 'half the stretch is a 0.15 gap');
});

test('a repeated move gives its period and where each cycle starts; a clip that returns to rest ends exactly there', () => {
  const fps = 30, one = [{ time: 0, value: 1, ease: 'outCubic' }, { time: 0.2, value: 1.25, ease: 'inOutSine' }, { time: 0.4, value: 1 }, { time: 0.6, value: 1 }];
  const three = [0, 0.6, 1.2].flatMap(offset => one.slice(0, 3).map(k => ({ ...k, time: +(k.time + offset).toFixed(3) }))).concat([{ time: 1.8, value: 1 }]);
  const track = trackFrames(play(three, fps, 1.8).map(sy => draw({ sy })), { fps });
  const cycles = findCycles(track);
  assert.ok(Math.abs(cycles.period - 0.6) <= 1 / fps, `period ${cycles?.period}`);
  assert.equal(cycles.repeats, 3);
  assert.equal(findCycles(trackFrames(play(one, fps, 0.6).map(sy => draw({ sy })), { fps })), null, 'one move is not a cycle');
  const motion = motionFrom(trackFrames(play(one, fps, 0.6).map(sy => draw({ sy: sy * 1.004 })), { fps, rest: 'first' }));
  const first = motion.tracks.scale[0], last = motion.tracks.scale.at(-1);
  assert.deepEqual([first.y, last.y], [1, 1], 'noise around rest is rest, and the last key equals the first');
});

test('an element cut off by the region is reported, and frames where it is absent read as a fade, not a collapse', () => {
  const fps = 30;
  // A tall stretch that runs out of the top of the frame.
  const cut = trackFrames([draw({}), draw({ sy: 2.4 }), draw({})], { fps, rest: 'first' });
  assert.ok(cut.confidence <= 0.3 && /edge of the region/.test(cut.note) && cut.cutAt.length === 1, JSON.stringify([cut.confidence, cut.note]));
  // Nothing for three frames, then it fades in.
  const fade = trackFrames([0, 0, 0, 0.3, 0.6, 1, 1, 1].map(alpha => draw({ alpha })), { fps, rest: 'last' });
  assert.deepEqual(fade.samples.slice(0, 3).map(s => [s.visible, s.sy, s.alpha]), [[false, 1, 0], [false, 1, 0], [false, 1, 0]]);
  assert.ok(!motionFrom(fade).tracks.scale, 'a fade-in is not a scale-up');
});

test('a ground that shades evenly (a menu bar gradient) is still ground: the motion is measured as on a flat one', () => {
  const fps = 30;
  const values = play([{ time: 0, value: 1, ease: 'outCubic' }, { time: 0.2, value: 1.2, ease: 'inOutSine' }, { time: 0.5, value: 1 }, { time: 0.7, value: 1 }], fps, 0.7);
  const flat = trackFrames(values.map(sy => draw({ sy })), { fps });
  const shaded = trackFrames(values.map(sy => draw({ sy, shade: 70 })), { fps });
  assert.ok(shaded.confidence > 0.9, `confidence on a gradient: ${shaded.confidence}`);
  assert.ok(Math.abs(shaded.background.slopeY[0] - 70) < 6, 'the shading is found as a slope');
  const gap = compareTracks(flat, shaded);
  assert.ok(gap.channels.scaleY.max < 0.02, `the same stretch is read on both grounds: ${gap.channels.scaleY.max}`);
});

test('a ground that changes colour mid-clip (a pressed button plate) does not read as motion', () => {
  const fps = 30;
  const lit = frame => { const data = new Uint8ClampedArray(frame.data); for (let i = 0; i < data.length; i += 4) if (data[i] === GROUND[0] && data[i + 1] === GROUND[1]) { data[i] += 30; data[i + 1] += 26; data[i + 2] += 40; } return { ...frame, data }; };
  const frames = Array.from({ length: 12 }, (_, i) => (i >= 4 ? lit(draw({})) : draw({})));
  const track = trackFrames(frames, { fps, rest: 'first' });
  assert.ok(track.samples.every(s => Math.abs(s.sx - 1) < 0.02 && Math.abs(s.sy - 1) < 0.02), JSON.stringify(track.samples.map(s => s.sy)));
  assert.equal(Object.keys(motionFrom(track).tracks).filter(k => k !== 'alpha').length, 0, 'nothing moved');
});

test('parts that move apart are reported as a changing shape, not as a clean stretch', () => {
  const fps = 30;
  // A box whose top third lifts away from the rest (a lid), drawn as two boxes.
  const split = gap => { const a = draw({ sy: 0.66 }); const b = draw({ sy: 0.34, lift: 33 + gap }); const data = new Uint8ClampedArray(a.data); for (let i = 0; i < data.length; i += 4) if (b.data[i] !== GROUND[0]) { data[i] = b.data[i]; data[i + 1] = b.data[i + 1]; data[i + 2] = b.data[i + 2]; } return { ...a, data }; };
  const track = trackFrames([0, 0, 6, 14, 20, 14, 6, 0, 0, 0].map(split), { fps, rest: 'first' });
  assert.ok(track.shapeChangesAt?.length >= 2 && /not one rigid element/.test(track.note), JSON.stringify(track.note));
  assert.ok(track.confidence <= 0.5);
});

test('a move no preset explains gets its own fitted curve, and a preset move keeps its name', () => {
  const fps = 60, own = [0.05, 0.75, 0.55, 1.3];
  const values = play([{ time: 0, value: 0, ease: own }, { time: 0.5, value: 1 }], fps, 0.5);
  const fit = fitEase(values, 0, values.length - 1);
  assert.ok(Array.isArray(fit.curve) && fit.curve.length === 4, 'no curve was fitted: ' + JSON.stringify(fit));
  assert.ok(fit.curve[0] >= 0 && fit.curve[0] <= 1 && fit.curve[2] >= 0 && fit.curve[2] <= 1, 'x handles must stay in 0..1');
  assert.ok(fit.error < 0.015 && fit.error < fit.presetError * 0.6, `fit ${fit.error} against preset ${fit.presetError}`);
  // played back, the fitted curve is the measured move
  const back = play([{ time: 0, value: 0, ease: fit.curve }, { time: 0.5, value: 1 }], fps, 0.5);
  assert.ok(Math.max(...back.map((v, i) => Math.abs(v - values[i]))) < 0.03, 'the fitted curve does not reproduce the samples');
  // a preset move is still named and carries no curve
  const named = fitEase(play([{ time: 0, value: 0, ease: 'outCubic' }, { time: 0.5, value: 1 }], fps, 0.5), 0, 30);
  assert.equal(named.ease, 'outCubic'); assert.equal(named.curve, undefined);
  // too few samples for four numbers: no curve is claimed
  const short = play([{ time: 0, value: 0, ease: own }, { time: 5 / 60, value: 1 }], fps, 5 / 60);
  assert.equal(fitEase(short, 0, short.length - 1).curve, undefined);
});

test('a fitted curve travels from the measurement to the written clip', () => {
  const fps = 60, own = [0.05, 0.75, 0.55, 1.3];
  const frames = play([{ time: 0, value: 1, ease: own }, { time: 0.5, value: 1.4 }, { time: 0.7, value: 1.4 }], fps, 0.7).map(sy => draw({ sy }));
  const motion = motionFrom(trackFrames(frames, { fps, rest: 'first' }));
  const key = motion.tracks.scale[0];
  assert.ok(Array.isArray(key.curve), 'the scale key carries no fitted curve: ' + JSON.stringify(motion.tracks.scale));
  assert.ok(motion.fitError <= 0.03, `fit error ${motion.fitError}`);
});
