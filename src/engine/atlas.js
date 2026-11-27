// A reader for Spine's .atlas text (the 4.x format and the older one), without any Spine code.
// Returns the same plain geometry src/understand/atlas.js returns from the official parser,
// which test/engine-parity.test.js compares field by field.
//
// Pure and isomorphic.

import { StudioError } from '../shared/errors.js';

const ints = v => v.split(',').map(s => parseInt(s.trim(), 10));

/**
 * @param {string} text
 * @returns {{ pages: Array<{ name: string, width: number, height: number, pma: boolean, format: string|null, minFilter: string, magFilter: string }>,
 *   regions: Array<{ name: string, page: string, x: number, y: number, width: number, height: number, degrees: number,
 *   offsetX: number, offsetY: number, originalWidth: number, originalHeight: number, index: number,
 *   u: number, v: number, u2: number, v2: number }> }}
 */
export function parseAtlas(text) {
  if (typeof text !== 'string') throw new StudioError('bad-argument', 'Atlas text must be a string.');
  const lines = text.replace(/\r/g, '').split('\n');
  const pages = [], regions = [];
  let page = null, region = null;
  const entry = line => {
    const colon = line.indexOf(':');
    return colon < 0 ? null : [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  };
  const finishRegion = () => {
    if (!region) return;
    if (region.originalWidth === 0 && region.originalHeight === 0) { region.originalWidth = region.width; region.originalHeight = region.height; }
    region.u = region.x / page.width; region.v = region.y / page.height;
    if (region.degrees === 90) { region.u2 = (region.x + region.height) / page.width; region.v2 = (region.y + region.width) / page.height; }
    else { region.u2 = (region.x + region.width) / page.width; region.v2 = (region.y + region.height) / page.height; }
    regions.push(region);
    region = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) { finishRegion(); page = null; continue; }
    const kv = entry(line);
    if (!page) {
      page = { name: line, width: 0, height: 0, pma: false, format: null, minFilter: 'Nearest', magFilter: 'Nearest' };
      pages.push(page);
      continue;
    }
    if (kv && !region) {
      const [key, value] = kv;
      if (key === 'size') { [page.width, page.height] = ints(value); }
      else if (key === 'pma') page.pma = value === 'true';
      else if (key === 'format') page.format = value;
      else if (key === 'filter') { const [min, mag] = value.split(',').map(v => v.trim()); page.minFilter = min; page.magFilter = mag ?? min; }
      continue;
    }
    if (!kv) {
      finishRegion();
      region = { name: line, page: page.name, x: 0, y: 0, width: 0, height: 0, degrees: 0, offsetX: 0, offsetY: 0, originalWidth: 0, originalHeight: 0, index: -1, u: 0, v: 0, u2: 0, v2: 0 };
      continue;
    }
    const [key, value] = kv;
    if (key === 'bounds') { [region.x, region.y, region.width, region.height] = ints(value); }
    else if (key === 'offsets') { [region.offsetX, region.offsetY, region.originalWidth, region.originalHeight] = ints(value); }
    else if (key === 'xy') { [region.x, region.y] = ints(value); }
    else if (key === 'size') { [region.width, region.height] = ints(value); }
    else if (key === 'orig') { [region.originalWidth, region.originalHeight] = ints(value); }
    else if (key === 'offset') { [region.offsetX, region.offsetY] = ints(value); }
    else if (key === 'rotate') region.degrees = value === 'true' ? 90 : value === 'false' ? 0 : parseInt(value, 10) || 0;
    else if (key === 'index') region.index = parseInt(value, 10);
  }
  finishRegion();
  return { pages, regions };
}

/** A texture source over an atlas: region by attachment path. */
export function atlasRegions(atlas) {
  const pageOf = new Map(atlas.pages.map(p => [p.name, p]));
  const byName = new Map();
  for (const r of atlas.regions) if (!byName.has(r.name)) byName.set(r.name, r);
  return path => {
    const r = byName.get(path);
    if (!r) return null;
    const p = pageOf.get(r.page);
    return { ...r, pageWidth: p.width, pageHeight: p.height, pma: p.pma, nearest: p.magFilter === 'Nearest' };
  };
}

/** A texture source over whole images, one per attachment path: `{ path: { width, height } }`. */
export function imageRegions(sizes) {
  return path => {
    const s = sizes instanceof Map ? sizes.get(path) : sizes?.[path];
    if (!s) return null;
    return { name: path, page: path, x: 0, y: 0, width: s.width, height: s.height, degrees: 0, offsetX: 0, offsetY: 0,
      originalWidth: s.width, originalHeight: s.height, index: -1, u: 0, v: 0, u2: 1, v2: 1, pageWidth: s.width, pageHeight: s.height, pma: false };
  };
}
