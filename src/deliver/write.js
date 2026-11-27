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
import { fxArtOf, fxPageName, sectionOf, withFxSection } from './fx-atlas.js';

const SKIPPED_DIRS = new Set(['.backup', '.keyframe', 'studio', 'node_modules', '.git', 'reference']);
/** export_art writes into <name>-export/: copies made for engines and web pages, never the project's own skeletons. */
export const isExportFolder = (/** @type {string} */ name) => name.endsWith('-export');
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
      if (entry.isDirectory()) { if (depth < 2 && !SKIPPED_DIRS.has(entry.name) && !isExportFolder(entry.name)) walk(abs, depth + 1); continue; }
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
 * @param {object} [options.events]  event definitions with their defaults (deliver/events.js)
 * @param {boolean} [options.loop]  whether the clip loops in the exports (kept in the delivery)
 */
export async function prepareDelivery({ projectDir, from, into, name, animation, replace = false, fps, holdFromStart = true, plant, events, loop }) {
  const dir = () => projectDir;
  // With no base in the folder, its deliveries are what there is to write onto (below).
  const opened = openSkeleton(dir, from, { findSkeletons: d => { const bases = findSkeletons(d); return bases.length ? bases : findSkeletons(d, { includeDeliveries: true }); } });
  const base = opened.sk;
  // A delivery whose base is not in its folder (only the result was kept or shared): it is
  // the only source there is, so it is updated in place, with a backup, like any delivery.
  const ownBase = base[DELIVERY_MARKER]?.base;
  if (base[DELIVERY_MARKER] && !into && (!ownBase || !fs.existsSync(path.join(path.dirname(opened.abs), ownBase)))) {
    const bytes = readBytes(opened.abs);
    const source = structuredClone(base);
    delete source[DELIVERY_MARKER];
    const { skeleton, report } = await composeDelivery({ base: source, previous: base, name, animation, replace, fps, holdFromStart, plant, events, loop,
      deliveryInfo: { ...base[DELIVERY_MARKER] } });
    return {
      projectDir, base: null,
      target: { rel: opened.rel, abs: opened.abs, hash: hash(bytes), existed: true },
      bytes: Buffer.from(`${JSON.stringify(skeleton, null, 2)}\n`, 'utf8'),
      report: { ...report, baseMissing: `${ownBase ?? 'The base'} is not in this folder, so ${opened.rel} was updated in place (the previous version is backed up). Put the base back beside it to write onto the base again.` },
    };
  }
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
  const { skeleton, report } = await composeDelivery({ base, previous, name, animation, replace, fps, holdFromStart, plant, events, loop,
    deliveryInfo: { base: path.basename(opened.abs) } });
  return {
    projectDir, base: { rel: opened.rel, abs: opened.abs, hash: hash(baseBytes) },
    target: { rel: toRel(projectDir, targetAbs), abs: targetAbs, hash: targetBytes ? hash(targetBytes) : null, existed: !!targetBytes },
    bytes: Buffer.from(`${JSON.stringify(skeleton, null, 2)}\n`, 'utf8'),
    report: { ...report, ...(opened.autoChosen ? { baseChosen: opened.autoChosen } : {}) },
  };
}

/**
 * Commit a prepared delivery. Returns what was written and what was backed up.
 * @param {any} plan
 * @param {{ drawEffects?: (art: any[], page: string) => { png: Uint8Array, section: string } }} [options]
 *   drawEffects draws the delivery's effect page (src/render/fx-art.js; add_effect passes it); without
 *   it a delivery that draws library art keeps the page and atlas section it already has
 */
export function commitDelivery(plan, { drawEffects } = {}) {
  const { projectDir, base, target, bytes } = plan;
  // Effect art is drawn first: a missing library item stops the write before anything changes.
  const fx = effectPage(bytes, target.abs, drawEffects);
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
  const atlasSource = base ? atlasBeside(base.abs) : fx ? atlasBeside(target.abs) : null;
  return { file: target.rel, base: base?.rel ?? null, created: !target.existed, backup,
    ...(base || fx ? { atlas: placeAtlas(projectDir, atlasSource, target.abs, fx) } : {}) };
}

/** The page of library art the delivery's effects draw with, or null (deliver/fx-atlas.js). */
function effectPage(bytes, targetAbs, drawEffects) {
  let skeleton = null;
  try { skeleton = JSON.parse(bytes.toString('utf8')); } catch { return null; }
  const art = fxArtOf(skeleton);
  if (!art.length) return null;
  const page = fxPageName(targetAbs);
  if (drawEffects) return { page, ...drawEffects(art, page) };
  // Kept as drawn: the section of the delivery's current atlas (the page itself stays beside it).
  const current = atlasBeside(targetAbs);
  const section = current ? sectionOf(fs.readFileSync(current, 'utf8'), page) : null;
  return section ? { page, section, png: null } : null;
}

/** Write bytes beside the delivery, backing up a different file already there. */
function placeBytes(projectDir, destination, bytes) {
  const existing = readBytes(destination);
  if (existing && existing.equals(bytes)) return 'unchanged';
  if (existing) snapshotBytesDeferred(projectDir, existing, toRel(projectDir, destination), path.extname(destination))?.commit();
  fs.writeFileSync(destination, bytes);
  return existing ? 'replaced' : 'copied';
}

// The runtime and the Player pair x.json with x.atlas by name. Copy the base's atlas beside
// the delivery; the page names inside stay valid because both sit in one folder.
// A delivery whose effects draw library art also gets its own page (<stem>_fx.png), and its
// atlas is the base's with that page's section added.
function placeAtlas(projectDir, source, targetAbs, fx = null) {
  if (!source && !fx) return { status: 'no-source-atlas' };
  const destination = targetAbs.replace(/\.json$/i, source?.endsWith('.atlas.txt') ? '.atlas.txt' : '.atlas');
  const sourceText = source ? fs.readFileSync(source, 'utf8') : '';
  const sourceBytes = fx ? Buffer.from(withFxSection(sourceText, fx.page, fx.section), 'utf8') : fs.readFileSync(source);
  const fxPage = fx ? { file: toRel(projectDir, path.join(path.dirname(targetAbs), fx.page)),
    status: fx.png ? placeBytes(projectDir, path.join(path.dirname(targetAbs), fx.page), Buffer.from(fx.png)) : 'kept' } : null;
  const done = (/** @type {object} */ result) => (fxPage ? { ...result, effects: fxPage } : result);
  const existing = readBytes(destination);
  if (existing && existing.equals(sourceBytes)) return done({ status: 'unchanged', file: toRel(projectDir, destination) });
  let backup = null;
  if (existing) {
    const pending = snapshotBytesDeferred(projectDir, existing, toRel(projectDir, destination), path.extname(destination));
    backup = pending?.commit() ?? null;
  }
  fs.writeFileSync(destination, sourceBytes);
  return done({ status: existing ? 'replaced' : 'copied', file: toRel(projectDir, destination), backup });
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
