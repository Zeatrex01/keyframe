// critique_art and export_art: the art director's check of a drawing, and the drawing made usable
// outside the studio (game engines, web pages, design tools).

import fs from 'node:fs';
import path from 'node:path';
import { projectOf } from '../project.js';
import { StudioError } from '../../shared/errors.js';
import { PARTS_FORMAT } from '../../render/svg-rig.js';
import { critiqueArt } from '../../art/critique-art.js';
import { layoutText, strokesPath } from '../../art/font.js';
import { colorOf, readableOn } from '../../art/style.js';
import { drawingSvg } from '../../render/compose-svg.js';
import { exportDrawing, exportClip, EXPORT_KINDS } from '../../render/export-art.js';
import { rasterizeSvg } from '../../engine/svg.js';
import { encodePng, decodePng } from '../../render/png.js';
import { parseAtlas } from '../../engine/index.js';
import { projectStyle } from '../style-file.js';
import { webPlayerFiles } from '../../deliver/web-player.js';

const KINDS = [...EXPORT_KINDS, 'web'];

/** Read a parts document the studio drew. */
function readDrawing(project, file) {
  const abs = project.resolve(file);
  let doc;
  try { doc = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { throw new StudioError('no-drawing', `${file} is not a drawing (a <name>.parts.json written by draw_rig).`, { file }); }
  if (doc?.format !== PARTS_FORMAT) throw new StudioError('bad-argument', `${file} is not a drawing the studio made.`, { file });
  return { doc, abs };
}

/**
 * What a drawing looks like: the whole drawing assembled on the surface colour at the top, then
 * every part and state side by side, each named underneath. One PNG an agent can look at.
 */
export function contactSheet(doc, style, cell = 170) {
  const looks = doc.parts.flatMap(p => [{ p, name: p.name, svg: p.svg }, ...Object.entries(p.states ?? {}).map(([k, svg]) => ({ p, name: `${p.name}_${k}`, svg }))]);
  const cols = Math.min(6, looks.length), rows = Math.ceil(looks.length / cols), label = 22;
  const W = Math.max(cols * cell, 640);
  const whole = drawingSvg(doc, { padding: 6 });
  const k0 = Math.min((W - 40) / whole.size[0], 380 / whole.size[1], 2);
  const head = Math.round(whole.size[1] * k0) + 20 + label;
  const H = head + rows * (cell + label);
  const parts = [{ name: 'sheet_bg', svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${colorOf(style, 'surface')}"/></svg>`, at: [W / 2, -H / 2], size: [W, H] }];
  parts.push({ name: 'whole', svg: whole.svg, at: [W / 2, -(10 + whole.size[1] * k0 / 2)], size: [whole.size[0] * k0, whole.size[1] * k0] });
  const ink = colorOf(style, readableOn(style, 'surface'));
  const caption = (text, x, y) => `<path d="${strokesPath(layoutText(text.slice(0, 26), { size: 9, upper: false, x, y }).strokes)}" fill="none" stroke="${ink}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  const labels = [caption(`${doc.name} assembled`, W / 2, head - 8)];
  looks.forEach((l, i) => {
    const cx = (i % cols) * (W / cols) + W / cols / 2, top = head + Math.floor(i / cols) * (cell + label);
    const k = Math.min(1, (cell - 20) / Math.max(l.p.size[0], l.p.size[1]));
    parts.push({ name: `c${i}`, svg: l.svg, at: [cx, -(top + cell / 2)], size: [l.p.size[0] * k, l.p.size[1] * k] });
    labels.push(caption(l.name, cx, top + cell + 12));
  });
  const sheet = drawingSvg({ name: 'sheet', parts });
  const svg = sheet.svg.replace('</svg>', `${labels.join('')}</svg>`);
  return encodePng(rasterizeSvg(svg, { width: Math.round(W), height: Math.round(H) }));
}

export const critiqueArtTool = {
  name: 'critique_art',
  tier: 'core',
  writes: true,
  summary: 'The art director\'s check of a drawing against the style guide: palette drift, outline weights, alignment, silhouettes at small size, states too alike, contrast. Writes a contact sheet to look at.',
  description: 'Run after every draw_rig, before animating or exporting: the PROVE step of drawing. It measures the parts of a drawing (<name>.parts.json) against the project\'s style guide: colours outside the palette and its tones (palette), outline weights off thin/regular/bold after the part\'s scale (stroke), parts that almost line up and corners off the grid (align), parts that blur away at 24 px (silhouette), hover/pressed/disabled looks too close to the normal one (states), parts that melt into the surface colour (contrast). Each finding names the part, the number measured and the fix. It also draws every part and state side by side on the surface colour, named underneath, into <project>/.keyframe/art/<name>-sheet.png: look at it (an image you can open) before calling the drawing done.',
  inputSchema: {
    type: 'object', required: ['file'], additionalProperties: false,
    properties: { file: { type: 'string', short: '<name>.parts.json', description: 'The drawing: the <name>.parts.json draw_rig wrote.' } },
  },
  run({ file }, { session }) {
    const project = projectOf(session);
    const { doc } = readDrawing(project, file);
    const { style } = projectStyle(project.dir);
    const result = critiqueArt(doc, style);
    const sheetAbs = path.join(project.dir, '.keyframe', 'art', `${doc.name}-sheet.png`);
    fs.mkdirSync(path.dirname(sheetAbs), { recursive: true });
    const png = contactSheet(doc, style);
    fs.writeFileSync(sheetAbs, png);
    // The sheet comes back as an image: a drawing with no clip is seen here, not with see_animation.
    return {
      image: { data: Buffer.from(png).toString('base64'), mimeType: 'image/png' },
      meta: {
        file, style: style.name, ...result, sheet: project.rel(sheetAbs),
        verdict: result.counts.warn ? `${result.counts.warn} thing${result.counts.warn > 1 ? 's' : ''} to fix before it is done.` : 'Consistent with the style guide. Look at the image (the drawing assembled, then each part and state) before calling it done.',
        next: result.counts.warn ? 'Fix with draw_rig (merge: true for single parts), then critique_art again and look at the image.' : 'write_animation to animate it, or export_art for engines and the web.',
      },
    };
  },
};

export const exportArtTool = {
  name: 'export_art',
  tier: 'core',
  writes: true,
  summary: 'Exports a drawing for engines and the web: trimmed PNGs per part and state with pivots at any scale, a sprite sheet with a JSON map, clean SVG, a clip as PNG frames, and an embeddable web player.',
  description: `Writes new files into <folder>/<name>-export/ (never touches the drawing or the owner's files; a second export replaces the folder's files): \`parts\` png@<s>x/<part>.png, each part and each state at scale s (pixels per rig unit), transparent and trimmed, with parts.json listing for each its trim offset, source size and pivot in pixels so an engine places and turns it like the rig; \`sheet\` <name>@<s>x.png and .json, all of them packed into one sprite sheet with a frame map in the common JSON-hash layout (frame, spriteSourceSize, sourceSize, pivot) that game engines and web libraries read; \`svg\` svg/<part>.svg and <name>.svg, clean SVG with a <g id> per part for web pages and design tools; \`clip\` (with \`animation\`) clip-<anim>/frame_0000.png... and clip-<anim>@sheet.png/.json at \`fps\`, for engines without a skeletal runtime; \`web\` web/keyframe-player.js (the studio's engine as one script: a KeyframePlayer class with play, stop, pause, seek, setSpeed, setLook for drawn states, and start/complete/loop/event listeners, plus a <keyframe-player> element), the skeleton, its atlas and pages, and an index.html showing the snippet, for web games and pages. Kinds: ${KINDS.join(', ')}; default parts, sheet and svg. Scales default [1, 2]; \`pixels\` instead sets the longest side of the whole drawing.`,
  inputSchema: {
    type: 'object', required: ['file'], additionalProperties: false,
    properties: {
      file: { type: 'string', short: '<name>.parts.json', description: 'The drawing: the <name>.parts.json draw_rig wrote.' },
      kinds: { type: 'array', items: { type: 'string', enum: KINDS }, short: 'parts, sheet, svg, clip, web', description: 'What to export; default parts, sheet and svg.' },
      scales: { type: 'array', items: { type: 'number', minimum: 0.1, maximum: 8 }, short: 'px per unit, e.g. [1, 2, 3]', description: 'Pixels per rig unit, one export each (1x, 2x, 3x). Default [1, 2].' },
      pixels: { type: 'number', minimum: 8, maximum: 8192, short: 'longest side in px (instead of scales)', description: 'Instead of scales: the longest side of the whole drawing in pixels.' },
      animation: { type: 'string', short: 'clip to export (kind clip)', description: 'The animation to export as frames (kind clip). Read from the latest delivery (<name>_v2.json) when there is one.' },
      fps: { type: 'number', minimum: 1, maximum: 60, short: 'clip frames per second (24)', description: 'Frames per second of the clip export; default 24.' },
      size: { type: 'number', minimum: 16, maximum: 2048, short: 'clip frame px (256)', description: 'Square frame size of the clip export in pixels; default 256.' },
    },
  },
  async run({ file, kinds, scales, pixels, animation, fps, size }, { session }) {
    const project = projectOf(session);
    const { doc, abs } = readDrawing(project, file);
    const wanted = kinds?.length ? kinds : ['parts', 'sheet', 'svg', ...(animation ? ['clip'] : [])];
    const drawing = wanted.filter(k => EXPORT_KINDS.includes(k) && k !== 'clip');
    const outDir = path.join(path.dirname(abs), `${doc.name}-export`);
    const files = {};
    const out = drawing.length ? exportDrawing(doc, { scales: scales?.length ? scales : [1, 2], kinds: drawing, pixels }) : { files: {}, manifest: { scales: [] } };
    Object.assign(files, out.files);
    let clip = null, web = null;
    if (wanted.includes('clip') || wanted.includes('web')) {
      if ((doc.kind ?? 'rig') !== 'rig') throw new StudioError('bad-argument', 'An artboard has no skeleton; draw it as a rig to animate it or play it on a page.', {});
      const dir = path.dirname(abs);
      const skeletonFile = [`${doc.name}_v2.json`, `${doc.name}.json`].map(f => path.join(dir, f)).find(f => fs.existsSync(f));
      if (!skeletonFile) throw new StudioError('no-skeleton', `No skeleton for ${doc.name} beside the drawing.`, {});
      const json = JSON.parse(fs.readFileSync(skeletonFile, 'utf8'));
      const atlasFile = [skeletonFile.replace(/\.json$/, '.atlas'), path.join(dir, `${doc.name}.atlas`)].find(f => fs.existsSync(f));
      const atlasText = fs.readFileSync(atlasFile, 'utf8');
      const bytes = Object.fromEntries(parseAtlas(atlasText).pages.map(p => [p.name, fs.readFileSync(path.join(path.dirname(atlasFile), p.name))]));
      if (wanted.includes('clip')) {
        if (!animation) throw new StudioError('bad-argument', 'kind clip needs `animation`.', {});
        const pages = Object.fromEntries(Object.entries(bytes).map(([k, v]) => [k, decodePng(v)]));
        const done = await exportClip({ json, atlasText, pages, animation, fps: fps ?? 24, size: size ?? 256 });
        Object.assign(files, done.files);
        clip = { animation, frames: done.frames, fps: done.fps, from: project.rel(skeletonFile) };
      }
      if (wanted.includes('web')) {
        for (const [rel, data] of Object.entries(webPlayerFiles({ name: doc.name, skeleton: json, atlasText, pages: bytes }))) files[`web/${rel}`] = data;
        web = { folder: 'web/', clips: Object.keys(json.animations ?? {}), from: project.rel(skeletonFile) };
      }
    }
    for (const [rel, data] of Object.entries(files)) {
      const target = path.join(outDir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
    }
    const names = Object.keys(files);
    return {
      folder: project.rel(outDir), files: names.length,
      scales: out.manifest.scales,
      written: names.filter(n => !n.includes('/')).concat([...new Set(names.filter(n => n.includes('/')).map(n => `${n.split('/')[0]}/`))]),
      ...(clip ? { clip } : {}),
      ...(web ? { web } : {}),
      next: 'Engines: the sprite sheet and its JSON, or the per-part PNGs with parts.json (pivots in pixels). Web: the SVG files; for animation on a page, the standalone player.',
    };
  },
};
