// What does this clip do, in sentences. Ported from legacy describe_anim.js.
//
// Context (2026-09-06): another AI connected over MCP did not really understand the
// animation. Measured on the ident example: the keys say `b_sweep.translate x
// -320..320` and `b_bloom.scale 1..1.05`, and a human wrote "light sweep passes once,
// glow breathes 1 -> 1.05 -> 1, first frame == last". Every fact in that sentence was
// derivable from the numbers and no tool derived it, so the understanding lived in
// whichever model happened to be connected, not in the product. This module derives it.
//
// A DESCRIBER, not a judge (critique.js is the quality mirror): it names what moves, when,
// how far, which way, what fades, what holds, whether the loop is seamless, and where a
// timeline pops because its first key sits after t=0 (the setup-pose leak the ident
// example was born from). Sentences carry the numbers they were made from, so an agent
// can quote either.
//
// Directions follow Spine: +x right, +y up, +rotation counter-clockwise. Translate keys
// are OFFSETS from the setup pose, so "rises 15 units" is a delta.
//
// Pure: reads the AUTHORED keys. Values between keys are read linearly (only to decide
// whether a slot is hidden at an instant); poses come from the runtime, not from here.

import { StudioError } from '../shared/errors.js';
import { skinsOf } from '../spine/check.js';

const isNumber = v => typeof v === 'number' && Number.isFinite(v);
const round3 = v => Math.round(v * 1000) / 1000;
const round2 = v => Math.round(v * 100) / 100;
const timeOf = k => (k && isNumber(k.time)) ? k.time : 0;
const EPS = 1e-4;

// One numeric field per timeline value: [field, key property, the value a missing
// property reads as]. The setup pose implies the same neutral value before the first key.
const BONE_FIELDS = {
  translate: [['x', 'x', 0], ['y', 'y', 0]], translatex: [['x', 'value', 0]], translatey: [['y', 'value', 0]],
  rotate: [['rot', 'value', 0]],
  scale: [['sx', 'x', 1], ['sy', 'y', 1]], scalex: [['sx', 'value', 1]], scaley: [['sy', 'value', 1]],
  shear: [['shx', 'x', 0], ['shy', 'y', 0]], shearx: [['shx', 'value', 0]], sheary: [['shy', 'value', 0]],
};

/** Alpha (0..1) of a Spine colour string; a 6-digit colour is opaque. */
export const alphaOfHex = hex => {
  const s = String(hex || 'ffffffff').replace(/^#/, '');
  return s.length >= 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1;
};
const curveKind = k => k.curve === 'stepped' ? 'stepped' : Array.isArray(k.curve) ? 'bezier' : 'linear';

/**
 * Split one channel into per-field value series: [{ field, setup, points: [{ t, v, curve }] }].
 * Slots give `alpha` (from rgba, rgba2 or alpha) and `attachment` as a name series
 * (null = hidden, `nominal: true`).
 * @param {'bone'|'slot'} kind
 * @param {object} setupValues the setup pose's value per field
 */
export function seriesOf(kind, channel, keys, setupValues) {
  if (!Array.isArray(keys) || !keys.length) return [];
  const points = value => keys.map(k => ({ t: timeOf(k), v: value(k), curve: curveKind(k) }));
  if (kind === 'bone') {
    const spec = BONE_FIELDS[channel];
    if (!spec) return [];
    return spec.map(([field, key, neutral]) => ({
      field, setup: setupValues[field] ?? neutral, points: points(k => isNumber(k[key]) ? k[key] : neutral),
    }));
  }
  if (channel === 'rgba') return [{ field: 'alpha', setup: setupValues.alpha, points: points(k => alphaOfHex(k.color)) }];
  // Two-colour tint: the alpha lives in `light`. Legacy skipped rgba2, so a fade on a
  // tinted slot was never described.
  if (channel === 'rgba2') return [{ field: 'alpha', setup: setupValues.alpha, points: points(k => alphaOfHex(k.light)) }];
  // A missing alpha value reads as 0, as the official parser reads it (legacy read 1).
  if (channel === 'alpha') return [{ field: 'alpha', setup: setupValues.alpha, points: points(k => isNumber(k.value) ? k.value : 0) }];
  if (channel === 'attachment') {
    return [{ field: 'attachment', setup: setupValues.attachment, nominal: true,
      points: keys.map(k => ({ t: timeOf(k), v: k.name ?? null, curve: 'stepped' })) }];
  }
  return [];
}

/**
 * MOVES: maximal runs of consecutive changing segments in one direction. A -> B -> C where
 * B reverses is two moves, which is what lets overshoot and breathing be named.
 */
export function movesOf(series) {
  const out = [];
  const pts = series.points;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    if (series.nominal) {
      if (a.v !== b.v) out.push({ t0: a.t, t1: b.t, from: a.v, to: b.v, curve: 'stepped' });
      continue;
    }
    const d = b.v - a.v;
    if (Math.abs(d) < EPS) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.t1 - a.t) < EPS && Math.sign(last.to - last.from) === Math.sign(d)) {
      last.t1 = b.t;
      last.to = b.v;
      if (last.curve !== a.curve) last.curve = 'mixed';
    } else {
      out.push({ t0: a.t, t1: b.t, from: a.v, to: b.v, curve: a.curve });
    }
  }
  return out;
}

const percentOf = (part, whole) => Math.round(Math.abs(part / whole) * 100);
const secs = t => `${round2(t)}s`;
const timeSpan = (t0, t1) => `${secs(t0)}–${secs(t1)}`;
const ARROW = '→';
const DEG = '°';

// The verb for one move of one field. Numbers stay in the sentence.
function verb(field, m) {
  const d = m.to - m.from, ad = Math.abs(d);
  switch (field) {
    case 'y': return `${d > 0 ? 'rises' : 'drops'} ${round2(ad)} units`;
    case 'x': return `${d > 0 ? 'moves right' : 'moves left'} ${round2(ad)} units`;
    case 'rot': return `rotates ${round2(ad)}${DEG} ${d > 0 ? 'counter-clockwise' : 'clockwise'}`;
    case 'sx': case 'sy': return `${d > 0 ? 'scales up' : 'scales down'} ${round2(m.from)}${ARROW}${round2(m.to)} (${field === 'sx' ? 'x' : 'y'})`;
    case 'scale': return `${d > 0 ? 'scales up' : 'scales down'} ${round2(m.from)}${ARROW}${round2(m.to)}`;
    case 'shx': case 'shy': return `shears ${round2(ad)}${DEG}`;
    case 'alpha':
      if (m.from <= 0.02 && m.to >= 0.98) return 'fades in';
      if (m.from >= 0.98 && m.to <= 0.02) return 'fades out';
      return `${d > 0 ? 'brightens to' : 'dims to'} ${Math.round(m.to * 100)}%`;
    case 'attachment': return m.to === null ? 'hides' : `switches to "${m.to}"`;
    default: return 'changes';
  }
}
const easeWord = m => m.curve === 'bezier' ? ' (eased)' : m.curve === 'stepped' ? ' (stepped)' : m.curve === 'mixed' ? '' : ' (linear)';

// A move that comes straight back to where it started, said as one shape.
function returnPhrase(field, m, next) {
  const d = m.to - m.from;
  const ad = round2(Math.abs(d));
  switch (field) {
    case 'alpha':
      return m.from <= 0.02 ? `flashes to ${Math.round(m.to * 100)}% and back to 0`
        : `${d > 0 ? 'brightens to' : 'dips to'} ${Math.round(m.to * 100)}% and returns`;
    case 'rot': return `swings ${ad}${DEG} ${d > 0 ? 'counter-clockwise' : 'clockwise'} and back`;
    case 'y': return `${d > 0 ? 'bobs up' : 'dips down'} ${ad} units and back`;
    case 'x': return `sways ${d > 0 ? 'right' : 'left'} ${ad} units and back`;
    default: {
      const label = field === 'sx' ? 'breathes (x)' : field === 'sy' ? 'breathes (y)' : 'breathes';
      return `${label} ${round2(m.from)}${ARROW}${round2(m.to)}${ARROW}${round2(next.to)}`;
    }
  }
}

// Scale fields move together far more often than apart; say it once.
function mergeScale(fields) {
  const sx = fields.find(f => f.field === 'sx'), sy = fields.find(f => f.field === 'sy');
  if (!sx || !sy || sx.moves.length !== sy.moves.length) return fields;
  const same = sx.moves.every((m, i) => Math.abs(m.t0 - sy.moves[i].t0) < EPS && Math.abs(m.t1 - sy.moves[i].t1) < EPS
    && Math.abs(m.from - sy.moves[i].from) < 1e-3 && Math.abs(m.to - sy.moves[i].to) < 1e-3);
  if (!same) return fields;
  return fields.filter(f => f !== sy).map(f => f === sx ? { ...f, field: 'scale' } : f);
}

// The sentence for one actor, its structured moves, and the shapes found in them
// (overshoot, breathe) plus setup-pose snaps. `brief` is null when nothing moves; snaps
// are still returned, since a held timeline that starts late jumps all the same.
function actorBrief(kind, name, channels, setup, boneHiddenAt) {
  const all = [];
  for (const [channel, keys] of Object.entries(channels ?? {})) {
    for (const s of seriesOf(kind, channel, keys, setup)) all.push({ ...s, moves: movesOf(s) });
  }
  // SETUP-POSE SNAP: the first key sits after t=0 with a value the setup does not have.
  // The runtime holds the setup value until then and jumps. This is the exact bug the
  // ident example was born from; a describer that hides it is useless. Checked on
  // every field, moving or not: legacy dropped fields without moves first, so a late
  // timeline holding one value (a single key at 0.5 s) jumped unreported.
  const snaps = [];
  for (const f of all) {
    const first = f.points[0];
    if (!f.nominal && first.t > EPS && Math.abs(first.v - f.setup) > 1e-3) {
      const masked = kind === 'bone' && boneHiddenAt(name, first.t) === true;
      snaps.push({ actor: name, field: f.field, t: round3(first.t), from: round3(f.setup), to: round3(first.v), masked });
    }
  }
  let fields = all.filter(f => f.moves.length);
  if (!fields.length) return { brief: null, snaps };
  fields = mergeScale(fields);

  const shapes = [];
  const clauses = []; // { t0, text }, sorted by time so a bone that moves AND rotates reads in story order
  for (const f of fields) {
    const ms = f.moves;
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i], next = ms[i + 1];
      const d = m.to - m.from;
      let text = `${verb(f.field, m)}${easeWord(m)} over ${timeSpan(m.t0, m.t1)}`;
      if (next && !f.nominal && Math.abs(next.t0 - m.t1) < EPS && Math.sign(next.to - next.from) === -Math.sign(d)) {
        const back = next.to - next.from;
        const returns = Math.abs(next.to - m.from) < Math.max(1e-3, Math.abs(d) * 0.02);
        if (returns) {
          shapes.push({ kind: 'breathe', actor: name, field: f.field, from: round3(m.from), peak: round3(m.to), t0: round3(m.t0), t1: round3(next.t1) });
          text = `${returnPhrase(f.field, m, next)} over ${timeSpan(m.t0, next.t1)}`;
          i++;
        } else if (Math.abs(back) <= Math.abs(d) * 0.35) {
          const percent = percentOf(back, d);
          shapes.push({ kind: 'overshoot', actor: name, field: f.field, percent, settleAt: round3(next.t1) });
          text += ` with a ${percent}% overshoot, settling by ${secs(next.t1)}`;
          i++;
        }
      }
      clauses.push({ t0: m.t0, text });
    }
  }
  clauses.sort((p, q) => p.t0 - q.t0);
  const start = Math.min(...fields.map(f => f.moves[0].t0));
  const end = Math.max(...fields.map(f => f.moves[f.moves.length - 1].t1));
  const roundValue = v => typeof v === 'number' ? round3(v) : v;
  const brief = {
    name, kind, start: round3(start), end: round3(end),
    sentence: `${name} ${clauses.map(c => c.text).join('; ')}.`,
    moves: fields.map(f => ({ field: f.field,
      moves: f.moves.map(m => ({ t0: round3(m.t0), t1: round3(m.t1), from: roundValue(m.from), to: roundValue(m.to), curve: m.curve })) })),
    shapes,
  };
  return { brief, snaps };
}

function durationOf(animation) {
  let d = 0;
  const walk = o => {
    if (Array.isArray(o)) { for (const k of o) if (k && isNumber(k.time) && k.time > d) d = k.time; }
    else if (o && typeof o === 'object') for (const v of Object.values(o)) walk(v);
  };
  walk(animation);
  return d;
}

// Bone indices a weighted vertex array refers to: [n, (bone, x, y, weight) x n, ...].
function weightedBones(attachment) {
  const v = attachment?.vertices, uvs = attachment?.uvs;
  const out = new Set();
  if (!Array.isArray(v) || !Array.isArray(uvs) || v.length <= uvs.length) return out;
  for (let i = 0; i < v.length;) {
    const n = v[i++];
    if (!(n >= 0) || i + n * 4 > v.length) return new Set();
    for (let j = 0; j < n; j++, i += 4) out.add(v[i]);
  }
  return out;
}

// Which slots a bone moves on screen: the slots on the bone or any descendant, and the
// slots whose mesh is weighted to one of those bones. Legacy looked at the bone's own
// slots only, so a parent bone with a hidden slot of its own called the pop of its
// VISIBLE children "masked" and excused them from the loop check.
function slotsMovedBy(sk) {
  const children = {};
  for (const b of sk.bones ?? []) if (b?.parent) (children[b.parent] ??= []).push(b.name);
  const boneIndex = new Map((sk.bones ?? []).map((b, i) => [i, b?.name]));
  const weightedSlots = {}; // bone -> slots weighted to it
  for (const skin of skinsOf(sk)) {
    for (const [slot, attachments] of Object.entries(skin?.attachments ?? {})) {
      for (const a of Object.values(attachments ?? {})) {
        for (const i of weightedBones(a)) (weightedSlots[boneIndex.get(i)] ??= new Set()).add(slot);
      }
    }
  }
  const ownSlots = {};
  for (const s of sk.slots ?? []) (ownSlots[s.bone] ??= []).push(s.name);
  const cache = {};
  return bone => {
    if (cache[bone]) return cache[bone];
    const out = new Set();
    const visit = b => {
      for (const s of ownSlots[b] ?? []) out.add(s);
      for (const s of weightedSlots[b] ?? []) out.add(s);
      for (const c of children[b] ?? []) visit(c);
    };
    visit(bone);
    return (cache[bone] = [...out]);
  };
}

/**
 * The clip in sentences, plus the structure the sentences were made from.
 * @param {object} sk   parsed skeleton JSON
 * @param {string} name animation name
 */
export function describeAnimation(sk, name) {
  const animation = sk?.animations?.[name];
  if (!animation) {
    throw new StudioError('unknown-animation', `No animation named "${name}".`,
      { animation: name, available: Object.keys(sk?.animations ?? {}) });
  }
  const duration = durationOf(animation);
  const boneSetup = {};
  for (const b of sk.bones ?? []) boneSetup[b.name] = { x: 0, y: 0, rot: 0, sx: 1, sy: 1, shx: 0, shy: 0 };
  const slotSetup = {};
  for (const s of sk.slots ?? []) slotSetup[s.name] = { alpha: alphaOfHex(s.color), attachment: s.attachment ?? null };
  const movedSlots = slotsMovedBy(sk);

  // Alpha of a slot at t: linear between keys, the setup value before the first key.
  const alphaAt = (slot, t) => {
    const timelines = animation.slots?.[slot] ?? {};
    const setup = slotSetup[slot] ?? { alpha: 1 };
    const channel = ['rgba', 'rgba2', 'alpha'].find(c => Array.isArray(timelines[c]) && timelines[c].length);
    const s = channel && seriesOf('slot', channel, timelines[channel], setup)[0];
    if (!s) return setup.alpha;
    const p = s.points;
    if (t < p[0].t) return s.setup;
    for (let i = 0; i + 1 < p.length; i++) {
      if (t >= p[i].t && t <= p[i + 1].t) {
        const f = p[i + 1].t > p[i].t ? (t - p[i].t) / (p[i + 1].t - p[i].t) : 0;
        return p[i].curve === 'stepped' ? p[i].v : p[i].v + (p[i + 1].v - p[i].v) * f;
      }
    }
    return p[p.length - 1].v;
  };
  // true: every slot the bone moves is invisible at t. null: the bone moves no slot.
  const boneHiddenAt = (bone, t) => {
    const slots = movedSlots(bone);
    if (!slots.length) return null;
    return slots.every(s => alphaAt(s, t) <= 0.001);
  };

  const read = [
    ...Object.entries(animation.bones ?? {}).map(([bone, timelines]) => actorBrief('bone', bone, timelines, boneSetup[bone] ?? {}, boneHiddenAt)),
    ...Object.entries(animation.slots ?? {}).map(([slot, timelines]) => actorBrief('slot', slot, timelines, slotSetup[slot] ?? {}, boneHiddenAt)),
  ];
  const actors = read.map(r => r.brief).filter(Boolean);
  actors.sort((p, q) => p.start - q.start || p.name.localeCompare(q.name));

  // Global holds: gaps where nothing moves, long enough to read (0.3 s or 8% of the clip).
  const busy = [];
  for (const actor of actors) for (const f of actor.moves) for (const m of f.moves) busy.push([m.t0, m.t1]);
  busy.sort((p, q) => p[0] - q[0]);
  const holds = [];
  let cursor = 0;
  const minHold = Math.max(0.3, duration * 0.08);
  for (const [t0, t1] of busy) {
    if (t0 - cursor >= minHold) holds.push({ t0: round3(cursor), t1: round3(t0) });
    cursor = Math.max(cursor, t1);
  }
  if (duration - cursor >= minHold) holds.push({ t0: round3(cursor), t1: round3(duration), end: true });

  // Seamless loop: the value at t=0 (setup if the first key is later) equals the value at
  // the end, on every field that has keys.
  const loopBreaks = [];
  const checkLoop = (kind, owner, channels, setup) => {
    // A bone nobody can see at either end cannot break the loop on screen: ident's
    // sweep parks off-frame while invisible, and the human called that loop seamless.
    // The eye is the judge, not the number.
    if (kind === 'bone' && boneHiddenAt(owner, 0) === true && boneHiddenAt(owner, duration) === true) return;
    for (const [channel, keys] of Object.entries(channels ?? {})) {
      for (const s of seriesOf(kind, channel, keys, setup)) {
        const v0 = s.points[0].t > EPS ? s.setup : s.points[0].v;
        const v1 = s.points[s.points.length - 1].v;
        const same = s.nominal ? v0 === v1 : Math.abs(v0 - v1) < 1e-3;
        if (!same) loopBreaks.push(`${owner}.${s.field} ${s.nominal ? String(v0) : round2(v0)}${ARROW}${s.nominal ? String(v1) : round2(v1)}`);
      }
    }
  };
  for (const [bone, timelines] of Object.entries(animation.bones ?? {})) checkLoop('bone', bone, timelines, boneSetup[bone] ?? {});
  for (const [slot, timelines] of Object.entries(animation.slots ?? {})) checkLoop('slot', slot, timelines, slotSetup[slot] ?? {});
  const seamless = !loopBreaks.length;

  // Opening state: which keyed slots are hidden at t=0 (a reveal starts dark on purpose).
  const keyedSlots = Object.keys(animation.slots ?? {});
  const hiddenAtStart = keyedSlots.filter(s => alphaAt(s, 0) <= 0.001);
  const visibleAtEnd = keyedSlots.filter(s => alphaAt(s, duration) > 0.001);

  // Stagger: distinct entrance times inside the first 40% of the clip.
  const byTime = new Map();
  for (const actor of actors.filter(a => a.start <= duration * 0.4)) {
    if (!byTime.has(actor.start)) byTime.set(actor.start, []);
    byTime.get(actor.start).push(actor.name);
  }
  const stagger = byTime.size >= 2
    ? [...byTime.entries()].map(([t, names]) => `${secs(t)} ${names.join(', ')}`).join(` ${ARROW} `) : null;

  // Snaps in actor reading order (start time, then name); a snap of a still actor follows.
  const order = new Map(actors.map((a, i) => [a.name, i]));
  const shapes = actors.flatMap(a => a.shapes);
  const snaps = read.flatMap(r => r.snaps).map((s, i) => ({ s, i }))
    .sort((p, q) => (order.get(p.s.actor) ?? Infinity) - (order.get(q.s.actor) ?? Infinity) || p.i - q.i).map(x => x.s);
  const constraintSections = ['ik', 'transform', 'path', 'physics'].filter(s => animation[s] && Object.keys(animation[s]).length);

  // Beats: the timeline in reading order, one line per actor.
  const beats = actors.map(a => ({ t0: a.start, t1: a.end, text: a.sentence }));

  // The paragraph: short declaratives, numbers inside.
  const S = [];
  S.push(`${name} runs ${secs(duration)}${seamless ? ' and loops seamlessly (first frame equals last)' : ''}.`);
  if (!actors.length && !snaps.length) S.push('Nothing moves: no bone or slot timeline changes a value.');
  if (hiddenAtStart.length) {
    S.push(hiddenAtStart.length === keyedSlots.length
      ? `Everything keyed starts hidden (alpha 0 at t=0)${visibleAtEnd.length === keyedSlots.length ? ' and is fully visible by the end — a reveal.' : '.'}`
      : `${hiddenAtStart.join(', ')} ${hiddenAtStart.length === 1 ? 'starts' : 'start'} hidden.`);
  }
  if (stagger) S.push(`Entrances are staggered: ${stagger}.`);
  for (const a of actors) S.push(a.sentence);
  for (const h of holds) {
    S.push(h.end ? `Then everything holds for the last ${round2(h.t1 - h.t0)}s.` : `Nothing moves between ${timeSpan(h.t0, h.t1)}.`);
  }
  for (const s of snaps) {
    S.push(`${s.actor}.${s.field} has its first key at ${secs(s.t)} (${s.to}) while the setup pose is ${s.from}`
      + ` — it snaps ${round2(Math.abs(s.to - s.from))} at ${secs(s.t)}`
      + `${s.masked ? ', invisible because its slots are at alpha 0 then' : ' — visible, this is the setup-pose pop'}.`);
  }
  if (!seamless) {
    S.push(`Not a loop: ${loopBreaks.length} ${loopBreaks.length === 1 ? 'field ends' : 'fields end'} where it did not start (`
      + `${loopBreaks.slice(0, 3).join(', ')}${loopBreaks.length > 3 ? ', …' : ''}).`);
  }
  if (constraintSections.length) S.push(`The clip also keys constraint mix on: ${constraintSections.join(', ')}.`);

  return {
    animation: name, duration: round3(duration), actors: actors.length,
    loop: { seamless, ...(loopBreaks.length ? { breaks: loopBreaks } : {}) },
    opening: { hiddenSlots: hiddenAtStart, keyedSlots: keyedSlots.length },
    stagger, holds, shapes, snaps, beats, summary: S.join(' '),
  };
}
