#!/usr/bin/env node
// Experimental: raster art from another AI becomes a rig (branch raster-trial, not in a release).
//
//   node tools/raster-trial.js cut <picture.png> <out-folder>
//       keys out the flat background, finds the separate pieces of a parts sheet, and writes
//       <out>/pieces/<n>.png, <out>/pieces.json and <out>/pieces-sheet.png (the pieces in a row on a
//       checkerboard, numbered left to right as in pieces.json) for the agent to look at and name
//   node tools/raster-trial.js rig <out-folder> <name> <names.json> [--scale 0.5]
//       names.json maps piece numbers to side-view part names ({ "1": "head", "2": "torso", ... }), or
//       { "parts": {...}, "gear": { "<n>": { "name", "on": head|hand|offhand|back|hip, "offset"?, "rotate"? } },
//       (or worn over a body part: { "name", "on": "<part>", "at": [x, y] corner from the part's corner, "ratio"? }),
//       "gearHeadRef": "<n>", "hands"?: { "<n>": "forearmFront"|"forearmBack" } } with the grip sheet cut
//       into <out>/grip (gripping or relaxed forearms that replace the drawn ones), and the gear sheet cut into <out>/gear (cut <gear.png> <out>/gear);
//       each gear piece is its own slot, worn in the setup pose; "variants": { "<name>": "<folder>" }
//       adds another character's body pieces (its folder and names.json) as looks in the same slots
//       writes <out>/<name>.json, .atlas and .png: a project the studio opens, ready for
//       paint_weights, write_animation, check_skeleton and the exports
//   node tools/raster-trial.js puppet <picture.png> <out-folder> <name> <bones.json> [--scale 0.5]
//       one fused figure, not cut: the whole picture is one image on the root, and bones.json places
//       the skeleton on it in picture pixels ({ "bones": [{ "name", "parent"?, "from": [x, y],
//       "to": [x, y] }] }, parents first). Then paint_weights binds the picture to those bones.
//
// The parts must be drawn apart on one flat key colour (or a transparent background). One fused
// figure is not cut here.

import fs from 'node:fs';
import path from 'node:path';
import { decodePng, encodePng } from '../src/render/png.js';
import { keyOut, findPieces, assembleSideBiped, placeGear, rasterRig, puppetRig } from '../src/render/raster-import.js';

const [cmd, ...rest] = process.argv.slice(2);
const option = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback; };

/** The pieces side by side on a checkerboard, in their numbered order. */
function sheet(pieces, gap = 24) {
  const width = pieces.reduce((s, p) => s + p.image.width + gap, gap);
  const height = Math.max(...pieces.map(p => p.image.height)) + 2 * gap;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = ((x >> 4) + (y >> 4)) & 1 ? 200 : 235, i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  let ox = gap;
  for (const p of pieces) {
    const { width: w, height: h, data: src } = p.image;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = ((gap + y) * width + ox + x) * 4, a = src[s + 3] / 255;
      for (let c = 0; c < 3; c++) data[d + c] = Math.round(src[s + c] * a + data[d + c] * (1 - a));
    }
    ox += w + gap;
  }
  return { width, height, data };
}

if (cmd === 'cut') {
  const [input, out] = rest;
  fs.mkdirSync(path.join(out, 'pieces'), { recursive: true });
  const keyed = keyOut(decodePng(fs.readFileSync(input)));
  const pieces = findPieces(keyed);
  for (const p of pieces) fs.writeFileSync(path.join(out, 'pieces', `${p.index}.png`), encodePng(p.image));
  fs.writeFileSync(path.join(out, 'pieces.json'), JSON.stringify({ key: keyed.key, pieces: pieces.map(({ image, ...p }) => p) }, null, 2));
  fs.writeFileSync(path.join(out, 'pieces-sheet.png'), encodePng(sheet(pieces)));
  console.log(`key ${keyed.key ? `rgb(${keyed.key})` : 'none (transparent)'}; ${pieces.length} pieces: ${pieces.map(p => `${p.index} ${p.box[2]}x${p.box[3]}`).join(', ')}`);
} else if (cmd === 'rig') {
  const [out, name, namesFile] = rest;
  const spec = JSON.parse(fs.readFileSync(namesFile, 'utf8'));
  const names = spec.parts ?? spec, scale = Number(option('--scale', 0.5));
  /** @type {Record<string, { width: number, height: number, data: Uint8Array }>} */
  const images = {};
  const piece = (dir, n) => decodePng(fs.readFileSync(path.join(out, dir, 'pieces', `${n}.png`)));
  for (const [n, part] of Object.entries(names)) images[part] = piece('', n);
  // Gripping or relaxed forearms from a grip sheet cut into <out>/grip: { "<n>": "forearmFront", ... }.
  for (const [n, part] of Object.entries(spec.hands ?? {})) images[part] = piece('grip', n);
  const named = Object.fromEntries(Object.entries(images).map(([k, image]) => [k, { image }]));
  let parts = assembleSideBiped(named, { scale, joints: spec.joints ?? {} });
  if (spec.gear) {
    // The gear sheet was cut into <out>/gear; its copy of the head sets its scale against the body's.
    const ratio = spec.gearHeadRef ? images.head.height / piece('gear', spec.gearHeadRef).height : Number(spec.gearRatio ?? 1);
    const gear = Object.entries(spec.gear).map(([n, g]) => ({ ...g, image: piece('gear', n) }));
    for (const g of gear) images[g.name] = g.image;
    parts = placeGear(parts, named, gear, { scale, ratio });
  }
  // Variants: another character cut the same way ({ "variants": { "mage": "../mage" } }, a folder with
  // its own names.json); its body pieces become "<part>_<variant>" looks in the same slots.
  /** @type {Record<string, Record<string, { width: number, height: number, data: Uint8Array }>>} */
  const variants = {};
  for (const [v, dir] of Object.entries(spec.variants ?? {})) {
    const at = path.resolve(path.dirname(namesFile), dir);
    const other = JSON.parse(fs.readFileSync(path.join(at, 'names.json'), 'utf8'));
    const own = (sub, n) => decodePng(fs.readFileSync(path.join(at, sub, 'pieces', `${n}.png`)));
    variants[v] = {};
    for (const [n, part] of Object.entries(other.parts ?? other)) variants[v][part] = own('', n);
    for (const [n, part] of Object.entries(other.hands ?? {})) variants[v][part] = own('grip', n);
  }
  const rig = rasterRig({ name, parts, images, variants });
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(rig.skeleton, null, 2));
  fs.writeFileSync(path.join(out, `${name}.atlas`), rig.atlasText);
  fs.writeFileSync(path.join(out, rig.page), rig.png);
  console.log(`wrote ${name}.json, .atlas and ${rig.page} with ${parts.length} parts`);
} else if (cmd === 'puppet') {
  const [input, out, name, bonesFile] = rest;
  fs.mkdirSync(out, { recursive: true });
  const keyed = keyOut(decodePng(fs.readFileSync(input)));
  const rig = puppetRig({ name, image: keyed, bones: JSON.parse(fs.readFileSync(bonesFile, 'utf8')).bones, scale: Number(option('--scale', 0.5)) });
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(rig.skeleton, null, 2));
  fs.writeFileSync(path.join(out, `${name}.atlas`), rig.atlasText);
  fs.writeFileSync(path.join(out, rig.page), rig.png);
  console.log(`wrote ${name}.json, .atlas and ${rig.page}: one image on ${rig.skeleton.bones.length} bones`);
} else {
  console.error('usage: raster-trial.js cut <picture.png> <out> | rig <out> <name> <names.json> [--scale 0.5] | puppet <picture.png> <out> <name> <bones.json> [--scale 0.5]');
  process.exitCode = 2;
}
