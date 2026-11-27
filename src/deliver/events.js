// Event definitions for a delivery: the named moments a clip fires (a hit frame, a footstep, a
// sound cue) so a game can act on the exact frame. A skeleton must define every event its clips
// fire, with default values the keys may override; the studio keeps that true on every write:
//
//   defined by the base         the owner's own definitions always win
//   given in this write         `events: { hit: { int: 1, string: 'jab' } }` on write_animation
//   defined by the delivery     earlier writes' definitions come along
//   fired but still undefined   defined with no defaults, and reported
//
// Pure.

import { StudioError } from '../shared/errors.js';

const FIELDS = { int: v => Number.isInteger(v), float: v => Number.isFinite(v), string: v => typeof v === 'string',
  audio: v => typeof v === 'string', volume: v => Number.isFinite(v) && v >= 0 && v <= 1, balance: v => Number.isFinite(v) && v >= -1 && v <= 1 };

/** Check event definitions given to a write: { name: { int, float, string, audio, volume, balance } }. */
export function validateEventDefs(defs) {
  if (defs === undefined) return {};
  if (!defs || typeof defs !== 'object' || Array.isArray(defs)) throw new StudioError('bad-argument', '`events` is an object: { <name>: { int, float, string, audio, volume, balance } }.');
  for (const [name, def] of Object.entries(defs)) {
    if (!name.trim()) throw new StudioError('bad-argument', 'An event needs a name.');
    if (!def || typeof def !== 'object' || Array.isArray(def)) throw new StudioError('bad-argument', `Event "${name}" is an object of default values (may be empty).`, { event: name });
    for (const [key, value] of Object.entries(def)) {
      if (!FIELDS[key]) throw new StudioError('bad-argument', `Event "${name}": unknown field "${key}" (one of ${Object.keys(FIELDS).join(', ')}).`, { event: name, field: key });
      if (!FIELDS[key](value)) throw new StudioError('bad-argument', `Event "${name}": ${key} has the wrong type or range.`, { event: name, field: key, value });
    }
  }
  return defs;
}

/** Every event name the skeleton's clips fire. */
export function firedEvents(sk) {
  const names = new Set();
  for (const clip of Object.values(sk.animations ?? {})) for (const key of clip?.events ?? []) if (typeof key?.name === 'string') names.add(key.name);
  return names;
}

/**
 * Set `out.events` from the base, this write's definitions and the previous delivery, and define
 * any event a clip fires that is still undefined. Returns what was added and what the base overrode.
 */
export function defineEvents(out, base, previous, given = {}) {
  const own = base.events ?? {};
  const events = { ...(previous?.events ?? {}), ...given, ...own };
  const kept = Object.keys(given).filter(n => own[n] && JSON.stringify(own[n]) !== JSON.stringify(given[n]));
  const added = [];
  for (const name of firedEvents(out)) if (!events[name]) { events[name] = {}; added.push(name); }
  if (Object.keys(events).length) out.events = events; else delete out.events;
  return { defined: [...Object.keys(given).filter(n => !own[n]), ...added], ...(added.length ? { definedWithoutDefaults: added } : {}), ...(kept.length ? { baseDefinitionKept: kept } : {}) };
}
