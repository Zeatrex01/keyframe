// Writes a delivery file beside the owner's base. The file half of the one-way rule.
//
// Two phases so a change between reading and writing is caught:
//   prepareDelivery  reads the base and the current delivery, composes and proves the result
//   commitDelivery   checks that neither file changed since, backs up the old delivery,
//                    writes atomically (temp file + rename), and places the atlas beside it
//
// Refusals, each a StudioError with a code, each before anything is written:
//   base-protected      the target is the base itself
//   base-is-delivery    the chosen base is a studio delivery; write onto its own base
//   target-not-delivery the target exists and is not a studio delivery (an owner file)
//   delivery-folder     the target is not in the base's folder (atlas pages resolve by folder)
//   changed-during-write the base or the target changed after it was read
// plus everything compose refuses (delivery-refused, bad-animation, ...).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { StudioError } from '../shared/errors.js';
import { openSkeleton, insideProjectReal } from '../core/paths.js';
import { snapshotBytesDeferred } from '../core/backup.js';
import { composeDelivery, DELIVERY_MARKER } from './compose.js';
import { deleteAnimations } from './policy.js';

const SKIPPED_DIRS = new Set(['.backup', '.keyframe', 'studio', 'node_modules', '.git', 'reference']);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readBytes = abs => { try { return fs.readFileSync(abs); } catch { return null; } };
const toRel = (dir, abs) => path.relative(dir, abs).split(path.sep).join('/');
const samePath = (a, b) => process.platform === 'win32'
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

/**
 * Spine skeletons in the project (two levels deep), excluding studio deliveries. With
 * `includeDeliveries`, deliveries are listed too and carry `delivery: true` (the marker decides,
 * never the file name: an owner's own "hero_v2.json" is a base).
 */
export function findSkeletons(projectDir, { includeDeliveries = false } = {}) {
  const out = [];
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (depth < 2 && !SKIPPED_DIRS.has(entry.name)) walk(abs, depth + 1); continue; }
      if (!/\.json$/i.test(entry.name)) continue;
      try {
        const json = JSON.parse(fs.readFileSync(abs, 'utf8'));
        if (!json || !Array.isArray(json.bones) || !json.skeleton) continue;
        if (!includeDeliveries && json[DELIVERY_MARKER]) continue;
        out.push(json[DELIVERY_MARKER] ? { file: toRel(projectDir, abs), delivery: true } : { file: toRel(projectDir, abs) });
      } catch { /* not JSON: not a skeleton */ }
    }
  };
  walk(projectDir, 0);
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** The atlas paired with a skeleton by name: x.atlas, else x.atlas.txt. */
export function atlasBeside(jsonAbs) {
  const stem = jsonAbs.replace(/\.json$/i, '');
  for (const candidate of [`${stem}.atlas`, `${stem}.atlas.txt`]) if (fs.existsSync(candidate)) return candidate;
  return null;
}

/**
 * @param {object} options
 * @param {string} options.projectDir
 * @param {string} [options.from]   base skeleton, project-relative; empty = the folder's base
 * @param {string} [options.into]   delivery file; empty = <base>_v2.json beside the base
 * @param {string} options.name     animation name
 * @param {object} options.animation native Spine 4.2 animation JSON
 * @param {boolean} [options.replace] @param {number} [options.fps] @param {boolean} [options.holdFromStart]
 * @param {Array<string|object>} [options.plant]  feet that stay where they stand (deliver/plant.js)
 */
export async function prepareDelivery({ projectDir, from, into, name, animation, replace = false, fps, holdFromStart = true, plant }) {
  const dir = () => projectDir;
  const opened = openSkeleton(dir, from, { findSkeletons: d => findSkeletons(d) });
  const base = opened.sk;
  if (base[DELIVERY_MARKER]) {
    throw new StudioError('base-is-delivery', `"${opened.rel}" is a studio delivery; write onto its own base${base[DELIVERY_MARKER].base ? ` ("${base[DELIVERY_MARKER].base}")` : ''}.`,
      { file: opened.rel, base: base[DELIVERY_MARKER].base ?? null });
  }
  const baseBytes = readBytes(opened.abs);
  const intoRel = into || toRel(projectDir, opened.abs.replace(/\.json$/i, '_v2.json'));
  const targetAbs = insideProjectReal(dir, intoRel);
  if (!/\.json$/i.test(targetAbs)) throw new StudioError('bad-argument', `The delivery must be a .json file: ${intoRel}.`, { into: intoRel });
  if (samePath(targetAbs, opened.abs)) {
    throw new StudioError('base-protected', `"${opened.rel}" is the base; it is never written. Choose another target.`, { file: opened.rel });
  }
  if (!samePath(path.dirname(targetAbs), path.dirname(opened.abs))) {
    throw new StudioError('delivery-folder', `The delivery must sit in the base's folder so its atlas and pages resolve: ${intoRel}.`,
      { into: intoRel, folder: toRel(projectDir, path.dirname(opened.abs)) || '.' });
  }
  const targetBytes = readBytes(targetAbs);
  let previous = null;
  if (targetBytes) {
    try { previous = JSON.parse(targetBytes.toString('utf8')); } catch { previous = null; }
    if (!previous || !previous[DELIVERY_MARKER]) {
      throw new StudioError('target-not-delivery', `"${intoRel}" exists and is not a studio delivery; it is never overwritten. Choose another target.`,
        { into: intoRel });
    }
  }
  const { skeleton, report } = await composeDelivery({ base, previous, name, animation, replace, fps, holdFromStart, plant,
    deliveryInfo: { base: path.basename(opened.abs) } });
  return {
    projectDir, base: { rel: opened.rel, abs: opened.abs, hash: hash(baseBytes) },
    target: { rel: toRel(projectDir, targetAbs), abs: targetAbs, hash: targetBytes ? hash(targetBytes) : null, existed: !!targetBytes },
    bytes: Buffer.from(`${JSON.stringify(skeleton, null, 2)}\n`, 'utf8'),
    report: { ...report, ...(opened.autoChosen ? { baseChosen: opened.autoChosen } : {}) },
  };
}

/** Commit a prepared delivery. Returns what was written and what was backed up. */
export function commitDelivery(plan) {
  const { projectDir, base, target, bytes } = plan;
  const currentBase = base ? readBytes(base.abs) : null;
  const currentTarget = readBytes(target.abs);
  const baseChanged = base ? (!currentBase || hash(currentBase) !== base.hash) : false;
  if (baseChanged || (currentTarget ? hash(currentTarget) : null) !== target.hash) {
    throw new StudioError('changed-during-write', 'The base or the delivery changed after it was read; nothing was written. Run the write again.',
      { base: base?.rel ?? null, target: target.rel });
  }
  const pending = currentTarget ? snapshotBytesDeferred(projectDir, currentTarget, target.rel, '.json') : null;
  const temp = path.join(path.dirname(target.abs), `.${path.basename(target.abs)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temp, bytes);
    fs.renameSync(temp, target.abs);
  } catch (err) {
    try { fs.unlinkSync(temp); } catch { /* temp may not exist */ }
    pending?.rollback();
    throw new StudioError('write-failed', `The delivery could not be written: ${err.message}`, { target: target.rel });
  }
  const backup = pending ? pending.commit() : null;
  return { file: target.rel, base: base?.rel ?? null, created: !target.existed, backup,
    ...(base ? { atlas: placeAtlas(projectDir, base.abs, target.abs) } : {}) };
}

// The runtime and the Player pair x.json with x.atlas by name. Copy the base's atlas beside
// the delivery; the page names inside stay valid because both sit in one folder.
function placeAtlas(projectDir, baseAbs, targetAbs) {
  const source = atlasBeside(baseAbs);
  if (!source) return { status: 'no-source-atlas' };
  const destination = targetAbs.replace(/\.json$/i, source.endsWith('.atlas.txt') ? '.atlas.txt' : '.atlas');
  const sourceBytes = fs.readFileSync(source);
  const existing = readBytes(destination);
  if (existing && existing.equals(sourceBytes)) return { status: 'unchanged', file: toRel(projectDir, destination) };
  let backup = null;
  if (existing) {
    const pending = snapshotBytesDeferred(projectDir, existing, toRel(projectDir, destination), path.extname(destination));
    backup = pending?.commit() ?? null;
  }
  fs.copyFileSync(source, destination);
  return { status: existing ? 'replaced' : 'copied', file: toRel(projectDir, destination), backup };
}

/**
 * Delete animations from a delivery, all or nothing (the base is never a target).
 * @returns {Promise<object>} the commit result plus `deleted` and `remaining`
 */
export async function deleteFromDelivery({ projectDir, file, names }) {
  const dir = () => projectDir;
  const abs = insideProjectReal(dir, file);
  const bytes = readBytes(abs);
  if (!bytes) throw new StudioError('file-not-found', `File not found: ${file}.`, { file });
  let delivery = null;
  try { delivery = JSON.parse(bytes.toString('utf8')); } catch { delivery = null; }
  if (!delivery || !delivery[DELIVERY_MARKER]) {
    throw new StudioError('base-protected', `"${file}" is not a studio delivery; animations are deleted only from deliveries, never from the owner's files.`, { file });
  }
  const result = deleteAnimations(delivery.animations, names);
  if (!result.deleted.length && !result.missing.length) throw new StudioError('bad-argument', 'Name at least one animation to delete.');
  if (result.missing.length) {
    throw new StudioError('unknown-animation', `Nothing was deleted: ${result.missing.map(n => `"${n}"`).join(', ')} not in ${file}.`,
      { missing: result.missing, available: Object.keys(delivery.animations ?? {}) });
  }
  const out = { ...delivery, animations: result.animations };
  const plan = {
    projectDir, base: null,
    target: { rel: toRel(projectDir, abs), abs, hash: hash(bytes), existed: true },
    bytes: Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8'),
  };
  return { ...commitDelivery(plan), deleted: result.deleted, remaining: result.remainingNames };
}

/** prepare + commit. */
export async function writeDelivery(options) {
  const plan = await prepareDelivery(options);
  const written = commitDelivery(plan);
  return { ...written, ...plan.report };
}
