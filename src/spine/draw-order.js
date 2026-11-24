// Draw-order offsets the official runtime cannot survive. One implementation, used by the
// static check, the runtime host (before it hands a file to the parser) and the readers.

import { finding } from './findings.js';

/**
 * Offsets in one draw-order key that the official parser cannot survive.
 * Measured 2026-10-28 on spine-ts 4.2.119: offsets not in increasing slot order make
 * SkeletonJson loop until the process runs out of memory (it cannot be caught); an offset
 * landing outside the slot list, or two offsets landing on the same index, parse without
 * complaint and then crash every sample with "Cannot read properties of undefined". A file
 * written by hand or by an agent can carry any of these, so the runtime host checks before
 * it hands a file to the parser: broken input fails one read, not the process.
 * @param {string[]} setupOrder
 * @param {object[]} offsets `[{ slot, offset }]`
 * @returns {{ code: string, slot: string, message: string }[]}
 */
export function drawOrderOffsetProblems(setupOrder, offsets) {
  const index = new Map(setupOrder.map((slot, i) => [slot, i]));
  const problems = [];
  const taken = new Set();
  let next = 0; // the first slot index the parser has not consumed yet
  for (const o of Array.isArray(offsets) ? offsets : []) {
    const slot = o?.slot;
    const slotIndex = index.get(slot);
    if (slotIndex === undefined) {
      problems.push({ code: 'draw-order-unknown-slot', slot, message: `Slot "${slot}" does not exist.` });
      continue;
    }
    if (slotIndex < next) {
      problems.push({ code: 'draw-order-unsorted', slot,
        message: `Offsets must list slots in increasing setup order; "${slot}" comes after a later slot (or twice).` });
      continue;
    }
    next = slotIndex + 1;
    const offset = o.offset ?? 0;
    const target = slotIndex + offset;
    if (!Number.isInteger(offset) || target < 0 || target >= setupOrder.length) {
      problems.push({ code: 'draw-order-out-of-range', slot,
        message: `Offset ${offset} moves "${slot}" to index ${target}, outside 0..${setupOrder.length - 1}.` });
      continue;
    }
    if (taken.has(target)) {
      problems.push({ code: 'draw-order-collision', slot, message: `Two offsets move a slot to index ${target}.` });
      continue;
    }
    taken.add(target);
  }
  return problems;
}

/**
 * Every draw-order key in the skeleton the runtime cannot survive, as fatal findings.
 * The runtime parses all animations at once, so one bad key anywhere blocks every pose.
 */
export function drawOrderHazards(sk) {
  const setupOrder = (sk?.slots ?? []).map(s => s?.name);
  const out = [];
  for (const [animation, anim] of Object.entries(sk?.animations ?? {})) {
    const keys = anim?.drawOrder;
    if (!Array.isArray(keys)) continue;
    keys.forEach((key, i) => {
      for (const p of drawOrderOffsetProblems(setupOrder, key?.offsets)) {
        out.push(finding('fatal', p.code, `animations/${animation}/drawOrder/${i}`, p.message, { animation, key: i, slot: p.slot }));
      }
    });
  }
  return out;
}
