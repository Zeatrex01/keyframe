// Placeholder art to a rig: one SVG per part, placed and pivoted, becomes an atlas page, a
// Spine 4.2 skeleton whose setup pose is the finished picture, and the parts document that the
// drawing board edits and rebuilds from (roadmap Phase 4, issue #24).
//
// A part: { name, svg, at: [x, y], pivot?: [x, y], parent?, size?: [w, h], blend?, hidden?, states?, source? }
//   svg     one SVG document; its viewBox is the part's own drawing space
//   at      where the centre of the art sits in the rig (y up, units)
//   pivot   where its bone sits in the rig: it turns and scales there (default `at`)
//   parent  the part whose bone carries this one (default the root)
//   size    the art's size in the rig (default the viewBox size)
//   states  other looks of the part, { pressed: svg, ... }: attachments <name>_<state> of its slot
//   frames  a flipbook, [svg, svg, ...] (2 to 64): the part's attachment becomes a sequence of
//           regions <name>_f01, <name>_f02, ... that a clip plays (fire, smoke, a blink, a mouth)
//   physics true or { inertia, strength, damping, mass, gravity, wind, x, y }: the part swings
//           on its own (hair, a tail, a cape): its bone points from the pivot through the art
//           and carries a physics constraint the studio's engine simulates
//   source  how it was drawn (parametric shapes or a component), kept so it can be redrawn
// Parts are listed back to front: the first is drawn first. A parent may come later in the list
// (an arm drawn behind the body it hangs from). Pure, no I/O: the caller writes the files.

import { StudioError } from '../shared/errors.js';
import { rasterizeSvg, svgSize } from '../engine/svg.js';
import { encodePng } from './png.js';
import { stackProblems } from './stack.js';

export const PARTS_FORMAT = 'keyframe-parts';
const NAME = /^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,63}$/;
const PAD = 2, MAX_PAGE = 4096;
const round = v => Math.round(v * 100) / 100;
const pair = (v, label) => {
  if (!Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite)) throw new StudioError('bad-argument', `${label} is [x, y] in rig units.`, { value: v });
  return v;
};

/** A part's other looks (hover, pressed, on, off): extra attachments of its slot, each one SVG. */
function states(p, where, problems) {
  if (p.states === undefined) return {};
  if (!p.states || typeof p.states !== 'object' || Array.isArray(p.states)) { problems.push(`${where}.states maps a state name to one SVG.`); return {}; }
  const out = {};
  for (const [k, v] of Object.entries(p.states)) {
    if (!/^[a-z][a-zA-Z0-9]{0,23}$/.test(k)) problems.push(`${where}.states: "${k}" must be a short word.`);
    else if (typeof v !== 'string' || v.length > 200000) problems.push(`${where}.states.${k} must be one SVG document.`);
    else out[k] = v;
  }
  return Object.keys(out).length ? { states: out } : {};
}

/** A flipbook: 2 to 64 SVG frames. */
function frames(p, where, problems) {
  if (p.frames === undefined) return {};
  if (!Array.isArray(p.frames) || p.frames.length < 2 || p.frames.length > 64) { problems.push(`${where}.frames is a list of 2 to 64 SVG frames.`); return {}; }
  if (p.frames.some(f => typeof f !== 'string' || f.length > 200000)) { problems.push(`${where}.frames: every frame is one SVG document.`); return {}; }
  return { frames: p.frames.slice() };
}

/** The physics a part swings with, with defaults for hair and tails that rest where they are drawn. */
export const PART_PHYSICS = Object.freeze({ inertia: 0.7, strength: 45, damping: 0.85, mass: 1, gravity: 0, wind: 0, x: 0, y: 0 });
const PHYSICS_RANGE = { inertia: [0, 1], strength: [0, 1000], damping: [0, 1], mass: [0.01, 100], gravity: [-1000, 1000], wind: [-1000, 1000], x: [0, 1], y: [0, 1] };
function physics(p, where, problems) {
  if (p.physics === undefined || p.physics === false) return {};
  if (p.physics === true) return { physics: { ...PART_PHYSICS } };
  if (!p.physics || typeof p.physics !== 'object' || Array.isArray(p.physics)) { problems.push(`${where}.physics is true or { inertia, strength, damping, mass, gravity, wind, x, y }.`); return {}; }
  const out = { ...PART_PHYSICS };
  for (const [k, v] of Object.entries(p.physics)) {
    const range = PHYSICS_RANGE[k];
    if (!range) { problems.push(`${where}.physics.${k} is not one of ${Object.keys(PHYSICS_RANGE).join(', ')}.`); continue; }
    if (!Number.isFinite(v) || v < range[0] || v > range[1]) { problems.push(`${where}.physics.${k} is a number from ${range[0]} to ${range[1]}.`); continue; }
    out[k] = v;
  }
  return { physics: out };
}

/** Check a parts document; returns the cleaned parts or throws with every problem. */
export function validateParts(parts) {
  if (!Array.isArray(parts) || !parts.length) throw new StudioError('bad-argument', 'A drawing has at least one part.', {});
  if (parts.length > 64) throw new StudioError('bad-argument', 'A drawing has at most 64 parts.', { parts: parts.length });
  const seen = new Set(['root']), problems = [];
  const out = parts.map((p, i) => {
    const where = `parts[${i}]`;
    if (!p || typeof p !== 'object') { problems.push(`${where} is not an object.`); return null; }
    if (typeof p.name !== 'string' || !NAME.test(p.name)) problems.push(`${where}.name must be 1-64 letters, digits, spaces, _ . - (not starting with a space).`);
    else if (seen.has(p.name)) problems.push(`${where}.name "${p.name}" is used twice (or is "root").`);
    if (typeof p.svg !== 'string' || p.svg.length > 200000) problems.push(`${where}.svg must be one SVG document (at most 200 kB).`);
    if (p.name) seen.add(p.name);
    problems.push(...stackProblems(p, where));
    try {
      const size = p.svg ? svgSize(p.svg) : null;
      return {
        name: p.name, svg: p.svg, at: pair(p.at ?? [0, 0], `${where}.at`).map(Number),
        pivot: pair(p.pivot ?? p.at ?? [0, 0], `${where}.pivot`).map(Number),
        parent: p.parent && p.parent !== 'root' ? p.parent : null,
        size: p.size ? pair(p.size, `${where}.size`).map(Number) : size ? [size.width, size.height] : [0, 0],
        ...(p.blend === 'additive' || p.blend === 'multiply' || p.blend === 'screen' ? { blend: p.blend } : {}),
        ...(p.hidden ? { hidden: true } : {}),
        ...(p.stack !== undefined ? { stack: p.stack } : {}),
        ...(p.taper !== undefined ? { taper: p.taper } : {}),
        ...(states(p, where, problems)),
        ...(frames(p, where, problems)),
        ...(physics(p, where, problems)),
        ...(p.source && typeof p.source === 'object' ? { source: p.source } : {}),
      };
    } catch (err) {
      problems.push(`${where}: ${err.message}`);
      return null;
    }
  });
  for (const p of out) if (p && !(p.size[0] > 0 && p.size[1] > 0)) problems.push(`${p.name}: size must be positive.`);
  const names = new Set(out.filter(Boolean).map(p => p.name));
  for (const p of out) for (const k of Object.keys(p?.states ?? {})) if (names.has(`${p.name}_${k}`)) problems.push(`${p.name}: state "${k}" is named like the part "${p.name}_${k}".`);
  for (const p of out) {
    if (!p?.parent) continue;
    if (!names.has(p.parent)) { problems.push(`${p.name}.parent "${p.parent}" is not a part.`); continue; }
    const byName = new Map(out.filter(Boolean).map(q => [q.name, q]));
    let q = p, guard = 0;
    while (q?.parent && guard++ <= out.length) q = byName.get(q.parent);
    if (guard > out.length) problems.push(`${p.name}: its parents form a loop.`);
  }
  if (problems.length) throw new StudioError('bad-parts', `The drawing has problems: ${problems.join(' ')}`, { problems });
  return /** @type {any[]} */ (out);
}

/** The region of a flipbook frame: <part>_f01, <part>_f02, ... (a Spine sequence of path <part>_f, start 1, two digits). */
export const frameRegion = (name, i) => `${name}_f${String(i + 1).padStart(2, '0')}`;

/** Shelf-pack images (largest first) into one page; returns positions and the page size. */
export function packImages(images) {
  const order = images.map((img, i) => i).sort((a, b) => images[b].height - images[a].height || images[b].width - images[a].width);
  const area = images.reduce((s, img) => s + (img.width + PAD) * (img.height + PAD), 0);
  let width = 64;
  while (width < MAX_PAGE && (width * width < area || images.some(img => img.width + 2 * PAD > width))) width *= 2;
  const at = new Array(images.length);
  let x = PAD, y = PAD, row = 0;
  for (const i of order) {
    const img = images[i];
    if (x + img.width + PAD > width) { x = PAD; y += row + PAD; row = 0; }
    at[i] = [x, y];
    x += img.width + PAD; row = Math.max(row, img.height);
  }
  let height = 64;
  while (height < y + row + PAD) height *= 2;
  if (height > MAX_PAGE) throw new StudioError('bad-parts', 'The parts do not fit one 4096 px atlas page: lower `resolution` or make them smaller.', { width, height });
  return { at, width, height };
}

/**
 * Build a rig from parts.
 * @param {{ name: string, parts: any[], resolution?: number }} input  resolution: atlas pixels per rig unit (default 2)
 * @returns {{ skeleton: object, atlasText: string, png: Uint8Array, page: string, document: object, skipped: string[] }}
 */
export function buildSvgRig({ name, parts, resolution = 2 }) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new StudioError('bad-argument', 'The rig name is 1-64 letters, digits, _ or -.', { name });
  const res = Math.max(0.25, Math.min(8, Number(resolution) || 2));
  const clean = validateParts(parts);
  const skipped = [];
  // One region per part, and one per state of a part (<part>_<state>), all at the part's size.
  const regions = clean.flatMap(p => [{ part: p, region: p.name, svg: p.svg }, ...Object.entries(p.states ?? {}).map(([k, svg]) => ({ part: p, region: `${p.name}_${k}`, svg })),
    ...(p.frames ?? []).map((svg, i) => ({ part: p, region: frameRegion(p.name, i), svg }))]);
  const images = regions.map(({ part: p, region, svg }) => {
    const img = rasterizeSvg(svg, { width: Math.max(1, Math.round(p.size[0] * res)), height: Math.max(1, Math.round(p.size[1] * res)) });
    for (const s of img.skipped) skipped.push(`${region}: ${s}`);
    return img;
  });
  const { at, width, height } = packImages(images);
  const data = new Uint8Array(width * height * 4);
  images.forEach((img, i) => {
    const [ox, oy] = at[i];
    for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((oy + y) * width + ox) * 4);
  });
  const page = `${name}.png`;
  let atlasText = `${page}\nsize:${width},${height}\nfilter:Linear,Linear\npma:false\n`;
  regions.forEach((r, i) => { atlasText += `${r.region}\nbounds:${at[i][0]},${at[i][1]},${images[i].width},${images[i].height}\n`; });

  // Bones parents first; slots keep the drawing order. A part that swings on its own points its
  // bone from the pivot through its art (a physics bone lags and swings along its length); every
  // other bone keeps the rig's axes. Offsets are turned into each parent's own frame.
  const pivotOf = new Map([['root', [0, 0]]]);
  const angleOf = new Map([['root', 0]]);
  const bones = [{ name: 'root' }];
  const ordered = [], placed = new Set();
  const place = p => { if (placed.has(p.name)) return; if (p.parent) place(clean.find(q => q.name === p.parent)); placed.add(p.name); ordered.push(p); };
  clean.forEach(place);
  const turn = ([x, y], deg) => { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [x * c - y * s, x * s + y * c]; };
  for (const p of ordered) {
    const parent = p.parent ?? 'root', pp = pivotOf.get(parent), pa = angleOf.get(parent);
    const reach = Math.hypot(p.at[0] - p.pivot[0], p.at[1] - p.pivot[1]);
    const angle = p.physics ? (reach > 1e-3 ? Math.atan2(p.at[1] - p.pivot[1], p.at[0] - p.pivot[0]) * 180 / Math.PI : -90) : 0;
    const [x, y] = turn([p.pivot[0] - pp[0], p.pivot[1] - pp[1]], -pa);
    bones.push({ name: p.name, parent, x: round(x), y: round(y), ...(angle - pa ? { rotation: round(angle - pa) } : {}),
      ...(p.physics ? { length: round(Math.max(1, reach > 1e-3 ? reach * 2 : p.size[1])) } : {}) });
    pivotOf.set(p.name, p.pivot);
    angleOf.set(p.name, angle);
  }
  const physicsList = ordered.filter(p => p.physics).map((p, i) => ({ name: p.name, order: i, bone: p.name, rotate: 1, ...p.physics }));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of clean) {
    minX = Math.min(minX, p.at[0] - p.size[0] / 2); maxX = Math.max(maxX, p.at[0] + p.size[0] / 2);
    minY = Math.min(minY, p.at[1] - p.size[1] / 2); maxY = Math.max(maxY, p.at[1] + p.size[1] / 2);
  }
  const skeleton = {
    skeleton: { hash: `kf-${name}`, spine: '4.2.43', x: round(minX), y: round(minY), width: round(maxX - minX), height: round(maxY - minY), images: './', audio: '' },
    bones,
    slots: clean.map(p => ({ name: p.name, bone: p.name, ...(p.hidden ? {} : { attachment: p.name }), ...(p.blend ? { blend: p.blend } : {}) })),
    skins: [{ name: 'default', attachments: Object.fromEntries(clean.map(p => {
      const angle = angleOf.get(p.name);
      const [x, y] = turn([p.at[0] - p.pivot[0], p.at[1] - p.pivot[1]], -angle);
      const box = { x: round(x), y: round(y), ...(angle ? { rotation: round(-angle) } : {}), width: round(p.size[0]), height: round(p.size[1]) };
      const own = p.frames ? { ...box, path: `${p.name}_f`, sequence: { count: p.frames.length, start: 1, digits: 2, setup: 0 } } : { ...box };
      return [p.name, Object.fromEntries([[p.name, own], ...Object.keys(p.states ?? {}).map(k => [`${p.name}_${k}`, { ...box }])])];
    })) }],
    ...(physicsList.length ? { physics: physicsList } : {}),
    animations: {},
  };
  const document = { format: PARTS_FORMAT, version: 1, name, resolution: res, parts: clean.map(({ parent, ...p }) => (parent ? { ...p, parent } : p)) };
  return { skeleton, atlasText, png: encodePng({ width, height, data }), page, document, skipped };
}
