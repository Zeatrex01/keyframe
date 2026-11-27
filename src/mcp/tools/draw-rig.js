// draw_rig — placeholder art drawn as SVG parts becomes a skeleton, an atlas and a page image.

import fs from 'node:fs';
import path from 'node:path';
import { projectOf } from '../project.js';
import { snapshot } from '../../core/backup.js';
import { StudioError } from '../../shared/errors.js';
import { buildSvgRig, PARTS_FORMAT } from '../../render/svg-rig.js';
import { checkSkeleton } from '../../spine/check.js';
import { readAssetSvg } from '../../core/asset-library.js';
import { appendFeed } from '../../core/draw-feed.js';
import { safeTree } from '../../render/svg-safe.js';
import { expandParts } from '../../art/draw-spec.js';
import { COMPONENTS } from '../../art/components.js';
import { GLYPH_NAMES } from '../../art/glyphs.js';
import { projectStyle } from '../style-file.js';
import { drawingSvg } from '../../render/compose-svg.js';
import { rasterizeSvg } from '../../engine/svg.js';
import { encodePng } from '../../render/png.js';
import { readAseprite, asepriteDrawing } from '../../render/aseprite.js';

const PART = {
  type: 'object', required: ['name', 'at'], additionalProperties: false,
  properties: {
    name: { type: 'string', short: 'part, bone and slot name', description: 'The part, its bone and its slot (arm_l, head, lid).' },
    svg: { type: 'string', short: 'one SVG, or asset:<pack>/<item>', description: 'One SVG document drawing the part in its own viewBox, or an asset library item: asset:<pack>/<item> (the page lists the packs). Give svg, shapes or component.' },
    box: { type: 'array', items: { type: 'number' }, short: '[w, h] for shapes', description: 'With `shapes`: the drawing space [w, h] of the part (y down, 0,0 top left).' },
    shapes: { type: 'array', items: { type: 'object' }, short: 'parametric shapes (style guide)', description: 'The part as shapes in the project style guide, far cheaper than SVG: { rect: [x,y,w,h], r }, { circle: [cx,cy,r] }, { ellipse: [cx,cy,rx,ry] }, { poly: [[x,y],...] }, { path: d }, { line: [x1,y1,x2,y2] }, { star: [cx,cy,r], points }, { text, at: [x, baseline], size: sm|md|lg|n, align }, { icon: name, box: [x,y,size] }. Paint by role: fill, stroke ("primary", "primary-20" darker, "primary+20" lighter, "primary~" greyed, "#rrggbb", "none"; stroke false for none), sw thin|regular|bold|n, r sm|md|lg|pill|n, shade, shine, shadow, opacity, grad: [top, bottom].' },
    component: { type: 'object', short: 'a UI component (button, panel, popup...)', description: `A ready component drawn in the style guide, split into the parts an animator needs: { component: ${Object.keys(COMPONENTS).join(' | ')}, label, icon, color, w, h, ... }. ${Object.entries(COMPONENTS).map(([k, v]) => `${k}: ${v}`).join(' ')} Extra fields: title, lines (popup body), button (popup action label), value (badge), on (toggle), plate (icon: round | square), size.` },
    states: { short: 'other looks: ["hover","pressed","disabled"]', description: 'Other looks of the part, attachments <name>_<state> of its slot that a clip switches to: with `shapes`, a list of hover | pressed | disabled is derived from the same shapes (lighter, darker and pressed down, greyed), or { state: { shapes } } draws your own; with `svg`, { state: svg }.' },
    at: { type: 'array', items: { type: 'number' }, short: '[x, y] art centre, y up', description: 'Centre of the art in the rig, [x, y] in units, y up.' },
    pivot: { type: 'array', items: { type: 'number' }, short: '[x, y] bone (default at)', description: 'Where the bone sits (it turns there), [x, y]; default `at`.' },
    parent: { type: 'string', short: 'carrying part (default root)', description: 'The part whose bone carries this one; default the root.' },
    size: { type: 'array', items: { type: 'number' }, short: '[w, h] (default viewBox)', description: 'Size in the rig [w, h] in units; default the viewBox size.' },
    blend: { type: 'string', enum: ['normal', 'additive', 'multiply', 'screen'], short: 'blend (default normal)', description: 'Slot blend mode; default normal.' },
    source: { type: 'object', short: 'how it was drawn (keep as read)', description: 'Kept from an earlier drawing (the drawing board sends it back): how the part was drawn, so restyle can draw it again. Leave it as read.' },
    stack: { type: 'array', items: { type: 'number' }, short: '[from, to] height band (sprite stack)', description: 'Sprite stacking: the part is drawn as seen from above and is the cut through the object at every height from `from` to `to` (rig units, 0 is the ground). export_art kind stack piles the cuts into a turnable top-down object (a car: wheels [0, 3], body [2, 8], windows [8, 12], roof [12, 13]). Parts without it stay flat.' },
    taper: { type: 'array', items: { type: 'number' }, short: '[bottom, top] cut scale along the band', description: 'With `stack`: the cut\'s scale at the bottom and the top of the band (1 is as drawn), so a cone, a dome or a tree crown is one part: [1, 0.2].' },
    hidden: { type: 'boolean', short: 'hidden in setup', description: 'Hidden in the setup pose (a closed lid, a flash); default false.' },
    frames: { type: 'array', maxItems: 64, short: 'flipbook frames (svg or {shapes})', description: 'A flipbook: 2 to 64 frames (SVG, or { shapes } in the part\'s box) that the part\'s attachment plays as a sequence (fire, smoke, a blink, a mouth). A clip plays it with attachments.default.<part>.<part>.sequence: [{ time, mode: loop | once | pingpong | hold, delay: seconds a frame, index }].' },
    physics: { short: 'swings on its own (hair, tail, cape)', description: 'true, or { inertia 0-1, strength, damping 0-1, mass, gravity, wind, x, y }: the part swings on its own as the rig moves (hair, a tail, a cape, a ribbon), simulated by the studio\'s engine; its bone points from the pivot through the art. Defaults rest where it is drawn: inertia 0.7, strength 45, damping 0.85. Put the pivot where it hangs from.' },
  },
};

/**
 * `merge`: the parts drawn before, with these added (new names go in front) or replaced in place
 * (same name), so a figure can be drawn one part per call and the page shows each as it comes.
 */
function mergeParts(previousDoc, parts) {
  const out = (previousDoc?.parts ?? []).map(p => ({ ...p }));
  for (const p of parts) {
    const i = out.findIndex(q => q.name === p.name);
    if (i >= 0) out[i] = p; else out.push(p);
  }
  return out;
}

/** A drawing as the parts that drew it, so a changed style guide can draw them again. */
function sourcesOf(doc) {
  const out = [];
  for (const p of doc.parts) {
    const { svg, states, source, size, ...placed } = p;
    if (source?.of && !source.component) continue;              // drawn with its component
    if (source?.component) out.push({ name: p.name, component: source.component, at: source.at ?? p.at, ...(source.pivot ? { pivot: source.pivot } : {}), ...(source.parent ? { parent: source.parent } : {}) });
    else if (source?.shapes) out.push({ ...placed, box: source.box, shapes: source.shapes, ...(source.states ? { states: source.states } : {}) });
    else out.push(p);
  }
  return out;
}

/** The feed events for the parts this call drew (all of them, or only the merged ones). */
function feedEvents(rel, name, document, drawn) {
  const wanted = new Set(drawn.map(p => p.name));
  const parts = document.parts.filter(p => wanted.has(p.name));
  return [
    { kind: 'start', rig: name, file: rel, parts: parts.length, total: document.parts.length },
    ...parts.map(p => {
      let tree = null;
      try { tree = safeTree(p.svg, p.name); } catch { tree = null; }
      const { svg, ...placed } = p;
      return { kind: 'part', rig: name, file: rel, index: document.parts.indexOf(p), part: placed, tree };
    }),
    { kind: 'done', rig: name, file: rel, total: document.parts.length },
  ];
}

/**
 * The parts and clips of an Aseprite file, with the bones the caller placed on its layers
 * ({ <layer>: { pivot, parent, physics } }, by layer or part name).
 */
function fromAseprite(project, { file, layers = {} }) {
  if (!/\.(aseprite|ase)$/i.test(file)) throw new StudioError('bad-argument', 'aseprite.file is an .aseprite or .ase file in the project.', { file });
  const abs = project.resolve(file);
  if (!fs.existsSync(abs)) throw new StudioError('file-not-found', `${file} is not in the project.`, { file });
  const drawing = asepriteDrawing(readAseprite(fs.readFileSync(abs)), { file: project.rel(abs) });
  if (!layers || typeof layers !== 'object' || Array.isArray(layers)) throw new StudioError('bad-argument', 'aseprite.layers maps a layer to { pivot, parent, physics }.', {});
  const byLayer = new Map(drawing.parts.flatMap(p => [[p.name, p], [p.source.layer, p]]));
  for (const [layer, set] of Object.entries(layers)) {
    const part = byLayer.get(layer);
    if (!part) throw new StudioError('bad-argument', `aseprite.layers: "${layer}" is not a visible layer of ${file} (layers: ${drawing.parts.map(p => p.name).join(', ')}).`, { layer });
    for (const [k, v] of Object.entries(set ?? {})) {
      if (!['pivot', 'parent', 'physics'].includes(k)) throw new StudioError('bad-argument', `aseprite.layers.${layer}.${k} is not one of pivot, parent, physics.`, { layer });
      part[k] = k === 'parent' ? byLayer.get(v)?.name ?? v : v;
    }
  }
  return drawing;
}

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
SVG that is drawn: rect, circle, ellipse, line, polyline, polygon, path (all commands), g with transform, fill and stroke (colours, linear and radial gradients), opacity, stroke-linecap. Not drawn (and named in \`skipped\`): text, filters, masks, clip paths, images, <use>. Prefer \`shapes\` and \`component\` over raw SVG: they cost a tenth of the tokens and follow the project's style guide (style_guide) by name, with labels in the built-in stroke font and icons from the family (${GLYPH_NAMES.length} glyphs: ${GLYPH_NAMES.join(', ')}). \`restyle: true\` with no parts redraws every part drawn from shapes or a component with the current guide. Keep one part per moving piece. Ready-made props and effect sprites (coin, star, spark, heart, gem, cloud, leaf, drop) come from the bundled asset library as \`svg: "asset:keyframe-basics/coin"\`.
\`aseprite: { file }\` builds the rig from an Aseprite file in the project instead of drawn parts (the file is only read): each visible image layer becomes a part named after it, drawn pixel for pixel (one rig unit is one pixel, the canvas's bottom centre is the origin, the atlas is drawn at a whole \`resolution\`, default 1, and magnified without smoothing); a layer whose cels change becomes a flipbook of its distinct cels; every tag becomes a clip of the same name playing its frames in its direction (forward, reverse, ping-pong) at the file's frame durations, a layer empty in a frame hidden there (no tags: one clip "all"). Layer opacity, normal, multiply, screen and addition blends are kept; hidden, reference and tilemap layers are left out and listed. To animate the parts with bones as well, \`layers: { arm: { pivot: [x, y], parent: "body", physics: true } }\` places a layer's bone (rig units). Importing again under the same name reads the file again and keeps the clips written since.
With \`merge: true\` the parts are added to the drawing of the same name (a part with an existing name replaces it in place, a new one goes in front) and the rest is kept: draw a figure one part or a few parts per call, back to front, and the page shows each part being drawn as it arrives (every call is shown live on the drawing board). Drawing again under the same name without \`merge\` replaces the whole drawing and keeps the clips already written (keys on a part that no longer exists are dropped and listed); every file is backed up first. A name whose files the studio did not draw is refused. Then animate it with write_animation and look at it with see_animation.`,
  inputSchema: {
    type: 'object', required: ['name'], additionalProperties: false,
    properties: {
      name: { type: 'string', short: 'rig name', description: 'The rig name: the files are <name>.json, .atlas, .png and .parts.json.' },
      parts: { type: 'array', minItems: 1, maxItems: 64, items: PART, short: 'parts, back to front', description: 'The parts, back to front (a component counts once and may give several).' },
      folder: { type: 'string', short: 'folder (default root)', description: 'Project-relative folder for the files; created when missing. Default the project root.' },
      resolution: { type: 'number', minimum: 0.25, maximum: 8, short: 'atlas px per unit (default 2)', description: 'Atlas pixels per rig unit. Default 2 (crisp at twice the rig size).' },
      as: { type: 'string', enum: ['rig', 'artboard'], short: 'rig (default) or artboard', description: 'rig (default): a skeleton to animate. artboard: a design that is never rigged (an icon set, a logo, a UI sheet): writes <name>.svg and <name>.png with the parts, no skeleton. A drawing keeps its kind when drawn again.' },
      restyle: { type: 'boolean', short: 'redraw with the current style guide', description: 'Redraw every part of the drawing that was drawn from shapes or a component with the current style guide (no parts needed). Parts given as SVG stay as they are.' },
      merge: { type: 'boolean', short: 'add to the drawing (part by part)', description: 'Add these parts to the drawing of the same name (same name replaces in place, a new name goes in front) and keep the others. Default false: the parts are the whole drawing.' },
      aseprite: { type: 'object', required: ['file'], short: '{ file, layers? }: rig from Aseprite', description: 'Build from an Aseprite file in the project instead of parts: { file: "<x>.aseprite", layers?: { <layer>: { pivot: [x, y], parent: <layer>, physics } } }. Layers become parts, changing cels flipbooks, tags clips.',
        properties: { file: { type: 'string', short: '.aseprite file', description: 'Project-relative .aseprite or .ase file (read only).' } } },
    },
  },
  run({ name, parts, folder = '', resolution, merge = false, restyle = false, as, aseprite }, { session }) {
    const project = projectOf(session);
    if (aseprite && (parts || merge || restyle || as === 'artboard')) throw new StudioError('bad-argument', 'aseprite builds the whole rig from the file: leave out parts, merge, restyle and as.', {});
    if (aseprite && resolution !== undefined && !Number.isInteger(resolution)) throw new StudioError('bad-argument', 'With aseprite, resolution is a whole number of atlas pixels per pixel (1 to 8), so every pixel stays sharp.', { resolution });
    const dirAbs = folder ? project.resolve(folder) : project.dir;
    const abs = Object.fromEntries(Object.entries({ json: `${name}.json`, atlas: `${name}.atlas`, png: `${name}.png`, parts: `${name}.parts.json`, svg: `${name}.svg` })
      .map(([k, f]) => [k, path.join(dirAbs, f)]));
    let previous = null, previousDoc = null;
    if (['json', 'atlas', 'png', 'parts', 'svg'].some(k => fs.existsSync(abs[k]))) {
      try { previousDoc = JSON.parse(fs.readFileSync(abs.parts, 'utf8')); } catch { previousDoc = null; }
      if (previousDoc?.format !== PARTS_FORMAT) throw new StudioError('not-ours', `${project.rel(abs.json)} (or its atlas, page or svg) exists and was not drawn by the studio; choose another name or folder.`, { file: project.rel(abs.json) });
      try { previous = JSON.parse(fs.readFileSync(abs.json, 'utf8')); } catch { previous = null; }
    }
    const kind = as ?? previousDoc?.kind ?? 'rig';
    const { style } = projectStyle(project.dir);
    let input = parts ?? [];
    const ase = aseprite ? fromAseprite(project, aseprite) : null;
    if (ase) input = ase.parts;
    else if (restyle) {
      if (!previousDoc) throw new StudioError('bad-argument', `There is no drawing "${name}" to restyle.`, { name });
      input = sourcesOf(previousDoc);
    } else if (!input.length) throw new StudioError('bad-argument', 'Give the parts to draw (or restyle: true to redraw the drawing with the current style guide).', {});
    const read = input.map(p => (typeof p?.svg === 'string' && p.svg.startsWith('asset:') ? { ...p, svg: readAssetSvg(p.svg) } : p));
    for (const [i, p] of read.entries()) {
      const given = ['svg', 'shapes', 'component'].filter(k => p?.[k] !== undefined);
      if (given.length !== 1) throw new StudioError('bad-argument', `parts[${i}] (${p?.name}) needs exactly one of svg, shapes or component${given.length ? ` (got ${given.join(' and ')})` : ''}.`, { part: p?.name });
      if (p.shapes !== undefined && !Array.isArray(p.box)) throw new StudioError('bad-argument', `parts[${i}] (${p.name}): shapes need box [w, h].`, { part: p.name });
    }
    const expanded = expandParts(read, style);
    const all = merge && !restyle ? mergeParts(previousDoc, expanded.parts) : expanded.parts;
    const built = buildSvgRig({ name, parts: all, resolution: resolution ?? (merge || restyle ? previousDoc?.resolution : undefined) ?? (ase ? 1 : 2),
      filter: ase || ((merge || restyle) && previousDoc?.filter === 'nearest') ? 'nearest' : 'linear' });
    if (kind === 'artboard') built.document.kind = 'artboard';
    const dropped = kind === 'rig' ? carryOver(previous, built.skeleton) : [];
    if (ase) Object.assign(built.skeleton.animations, ase.clips);
    const findings = kind === 'rig' ? checkSkeleton(built.skeleton).filter(f => f.level === 'fatal') : [];
    if (findings.length) throw new StudioError('check-failed', `The drawn rig does not pass the check: ${findings.map(f => f.message).join(' ')}`, { findings });
    // A rig writes the skeleton, its atlas and page; an artboard (an icon sheet, a logo, a UI sheet
    // that is never animated) writes the whole drawing as one SVG and one PNG. Both keep the parts.
    const outputs = kind === 'rig' ? ['png', 'atlas', 'json', 'parts'] : ['svg', 'png', 'parts'];
    fs.mkdirSync(dirAbs, { recursive: true });
    const backups = {};
    for (const k of outputs) {
      const stamp = fs.existsSync(abs[k]) ? snapshot(project.dir, abs[k], project.rel(abs[k])) : null;
      if (stamp) backups[k] = stamp;
    }
    if (kind === 'rig') {
      fs.writeFileSync(abs.png, built.png);
      fs.writeFileSync(abs.atlas, built.atlasText);
      fs.writeFileSync(abs.json, `${JSON.stringify(built.skeleton, null, 1)}\n`);
    } else {
      const sheet = drawingSvg(built.document);
      fs.writeFileSync(abs.svg, sheet.svg);
      const res = built.document.resolution;
      fs.writeFileSync(abs.png, encodePng(rasterizeSvg(sheet.svg, { width: Math.max(1, Math.round(sheet.size[0] * res)), height: Math.max(1, Math.round(sheet.size[1] * res)) })));
    }
    fs.writeFileSync(abs.parts, `${JSON.stringify(built.document, null, 1)}\n`);
    let feed = null;
    try { feed = appendFeed(project.dir, feedEvents(project.rel(abs.parts), name, built.document, restyle ? built.document.parts : expanded.parts)).at(-1)?.seq ?? null; } catch { feed = null; }
    const states = built.document.parts.filter(p => p.states).map(p => `${p.name}: ${Object.keys(p.states).map(k => `${p.name}_${k}`).join(', ')}`);
    return {
      file: project.rel(kind === 'rig' ? abs.json : abs.svg),
      kind,
      written: outputs.map(k => project.rel(abs[k])),
      parts: built.document.parts.map(p => p.name),
      ...(kind === 'rig' ? { bones: built.skeleton.bones.map(b => (b.parent ? `${b.name} < ${b.parent}` : b.name)) } : {}),
      ...(states.length ? { states } : {}),
      size: [built.skeleton.skeleton.width, built.skeleton.skeleton.height],
      ...(merge ? { drawing: built.document.parts.map(p => p.name) } : {}),
      ...(expanded.parametric ? { style: style.name } : {}),
      ...(expanded.missing.length ? { notInFont: expanded.missing } : {}),
      ...(feed ? { feed } : {}),
      ...(Object.keys(backups).length ? { backups } : {}),
      ...(kind === 'rig' && previous ? { keptClips: Object.keys(built.skeleton.animations) } : {}),
      ...(dropped.length ? { dropped } : {}),
      ...(built.skipped.length ? { skipped: built.skipped } : {}),
      ...(ase ? { aseprite: { file: ase.parts[0].source.aseprite, clips: Object.keys(ase.clips), flipbooks: ase.parts.filter(p => p.frames).map(p => `${p.name} (${p.frames.length})`),
        ...(ase.skipped.length ? { leftOut: ase.skipped } : {}), ...(ase.notes.length ? { notes: ase.notes } : {}), palette: ase.palette.length,
        place: built.document.parts.map(p => `${p.name} at [${p.at}] size [${p.size}]`) } } : {}),
      next: ase ? `see_animation { file: "${project.rel(abs.json)}", animation: "${Object.keys(ase.clips)[0] ?? ''}" } to look at it; export_art { file: "${project.rel(abs.parts)}", pixel: { palette: [...] } } keeps the file's own colours.`
        : kind === 'rig'
        ? `critique_art { file: "${project.rel(abs.parts)}" } to check the drawing; then write_animation { file: "${project.rel(abs.json)}", ... }.`
        : `critique_art { file: "${project.rel(abs.parts)}" } to check the drawing; export_art to get PNGs at other scales.`,
    };
  },
};
