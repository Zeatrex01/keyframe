// Change the interpolation between keys that already exist. Ported from legacy recurve.js.
//
// The workflow gap: an AI writing an animation usually leaves every
// segment linear. Writing an animation and choosing its curves are two different moments:
// the keys (what happens, and when) are decided first, and how it feels between them is a
// judgement made while watching. Without this module the only way to change a curve was to
// re-author the whole timeline. This retro-fits curves onto keys that are already there.
//
// It never moves a key. Times and values are read, never written: only each segment's
// `curve` is set (or removed, for `linear`). The pose at every key is bit-identical
// afterwards, only the path between keys changes, which is what makes it safe to run
// repeatedly while judging by eye.
//
// Works on the Spine JSON shape (time / value / x / y / color) of a file that already exists.
// Pure and isomorphic.

import { StudioError } from '../../shared/errors.js';
import { ease1 } from './key-math.js';
import { handlesFor, presetNames } from './presets.js';

/*
 * Which channels can carry a curve, which fields each interpolates (the field count decides
 * the curve length: 4 numbers per property), and the value the runtime assumes when a key
 * omits a field (spine-ts 4.2 SkeletonJson: 1 for scale, 0 for everything else; exports
 * drop default values, so a scale key without `x` is common). Getting either wrong writes a
 * file Spine reads as garbage, or a curve that dips to 0 on a scale track. Channels not
 * listed are skipped and reported, never guessed at:
 *   attachment, drawOrder, inherit switch instead of interpolating;
 *   deform carries a curve but its values are vertex arrays (mesh work, out of scope);
 *   rgba2 / rgb2 (two-colour tint) are not carried.
 */
const fields = (names, fallback) => Object.freeze({ fields: Object.freeze(names), fallback });
export const BONE_CHANNELS = Object.freeze({
  rotate: fields(['value'], 0),
  translate: fields(['x', 'y'], 0), translatex: fields(['value'], 0), translatey: fields(['value'], 0),
  scale: fields(['x', 'y'], 1), scalex: fields(['value'], 1), scaley: fields(['value'], 1),
  shear: fields(['x', 'y'], 0), shearx: fields(['value'], 0), sheary: fields(['value'], 0),
});
export const SLOT_CHANNELS = Object.freeze({
  alpha: fields(['value'], 0),
  // Colour channels interpolate the 4 (or 3) bytes of a hex string as 0..1 components.
  rgba: Object.freeze({ color: 4 }),
  rgb: Object.freeze({ color: 3 }),
});

const isNumber = v => typeof v === 'number' && Number.isFinite(v);
const timeOf = key => (isNumber(key?.time) ? key.time : 0);
const hexComponent = (key, i) => {
  const hex = String(key?.color || 'ffffffff').replace(/^#/, '').padEnd(8, 'f');
  return parseInt(hex.slice(i * 2, i * 2 + 2), 16) / 255;
};

/**
 * The absolute curve for one segment of one channel: the single implementation of
 * "preset -> Spine bezier".
 * @param {{ fields: string[], fallback: number } | { color: number }} spec a channel spec
 * @param {object} a the segment's first key
 * @param {object} b the segment's second key
 * @param {number[] | 'stepped' | null} handles normalized handles; null means linear
 * @returns {number[] | 'stepped' | null} null means "write no curve at all" (linear is
 *   Spine's own default and the correct way to express it, as is a zero-length segment)
 */
export function segmentCurve(spec, a, b, handles) {
  const t0 = timeOf(a), t1 = timeOf(b);
  if (!(t1 > t0)) return null;
  if (handles === 'stepped') return 'stepped';
  if (!handles) return null;
  const out = [];
  if ('color' in spec) {
    for (let i = 0; i < spec.color; i++) out.push(...ease1(t0, t1, hexComponent(a, i), hexComponent(b, i), handles));
    return out;
  }
  for (const field of spec.fields) {
    const v0 = isNumber(a[field]) ? a[field] : spec.fallback;
    const v1 = isNumber(b[field]) ? b[field] : spec.fallback;
    out.push(...ease1(t0, t1, v0, v1, handles));
  }
  return out;
}

const TIME_EPS = 1e-6;
const inRange = (key, from, to) => {
  const t = timeOf(key);
  return (from === undefined || t >= from - TIME_EPS) && (to === undefined || t <= to + TIME_EPS);
};
const wanted = (list, name) => !list || !list.length
  || list.some(x => String(x).toLowerCase() === String(name).toLowerCase());

function resolveCurve(preset) {
  const word = String(preset).toLowerCase();
  if (word === 'stepped') return 'stepped';
  if (word === 'linear') return null;
  const handles = handlesFor(preset);
  if (handles) return handles;
  const valid = [...presetNames(), 'stepped'];
  if (Array.isArray(preset)) {
    throw new StudioError('bad-curve-handles',
      'Raw curve handles must be four finite numbers [x1, y1, x2, y2] with x1 and x2 in 0..1.',
      { preset });
  }
  throw new StudioError('unknown-curve',
    `Unknown curve "${preset}". Valid: ${valid.join(', ')}, or four numbers [x1, y1, x2, y2].`,
    { preset: String(preset), valid });
}

/**
 * Apply a curve across an animation's segments.
 * @param {object} skeleton parsed skeleton JSON; MUTATED (clone first to keep the original)
 * @param {{ animation: string, preset: string | number[], bones?: string[], slots?: string[],
 *   channels?: string[], from?: number, to?: number }} options
 *   `preset`: a preset name or alias, 'linear' (removes the curve), 'stepped', or raw
 *   normalized handles. `from`/`to` select segments by their first key's time.
 * @returns {{ animation: string, preset: string, segments: number,
 *   changed: Array<{ owner: string, channel: string, segments: number }>,
 *   skipped: Array<{ owner: string, channel: string, reason: string }>,
 *   handles: number[] | 'stepped' | 'linear' }}
 *   what actually changed, so the caller reports it instead of claiming success
 */
export function recurve(skeleton, options) {
  const { animation: name, preset, bones, slots, channels, from, to } = options;
  const animations = skeleton?.animations ?? {};
  const animation = Object.hasOwn(animations, name) ? animations[name] : undefined;
  if (!animation) {
    throw new StudioError('unknown-animation', `No animation named "${name}".`,
      { animation: name, available: Object.keys(animations) });
  }
  const handles = resolveCurve(preset);

  const changed = [], skipped = [];
  let segments = 0;
  const walk = (group, table, filter) => {
    for (const [owner, timelines] of Object.entries(group ?? {})) {
      if (!wanted(filter, owner)) continue;
      for (const [channelName, keys] of Object.entries(timelines ?? {})) {
        const channel = channelName.toLowerCase();
        if (!wanted(channels, channel)) continue;
        const spec = Object.hasOwn(table, channel) ? table[channel] : undefined;
        if (!spec) { skipped.push({ owner, channel: channelName, reason: 'channel-carries-no-curve' }); continue; }
        if (!Array.isArray(keys) || keys.length < 2) continue;
        let count = 0;
        for (let i = 0; i < keys.length - 1; i++) {
          if (!inRange(keys[i], from, to)) continue;
          const curve = segmentCurve(spec, keys[i], keys[i + 1], handles);
          if (curve === null) delete keys[i].curve; else keys[i].curve = curve;
          count++;
        }
        segments += count;
        if (count) changed.push({ owner, channel: channelName, segments: count });
      }
    }
  };
  walk(animation.bones, BONE_CHANNELS, bones);
  walk(animation.slots, SLOT_CHANNELS, slots);

  return { animation: name, preset: String(preset), segments, changed, skipped,
    handles: handles === 'stepped' ? 'stepped' : (handles ?? 'linear') };
}
