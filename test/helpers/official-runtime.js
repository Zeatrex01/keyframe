// The official Spine runtime for gates that compare against it, or null when the Spine add-on is
// not installed. The engine never needs it; only these comparisons do, and they skip without it.
import * as runtime from '../../src/runtime/index.js';

const official = {
  ...runtime,
  parseSkeleton: (json, options = {}) => runtime.parseSkeleton(json, { ...options, backend: 'spine' }),
};

let cached;
/** @returns {Promise<typeof official | null>} */
export async function officialRuntime() {
  if (cached === undefined) {
    try { await runtime.loadRuntime(); cached = official; } catch { cached = null; }
  }
  return cached;
}
