// A measured reference read as animation, not copied as numbers (roadmap Phase 3, issue #19):
// its beats named in the principles' terms (anticipation, main move, overshoot and settle,
// holds), and how to re-stage it for the subject the brief describes (its typical timing and
// the size it is shown at), as apply_motion's speed and amount.
//
// Pure and isomorphic.

import { CLIP_TIMING } from './principles.js';
import { PRESETS } from './subject.js';

const round = v => Math.round(v * 1000) / 1000;

/** The largest excursion from rest of each sample across scale, travel and turn. */
function magnitudes(motion) {
  const out = [];
  for (const [channel, keys] of Object.entries(motion.tracks ?? {})) {
    for (const k of keys) {
      const m = channel === 'scale' ? Math.max(Math.abs(k.x - 1), Math.abs(k.y - 1)) : channel === 'translate' ? Math.hypot(k.x, k.y)
        : channel === 'rotate' ? Math.abs(k.value) / 90 : 0;
      out.push({ time: k.time, m, channel, key: k });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Opposite-signed values before the peak, a pass beyond the final value after it; from the channel that moves most. */
function principlesOf(motion) {
  const found = { anticipation: null, overshoot: null };
  const size = { anticipation: -1, overshoot: -1 };
  for (const [channel, keys] of Object.entries(motion.tracks ?? {})) {
    const fields = channel === 'scale' || channel === 'translate' ? ['x', 'y'] : ['value'];
    const rest = channel === 'scale' || channel === 'alpha' ? 1 : 0;
    const unit = channel === 'rotate' ? 90 : 1;
    for (const f of fields) {
      const values = keys.map(k => k[f] - rest);
      let peak = 0;
      values.forEach((v, i) => { if (Math.abs(v) > Math.abs(values[peak])) peak = i; });
      const big = values[peak];
      if (Math.abs(big) < 1e-3) continue;
      const weight = Math.abs(big) / unit;
      const before = values.slice(0, peak).find(v => Math.sign(v) === -Math.sign(big) && Math.abs(v) > Math.abs(big) * 0.02);
      if (before !== undefined && weight > size.anticipation) {
        size.anticipation = weight;
        found.anticipation = { channel: `${channel}.${f}`, ratio: round(Math.abs(before / big)), at: keys[values.indexOf(before)].time };
      }
      const end = values[values.length - 1];
      const pass = values.slice(peak + 1, -1).find(v => Math.abs(v - end) > Math.abs(big - end) * 0.02 && Math.sign(v - end) !== Math.sign(big - end));
      if (pass !== undefined && weight > size.overshoot) {
        size.overshoot = weight;
        found.overshoot = { channel: `${channel}.${f}`, ratio: round(Math.abs((pass - end) / (big - end))) };
      }
    }
  }
  return found;
}

/**
 * Read a measured motion as beats and principles, and say how to re-stage it.
 * @param {{ duration: number, tracks: object, beats?: Array<{ from: number, to: number, kind: string }> }} motion  from measure_reference
 * @param {{ brief?: any, clip?: string }} [context]  the skeleton's brief and the clip it is for
 */
export function interpretMotion(motion, { brief, clip } = {}) {
  const beats = (motion.beats ?? []).map(b => ({ ...b, from: round(b.from), to: round(b.to), seconds: round(b.to - b.from) }));
  const moves = beats.filter(b => b.kind === 'move');
  const mags = magnitudes(motion);
  const peak = mags.reduce((best, s) => (s.m > (best?.m ?? -1) ? s : best), null);
  const { anticipation, overshoot } = principlesOf(motion);
  const holds = beats.filter(b => b.kind === 'hold' && b.seconds >= 0.2);
  const reading = [];
  if (anticipation) reading.push(`anticipation: a ${Math.round(anticipation.ratio * 100)}% counter-move on ${anticipation.channel} before the main move`);
  if (moves.length) reading.push(`main move${moves.length > 1 ? 's' : ''}: ${moves.map(m => `${m.from}-${m.to} s`).join(', ')}`);
  if (peak) reading.push(`peak at ${round(peak.time)} s on ${peak.channel}`);
  if (overshoot) reading.push(`overshoot and settle: passes its end by ${Math.round(overshoot.ratio * 100)}% on ${overshoot.channel}`);
  if (holds.length) reading.push(`hold${holds.length > 1 ? 's' : ''}: ${holds.map(h => `${h.seconds} s at ${h.from} s`).join(', ')}`);

  // Re-staging: the reference's tempo to the subject's typical clip, its size to the display.
  const entry = brief?.clips?.find(c => c.name === clip);
  const preset = PRESETS[brief?.subject];
  const typical = CLIP_TIMING.filter(t => preset?.timing.includes(t.clip));
  const target = entry?.seconds ?? null;
  const restage = { speed: 1, amount: 1, why: [] };
  if (target && motion.duration > 0) {
    restage.speed = round(motion.duration / target);
    restage.why.push(`the brief gives ${clip} ${target} s; the reference lasts ${round(motion.duration)} s`);
  } else if (typical.length && motion.duration > 0) {
    const [lo, hi] = typical[0].seconds;
    if (motion.duration < lo || motion.duration > hi) {
      restage.speed = round(motion.duration / Math.min(hi, Math.max(lo, motion.duration)));
      restage.why.push(`a typical ${typical[0].clip} lasts ${lo}-${hi} s; the reference lasts ${round(motion.duration)} s`);
    }
  }
  const height = brief?.display?.height;
  if (height && height < 160 && peak && peak.m < 0.05) {
    restage.amount = round(Math.min(3, 0.05 / Math.max(peak.m, 0.005)));
    restage.why.push(`shown at ${height} px, a ${Math.round(peak.m * 100)}% move would not read; exaggerate it`);
  }
  if (!restage.why.length) restage.why.push('the reference already fits the subject: play it as measured');
  return { beats, principles: { anticipation, overshoot, holds: holds.length }, reading, restage };
}
