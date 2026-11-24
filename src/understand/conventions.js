// Rig conventions: what the owner's own clips always do together.
//
// A rig often has rules nobody wrote down. The cat closes an eye by showing `lid_closed` on the
// lid slot AND hiding the eye and pupil slots in the same instant; showing the lid alone leaves
// the eye half closed. Such rules live only in the clips, so they are mined from the clips: every
// time a slot switches, mid-clip, to a non-setup attachment, the attachment state of every other slot at
// that instant is recorded. A slot value that holds in nearly every occurrence, across more than
// one clip, and differs from the setup pose is a convention. A switch at time 0 sets a pose
// rather than making a transition, so it does not vote.
//
// read_rig lists them; critique_animation flags a clip that breaks one (judged against the OTHER
// clips, so a clip never vouches for itself).
//
// Pure: plain skeleton JSON in, plain data out.

import { round3 } from './read-timelines.js';

/** At least this share of the occurrences must agree. */
export const AGREEMENT = 0.8;
/** At least this many occurrences, from at least two clips. */
export const MIN_OCCURRENCES = 3;
const MIN_CLIPS = 2;
const EPS = 1e-4;

const keyName = k => (k && typeof k.name === 'string' ? k.name : null);
const keyTime = k => (typeof k?.time === 'number' ? k.time : 0);

function setupAttachments(sk) {
  return new Map((sk?.slots ?? []).map(s => [s.name, typeof s.attachment === 'string' ? s.attachment : null]));
}

/** The attachment each slot shows at `time` in one clip (keys at `time` included). */
function stateAt(sk, clip, time, setup) {
  const state = new Map(setup);
  for (const [slot, timelines] of Object.entries(clip?.slots ?? {})) {
    const keys = timelines?.attachment;
    if (!Array.isArray(keys)) continue;
    for (const k of keys) if (keyTime(k) <= time + EPS) state.set(slot, keyName(k));
  }
  return state;
}

/** Every instant a slot switches to an attachment other than its setup one. */
function switchesOf(clip, setup) {
  const out = [];
  for (const [slot, timelines] of Object.entries(clip?.slots ?? {})) {
    const keys = timelines?.attachment;
    if (!Array.isArray(keys)) continue;
    let previous = setup.get(slot) ?? null;
    for (const k of keys) {
      const name = keyName(k);
      if (keyTime(k) > EPS && name !== null && name !== previous && name !== (setup.get(slot) ?? null)) out.push({ slot, attachment: name, time: keyTime(k) });
      previous = name;
    }
  }
  return out;
}

/**
 * The attachments a slot passes through next to `attachment` in the owner's clips: lid_half
 * before or after lid_closed. Those are the in-betweens a softer switch can use.
 */
function neighboursOf(sk, slot, attachment) {
  const out = new Set();
  for (const clip of Object.values(sk?.animations ?? {})) {
    const keys = clip?.slots?.[slot]?.attachment;
    if (!Array.isArray(keys)) continue;
    keys.forEach((k, i) => {
      if (keyName(k) !== attachment) return;
      for (const n of [keys[i - 1], keys[i + 1]]) {
        const name = n ? keyName(n) : null;
        if (name !== null && name !== attachment) out.add(name);
      }
    });
  }
  return [...out].sort();
}

/**
 * The conventions of a rig, mined from its clips.
 * @param {object} sk skeleton JSON
 * @param {{ exclude?: string }} [options] a clip that does not vote (the one being judged)
 * @returns {Array<{ slot: string, attachment: string, alsoSets: Array<{ slot: string, attachment: string|null }>,
 *   inBetweens: string[], occurrences: number, clips: string[] }>}
 */
export function rigConventions(sk, { exclude } = {}) {
  const setup = setupAttachments(sk);
  /** @type {Map<string, { slot: string, attachment: string, states: Map<string, string|null>[], clips: Set<string> }>} */
  const groups = new Map();
  for (const [name, clip] of Object.entries(sk?.animations ?? {})) {
    if (name === exclude) continue;
    for (const s of switchesOf(clip, setup)) {
      const id = `${s.slot}\u0000${s.attachment}`;
      if (!groups.has(id)) groups.set(id, { slot: s.slot, attachment: s.attachment, states: [], clips: new Set() });
      const g = groups.get(id);
      g.states.push(stateAt(sk, clip, s.time, setup));
      g.clips.add(name);
    }
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.states.length < MIN_OCCURRENCES || g.clips.size < MIN_CLIPS) continue;
    const alsoSets = [];
    for (const [slot, setupValue] of setup) {
      if (slot === g.slot) continue;
      const counts = new Map();
      for (const state of g.states) {
        const v = state.get(slot) ?? null;
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      const [value, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
      if (value !== setupValue && count / g.states.length >= AGREEMENT) alsoSets.push({ slot, attachment: value });
    }
    if (alsoSets.length) out.push({ slot: g.slot, attachment: g.attachment, alsoSets, inBetweens: neighboursOf(sk, g.slot, g.attachment), occurrences: g.states.length, clips: [...g.clips].sort() });
  }
  return out.sort((a, b) => a.slot.localeCompare(b.slot) || a.attachment.localeCompare(b.attachment));
}

/**
 * Where one clip breaks a convention the rig's other clips keep.
 * A missing hide is `weak` (the covered art shows through, as in a half-closed blink); a missing
 * companion attachment is only `look` (a wink is a choice, not a fault).
 * @returns {Array<{ code: 'rig-convention', severity: 'weak'|'look', where: string, message: string, measure: object, fix: string }>}
 */
export function conventionFindings(sk, name) {
  const clip = sk?.animations?.[name];
  if (!clip) return [];
  const conventions = new Map(rigConventions(sk, { exclude: name }).map(c => [`${c.slot}\u0000${c.attachment}`, c]));
  if (!conventions.size) return [];
  const setup = setupAttachments(sk);
  /** @type {any[]} */
  const out = [];
  for (const s of switchesOf(clip, setup)) {
    const c = conventions.get(`${s.slot}\u0000${s.attachment}`);
    if (!c) continue;
    const state = stateAt(sk, clip, s.time, setup);
    const missing = c.alsoSets.filter(x => (state.get(x.slot) ?? null) !== x.attachment);
    if (!missing.length) continue;
    const show = x => `${x.slot} ${x.attachment === null ? 'hidden' : `showing ${x.attachment}`}`;
    out.push({
      code: 'rig-convention',
      severity: missing.some(x => x.attachment === null) ? 'weak' : 'look',
      where: `animations/${name}/slots/${s.slot}/attachment`,
      message: `${s.slot} shows ${s.attachment} at ${round3(s.time)} s, but in this rig's other clips (${c.clips.slice(0, 4).join(', ')}) that always comes with ${missing.map(show).join(', ')}.`,
      measure: { time: round3(s.time), slot: s.slot, attachment: s.attachment, missing, occurrences: c.occurrences, clips: c.clips },
      fix: `Key ${missing.map(x => `${x.slot} to ${x.attachment === null ? 'null (hidden)' : `"${x.attachment}"`}`).join(', ')} at ${round3(s.time)} s too, and back where ${s.slot} switches back.${c.inBetweens.length ? ` For a softer switch (slow in and out), pass through ${c.inBetweens.join(' or ')} for a frame or two on the way, as the owner's clips do.` : ''} read_rig lists every convention under \`conventions\`.`,
    });
  }
  return out;
}
