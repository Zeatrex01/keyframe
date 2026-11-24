// The proof ledger: what was written and whether it was proven since. A write is not delivered
// until the calls that prove it ran on it after the write:
//
//   motion   (write_animation, apply_motion, set_curves, add_effect, bake_animation)
//            check_skeleton on the file and critique_animation on the clip
//   drawing  (draw_rig)  critique_art on the drawing
//
// The MCP server notes every successful call here (src/mcp/wire.js); `reply` refuses work
// "ready" for an unproven delivery, and the embedded Director's turn ends with a plain note
// naming what was written and not proven. Kept in <project>/.keyframe/proof.json, small and
// bounded. Node-only (layer `core`).

import fs from 'node:fs';
import path from 'node:path';

export const PROOF_FILE = path.join('.keyframe', 'proof.json');
const KEEP = 200;
const MOTION_WRITES = new Set(['write_animation', 'apply_motion', 'set_curves', 'add_effect', 'bake_animation']);

/** The calls that prove each kind of write, by the ledger field they set. */
export const PROOF_CALLS = Object.freeze({ motion: { checked: 'check_skeleton', critiqued: 'critique_animation' }, drawing: { critiqued: 'critique_art' } });

function read(dir) {
  try { const j = JSON.parse(fs.readFileSync(path.join(dir, PROOF_FILE), 'utf8')); return j && typeof j === 'object' ? { writes: j.writes ?? {}, checks: j.checks ?? {} } : { writes: {}, checks: {} }; } catch { return { writes: {}, checks: {} }; }
}
function write(dir, ledger) {
  const keys = Object.keys(ledger.writes).sort((a, b) => ledger.writes[b].written - ledger.writes[a].written).slice(0, KEEP);
  const out = { writes: Object.fromEntries(keys.map(k => [k, ledger.writes[k]])), checks: ledger.checks };
  fs.mkdirSync(path.join(dir, '.keyframe'), { recursive: true });
  const tmp = path.join(dir, `${PROOF_FILE}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(out));
  fs.renameSync(tmp, path.join(dir, PROOF_FILE));
}
const key = (file, animation) => `${file}#${animation ?? ''}`;

/**
 * Note one successful tool call.
 * @param {string} dir  the project
 * @param {string} tool
 * @param {object} args
 * @param {any} result  the tool's result (an image result's `meta` is read)
 * @param {number} [now]
 */
export function noteCall(dir, tool, args, result, now = Date.now()) {
  const r = result?.meta ?? result;
  if (!dir || !r || typeof r !== 'object' || r.error) return;
  const file = typeof r.file === 'string' ? r.file : typeof args?.file === 'string' ? args.file : null;
  if (!file) return;
  const ledger = read(dir);
  if (MOTION_WRITES.has(tool) && typeof (r.animation ?? args?.animation) === 'string') {
    ledger.writes[key(file, r.animation ?? args.animation)] = { kind: 'motion', file, animation: r.animation ?? args.animation, tool, written: now };
  } else if (tool === 'draw_rig') {
    const parts = file.replace(/\.json$/, '.parts.json');
    ledger.writes[key(parts, null)] = { kind: 'drawing', file: parts, rig: file, tool, written: now };
  } else if (tool === 'check_skeleton') {
    ledger.checks[file] = now;
  } else if (tool === 'critique_animation' && typeof args?.animation === 'string') {
    const w = ledger.writes[key(file, args.animation)];
    if (w) w.critiqued = now;
  } else if (tool === 'critique_art') {
    const w = ledger.writes[key(file, null)];
    if (w) w.critiqued = now;
  } else if (tool === 'see_animation' && typeof args?.animation === 'string') {
    const w = ledger.writes[key(file, args.animation)];
    if (w) w.seen = now;
  } else return;
  write(dir, ledger);
}

/** What a write still lacks: the calls to run, [] when proven (or when nothing was written). */
function missingFor(ledger, w) {
  const out = [];
  if (w.kind === 'motion') {
    if (!((ledger.checks[w.file] ?? 0) >= w.written)) out.push(PROOF_CALLS.motion.checked);
    if (!((w.critiqued ?? 0) >= w.written)) out.push(PROOF_CALLS.motion.critiqued);
  } else if (!((w.critiqued ?? 0) >= w.written)) out.push(PROOF_CALLS.drawing.critiqued);
  return out;
}

/** The proof of one delivery: what it lacks ([] when proven or never written through the tools). */
export function proofOf(dir, file, animation) {
  const ledger = read(dir);
  const w = ledger.writes[key(file, animation)] ?? (animation ? null : ledger.writes[key(file.replace(/\.json$/, '.parts.json'), null)]);
  return { written: !!w, missing: w ? missingFor(ledger, w) : [] };
}

/** Everything written since `since` (ms) and not proven yet. */
export function unproven(dir, since = 0) {
  const ledger = read(dir);
  return Object.values(ledger.writes).filter(w => w.written >= since).map(w => ({ file: w.file, animation: w.animation ?? null, kind: w.kind, missing: missingFor(ledger, w) })).filter(w => w.missing.length);
}
