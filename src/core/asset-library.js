// The asset library: bundled 2D packs under assets/library/<pack>/, each with a pack.json that
// records its license, author and source (roadmap Phase 4). A pack is taken only under a license
// that lets it ship in an MIT repository and be used in anyone's game: CC0, MIT or CC BY (whose
// attribution must then appear in NOTICE, which a gate checks).
//
// draw_rig reads an item as `svg: "asset:<pack>/<item>"`; the page lists the packs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StudioError } from '../shared/errors.js';

export const ASSET_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'library');
/** Licenses a pack may carry, and whether its author must be credited. */
export const LICENSES = Object.freeze({ 'CC0-1.0': false, MIT: true, 'CC-BY-3.0': true, 'CC-BY-4.0': true });
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** Problems with one pack.json (empty when it is sound). */
export function packProblems(pack, dir) {
  const out = [];
  if (!pack || typeof pack !== 'object') return ['pack.json is not an object.'];
  if (!ID.test(pack.id ?? '')) out.push('id is lowercase letters, digits and -.');
  if (dir && pack.id !== path.basename(dir)) out.push(`id "${pack.id}" must match its folder "${path.basename(dir)}".`);
  if (!(pack.license in LICENSES)) out.push(`license must be one of ${Object.keys(LICENSES).join(', ')}.`);
  for (const key of ['title', 'author', 'source']) if (typeof pack[key] !== 'string' || !pack[key]) out.push(`${key} is required.`);
  if (!Array.isArray(pack.items) || !pack.items.length) out.push('items lists at least one asset.');
  const seen = new Set();
  for (const item of pack.items ?? []) {
    if (!ID.test(item?.id ?? '')) out.push(`item id "${item?.id}" is lowercase letters, digits and -.`);
    if (seen.has(item?.id)) out.push(`item "${item.id}" is listed twice.`);
    seen.add(item?.id);
    if (typeof item?.file !== 'string' || !/^[\w.-]+\.(svg|png)$/i.test(item.file)) out.push(`item "${item?.id}": file is an .svg or .png in the pack folder.`);
    else if (dir && !fs.existsSync(path.join(dir, item.file))) out.push(`item "${item.id}": ${item.file} is missing.`);
  }
  return out;
}

/** Every pack, sound or not, with its problems. */
export function listPacks(root = ASSET_ROOT) {
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort(); } catch { return []; }
  return names.map(name => {
    const dir = path.join(root, name);
    let pack = null, problems;
    try { pack = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8')); problems = packProblems(pack, dir); }
    catch (err) { problems = [`pack.json cannot be read: ${err.message}`]; }
    return {
      id: pack?.id ?? name, title: pack?.title ?? name, description: pack?.description ?? '', license: pack?.license ?? null,
      author: pack?.author ?? null, source: pack?.source ?? null, attribution: LICENSES[pack?.license] ?? null,
      items: (pack?.items ?? []).map(i => ({ id: i.id, file: i.file, tags: Array.isArray(i.tags) ? i.tags : [], ref: `asset:${pack.id}/${i.id}` })),
      ...(problems.length ? { problems } : {}),
    };
  });
}

/** The SVG text of `asset:<pack>/<item>`. */
export function readAssetSvg(ref, root = ASSET_ROOT) {
  const m = String(ref).match(/^asset:([a-z0-9-]+)\/([a-z0-9-]+)$/);
  if (!m) throw new StudioError('bad-argument', `"${ref}" is not an asset reference: asset:<pack>/<item>.`, { ref });
  const pack = listPacks(root).find(p => p.id === m[1]);
  if (!pack || pack.problems) throw new StudioError('unknown-asset', `No sound asset pack "${m[1]}".`, { ref, available: listPacks(root).filter(p => !p.problems).map(p => p.id) });
  const item = pack.items.find(i => i.id === m[2]);
  if (!item) throw new StudioError('unknown-asset', `Pack "${m[1]}" has no item "${m[2]}".`, { ref, available: pack.items.map(i => i.ref) });
  if (!/\.svg$/i.test(item.file)) throw new StudioError('bad-argument', `${ref} is an image, not an SVG.`, { ref });
  return fs.readFileSync(path.join(root, pack.id, item.file), 'utf8');
}
