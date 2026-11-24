// Follow-through, written as two numbers instead of hand-placed keys.
//
// A bone channel may be given as a request instead of keys:
//   bones: { tail: { rotate: { follow: 'head', frequency: 2.5, damping: 0.35, amount: 1 } } }
// The bone then trails the named bone's motion in this clip through a damped spring: it lags
// while the leader moves, swings past when the leader stops, and settles. The offset is baked
// to ordinary rotate keys here, so the delivery carries plain Spine data and nothing at runtime.
//
// The spring follows the leader's value x(t): y'' = w^2 (x - y) - 2 z w y', w = 2 pi frequency.
// The follower's rotate is (y - x) * amount: zero when it has caught up.
//
// Pure: no I/O. The only input is the clip as written.

import { StudioError } from '../shared/errors.js';
import { handlesFor, isValidHandles } from '../spine/curves/presets.js';
import { fitKeys } from '../understand/track.js';

const fail = (where, message) => { throw new StudioError('bad-animation', `${where}: ${message}`, { where }); };
const SOURCES = { rotate: ['rotate', 'value'], 'translate.x': ['translate', 'x'], 'translate.y': ['translate', 'y'] };
const STEP = 1 / 240;

export const isFollow = value => value !== null && typeof value === 'object' && !Array.isArray(value) && 'follow' in value;

// y of the cubic bezier through (0,0) (x1,y1) (x2,y2) (1,1) at x = u, by bisection (x is monotone).
function bezierAt(x1, y1, x2, y2, u) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 16; i++) { const s = (lo + hi) / 2, r = 1 - s; if (3 * r * r * s * x1 + 3 * r * s * s * x2 + s * s * s < u) lo = s; else hi = s; }
  const s = (lo + hi) / 2, r = 1 - s;
  return 3 * r * r * s * y1 + 3 * r * s * s * y2 + s * s * s;
}

/** The value of one component of a key list at a time, with the curve forms a clip may be written in. */
export function valueAt(keys, field, component, time) {
  const at = key => key[field] ?? 0, when = key => key.time ?? 0;
  if (time <= when(keys[0])) return at(keys[0]);
  const last = keys[keys.length - 1];
  if (time >= when(last)) return at(last);
  let k = 0;
  while (when(keys[k + 1]) <= time) k++;
  const a = keys[k], b = keys[k + 1], t0 = when(a), t1 = when(b), v0 = at(a), v1 = at(b), u = (time - t0) / (t1 - t0);
  const curve = a.curve;
  if (curve === 'stepped') return v0;
  if (Array.isArray(curve) && curve.length >= component * 4 + 4 && t1 > t0) {
    // Spine's own form: absolute handles, time in seconds, four numbers per component
    const [cx1, cy1, cx2, cy2] = curve.slice(component * 4, component * 4 + 4), span = v1 - v0;
    if (Math.abs(span) < 1e-9) return v0;
    return v0 + span * bezierAt((cx1 - t0) / (t1 - t0), (cy1 - v0) / span, (cx2 - t0) / (t1 - t0), (cy2 - v0) / span, u);
  }
  const handles = curve && typeof curve === 'object' && isValidHandles(curve.handles) ? curve.handles : typeof curve === 'string' ? handlesFor(curve) : null;
  return v0 + (v1 - v0) * (handles ? bezierAt(...handles, u) : u);
}

// The last key time anywhere in the clip: the length the followers are baked for.
function durationOf(node) {
  let end = 0;
  const walk = value => { if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') { if (typeof value.time === 'number') end = Math.max(end, value.time); Object.values(value).forEach(walk); } };
  walk(node);
  return end;
}

/**
 * Replace every follow request in `animation.bones` with baked rotate keys. Mutates `animation`.
 * @returns {Array<object>} one report per follower: what it follows, how many keys, how far it swings
 */
export function bakeFollows(animation, { fps = 30 } = {}) {
  const bones = animation.bones ?? {};
  const requests = [];
  for (const [bone, channels] of Object.entries(bones)) {
    if (!channels || typeof channels !== 'object' || Array.isArray(channels)) continue;
    for (const [channel, value] of Object.entries(channels)) if (isFollow(value)) {
      if (channel !== 'rotate') fail(`bones/${bone}/${channel}`, 'only rotate can follow; write keys here.');
      requests.push({ bone, request: value });
    }
  }
  if (!requests.length) return [];
  const duration = durationOf(animation);
  if (!(duration > 0)) fail('animation', 'a follower needs a leader that moves: no key in this clip is later than 0.');
  const count = Math.round(duration * fps) + 1, reports = [], state = new Map(), looping = new Map();   // bone -> 'baking' | 'done'; bone -> is its motion a loop

  const bake = (bone, request) => {
    const where = `bones/${bone}/rotate`;
    if (state.get(bone) === 'done') return;
    if (state.get(bone) === 'baking') fail(where, 'followers follow each other in a circle.');
    state.set(bone, 'baking');
    const { follow, of = 'rotate', frequency = 2.5, damping = 0.35, amount = 1 } = request;
    for (const key of Object.keys(request)) if (!['follow', 'of', 'frequency', 'damping', 'amount'].includes(key)) fail(where, `"${key}" is not part of a follow request (follow, of, frequency, damping, amount).`);
    if (!(of in SOURCES)) fail(where, `"of" must be one of ${Object.keys(SOURCES).join(', ')}.`);
    if (!(frequency >= 0.2 && frequency <= 12)) fail(where, 'frequency is in swings per second, 0.2 to 12 (2 to 3 for hair, 4 to 6 for something stiff).');
    if (!(damping >= 0.05 && damping <= 2)) fail(where, 'damping is 0.05 (rings for a long time) to 2 (no overshoot); 1 is critical.');
    if (typeof amount !== 'number' || !Number.isFinite(amount)) fail(where, 'amount must be a number (degrees of swing per unit the leader moves).');
    const [channel, field] = SOURCES[of], component = field === 'y' ? 1 : 0;
    if (follow === bone && channel === 'rotate') fail(where, 'a bone cannot follow its own rotation.');
    const leaderChannels = bones[follow];
    if (!leaderChannels || leaderChannels[channel] === undefined) fail(where, `"${follow}" has no ${channel} keys in this clip to follow.`);
    if (isFollow(leaderChannels[channel])) bake(follow, leaderChannels[channel]);
    const keys = leaderChannels[channel];
    if (!Array.isArray(keys) || !keys.length) fail(where, `"${follow}" ${channel} has no keys.`);
    const leader = time => valueAt(keys, field, component, time);

    // A clip that ends where it starts is a loop: run it until the swing repeats, keep the last pass.
    // A follower of a follower takes its leader's answer: a settled swing also ends where it began.
    const loops = looping.has(follow) ? looping.get(follow) : Math.abs(leader(0) - leader(duration)) < 1e-6;
    looping.set(bone, loops);
    const w = 2 * Math.PI * frequency, samples = [];
    let y = leader(0), v = 0;
    for (let pass = loops ? 6 : 0; pass >= 0; pass--) {
      samples.length = 0;
      for (let i = 0, t = 0; i < count; i++) {
        const until = i / fps;
        for (; t < until - 1e-9; t += STEP) { const x = leader(Math.min(t, duration)); v += (w * w * (x - y) - 2 * damping * w * v) * STEP; y += v * STEP; }
        samples.push({ time: +(until).toFixed(4), value: (y - leader(until)) * amount });
      }
    }
    if (loops) samples[count - 1].value = samples[0].value;
    const peak = Math.max(...samples.map(s => Math.abs(s.value)));
    const fitted = peak < 0.05 ? null : fitKeys(samples, ['value'], Math.max(0.05, peak * 0.03), fps);
    const baked = (fitted ?? [{ time: 0, value: 0 }, { time: samples[count - 1].time, value: 0 }]).map(k => ({
      time: k.time, value: +k.value.toFixed(2), ...(k.curve ? { curve: { handles: k.curve } } : k.ease && k.ease !== 'linear' ? { curve: k.ease } : {}) }));
    bones[bone].rotate = baked;
    const rest = Math.abs(samples[count - 1].value);
    reports.push({ where, follows: follow, of, frequency, damping, amount, keys: baked.length, peak: +peak.toFixed(2), loop: loops,
      ...(peak < 0.05 ? { note: `"${follow}" barely moves on ${of}, so there is nothing to follow.` }
        : !loops && rest > Math.max(0.3, peak * 0.08) ? { note: `Still ${rest.toFixed(1)} degrees off when the clip ends: hold the leader's last key longer, or raise damping.` } : {}) });
    state.set(bone, 'done');
  };
  for (const { bone, request } of requests) bake(bone, request);
  return reports;
}
