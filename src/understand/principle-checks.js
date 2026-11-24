// The animation-principle checks of critique_animation (roadmap Phase 1): overlap, ease
// variety, squash volume and placement, loop seams, twinning and the readability floor.
// Every finding is a `look` (a warning that does not change the verdict) and names the
// principle it measures; thresholds marked `estimate` in src/understand/principles.js are
// rules of thumb, reported as such, until calibrated on real production exports.
//
// Pure: authored keys and the bone tree only, no pose.

import { THRESHOLDS } from './principles.js';

const round3 = v => Math.round(v * 1000) / 1000;
const isNumber = v => typeof v === 'number' && Number.isFinite(v);
const timeOf = k => (k && isNumber(k.time)) ? k.time : 0;

const ONE_FIELD = { rotate: 0, translatex: 0, translatey: 0, scalex: 1, scaley: 1, shearx: 0, sheary: 0 };
const TWO_FIELD = { translate: 0, scale: 1, shear: 0 };

/** Value series of a channel, one per field. */
function seriesOf(channel, keys) {
  if (Object.hasOwn(ONE_FIELD, channel)) return [keys.map(k => isNumber(k.value) ? k.value : ONE_FIELD[channel])];
  if (Object.hasOwn(TWO_FIELD, channel)) {
    const rest = TWO_FIELD[channel];
    return [keys.map(k => isNumber(k.x) ? k.x : rest), keys.map(k => isNumber(k.y) ? k.y : rest)];
  }
  return null;
}
const moves = series => series.some(v => Math.max(...v) - Math.min(...v) > 1e-6);

/** The normalized shape [x1, y1, x2, y2] of a bezier segment's first field, rounded, as a key. */
function shapeOf(keys, i, values) {
  const curve = keys[i].curve;
  if (!Array.isArray(curve) || curve.length < 4) return null;
  const t0 = timeOf(keys[i]), t1 = timeOf(keys[i + 1]);
  const v0 = values[i], v1 = values[i + 1];
  if (!(t1 > t0) || Math.abs(v1 - v0) < 1e-9) return null;
  const x1 = (curve[0] - t0) / (t1 - t0), x2 = (curve[2] - t0) / (t1 - t0);
  const y1 = (curve[1] - v0) / (v1 - v0), y2 = (curve[3] - v0) / (v1 - v0);
  return [x1, y1, x2, y2].map(n => n.toFixed(2)).join(',');
}

const SIDE = /(^|[_\-. ])(l|r|left|right)(?=$|[_\-. \d])|^(l|r)(?=[A-Z_])|(Left|Right|_L|_R)(?=$|[_\d])/g;
const pairKey = name => name.replace(SIDE, '$1#');

/**
 * @param {object} sk  skeleton JSON
 * @param {string} name animation name
 * @param {{ loop?: boolean, pixelsPerUnit?: number }} [options]
 * @returns {Array<{ severity: string, code: string, where: string, message: string, measure: object, fix: string, principle: string, estimate: boolean }>}
 */
export function principleFindings(sk, name, { loop, pixelsPerUnit = 1 } = {}) {
  const animation = sk?.animations?.[name] ?? {};
  const at = `animations/${name}`;
  const out = [];
  const add = (code, principle, message, measure, fix, { estimate = true, where = at, severity = 'look' } = {}) =>
    out.push({ severity, code, where, message, measure, fix, principle, estimate });
  const children = new Set((sk.bones ?? []).map(b => b.parent).filter(Boolean));
  const lengthOf = new Map((sk.bones ?? []).map(b => [b.name, isNumber(b.length) && b.length > 0 ? b.length : null]));

  const shapes = new Map();
  let eased = 0;
  const timesByBone = new Map();
  const signature = new Map();
  const volume = [];
  const onParent = new Set();
  const seams = [];
  const tiny = [];
  let duration = 0;
  for (const timelines of Object.values(animation.bones ?? {})) {
    for (const keys of Object.values(timelines ?? {})) if (Array.isArray(keys) && keys.length) duration = Math.max(duration, timeOf(keys[keys.length - 1]));
  }
  const isLoop = loop ?? /loop|idle|cycle|walk|run|breath|spin|float/i.test(name);

  for (const [bone, timelines] of Object.entries(animation.bones ?? {})) {
    const times = new Set();
    const sig = [];
    for (const [channel, keys] of Object.entries(timelines ?? {})) {
      if (!Array.isArray(keys) || keys.length < 2) continue;
      const series = seriesOf(channel, keys);
      if (!series || !moves(series)) continue;
      for (const k of keys) times.add(round3(timeOf(k)));
      sig.push(`${channel}:${keys.map(k => round3(timeOf(k))).join('/')}:${series.map(v => v.map(round3).join('/')).join('|')}`);
      for (let i = 0; i + 1 < keys.length; i++) {
        if (keys[i].curve === 'stepped') continue;
        const shape = shapeOf(keys, i, series[0]);
        if (!shape) continue;
        eased++;
        shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
      }
      if (channel === 'scale') {
        keys.forEach((k, i) => {
          const x = series[0][i], y = series[1][i];
          if (Math.abs(x - y) < 1e-3) return;
          if (children.has(bone)) onParent.add(bone);
          const drift = Math.abs(x * y - 1);
          // A squash or stretch moves the two axes in opposite directions; a spread from 0 or a
          // one-axis scale is not one.
          const squash = Math.abs(x - 1) > 0.01 && Math.abs(y - 1) > 0.01 && Math.sign(x - 1) !== Math.sign(y - 1);
          if (squash && drift > THRESHOLDS.squashVolume) volume.push({ bone, time: round3(timeOf(k)), x, y, volume: round3(x * y) });
        });
      }
      if (channel === 'scalex' || channel === 'scaley') if (children.has(bone)) onParent.add(bone);
      if (isLoop && duration > 0 && Math.abs(timeOf(keys[keys.length - 1]) - duration) < 1e-6 && timeOf(keys[0]) < 1e-6) {
        const gap = Math.max(...series.map(v => Math.abs(v[v.length - 1] - v[0])));
        if (gap > (channel.startsWith('scale') ? 0.005 : 0.05)) seams.push({ channel: `${bone}.${channel}`, gap: round3(gap) });
      }
      // The readability floor: the whole travel of the channel, on screen.
      const range = Math.max(...series.map(v => Math.max(...v) - Math.min(...v)));
      let pixels = null;
      if (channel.startsWith('translate')) pixels = range * pixelsPerUnit;
      else if (channel === 'rotate') pixels = range * Math.PI / 180 * (lengthOf.get(bone) ?? 50) * pixelsPerUnit;
      if (pixels !== null && pixels < THRESHOLDS.readablePixels) tiny.push({ channel: `${bone}.${channel}`, pixels: round3(pixels) });
    }
    if (times.size >= 2) timesByBone.set(bone, [...times].sort((a, b) => a - b).join(','));
    if (sig.length) signature.set(bone, sig.sort().join(';'));
  }

  // Overlap: bones keyed on exactly the same frames move as one block.
  const groups = new Map();
  for (const [bone, times] of timesByBone) groups.set(times, [...(groups.get(times) ?? []), bone]);
  const unison = [...groups.values()].filter(g => g.length > THRESHOLDS.unisonBones).sort((a, b) => b.length - a.length)[0];
  if (unison) {
    add('no-overlap', 'overlap and follow-through', `${unison.length} bones are keyed on exactly the same times: they move as one block.`,
      { bones: unison.slice(0, 8), count: unison.length },
      'Offset each child 1-3 frames after its parent (start, peak and stop later toward the tip), and vary the amplitude.');
  }

  // Ease variety: one curve shape everywhere reads as one rhythm.
  if (eased >= 5) {
    const [shape, count] = [...shapes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (count / eased > THRESHOLDS.dominantEaseRatio) {
      add('same-ease', 'slow in and slow out', `${Math.round(count / eased * 100)}% of the eased segments share one curve shape.`,
        { shape: shape.split(',').map(Number), share: round3(count / eased), segments: eased },
        'Make eases asymmetric and specific: arrivals outCubic/outQuart/outBack, departures inQuad/inCubic, holds outSine.');
    }
  }

  if (volume.length) {
    const worst = volume.sort((a, b) => Math.abs(b.volume - 1) - Math.abs(a.volume - 1))[0];
    add('squash-volume', 'squash and stretch', `${volume.length} squash or stretch key(s) change the volume by more than ${THRESHOLDS.squashVolume * 100}% (worst ${worst.bone} at ${worst.time} s: ${worst.x} x ${worst.y} = ${worst.volume}).`,
      { keys: volume.length, worst },
      'Keep scaleY close to 1/scaleX on a squash or stretch (1.2 wide is about 0.83 tall).');
  }
  if (onParent.size) {
    add('squash-on-parent', 'squash and stretch', `Non-uniform scale is keyed on bone(s) with children: ${[...onParent].join(', ')}. Their children shear.`,
      { bones: [...onParent] },
      'Key squash on a leaf bone or a dedicated squash bone; use shear for leans.', { estimate: false });
  }
  if (seams.length) {
    add('loop-seam', 'loops', `This looks like a loop, but ${seams.length} channel(s) end on a different value than they start: it pops at the seam.`,
      { channels: seams.slice(0, 8) },
      'Make the last key equal the first on every timeline, with the key at t = duration (not one frame early). Pass loop: false if this clip does not loop.',
      { estimate: false });
  }

  // Twinning: left and right keyed identically.
  const twins = [];
  for (const [bone, sig] of signature) {
    const key = pairKey(bone);
    if (key === bone) continue;
    for (const [other, otherSig] of signature) {
      if (other <= bone || pairKey(other) !== key) continue;
      if (sig === otherSig) twins.push([bone, other]);
    }
  }
  if (twins.length) {
    add('twinning', 'appeal', `Left and right move identically: ${twins.map(p => p.join(' = ')).join(', ')}.`,
      { pairs: twins },
      'Offset one side by 1-2 frames or give it a different amplitude.');
  }

  if (tiny.length) {
    add('below-readable', 'readability', `${tiny.length} moving channel(s) travel less than ${THRESHOLDS.readablePixels} screen pixels at ${pixelsPerUnit} pixel(s) per unit: nobody will see them.`,
      { channels: tiny.slice(0, 8), pixelsPerUnit },
      'Make the move bigger, or drop it; pass pixelsPerUnit (screen pixels per skeleton unit at the game\'s display size) for an exact floor.');
  }
  return out;
}
