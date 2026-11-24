// draw_rig — placeholder art drawn as SVG parts becomes a skeleton, an atlas and a page image.

import fs from 'node:fs';
import path from 'node:path';
import { projectOf } from '../project.js';
import { snapshot } from '../../core/backup.js';
import { StudioError } from '../../shared/errors.js';
import { buildSvgRig, PARTS_FORMAT } from '../../render/svg-rig.js';
import { checkSkeleton } from '../../spine/check.js';
import { readAssetSvg } from '../../core/asset-library.js';

const PART = {
  type: 'object', required: ['name', 'svg', 'at'], additionalProperties: false,
  properties: {
    name: { type: 'string', short: 'part, bone and slot name', description: 'The part, its bone and its slot (arm_l, head, lid).' },
    svg: { type: 'string', short: 'one SVG, or asset:<pack>/<item>', description: 'One SVG document drawing the part in its own viewBox, or an asset library item: asset:<pack>/<item> (the page lists the packs).' },
    at: { type: 'array', items: { type: 'number' }, short: '[x, y] art centre, y up', description: 'Centre of the art in the rig, [x, y] in units, y up.' },
    pivot: { type: 'array', items: { type: 'number' }, short: '[x, y] bone (default at)', description: 'Where the bone sits (it turns there), [x, y]; default `at`.' },
    parent: { type: 'string', short: 'carrying part (default root)', description: 'The part whose bone carries this one; default the root.' },
    size: { type: 'array', items: { type: 'number' }, short: '[w, h] (default viewBox)', description: 'Size in the rig [w, h] in units; default the viewBox size.' },
    blend: { type: 'string', enum: ['normal', 'additive', 'multiply', 'screen'], short: 'blend (default normal)', description: 'Slot blend mode; default normal.' },
    hidden: { type: 'boolean', short: 'hidden in setup', description: 'Hidden in the setup pose (a closed lid, a flash); default false.' },
  },
};

/** The animations, events and extra skins of a rig drawn before, kept across a redraw. */
function carryOver(previous, skeleton) {
  if (!previous) return [];
  const bones = new Set(skeleton.bones.map(b => b.name)), slots = new Set(skeleton.slots.map(s => s.name));
  const dropped = [];
  const animations = {};
  for (const [name, clip] of Object.entries(previous.animations ?? {})) {
    const out = { ...clip };
    for (const key of ['bones', 'slots']) {
      if (!clip[key]) continue;
      const known = key === 'bones' ? bones : slots;
      out[key] = Object.fromEntries(Object.entries(clip[key]).filter(([n]) => known.has(n) || (dropped.push(`${name}: ${key.slice(0, -1)} ${n}`), false)));
    }
    animations[name] = out;
  }
  skeleton.animations = animations;
  if (previous.events) skeleton.events = previous.events;
  return dropped;
}

export default {
  name: 'draw_rig',
  tier: 'core',
  writes: true,
  summary: 'Draws placeholder art as SVG parts and builds the rig from it: a skeleton, an atlas and a page image the studio plays at once.',
  description: `Starts a project from a description: draw each part (head, body, arm_l, lid, coin) as one small SVG, place it (\`at\`), say where it turns (\`pivot\`) and what carries it (\`parent\`). The studio draws the SVGs into an atlas page and writes <folder>/<name>.json (a Spine 4.2 skeleton whose setup pose is the finished picture), <name>.atlas, <name>.png and <name>.parts.json (the parts, which the drawing board in the page edits and rebuilds from). Parts are listed back to front.
SVG that is drawn: rect, circle, ellipse, line, polyline, polygon, path (all commands), g with transform, fill and stroke (colours, linear and radial gradients), opacity, stroke-linecap. Not drawn (and named in \`skipped\`): text, filters, masks, clip paths, images, <use>. Keep one part per moving piece and draw it in a flat, readable style with a dark outline. Ready-made props and effect sprites (coin, star, spark, heart, gem, cloud, leaf, drop) come from the bundled asset library as \`svg: "asset:keyframe-basics/coin"\`.
Drawing again under the same name replaces the art and keeps the clips already written (keys on a part that no longer exists are dropped and listed); every file is backed up first. A name whose files the studio did not draw is refused. Then animate it with write_animation and look at it with see_animation.`,
  inputSchema: {
    type: 'object', required: ['name', 'parts'], additionalProperties: false,
    properties: {
      name: { type: 'string', short: 'rig name', description: 'The rig name: the files are <name>.json, .atlas, .png and .parts.json.' },
      parts: { type: 'array', minItems: 1, maxItems: 64, items: PART, short: 'parts, back to front', description: 'The parts, back to front.' },
      folder: { type: 'string', short: 'folder (default root)', description: 'Project-relative folder for the files; created when missing. Default the project root.' },
      resolution: { type: 'number', minimum: 0.25, maximum: 8, short: 'atlas px per unit (default 2)', description: 'Atlas pixels per rig unit. Default 2 (crisp at twice the rig size).' },
    },
  },
  run({ name, parts, folder = '', resolution = 2 }, { session }) {
    const project = projectOf(session);
    const dirAbs = folder ? project.resolve(folder) : project.dir;
    const resolved = parts.map(p => (typeof p?.svg === 'string' && p.svg.startsWith('asset:') ? { ...p, svg: readAssetSvg(p.svg) } : p));
    const built = buildSvgRig({ name, parts: resolved, resolution });
    const files = { json: `${name}.json`, atlas: `${name}.atlas`, png: built.page, parts: `${name}.parts.json` };
    const abs = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, path.join(dirAbs, f)]));
    let previous = null;
    if (fs.existsSync(abs.json) || fs.existsSync(abs.atlas) || fs.existsSync(abs.png)) {
      let ours = false;
      try { ours = JSON.parse(fs.readFileSync(abs.parts, 'utf8')).format === PARTS_FORMAT; } catch { ours = false; }
      if (!ours) throw new StudioError('not-ours', `${project.rel(abs.json)} (or its atlas or page) exists and was not drawn by the studio; choose another name or folder.`, { file: project.rel(abs.json) });
      try { previous = JSON.parse(fs.readFileSync(abs.json, 'utf8')); } catch { previous = null; }
    }
    const dropped = carryOver(previous, built.skeleton);
    const findings = checkSkeleton(built.skeleton).filter(f => f.level === 'fatal');
    if (findings.length) throw new StudioError('check-failed', `The drawn rig does not pass the check: ${findings.map(f => f.message).join(' ')}`, { findings });
    fs.mkdirSync(dirAbs, { recursive: true });
    const backups = {};
    for (const [k, file] of Object.entries(abs)) {
      const stamp = fs.existsSync(file) ? snapshot(project.dir, file, project.rel(file)) : null;
      if (stamp) backups[k] = stamp;
    }
    fs.writeFileSync(abs.png, built.png);
    fs.writeFileSync(abs.atlas, built.atlasText);
    fs.writeFileSync(abs.json, `${JSON.stringify(built.skeleton, null, 1)}\n`);
    fs.writeFileSync(abs.parts, `${JSON.stringify(built.document, null, 1)}\n`);
    return {
      file: project.rel(abs.json),
      written: Object.values(abs).map(f => project.rel(f)),
      parts: built.skeleton.slots.map(s => s.name),
      bones: built.skeleton.bones.map(b => (b.parent ? `${b.name} < ${b.parent}` : b.name)),
      size: [built.skeleton.skeleton.width, built.skeleton.skeleton.height],
      ...(Object.keys(backups).length ? { backups } : {}),
      ...(previous ? { keptClips: Object.keys(built.skeleton.animations) } : {}),
      ...(dropped.length ? { dropped } : {}),
      ...(built.skipped.length ? { skipped: built.skipped } : {}),
      next: `write_animation { file: "${project.rel(abs.json)}", ... } to animate it; see_animation to look at it.`,
    };
  },
};
