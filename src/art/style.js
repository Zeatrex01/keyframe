// The art direction of a project: one style guide every drawn part follows, so the parts of a UI
// pack or a character look like one hand drew them.
//
//   <project>/keyframe.style.json
//
// A guide names colours by role (primary, surface, ink, text...), stroke weights, corner radii,
// the light (where it comes from, how much shade and shine), the spacing grid, the type and the
// standard sizes. Shapes and components (src/art/shapes.js, components.js) take these by name, so
// an AI writes "fill: primary, r: md" instead of colours and numbers, and a change to the guide
// restyles every part drawn from it. Pure: the tool reads and writes the file.

import { StudioError } from '../shared/errors.js';

export const STYLE_FORMAT = 'keyframe-style';
export const STYLE_FILE = 'keyframe.style.json';
const HEX = /^#[0-9a-f]{6}$/i;
const ROLE = /^[a-z][a-zA-Z0-9]{0,23}$/;

/** Ready-made guides: a starting point the art director adjusts, never a fixed look. */
export const STYLE_PRESETS = Object.freeze({
  'casual-game': {
    note: 'Chunky, friendly game UI: thick dark outline, pill and soft corners, light from the top, a glossy shine.',
    palette: {
      primary: '#4cc461', secondary: '#4d9cf0', accent: '#ffc83d', danger: '#f0524d', reward: '#ffb627',
      surface: '#3b3f6b', surfaceAlt: '#525791', panel: '#f4ecdf', ink: '#1e1b33', text: '#ffffff', textDark: '#2c2846', muted: '#a6a3c2',
    },
    stroke: { thin: 3, regular: 5, bold: 8, color: 'ink' },
    radius: { sm: 8, md: 18, lg: 30, pill: 999 },
    shape: 'rounded',
    light: { from: 'top', shade: 0.28, shine: 0.45, shadow: 6, shadowAlpha: 0.35 },
    grid: 4,
    type: { size: { sm: 18, md: 28, lg: 40 }, weight: 'bold', case: 'upper', outline: true },
    sizes: { button: [220, 80], buttonSmall: [120, 56], icon: 64, panel: [420, 300], bar: [300, 36], toggle: [96, 52] },
  },
  'flat-web': {
    note: 'Clean web UI: no outline, small radii, flat fills with a soft shadow, sentence case.',
    palette: {
      primary: '#3b6cf6', secondary: '#7a5af8', accent: '#f5a524', danger: '#e5484d', reward: '#f5a524',
      surface: '#ffffff', surfaceAlt: '#f1f3f8', panel: '#ffffff', ink: '#1c2033', text: '#ffffff', textDark: '#1c2033', muted: '#8b90a5',
    },
    stroke: { thin: 1.5, regular: 2, bold: 3, color: 'none' },
    radius: { sm: 6, md: 10, lg: 16, pill: 999 },
    shape: 'soft',
    light: { from: 'top', shade: 0, shine: 0, shadow: 3, shadowAlpha: 0.15 },
    grid: 4,
    type: { size: { sm: 14, md: 18, lg: 26 }, weight: 'regular', case: 'none', outline: false },
    sizes: { button: [180, 48], buttonSmall: [96, 36], icon: 32, panel: [400, 280], bar: [280, 12], toggle: [52, 30] },
  },
  'dark-sci': {
    note: 'Sci-fi HUD: sharp corners, thin bright lines on dark panels, glow instead of shadow.',
    palette: {
      primary: '#21d4c4', secondary: '#7b61ff', accent: '#ffd23f', danger: '#ff4f6d', reward: '#ffd23f',
      surface: '#121a2b', surfaceAlt: '#1c2740', panel: '#0e1524', ink: '#05080f', text: '#e8fbff', textDark: '#05080f', muted: '#5f7290',
    },
    stroke: { thin: 2, regular: 3, bold: 5, color: 'primary' },
    radius: { sm: 2, md: 4, lg: 8, pill: 999 },
    shape: 'sharp',
    light: { from: 'top', shade: 0.15, shine: 0.2, shadow: 0, shadowAlpha: 0 },
    grid: 4,
    type: { size: { sm: 14, md: 20, lg: 30 }, weight: 'regular', case: 'upper', outline: false },
    sizes: { button: [200, 56], buttonSmall: [110, 44], icon: 48, panel: [420, 300], bar: [300, 14], toggle: [72, 36] },
  },
});
export const DEFAULT_PRESET = 'casual-game';

const clone = v => JSON.parse(JSON.stringify(v));

/** A guide from a preset, with a name. */
export function presetStyle(preset = DEFAULT_PRESET, name = preset) {
  const base = STYLE_PRESETS[preset];
  if (!base) throw new StudioError('bad-argument', `No style preset "${preset}". Presets: ${Object.keys(STYLE_PRESETS).join(', ')}.`, { preset });
  return { format: STYLE_FORMAT, version: 1, name, preset, ...clone(base) };
}

/**
 * Check a guide and fill what it leaves out from its preset; throws with every problem.
 * @param {object} guide
 */
export function validateStyle(guide) {
  if (!guide || typeof guide !== 'object') throw new StudioError('bad-argument', 'A style guide is an object.', {});
  const base = presetStyle(STYLE_PRESETS[guide.preset] ? guide.preset : DEFAULT_PRESET, guide.name ?? 'style');
  const problems = [];
  const out = { ...base, ...guide, format: STYLE_FORMAT, version: 1 };
  for (const key of ['palette', 'stroke', 'radius', 'light', 'type', 'sizes']) out[key] = { ...base[key], ...(guide[key] ?? {}) };
  out.type.size = { ...base.type.size, ...(guide.type?.size ?? {}) };
  for (const [role, value] of Object.entries(out.palette)) {
    if (!ROLE.test(role)) problems.push(`palette role "${role}" must be a short camelCase word.`);
    if (typeof value !== 'string' || !HEX.test(value)) problems.push(`palette.${role} must be a #rrggbb colour.`);
  }
  for (const key of ['thin', 'regular', 'bold']) if (!(out.stroke[key] >= 0 && out.stroke[key] <= 40)) problems.push(`stroke.${key} must be 0-40.`);
  if (out.stroke.color !== 'none' && !out.palette[out.stroke.color] && !HEX.test(out.stroke.color)) problems.push(`stroke.color "${out.stroke.color}" is not a palette role, a colour or none.`);
  for (const [k, v] of Object.entries(out.radius)) if (!(v >= 0)) problems.push(`radius.${k} must be 0 or more.`);
  for (const k of ['shade', 'shine', 'shadowAlpha']) if (!(out.light[k] >= 0 && out.light[k] <= 1)) problems.push(`light.${k} must be 0-1.`);
  if (!(out.light.shadow >= 0 && out.light.shadow <= 40)) problems.push('light.shadow must be 0-40 (units the shadow falls).');
  if (!['top', 'top-left', 'top-right'].includes(out.light.from)) problems.push('light.from must be top, top-left or top-right.');
  if (!(out.grid >= 1 && out.grid <= 64)) problems.push('grid must be 1-64.');
  for (const [k, v] of Object.entries(out.type.size)) if (!(v > 0 && v <= 200)) problems.push(`type.size.${k} must be 1-200.`);
  if (!['upper', 'none'].includes(out.type.case)) problems.push('type.case must be upper or none.');
  for (const [k, v] of Object.entries(out.sizes)) if (!(typeof v === 'number' ? v > 0 : Array.isArray(v) && v.length === 2 && v.every(n => n > 0))) problems.push(`sizes.${k} must be a number or [w, h].`);
  if (problems.length) throw new StudioError('bad-style', `The style guide has problems: ${problems.join(' ')}`, { problems });
  return out;
}

// ---------------------------------------------------------------- colours

const toRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = rgb => `#${rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
/** Mix two #rrggbb colours: t 0 is a, 1 is b. */
export const mix = (a, b, t) => { const x = toRgb(a), y = toRgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
export const lighten = (c, t) => mix(c, '#ffffff', t);
export const darken = (c, t) => mix(c, '#000000', t);
/** Grey of the same lightness, for a disabled state. */
export const desaturate = (c, t = 1) => { const [r, g, b] = toRgb(c); const l = 0.3 * r + 0.59 * g + 0.11 * b; return mix(c, toHex([l, l, l]), t); };
/** Relative luminance (WCAG), 0 black to 1 white. */
export function luminance(c) {
  const [r, g, b] = toRgb(c).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/**
 * A colour named by role or written out: "primary", "primary+20" (20% lighter), "primary-30"
 * (30% darker), "primary~" (greyed), "#rrggbb", or "none".
 * @returns {string} #rrggbb or 'none'
 */
export function colorOf(style, value) {
  if (value === undefined || value === null || value === 'none' || value === false) return 'none';
  const text = String(value).trim();
  if (HEX.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) return `#${[...text.slice(1)].map(c => c + c).join('')}`.toLowerCase();
  const m = /^([a-zA-Z][a-zA-Z0-9]*)(?:([+-])(\d{1,3}))?(~)?$/.exec(text);
  const base = m && style.palette[m[1]];
  if (!base) throw new StudioError('bad-argument', `"${text}" is not a palette role (${Object.keys(style.palette).join(', ')}), a #rrggbb colour or none.`, { color: text });
  let c = base;
  if (m[2]) c = m[2] === '+' ? lighten(c, Math.min(100, Number(m[3])) / 100) : darken(c, Math.min(100, Number(m[3])) / 100);
  if (m[4]) c = desaturate(c, 0.85);
  return c;
}

/** The text role that reads best on a fill: the light text colour or the dark one. */
export function readableOn(style, fill) {
  const bg = colorOf(style, fill);
  if (bg === 'none') return 'textDark';
  const light = colorOf(style, style.palette.text ? 'text' : '#ffffff'), dark = colorOf(style, style.palette.textDark ? 'textDark' : 'ink');
  return contrast(light, bg) >= contrast(dark, bg) ? (style.palette.text ? 'text' : '#ffffff') : (style.palette.textDark ? 'textDark' : 'ink');
}

/** A stroke weight by name (thin, regular, bold) or number. */
export function weightOf(style, value) {
  if (typeof value === 'number') return value;
  const w = style.stroke[value ?? 'regular'];
  if (w === undefined) throw new StudioError('bad-argument', `"${value}" is not a stroke weight (thin, regular, bold) or a number.`, { weight: value });
  return w;
}

/** A corner radius by name (sm, md, lg, pill) or number. */
export function radiusOf(style, value) {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return value;
  const r = style.radius[value];
  if (r === undefined) throw new StudioError('bad-argument', `"${value}" is not a radius (${Object.keys(style.radius).join(', ')}) or a number.`, { radius: value });
  return r;
}

/** The guide in a few lines, for a tool result (what an AI needs to draw with it). */
export function styleSummary(style) {
  return {
    name: style.name, preset: style.preset, note: style.note,
    roles: Object.keys(style.palette),
    stroke: `${style.stroke.thin}/${style.stroke.regular}/${style.stroke.bold} in ${style.stroke.color}`,
    radius: Object.entries(style.radius).map(([k, v]) => `${k} ${v}`).join(', '),
    light: `from ${style.light.from}, shade ${style.light.shade}, shine ${style.light.shine}, shadow ${style.light.shadow}`,
    grid: style.grid,
    type: `${style.type.weight}, ${style.type.case === 'upper' ? 'capitals' : 'as written'}, sizes ${Object.entries(style.type.size).map(([k, v]) => `${k} ${v}`).join(' ')}`,
    sizes: style.sizes,
  };
}
