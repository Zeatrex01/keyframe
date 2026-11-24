// "What does this animation do", in numbers: channels, per-channel measurements, the
// frame-grid report, duration, constraint and deform summaries, and draw-order changes
// against the setup order. Raw keys only on request, compressed even then.
// Ported from legacy inspect.js `animation()`.
//
// The default is the measurement, not the keys (raw keys cost
// too many tokens). Measured in legacy: an ordinary scene of 20 bones x 3 channels x 30 keys
// returned ~28,000 tokens because the raw keys, each with a 4-8 number curve, travelled
// next to a measurement that already answered the question. Raw keys are needed only to
// fix a single bone: `detail` adds them as column arrays, `raw` in Spine's own form.
//
// Draw order is resolved by the official runtime (ADR-2), never by our own copy of
// Spine's offset algorithm. Raw draw-order keys are offsets relative to the setup order
// and cannot answer "who is in front"; the resolved order can. `readAnimation` takes the
// resolved orders as an argument and stays synchronous; `readAnimationOnRuntime` samples
// them from the runtime.

import { StudioError } from '../shared/errors.js';
import { parseSkeleton, sampleAnimation } from '../runtime/index.js';
import {
  CONSTRAINT_SECTIONS, round6, keyTime, issueCollector, animationDuration, channelsOf, frameGridReport,
  measureChannel, spanOf, compressKeys, drawOrderChanges, drawOrderOffsetProblems, runtimeRefusal,
} from './read-timelines.js';

function findAnimation(sk, name) {
  if (!sk || typeof sk !== 'object' || Array.isArray(sk)) throw new StudioError('bad-skeleton', 'This is not a skeleton JSON object.');
  const anim = sk.animations?.[name];
  if (!anim || typeof anim !== 'object') {
    const available = Object.keys(sk.animations ?? {});
    throw new StudioError('unknown-animation', `No animation named "${name}". Available: ${available.join(', ') || '(none)'}.`,
      { animation: name, available });
  }
  return anim;
}

/** Times of the animation's draw-order keys, in key order (where to sample the runtime). */
export function drawOrderKeyTimes(sk, name) {
  const keys = findAnimation(sk, name).drawOrder;
  return Array.isArray(keys) ? keys.map(keyTime) : [];
}

const summarise = value => (Array.isArray(value) ? spanOf(value) : value);

/**
 * @param {object} sk parsed skeleton JSON
 * @param {string} name animation name
 * @param {{ fps?: number, detail?: boolean | 'keys', raw?: boolean, bones?: string[],
 *   drawOrders?: string[][], fullDrawOrder?: boolean }} [options]
 *   detail: add the keys (compressed) next to each bone measurement, slot keys compressed,
 *     constraint sections raw. raw: with detail, keys in Spine's own form.
 *   bones: only these bones in the `bones` section. Always narrow when asking for detail.
 *   drawOrders: the resolved slot order at each draw-order key, from the runtime
 *     (see readAnimationOnRuntime). Without it the keys are listed but not resolved.
 *   fullDrawOrder: also return the full resolved order per key (long).
 */
export function readAnimation(sk, name, options = {}) {
  const anim = findAnimation(sk, name);
  const { fps, raw = false, fullDrawOrder = false, drawOrders } = options;
  const detail = options.detail === true || options.detail === 'keys';
  const filter = Array.isArray(options.bones) && options.bones.length ? new Set(options.bones) : null;
  const issues = issueCollector();

  const bones = {};
  for (const [bone, timelines] of Object.entries(anim.bones ?? {})) {
    if (filter && !filter.has(bone)) continue;
    bones[bone] = {};
    for (const [channel, keys] of Object.entries(timelines ?? {})) {
      if (!Array.isArray(keys)) continue; // reported by the walker below as channel-shape
      bones[bone][channel] = detail
        ? { keys: compressKeys(channel, keys, raw), measure: measureChannel(channel, keys) }
        : measureChannel(channel, keys);
    }
  }

  const slots = {};
  for (const [slot, timelines] of Object.entries(anim.slots ?? {})) {
    const out = {};
    for (const [channel, keys] of Object.entries(timelines ?? {})) {
      out[channel] = !Array.isArray(keys) ? keys : detail ? compressKeys(channel, keys, raw) : spanOf(keys);
    }
    slots[slot] = out;
  }

  // Constraint and deform sections: channels the studio does not write but must read.
  // Not reading them amounted to saying "the animation is empty" about a physics flag or
  // a meshed mouth.
  const constraints = {};
  for (const section of CONSTRAINT_SECTIONS) {
    const value = anim[section];
    if (!value || typeof value !== 'object' || !Object.keys(value).length) continue;
    if (detail) { constraints[section] = value; continue; }
    const out = {};
    for (const [constraint, timelines] of Object.entries(value)) {
      if (Array.isArray(timelines)) { out[constraint] = spanOf(timelines); continue; }
      const properties = {};
      for (const [property, keys] of Object.entries(timelines ?? {})) properties[property] = summarise(keys);
      out[constraint] = properties;
    }
    constraints[section] = out;
  }

  // Deform: 3.8 three levels (array at the end), 4.2 four levels ({ deform: [...] }).
  const deform = [];
  for (const [skin, slotMap] of Object.entries(anim.attachments ?? anim.deform ?? {})) {
    for (const [slot, attachments] of Object.entries(slotMap ?? {})) {
      for (const [attachment, value] of Object.entries(attachments ?? {})) {
        if (Array.isArray(value)) { deform.push({ skin, slot, attachment, timeline: 'deform', ...spanOf(value) }); continue; }
        if (!value || typeof value !== 'object') continue;
        for (const [timeline, keys] of Object.entries(value)) {
          if (Array.isArray(keys)) deform.push({ skin, slot, attachment, timeline, ...spanOf(keys) });
        }
      }
    }
  }

  const drawOrderSection = Array.isArray(anim.drawOrder) && anim.drawOrder.length
    ? resolveDrawOrder(sk, anim.drawOrder, drawOrders, fullDrawOrder) : null;

  return {
    name,
    duration: round6(animationDuration(anim, issues)),
    channels: channelsOf(anim, issues),
    frameGrid: frameGridReport(anim, fps, issues),
    bones, slots,
    ...(issues.list.length ? { issues: issues.list } : {}),
    ...(Object.keys(constraints).length ? { constraints } : {}),
    ...(deform.length ? { deform } : {}),
    ...(anim.drawOrder !== undefined ? { drawOrder: anim.drawOrder } : {}),
    ...(drawOrderSection ? { drawOrderChanges: drawOrderSection } : {}),
    ...(anim.events !== undefined ? { events: anim.events } : {}),
  };
}

// Per draw-order key: does it return to setup, what moved how many steps, and any offsets
// the runtime cannot survive. A key with no offsets restores the setup order.
function resolveDrawOrder(sk, keys, drawOrders, fullDrawOrder) {
  const setupOrder = (sk.slots ?? []).map(s => s?.name);
  const resolved = Array.isArray(drawOrders) && drawOrders.length === keys.length;
  if (drawOrders !== undefined && !resolved) {
    throw new StudioError('bad-argument', 'drawOrders must hold one resolved slot order per draw-order key.',
      { keys: keys.length, given: Array.isArray(drawOrders) ? drawOrders.length : null });
  }
  return {
    setupOrder,
    resolved,
    keys: keys.map((key, i) => {
      const problems = drawOrderOffsetProblems(setupOrder, key?.offsets);
      return {
        time: round6(keyTime(key)),
        returnsToSetup: !(Array.isArray(key?.offsets) && key.offsets.length),
        ...(resolved ? { changes: drawOrderChanges(setupOrder, drawOrders[i]) } : {}),
        ...(resolved && fullDrawOrder ? { order: drawOrders[i] } : {}),
        ...(problems.length ? { problems } : {}),
      };
    }),
  };
}

/**
 * readAnimation with the draw order resolved by the official runtime at every draw-order
 * key. If the runtime cannot be used for this file, the keys are listed unresolved and
 * `drawOrderChanges.unresolved` says why.
 * @param {object} sk
 * @param {string} name
 * @param {Parameters<typeof readAnimation>[2] & { skin?: string }} [options]
 */
export async function readAnimationOnRuntime(sk, name, options = {}) {
  const times = drawOrderKeyTimes(sk, name);
  if (!times.length) return readAnimation(sk, name, options);
  let drawOrders;
  const unresolved = await runtimeRefusal(sk, async () => {
    const samples = await sampleAnimation(await parseSkeleton(sk), name, times, { skin: options.skin });
    drawOrders = samples.map(s => s.drawOrder);
  });
  if (!unresolved) return readAnimation(sk, name, { ...options, drawOrders });
  const report = readAnimation(sk, name, { ...options, drawOrders: undefined });
  report.drawOrderChanges.unresolved = unresolved;
  return report;
}
