// Writes the result of a whole-skeleton transformation (bake, merge, skin migration, weight
// repair, curve change) as a proven delivery. One write model for every such tool.
//
//   source is a delivery  -> transformed in place (backed up), its base stays the baseline
//   source is a base      -> written to a new delivery (default <base>_v2.json); if that file
//                            already exists the call is refused, because rebuilding from the
//                            base would discard the delivery's accumulated work
// Proof is the same as for write_animation: no fatal the baseline does not have, and the
// official runtime parses the result (or already refused the baseline).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { StudioError } from '../shared/errors.js';
import { openSkeleton, insideProjectReal } from '../core/paths.js';
import { checkSkeleton } from '../spine/check.js';
import { splitFatals, describe, identity } from '../spine/findings.js';
import { parseSkeleton } from '../runtime/index.js';
import { DELIVERY_MARKER } from './compose.js';
import { findSkeletons, commitDelivery } from './write.js';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const toRel = (dir, abs) => path.relative(dir, abs).split(path.sep).join('/');
const samePath = (a, b) => process.platform === 'win32'
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
const runtimeError = async sk => { try { await parseSkeleton(sk); return null; } catch (err) { return err.message; } };

/**
 * @param {object} options
 * @param {string} options.projectDir
 * @param {string} [options.file]  the skeleton to transform; empty = the folder's base
 * @param {string} [options.into]  only for a base source: the new delivery (default <base>_v2.json)
 * @param {(skeleton: object, context: { baseline: object, baseName: string|null }) => Promise<{ skeleton: object, report?: object }>|{ skeleton: object, report?: object }} options.transform
 *   receives a copy of the source and the owner's base; returns the transformed skeleton and a report
 */
export async function prepareTransform({ projectDir, file, into, transform }) {
  const dir = () => projectDir;
  const opened = openSkeleton(dir, file, { findSkeletons: d => findSkeletons(d) });
  const sourceBytes = fs.readFileSync(opened.abs);
  const isDelivery = !!opened.sk[DELIVERY_MARKER];

  let baseline = opened.sk;
  let baseRef = null;
  let targetAbs;
  if (isDelivery) {
    if (into) throw new StudioError('bad-argument', 'A delivery is transformed in place; `into` applies only to a base source.', { file: opened.rel });
    targetAbs = opened.abs;
    const baseName = opened.sk[DELIVERY_MARKER].base;
    const baseAbs = baseName ? path.join(path.dirname(opened.abs), baseName) : null;
    if (baseAbs && fs.existsSync(baseAbs)) {
      const bytes = fs.readFileSync(baseAbs);
      try { baseline = JSON.parse(bytes.toString('utf8')); baseRef = { rel: toRel(projectDir, baseAbs), abs: baseAbs, hash: hash(bytes) }; } catch { baseline = opened.sk; }
    }
  } else {
    targetAbs = insideProjectReal(dir, into || toRel(projectDir, opened.abs.replace(/\.json$/i, '_v2.json')));
    if (samePath(targetAbs, opened.abs)) throw new StudioError('base-protected', `"${opened.rel}" is the base; it is never written.`, { file: opened.rel });
    if (!samePath(path.dirname(targetAbs), path.dirname(opened.abs))) {
      throw new StudioError('delivery-folder', 'The delivery must sit in the base\'s folder so its atlas and pages resolve.', { into: toRel(projectDir, targetAbs) });
    }
    if (fs.existsSync(targetAbs)) {
      throw new StudioError('delivery-exists', `"${toRel(projectDir, targetAbs)}" already exists; transform that delivery instead (file: "${toRel(projectDir, targetAbs)}"), or choose another \`into\`, so its accumulated work is not discarded.`,
        { delivery: toRel(projectDir, targetAbs) });
    }
    baseRef = { rel: opened.rel, abs: opened.abs, hash: hash(sourceBytes) };
  }

  const result = await transform(structuredClone(opened.sk), { baseline, baseName: baseRef ? path.basename(baseRef.abs) : null });
  const out = result.skeleton;
  out[DELIVERY_MARKER] = isDelivery ? opened.sk[DELIVERY_MARKER] : { base: path.basename(opened.abs), baseHash: opened.sk.skeleton?.hash ?? null };

  const baselineFindings = checkSkeleton(baseline);
  const sourceFindings = checkSkeleton(opened.sk);
  const outFindings = checkSkeleton(out);
  // Inherited means present in the base or already in the source being transformed.
  const known = new Set([...baselineFindings, ...sourceFindings].map(identity));
  const { fresh } = splitFatals([...baselineFindings, ...sourceFindings], outFindings);
  if (fresh.length) {
    throw new StudioError('delivery-refused', `Nothing was written: the result fails checks the source passes. ${describe(fresh).join('; ')}`, { findings: fresh });
  }
  const outRuntime = await runtimeError(out);
  if (outRuntime && !(await runtimeError(opened.sk))) {
    throw new StudioError('delivery-refused', `Nothing was written: the official runtime refuses the result but accepts the source. ${outRuntime}`, { runtime: outRuntime });
  }
  return {
    projectDir,
    base: baseRef,
    target: { rel: toRel(projectDir, targetAbs), abs: targetAbs, hash: isDelivery ? hash(sourceBytes) : null, existed: isDelivery },
    bytes: Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8'),
    source: opened.rel,
    report: {
      ...(result.report ?? {}),
      source: opened.rel, inPlace: isDelivery,
      warnings: outFindings.filter(f => f.level === 'warn' && !known.has(identity(f))),
      ...(opened.autoChosen ? { sourceChosen: opened.autoChosen } : {}),
    },
  };
}

/**
 * prepare + commit: returns the commit result merged with the transform's report.
 * `options.drawEffects` goes to the commit (it draws the delivery's effect page).
 */
export async function writeTransform(options) {
  const plan = await prepareTransform(options);
  return { ...commitDelivery(plan, { drawEffects: options.drawEffects }), ...plan.report };
}
