#!/usr/bin/env node
// A skeleton for Godot 4: writes <name>.kfscene (the scene description the Keyframe add-on in
// integrations/godot imports) and copies the atlas pages beside it.
//   npm run godot -- <skeleton.json> [--out <folder>] [--fps 30] [--skin <name>]
import fs from 'node:fs';
import path from 'node:path';
import { godotScene } from '../src/engine/godot.js';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const out = option('--out'), fps = Number(option('--fps') ?? 30), skin = option('--skin');
const [file] = args;
if (!file || file.startsWith('-')) {
  process.stderr.write('Usage: npm run godot -- <skeleton.json> [--out <folder>] [--fps 30] [--skin <name>]\n');
  process.exit(2);
}
try {
  const source = path.resolve(file);
  const atlas = source.replace(/(\.keyframe)?\.json$/i, '.atlas');
  if (!fs.existsSync(atlas)) throw new Error(`No atlas beside ${path.basename(source)}.`);
  const name = path.basename(source).replace(/(\.keyframe)?\.json$/i, '');
  const scene = godotScene(JSON.parse(fs.readFileSync(source, 'utf8')), { atlasText: fs.readFileSync(atlas, 'utf8'), fps, skin, name });
  const dir = path.resolve(out ?? path.dirname(source));
  fs.mkdirSync(dir, { recursive: true });
  for (const page of scene.pages) {
    const from = path.join(path.dirname(atlas), page.name), to = path.join(dir, page.name);
    if (from !== to) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
  }
  const target = path.join(dir, `${name}.kfscene`);
  fs.writeFileSync(target, `${JSON.stringify(scene)}\n`);
  process.stdout.write(`${target}: ${scene.bones.length} bones, ${scene.slots.length} slots, ${scene.animations.length} clips.\n`);
  for (const line of scene.report.baked) process.stdout.write(`  baked: ${line}\n`);
  for (const line of scene.report.skipped) process.stdout.write(`  not imported: ${line}\n`);
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
}
