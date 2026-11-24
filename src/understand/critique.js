// Measures the QUALITY of an animation: is this motion dead? Ported from legacy critique.js.
//
// `check` answers "will Spine open this file": validity. A technically flawless but
// artistically dead animation (every channel two keys, all linear, equal spacing, no
// anticipation, no follow-through) passes that gate untouched. The knowledge of how to
// animate was already available to any connected model; what was missing was a
// measurement of the RESULT. This is that measurement.
//
// Taste is not turned into rules. Only what is measurable is measured: curve variety,
// key spacing, anticipation, overshoot and settle, holds, and gross errors. Every finding
// carries a number and a concrete fix, because "make it prettier" tells a model nothing,
// while "100% of the rotate channel is linear, ease at least one end" does.
//
// A MIRROR, NOT A JUDGE: mechanical motion may be intended (machine, robot, UI). No
// finding blocks a write or fails a gate, so every finding is level `warn`; how much it
// matters is `params.severity` ('error' | 'weak' | 'look' | 'info'), and the verdict is
// 'faulty' (any error), 'mechanical' (any weak), 'unmeasured' (no bone moves, so nothing
// was measured) or 'good'.
//
// Pure: works on the AUTHORED keys of one animation (values, times, curve kinds); no pose
// is computed, so nothing here competes with the runtime (ADR-2).

import { finding } from '../spine/findings.js';
import { StudioError } from '../shared/errors.js';
import { principleFindings } from './principle-checks.js';
import { conventionFindings } from './conventions.js';

const round3 = v => Math.round(v * 1000) / 1000;
const isNumber = v => typeof v === 'number' && Number.isFinite(v);
const timeOf = k => (k && isNumber(k.time)) ? k.time : 0;

export const MIRROR_NOTE = 'This is a MIRROR, not a judge: no finding blocks a write or fails the gates. '
  + 'Mechanical motion can be intended (machine, robot, UI). The aim is to turn "make it prettier", '
  + 'which tells a model nothing, into NUMBERS, so ANY connected AI sees the same measure.';

// The fields of each bone channel, and the value a missing field reads as (what the
// official parser uses: 1 for scale, 0 otherwise). The 4.2 split channels (translatex,
// scaley, ...) carry one `value`; legacy measured only the combined channels and was
// blind to a clip written with the split ones.
const CHANNELS = {
  rotate: { fields: ['value'], neutral: 0 },
  translate: { fields: ['x', 'y'], neutral: 0 },
  translatex: { fields: ['value'], neutral: 0 },
  translatey: { fields: ['value'], neutral: 0 },
  scale: { fields: ['x', 'y'], neutral: 1 },
  scalex: { fields: ['value'], neutral: 1 },
  scaley: { fields: ['value'], neutral: 1 },
  shear: { fields: ['x', 'y'], neutral: 0 },
  shearx: { fields: ['value'], neutral: 0 },
  sheary: { fields: ['value'], neutral: 0 },
};
const fieldOf = (k, field, neutral) => isNumber(k[field]) ? k[field] : neutral;

// The keys of one channel as one value series per field. "Did it move" and "did it hold"
// are asked of every field: legacy collapsed a two-field channel to its magnitude (vector
// length), so a sweep from x=-320 to x=+320 had the same length at both ends and was
// reported as a DEAD channel (measured on the ident loop, 2026-10-28), and a flip
// from +10 to -10 read as a hold.
function fieldSeries(channel, keys) {
  const spec = CHANNELS[channel];
  if (!spec) return null;
  return spec.fields.map(field => keys.map(k => fieldOf(k, field, spec.neutral)));
}
const isMoving = series => series.some(values => Math.max(...values) - Math.min(...values) >= 1e-6);

// DIRECTION-PRESERVING values, for the two measures that need a single curve with a SIGN.
// A magnitude would destroy the sign, and anticipation is BY DEFINITION a move in the
// opposite direction: on a translate channel a 4-unit dip before a 95-unit rise came back as +4,
// indistinguishable from a small rise. The DOMINANT axis (the one that carries the
// motion) is taken with its sign; the other axis is a passenger. Only anticipation and
// overshoot use this.
function signedValues(channel, keys) {
  const spec = CHANNELS[channel];
  if (!spec) return null;
  const { fields: [f0, f1], neutral } = spec;
  if (f1 === undefined) return keys.map(k => fieldOf(k, f0, neutral));
  const xs = keys.map(k => fieldOf(k, f0, neutral));
  const ys = keys.map(k => fieldOf(k, f1, neutral));
  const range = v => Math.max(...v) - Math.min(...v);
  return range(ys) > range(xs) ? ys : xs;
}

// ── measurement units ─────────────────────────────────────────────────────────

/**
 * How many segments are linear, bezier, stepped. The LAST key's curve is meaningless (no
 * segment follows it) and is not counted; otherwise every two-key channel would read as
 * "half linear".
 */
export function curveProfile(keys) {
  let linear = 0, bezier = 0, stepped = 0;
  for (let i = 0; i < keys.length - 1; i++) {
    const c = keys[i].curve;
    if (c === 'stepped') stepped++;
    else if (Array.isArray(c)) bezier++;
    else linear++;
  }
  const segments = Math.max(0, keys.length - 1);
  return { segments, linear, bezier, stepped, linearRatio: segments ? round3(linear / segments) : 0 };
}

/**
 * Are the keys laid out at equal intervals? Perfect equality is the trace of SAMPLING
 * (or thoughtless keying), not of a built rhythm. `variation` is the coefficient of
 * variation of the gaps: 0 means perfectly equal. Null below three keys.
 */
export function spacing(keys) {
  if (keys.length < 3) return null;
  const gaps = [];
  for (let i = 1; i < keys.length; i++) gaps.push(timeOf(keys[i]) - timeOf(keys[i - 1]));
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (!(mean > 0)) return null;
  const deviation = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
  return { mean: round3(mean), variation: round3(deviation / mean) };
}

// THE MAIN MOVE: the span between the channel's two extremes, in the order they occur.
// Anticipation and overshoot belong to A MOVE (prepare, travel, arrive), never to a whole
// channel. The first legacy version compared the channel's first value with its last, so
// anything that RETURNS HOME (a jump, a lid that opens and closes: most of what gets
// animated) bailed out. Measured 2026-08-18: the textbook jump 0, -6, 60, 12, 0 scored
// zero on both, while the same shape ending away from home scored anticipation.
function mainMove(values) {
  const hi = Math.max(...values), lo = Math.min(...values);
  const span = hi - lo;
  if (!(span > 1e-9)) return null;
  const iHi = values.indexOf(hi), iLo = values.indexOf(lo);
  const i0 = Math.min(iHi, iLo), i1 = Math.max(iHi, iLo);
  if (i0 === i1) return null;
  return { i0, i1, span, direction: Math.sign(values[i1] - values[i0]) };
}

// A counter-move counts between 2% and 50% of the main move. Smaller is noise; larger is
// not a preparation or a settle but the next move (the fall after a jump).
const COUNTER_MIN = 0.02;
const COUNTER_MAX = 0.5;

/** A small preparation in the OPPOSITE direction just before the main move (crouch before a jump). */
export function anticipation(values) {
  if (values.length < 3) return { present: false };
  const move = mainMove(values);
  if (!move) return { present: false };
  if (move.i0 === 0) return { present: false, note: 'the main move starts on the first key' };
  const step = values[move.i0] - values[move.i0 - 1];
  const ratio = Math.abs(step) / move.span;
  return { present: step * move.direction < 0 && ratio > COUNTER_MIN && ratio < COUNTER_MAX, ratio: round3(ratio) };
}

/** The move passes its target and comes back a little: the cheapest source of life. */
export function overshoot(values) {
  if (values.length < 3) return { present: false };
  const move = mainMove(values);
  if (!move) return { present: false };
  if (move.i1 >= values.length - 1) return { present: false, note: 'the main move ends on the last key' };
  const step = values[move.i1 + 1] - values[move.i1];
  const ratio = Math.abs(step) / move.span;
  return { present: step * move.direction < 0 && ratio > COUNTER_MIN && ratio < COUNTER_MAX, ratio: round3(ratio) };
}

/**
 * The longest stretch where the value does not change between two keys. The foundation
 * of staging: for the audience to read something, something must STOP.
 * @param {object[]} keys
 * @param {number[] | number[][]} values one series, or one series per field (all must hold)
 * @returns {{ duration: number, time: number | null }} `time` is where the hold starts
 */
export function longestHold(keys, values, threshold = 1e-4) {
  const series = Array.isArray(values[0]) ? values : [values];
  let duration = 0, time = null;
  for (let i = 1; i < keys.length; i++) {
    if (series.some(v => Math.abs(v[i] - v[i - 1]) > threshold)) continue;
    const d = timeOf(keys[i]) - timeOf(keys[i - 1]);
    if (d > duration) { duration = d; time = round3(timeOf(keys[i - 1])); }
  }
  return { duration: round3(duration), time };
}

/** The time of the last key of any timeline in a clip (bones, slots, deform, draw order, events, constraints). */
export function clipDuration(animation) {
  let max = 0;
  const visit = node => {
    if (Array.isArray(node)) {
      for (const k of node) if (k && typeof k === 'object' && !Array.isArray(k)) max = Math.max(max, timeOf(k));
      return;
    }
    if (node && typeof node === 'object') for (const v of Object.values(node)) visit(v);
  };
  visit(animation);
  return max;
}

// ── the critique ──────────────────────────────────────────────────────────────

/**
 * @param {object} sk   parsed skeleton JSON
 * @param {string} name animation name
 * @param {{ loop?: boolean, pixelsPerUnit?: number, skip?: string[] }} [options] principle checks: is this a loop
 *   (default: guessed from the name), how many screen pixels one skeleton unit is, and finding
 *   codes that do not apply to the subject (from its brief: src/understand/subject.js)
 * @returns {{ animation: string, verdict: 'good'|'mechanical'|'faulty'|'unmeasured', measures: object,
 *             findings: ReturnType<typeof finding>[], note: string }}
 */
export function critiqueAnimation(sk, name, options = {}) {
  const animation = sk?.animations?.[name];
  if (!animation) {
    throw new StudioError('unknown-animation', `No animation named "${name}".`,
      { animation: name, available: Object.keys(sk?.animations ?? {}) });
  }
  const at = `animations/${name}`;
  const findings = [];
  const add = (severity, code, where, message, measure, fix) =>
    findings.push(finding(severity === 'info' ? 'info' : 'warn', code, where, message, { severity, measure: measure ?? {}, fix }));

  let segmentTotal = 0, linearTotal = 0, channelCount = 0, twoKeyCount = 0;
  let anticipationCount = 0, overshootCount = 0, movingCount = 0;
  const evenlySpaced = [];
  let hold = 0;

  for (const [bone, timelines] of Object.entries(animation.bones ?? {})) {
    for (const [channel, keys] of Object.entries(timelines ?? {})) {
      if (!Array.isArray(keys) || keys.length < 2) continue;
      const series = fieldSeries(channel, keys);
      if (!series) continue;
      channelCount++;
      if (!isMoving(series)) continue; // a dead channel has no rhythm
      movingCount++;

      const profile = curveProfile(keys);
      segmentTotal += profile.segments;
      linearTotal += profile.linear;
      if (keys.length === 2) twoKeyCount++;

      const gaps = spacing(keys);
      if (gaps && gaps.variation < 0.02) evenlySpaced.push(`${bone}.${channel}`);

      const signed = signedValues(channel, keys);
      if (anticipation(signed).present) anticipationCount++;
      if (overshoot(signed).present) overshootCount++;

      const h = longestHold(keys, series, channel === 'rotate' ? 0.01 : 1e-3);
      if (h.duration > hold) hold = h.duration;
    }
  }

  const linearRatio = segmentTotal ? linearTotal / segmentTotal : 0;

  // 1. Curve variety. All-linear is the measurable form of "mechanical": real motion
  // accelerates and decelerates, it does not travel at constant speed.
  if (segmentTotal >= 3 && linearRatio > 0.9) {
    add('weak', 'constant-speed', at, 'Almost all of the motion travels at CONSTANT SPEED (no ease).',
      { linearRatio: round3(linearRatio), segments: segmentTotal },
      'Ease at least the hold and start ends: give the key a bezier curve (ease in and out, or a sharp one). '
      + 'An ease on a single key already brings a dead move to life.');
  } else if (segmentTotal >= 3 && linearRatio > 0.6) {
    add('look', 'constant-speed', at, 'Most segments are linear.', { linearRatio: round3(linearRatio) },
      'Use an ease on the moments that need weight (a hold, an impact, a settle).');
  }

  // 2. Two-key channels.
  if (twoKeyCount && movingCount && twoKeyCount / movingCount > 0.7) {
    add('weak', 'two-key', at, 'Most moving channels carry only a START and an END key.',
      { twoKeyChannels: twoKeyCount, movingChannels: movingCount },
      'A to B is a straight line. Add a key between them (an overshoot, a hold or a break); '
      + 'with three keys the move starts to read.');
  }

  // 3. Equal spacing. The threshold is a RATIO: it used to be "at least 2 channels" and
  // never fired on a single-bone animation, the most common case.
  if (evenlySpaced.length && evenlySpaced.length >= Math.ceil(movingCount * 0.5)) {
    add('look', 'even-spacing', at,
      'The keys sit at perfectly equal intervals: the trace of SAMPLING, not of a built rhythm.',
      { channels: evenlySpaced.slice(0, 5) },
      'Build the rhythm on purpose: a short preparation, a fast main move, a long settle. '
      + 'Equal spacing reads like a metronome.');
  }

  // 4. Anticipation.
  if (movingCount >= 1 && anticipationCount === 0 && linearRatio > 0.5) {
    add('look', 'no-anticipation', at,
      'No channel prepares its move (a small step in the opposite direction before the main move).',
      { movingChannels: movingCount },
      'Crouch before the jump, pull back before the strike: add a key before the main move, in the opposite '
      + 'direction, at 5-15% of its amplitude. Small, and the most noticeable fix there is.');
  }

  // 5. Holds and staging. The clip lasts until its last key of ANY kind: a clip that only
  // swaps attachments or fades colour is still a clip with a length.
  const duration = clipDuration(animation);
  const slotChannels = Object.values(animation.slots ?? {}).reduce((n, timelines) =>
    n + Object.values(timelines ?? {}).filter(keys => Array.isArray(keys) && keys.length).length, 0);
  if (duration > 1.2 && hold < 0.12) {
    add('look', 'no-hold', at, 'Nothing ever STOPS: there is no moment for the viewer to read.',
      { duration: round3(duration), longestHold: round3(hold) },
      'Leave a 0.2-0.4 s hold on an important pose (the same value on two keys). '
      + 'Constant motion is as unreadable as none.');
  }

  // 6. Gross errors: these are errors, not taste.
  for (const [bone, timelines] of Object.entries(animation.bones ?? {})) {
    for (const channel of ['scale', 'scalex', 'scaley']) {
      const keys = timelines?.[channel];
      if (!Array.isArray(keys)) continue;
      for (const k of keys) {
        const values = channel === 'scale' ? [k.x, k.y] : [k.value];
        if (!values.some(v => isNumber(v) && v <= 0)) continue;
        add('error', 'scale-zero', `${at}/bones/${bone}/${channel}`,
          `${bone}.${channel} is zero or negative: the art vanishes or mirrors.`,
          channel === 'scale' ? { time: round3(timeOf(k)), x: k.x, y: k.y } : { time: round3(timeOf(k)), value: k.value },
          'To hide something use alpha (a colour timeline) or the attachment; a zero scale also collapses '
          + 'the world transform of every child bone.');
      }
    }
    // Two keys with the same value read as a hold, but a bezier between them whose handles sit
    // elsewhere makes the value leave and come back: the art dips or swells mid-"hold".
    for (const [channel, fields] of Object.entries({ rotate: ['value'], translate: ['x', 'y'], scale: ['x', 'y'], shear: ['x', 'y'],
      translatex: ['value'], translatey: ['value'], scalex: ['value'], scaley: ['value'], shearx: ['value'], sheary: ['value'] })) {
      const keys = timelines?.[channel];
      if (!Array.isArray(keys)) continue;
      const rest = channel.startsWith('scale') ? 1 : 0;
      for (let i = 0; i + 1 < keys.length; i++) {
        const curve = keys[i].curve;
        if (!Array.isArray(curve)) continue;
        fields.forEach((field, f) => {
          const from = keys[i][field] ?? rest;
          const to = keys[i + 1][field] ?? rest;
          const handles = [curve[f * 4 + 1], curve[f * 4 + 3]];
          if (from !== to || !handles.every(isNumber)) return;
          const drift = Math.max(...handles.map(h => Math.abs(h - from)));
          // Below these the excursion is not visible: 2 units of travel, 1 degree, 5% of size.
          const visible = channel.startsWith('scale') ? 0.05 : channel.startsWith('translate') ? 2 : 1;
          if (drift <= visible) return;
          add('error', 'hold-drifts', `${at}/bones/${bone}/${channel}`,
            `${bone}.${channel} has the same ${field} (${from}) on two keys, but the curve between them pulls it toward ${handles.find(h => Math.abs(h - from) === drift)}: it leaves and comes back instead of holding.`,
            { from: round3(timeOf(keys[i])), to: round3(timeOf(keys[i + 1])), value: from, handles },
            'For a hold, drop the curve on the first of the two keys (or set both handle values to the key value).');
        });
      }
    }
    const rotate = timelines?.rotate;
    if (Array.isArray(rotate)) {
      for (let i = 1; i < rotate.length; i++) {
        const degrees = Math.abs(fieldOf(rotate[i], 'value', 0) - fieldOf(rotate[i - 1], 'value', 0));
        const dt = timeOf(rotate[i]) - timeOf(rotate[i - 1]);
        if (!(degrees > 180 && dt > 0 && dt < 0.2)) continue;
        add('look', 'sudden-turn', `${at}/bones/${bone}/rotate`,
          `${bone}.rotate turns ${round3(degrees)} degrees between two keys (${round3(dt)} s).`,
          { time: round3(timeOf(rotate[i])), degrees: round3(degrees) },
          'Spine turns to the value you WROTE, not the shortest way: a jump past 180 degrees turns in an '
          + 'unexpected direction. Add a key between them to pin the direction.');
      }
    }
  }

  // 7. A channel that is available but never used.
  if (duration > 0.8 && Object.keys(animation.slots ?? {}).length === 0) {
    add('info', 'no-alpha', at, 'There is no alpha or colour timeline at all.', undefined,
      'If something has to appear or disappear, a colour timeline fades smoothly; hiding with the attachment '
      + 'is ABRUPT. (Ignore this if nothing needs to appear.)');
  }

  // 8. The rig's own conventions: what its other clips always switch together.
  for (const c of conventionFindings(sk, name)) {
    add(c.severity, c.code, c.where, c.message, c.measure, c.fix);
  }

  // 9. Nothing measurable. The rhythm checks read bone channels; a clip without a moving bone
  // channel is never called good on an empty measurement.
  const unmeasured = movingCount === 0;
  if (unmeasured) {
    add('info', 'no-bone-motion', at, slotChannels || duration > 0
      ? `No bone moves in this clip (${slotChannels} slot timeline${slotChannels === 1 ? '' : 's'}): the rhythm checks have nothing to measure.`
      : 'The clip has no keys at all.',
    { slotChannels, duration: round3(duration) },
    'Judge it by eye: see_animation at the switch times. Attachment swaps must follow the rig\'s conventions (read_rig `conventions`).');
  }

  // 10. The animation principles (roadmap Phase 1): overlap, ease variety, squash, loops,
  // twinning, readability. All `look`: they inform, they never change the verdict.
  for (const p of principleFindings(sk, name, options)) {
    findings.push(finding('warn', p.code, p.where, p.message, { severity: p.severity, measure: p.measure, fix: p.fix, principle: p.principle, estimate: p.estimate }));
  }

  // Checks the subject's brief says do not apply (twinning on a symmetric badge is a design).
  const skip = new Set(Array.isArray(options.skip) ? options.skip : []);
  const skipped = [...new Set(findings.filter(f => skip.has(f.code)).map(f => f.code))];
  if (skip.size) for (let i = findings.length - 1; i >= 0; i--) if (skip.has(findings[i].code)) findings.splice(i, 1);
  const has = severity => findings.some(f => f.params.severity === severity);
  return {
    animation: name,
    verdict: has('error') ? 'faulty' : has('weak') ? 'mechanical' : unmeasured ? 'unmeasured' : 'good',
    measures: {
      duration: round3(duration),
      channels: channelCount, movingChannels: movingCount, slotChannels,
      linearRatio: round3(linearRatio),
      anticipations: anticipationCount, overshoots: overshootCount,
      longestHold: round3(hold),
      ...(skipped.length ? { skipped } : {}),
    },
    findings,
    note: MIRROR_NOTE,
  };
}
