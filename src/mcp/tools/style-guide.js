// style_guide — the art direction of the project: one guide every drawn part follows.

import fs from 'node:fs';
import { projectOf } from '../project.js';
import { snapshot } from '../../core/backup.js';
import { StudioError } from '../../shared/errors.js';
import { STYLE_PRESETS, presetStyle, validateStyle, styleSummary, contrast, colorOf } from '../../art/style.js';
import { projectStyle } from '../style-file.js';

/** Merge a change into a guide, one level deep for the grouped settings. */
function merged(guide, change) {
  const out = { ...guide, ...change };
  for (const key of ['palette', 'stroke', 'radius', 'light', 'type', 'sizes']) if (change[key]) out[key] = { ...guide[key], ...change[key] };
  if (change.type?.size) out.type.size = { ...guide.type.size, ...change.type.size };
  return out;
}

/** What an art director checks first: text that cannot be read on its fill. */
function warnings(style) {
  const out = [];
  for (const [a, b] of [['text', 'primary'], ['text', 'secondary'], ['text', 'danger'], ['textDark', 'panel'], ['text', 'surface']]) {
    if (!style.palette[a] || !style.palette[b]) continue;
    const ratio = contrast(colorOf(style, a), colorOf(style, b));
    if (ratio < 3) out.push(`${a} on ${b} has a contrast of ${ratio.toFixed(1)}:1; labels need 3:1 (4.5:1 for small text). An outline helps (type.outline).`);
  }
  return out;
}

export default {
  name: 'style_guide',
  tier: 'core',
  writes: true,
  summary: 'The project\'s art direction: palette by role, stroke weights, corner radii, light, grid, type and sizes. Read it, start it from a preset, or change it.',
  description: `The art-direction step before drawing. The guide lives in <project>/keyframe.style.json and every part drawn with \`shapes\` or a \`component\` in draw_rig follows it by name: fill "primary", sw "bold", r "md". With no arguments it returns the guide (or the default preset while the project has none). \`preset\` starts the guide from one of: ${Object.entries(STYLE_PRESETS).map(([k, v]) => `${k} (${v.note})`).join(' ')} \`set\` changes parts of it: { palette: { primary: "#4cc461", ... }, stroke: { thin, regular, bold, color: a role, #rrggbb, "tint" (a shade darker than each fill) or "none" }, radius: { sm, md, lg, pill }, light: { from: top | top-left | top-right, shade 0-1, shine 0-1, shadow units, shadowAlpha 0-1 }, grid, type: { size: { sm, md, lg }, weight: bold | regular, case: upper | none, outline }, sizes: { button: [w, h], icon, ... }, note }. Palette roles are your own words too (brand, gold). After a change, draw_rig { name, restyle: true } redraws a drawing with it. The answer warns when a label colour cannot be read on its fill.`,
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      preset: { type: 'string', enum: Object.keys(STYLE_PRESETS), short: 'start from a preset', description: 'Start the guide (or start it again) from a preset.' },
      set: { type: 'object', short: 'change parts of the guide', description: 'The settings to change; the rest stays.' },
      name: { type: 'string', short: 'guide name', description: 'A name for the guide (the art direction of this project).' },
    },
  },
  run({ preset, set, name }, { session }) {
    const project = projectOf(session);
    const current = projectStyle(project.dir);
    if (!preset && !set && !name) {
      return { file: project.rel(current.file), saved: current.saved, guide: styleSummary(current.style), palette: current.style.palette, ...(warnings(current.style).length ? { warnings: warnings(current.style) } : {}),
        next: current.saved ? 'draw_rig with shapes or a component.' : 'style_guide { preset } or { set } to fix the art direction before drawing; the default preset is used until then.' };
    }
    let guide = preset ? presetStyle(preset, name ?? current.style.name) : current.style;
    if (set) {
      if (typeof set !== 'object' || Array.isArray(set)) throw new StudioError('bad-argument', 'set is an object of settings.', {});
      guide = merged(guide, set);
    }
    if (name) guide = { ...guide, name };
    const style = validateStyle(guide);
    const backup = fs.existsSync(current.file) ? snapshot(project.dir, current.file, project.rel(current.file)) : null;
    fs.writeFileSync(current.file, `${JSON.stringify(style, null, 1)}\n`);
    return {
      file: project.rel(current.file), guide: styleSummary(style), palette: style.palette,
      ...(backup ? { backup } : {}), ...(warnings(style).length ? { warnings: warnings(style) } : {}),
      next: 'draw_rig with shapes or a component; draw_rig { name, restyle: true } redraws an existing drawing in this guide.',
    };
  },
};
