// The key lanes under the stage, worked out from the animation itself: one lane per bone (or slot)
// and channel that has keys in the clip, the key times on it, and the clip's events. Read-only; no
// DOM here, so a test can load it. The page draws what this returns (web/timeline.js).

/** What a timeline in a skeleton's animation changes, by the name the file gives it. */
const BONE_CHANNELS = { rotate: 'rotate', translate: 'move', translatex: 'move', translatey: 'move',
  scale: 'scale', scalex: 'scale', scaley: 'scale', shear: 'shear', shearx: 'shear', sheary: 'shear' };
const SLOT_CHANNELS = { attachment: 'image', rgba: 'colour', rgb: 'colour', alpha: 'colour', rgba2: 'colour', rgb2: 'colour' };

/** The channels in the order lanes are listed, and the colour token each is drawn in. */
export const CHANNELS = Object.freeze(['rotate', 'move', 'scale', 'shear', 'colour', 'image', 'events']);
export const CHANNEL_COLOUR = Object.freeze({ rotate: '--ch-rotate', move: '--ch-translate', scale: '--ch-scale', shear: '--ch-scale',
  colour: '--ch-color', image: '--ch-attachment', events: '--ch-event' });

const timeOf = key => (Number.isFinite(key?.time) ? key.time : 0);
const sortedTimes = keys => [...new Set((Array.isArray(keys) ? keys : []).map(timeOf))].sort((a, b) => a - b);

/** The last key time anywhere in an animation: its length, as Spine counts it. */
function lengthOf(animation) {
  let end = 0;
  const visit = value => {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && !Array.isArray(item)) { end = Math.max(end, timeOf(item)); for (const v of Object.values(item)) if (typeof v === 'object') visit(v); }
        else visit(item);
      }
    } else if (value && typeof value === 'object') {
      for (const v of Object.values(value)) visit(v);
    }
  };
  visit(animation);
  return end;
}

/**
 * The lanes of one clip.
 * @param {any} json a skeleton in Spine 4.2 JSON form
 * @param {string} clip the animation's name
 * @returns {null | { duration: number, lanes: { target: string, kind: string, channel: string, keys: number[], child: boolean }[] }} kind is bone, slot or events
 */
export function lanesFromAnimation(json, clip) {
  const animation = json?.animations?.[clip];
  if (!animation || typeof animation !== 'object') return null;
  const boneOrder = new Map((json.bones ?? []).map((b, i) => [b.name, i]));
  const slotOrder = new Map((json.slots ?? []).map((s, i) => [s.name, i]));
  const lanes = [];
  const add = (kind, groups, channels, order) => {
    const targets = Object.keys(groups ?? {}).sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || a.localeCompare(b));
    for (const target of targets) {
      const byChannel = new Map();
      for (const [name, keys] of Object.entries(groups[target] ?? {})) {
        const channel = channels[name];
        if (!channel) continue;
        byChannel.set(channel, [...(byChannel.get(channel) ?? []), ...(Array.isArray(keys) ? keys : [])]);
      }
      let first = true;
      for (const channel of CHANNELS) {
        if (!byChannel.has(channel)) continue;
        const keys = sortedTimes(byChannel.get(channel));
        if (!keys.length) continue;
        lanes.push({ target, kind, channel, keys, child: !first });
        first = false;
      }
    }
  };
  add('bone', animation.bones, BONE_CHANNELS, boneOrder);
  add('slot', animation.slots, SLOT_CHANNELS, slotOrder);
  const events = sortedTimes(animation.events);
  if (events.length) lanes.push({ target: 'events', kind: 'events', channel: 'events', keys: events, child: false });
  return { duration: lengthOf(animation), lanes };
}

/**
 * Ruler marks for a clip: labelled steps a comfortable distance apart, and minor ticks between.
 * @returns {{ major: number[], minor: number[], step: number }}
 */
export function rulerTicks(duration, labels = 6) {
  if (!(duration > 0)) return { major: [], minor: [], step: 0 };
  const steps = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 30, 60];
  const step = steps.find(s => duration / s <= labels) ?? steps[steps.length - 1];
  const minorStep = step / 4;
  const major = [], minor = [];
  const round = v => Math.round(v * 1e6) / 1e6;
  for (let i = 1; i * step < duration - 1e-9; i++) major.push(round(i * step));
  for (let i = 1; i * minorStep < duration - 1e-9; i++) if (i % 4) minor.push(round(i * minorStep));
  return { major, minor, step };
}

/** Where a time sits along the lanes, 0 to 1. */
export const along = (time, duration) => (duration > 0 ? Math.max(0, Math.min(1, time / duration)) : 0);
