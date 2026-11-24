#!/usr/bin/env node
// Experimental: raster art from another AI becomes a rig (branch raster-trial, not in a release).
//
//   node tools/raster-trial.js cut <picture.png> <out-folder>
//       keys out the flat background, finds the separate pieces of a parts sheet, and writes
//       <out>/pieces/<n>.png, <out>/pieces.json and <out>/pieces-sheet.png (the pieces in a row on a
//       checkerboard, numbered left to right as in pieces.json) for the agent to look at and name
//   node tools/raster-trial.js rig <out-folder> <name> <names.json> [--scale 0.5]
//       names.json maps piece numbers to side-view part names ({ "1": "head", "2": "torso", ... });
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
import { keyOut, findPieces, assembleSideBiped, rasterRig, puppetRig } from '../src/render/raster-import.js';

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
  const names = JSON.parse(fs.readFileSync(namesFile, 'utf8'));
  /** @type {Record<string, { width: number, height: number, data: Uint8Array }>} */
  const images = {};
  for (const [n, part] of Object.entries(names)) images[part] = decodePng(fs.readFileSync(path.join(out, 'pieces', `${n}.png`)));
  const named = Object.fromEntries(Object.entries(images).map(([k, image]) => [k, { image }]));
  const parts = assembleSideBiped(named, { scale: Number(option('--scale', 0.5)) });
  const rig = rasterRig({ name, parts, images });
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
