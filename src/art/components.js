// Components: the usual pieces of a game or app UI, drawn from the style guide in one short call
// and split into the parts an animator needs. A button is one part whose states (hover, pressed,
// disabled) are attachments of the same slot, so a press can switch to the drawn pressed state; a
// progress bar is a track, a fill that grows from its left edge and a frame; a toggle is a track
// with on and off states and a knob that slides; a popup is a panel, a title, a close button and an
// action button that open and close on their own.
//
//   { component: 'button', label: 'PLAY', color: 'primary', w: 220, h: 80, icon: 'play' }
//
// Every component returns parts { name, box, shapes, offset, pivot?, states?, hidden?, blend? }:
// offset and pivot are from the component's centre in rig units (y up). Pure and isomorphic.

import { StudioError } from '../shared/errors.js';
import { GLYPHS, GLYPH_NAMES } from './glyphs.js';
import { readableOn } from './style.js';
import { layoutText } from './font.js';
import { figureParts } from './figure.js';

export const COMPONENTS = Object.freeze({
  button: 'A button with a label and/or an icon; states hover, pressed, disabled. One part.',
  iconButton: 'A round button holding one icon (close, settings, sound); states hover, pressed, disabled. One part.',
  panel: 'A framed panel with an optional title ribbon and an inset body. One part (two with a title).',
  popup: 'A dialog: dim backdrop, panel, title, body lines, an action button and a close button. Five parts.',
  progress: 'A progress bar: track, fill (grows from the left: scale its x), frame. Three parts.',
  toggle: 'A switch: track with on/off states and a knob that slides. Two parts.',
  badge: 'A reward badge: a glow behind (hidden, additive), the icon on a plate, a value, and two sparkles (hidden, additive). Four parts.',
  icon: 'One icon from the family, optionally on a round or square plate. One part.',
  figure: 'A jointed character to start from, every part turning at its joint. build upper (the default): waist up, for gestures and talking: body (breathes at the waist), head, eyes (blink), hairBack, and each arm as upper, lower and hand; ten parts. build side: in profile facing right, for platformers and side-scrollers (flip the root to face left): body (carries everything, turns at the hips), head, eye, and Back (far, darker) and Front (near) upperArm/forearm/hand and thigh/shin/foot; fifteen parts. build kid | adult: a full body standing, facing out, with legs; fourteen parts (h, build, skin, shirt, pants, hair, shoes, sleeves: long, prefix).',
});
export const BUTTON_STATES = Object.freeze(['hover', 'pressed', 'disabled']);

const num = (v, fallback) => (Number.isFinite(v) && v > 0 ? v : fallback);
const sizeOf = (style, key, fallback) => { const s = style.sizes[key]; return Array.isArray(s) ? s : fallback; };

/** The body of a button-like shape in one state, inside a box of w x (h + drop). */
function buttonShapes(style, { w, h, r, color, label, icon, size, state, round }) {
  // With an outline round every letter the light text reads on any fill; without one, pick by contrast.
  const ink = style.type.outline ? 'text' : readableOn(style, color);
  const drop = style.light.shadow;
  const pressed = state === 'pressed', disabled = state === 'disabled', hover = state === 'hover';
  const fill = disabled ? `${color}-15~` : pressed ? `${color}-18` : hover ? `${color}+${round ? 32 : 22}` : color;
  const y = pressed ? drop * 0.75 : 0;
  const out = [];
  if (drop > 0) out.push({ ...(round ? { circle: [w / 2, h / 2 + drop, h / 2] } : { rect: [0, drop, w, h], r }), fill: disabled ? 'ink~' : 'ink', stroke: false, shade: false, opacity: pressed ? style.light.shadowAlpha * 0.6 : style.light.shadowAlpha + (style.type.outline ? 0.2 : 0) });
  out.push({ ...(round ? { circle: [w / 2, h / 2 + y, h / 2 - style.stroke.bold / 2] } : { rect: [style.stroke.bold / 2, y + style.stroke.bold / 2, w - style.stroke.bold, h - style.stroke.bold], r }), fill, sw: 'bold', shine: !pressed && !disabled });
  const textColor = disabled ? 'muted' : ink;
  const iconSize = round ? h * 0.56 : h * 0.52;
  if (icon && label) {
    // Icon and label centred together, on the label's measured ink; a long label is set smaller.
    const measure = k => { const b = layoutText(label, { size: k, upper: style.type.case === 'upper', align: 'start' }).bounds; return b[2] - b[0] + k * 0.3; };
    const room = w - style.stroke.bold * 2 - h * 0.3 - iconSize - size * 0.4;
    if (measure(size) > room && room > 0) size = Math.max(size * 0.4, size * room / measure(size));
    const lw = measure(size);
    const total = iconSize + size * 0.4 + lw, x0 = w / 2 - total / 2;
    out.push({ icon, box: [x0, y + h / 2 - iconSize / 2, iconSize], fill: disabled ? 'muted' : ink });
    out.push({ text: label, at: [x0 + iconSize + size * 0.4, y + h / 2 + size / 2], size, align: 'start', color: textColor });
  } else if (icon) out.push({ icon, box: [w / 2 - iconSize / 2, y + h / 2 - iconSize / 2, iconSize], fill: disabled ? 'muted' : ink });
  else if (label) out.push({ text: label, at: [w / 2, y + h / 2 + size / 2], size, color: textColor });
  return out;
}

/**
 * The parts of one component.
 * @param {object} c  { component, ...params }
 * @param {object} style  a validated style guide
 * @param {string} name   the base name of the parts
 */
export function componentParts(c, style, name) {
  const kind = c?.component;
  if (!COMPONENTS[kind]) throw new StudioError('bad-argument', `"${kind}" is not a component: ${Object.keys(COMPONENTS).join(', ')}.`, { component: kind });
  const icon = c.icon;
  if (icon !== undefined && !GLYPHS[icon]) throw new StudioError('bad-argument', `icon "${icon}" is not in the icon family: ${GLYPH_NAMES.join(', ')}.`, { icon });
  const drop = style.light.shadow;
  const text = s => (s === undefined || s === null ? '' : String(s).slice(0, 40));

  if (kind === 'button' || kind === 'iconButton') {
    const round = kind === 'iconButton';
    const [dw, dh] = round ? [style.sizes.buttonSmall?.[1] ?? 56, style.sizes.buttonSmall?.[1] ?? 56] : sizeOf(style, 'button', [220, 80]);
    const h = num(c.h ?? c.size, dh), w = round ? h : num(c.w, dw);
    const params = { w, h, r: c.r ?? (style.shape === 'sharp' ? 'sm' : 'pill'), color: c.color ?? (round ? 'danger' : 'primary'), label: text(c.label), icon: icon ?? (round ? 'close' : undefined), size: num(c.textSize, Math.round(h * 0.36)), round };
    const states = Object.fromEntries(BUTTON_STATES.map(s => [s, { box: [w, h + drop], shapes: buttonShapes(style, { ...params, state: s }) }]));
    return [{ name, box: [w, h + drop], shapes: buttonShapes(style, { ...params, state: 'normal' }), offset: [0, -drop / 2], states }];
  }

  if (kind === 'figure') return figureParts(c, style);

  if (kind === 'icon') {
    const size = num(c.size, typeof style.sizes.icon === 'number' ? style.sizes.icon : 64);
    const plate = c.plate, pad = plate ? size * 0.18 : 0, full = size + pad * 2;
    /** @type {any[]} */
    const shapes = [];
    if (plate) shapes.push({ ...(plate === 'square' ? { rect: [style.stroke.regular / 2, style.stroke.regular / 2, full - style.stroke.regular, full - style.stroke.regular], r: 'md' } : { circle: [full / 2, full / 2, full / 2 - style.stroke.regular / 2] }), fill: c.plateColor ?? 'surfaceAlt', shine: true });
    shapes.push({ icon: icon ?? 'star', box: [pad, pad, size], fill: c.color ?? 'accent', shadow: !plate });
    return [{ name, box: [full, full + (plate ? 0 : drop)], shapes, offset: [0, plate ? 0 : -drop / 2] }];
  }

  if (kind === 'panel' || kind === 'popup') {
    const [dw, dh] = sizeOf(style, 'panel', [420, 300]);
    const w = num(c.w, dw), h = num(c.h, dh), title = text(c.title), sw = style.stroke.bold;
    const band = title ? Math.round(num(c.textSize, style.type.size.md) * 2) : 0;
    /** @type {any[]} */
    const shapes = [];
    if (drop > 0) shapes.push({ rect: [0, drop, w, h], r: 'lg', fill: 'ink', stroke: false, shade: false, opacity: style.light.shadowAlpha });
    shapes.push({ rect: [sw / 2, sw / 2, w - sw, h - sw], r: 'lg', fill: c.color ?? 'panel', sw: 'bold', shade: false });
    const inset = Math.max(12, w * 0.05);
    shapes.push({ rect: [inset, band ? band * 0.75 + inset * 0.5 : inset, w - inset * 2, h - (band ? band * 0.75 + inset * 1.5 : inset * 2)], r: 'md', fill: `${c.color ?? 'panel'}-8`, stroke: false, shade: false });
    const lines = (Array.isArray(c.lines) ? c.lines : []).slice(0, 6).map(text);
    const top = band ? band * 0.75 + inset * 1.5 : inset * 2, ls = num(c.bodySize, style.type.size.sm);
    lines.forEach((line, i) => shapes.push({ text: line, at: [w / 2, top + ls * (1.25 + i * 1.9)], size: ls, color: readableOn(style, c.color ?? 'panel'), outline: false }));
    /** @type {any[]} */
    const parts = [{ name, box: [w, h + drop], shapes, offset: [0, -drop / 2] }];
    if (title) {
      // The ribbon is as wide as the title's ink (measured, not guessed from its letter count), up to
      // most of the panel; a title longer than that is set smaller to fit (src/art/shapes.js).
      const inkW = layoutText(title, { size: band * 0.44, upper: style.type.case === 'upper' }).bounds;
      const tw = Math.min(w * 0.86, inkW[2] - inkW[0] + band * 1.6), ty = 0;
      parts.push({ name: `${name}_title`, box: [tw, band + drop], offset: [0, h / 2 - ty - band * 0.1 - drop / 2], shapes: [
        ...(drop > 0 ? [{ rect: [0, drop, tw, band], r: 'md', fill: 'ink', stroke: false, shade: false, opacity: style.light.shadowAlpha }] : []),
        { rect: [sw / 2, sw / 2, tw - sw, band - sw], r: 'md', fill: c.titleColor ?? 'secondary', sw: 'bold', shine: true },
        { text: title, at: [tw / 2, band / 2 + band * 0.22], size: band * 0.44 },
      ] });
    }
    if (kind === 'panel') return parts;
    // A popup: a dim backdrop behind, the action button and a close button on the frame.
    const back = [{ name: `${name}_dim`, box: [w * 3, h * 3], shapes: [{ rect: [0, 0, w * 3, h * 3], fill: 'ink', stroke: false, shade: false, opacity: 0.55 }], offset: [0, 0], hidden: false }];
    const [bw, bh] = sizeOf(style, 'buttonSmall', [140, 56]);
    const action = componentParts({ component: 'button', label: c.button ?? 'OK', color: c.buttonColor ?? 'primary', w: Math.max(bw, (c.button ?? 'OK').length * bh * 0.32 + bh), h: bh }, style, `${name}_ok`)[0];
    action.offset = [0, -h / 2 + bh * 0.2];
    const close = componentParts({ component: 'iconButton', icon: 'close', size: Math.round(bh * 0.9) }, style, `${name}_close`)[0];
    close.offset = [w / 2 - bh * 0.25, h / 2 - bh * 0.25];
    for (const p of [action, close]) p.parent = name;
    if (parts[1]) parts[1].parent = name;
    return [...back, ...parts, action, close];
  }

  if (kind === 'progress') {
    const [dw, dh] = sizeOf(style, 'bar', [300, 36]);
    const w = num(c.w, dw), h = num(c.h, dh), sw = style.stroke.bold;
    const inner = [w - sw * 2, h - sw * 2];
    return [
      { name: `${name}_track`, box: [w, h + drop], offset: [0, -drop / 2], shapes: [
        ...(drop > 0 ? [{ rect: [0, drop, w, h], r: 'pill', fill: 'ink', stroke: false, shade: false, opacity: style.light.shadowAlpha }] : []),
        { rect: [sw / 2, sw / 2, w - sw, h - sw], r: 'pill', fill: c.trackColor ?? (style.type.outline ? 'surface-25' : 'surfaceAlt'), sw: 'bold', shade: false }] },
      // Full length in the setup pose: the fill grows from its left edge, so its x scale is the progress.
      { name: `${name}_fill`, box: inner, offset: [0, 0], pivot: [-inner[0] / 2, 0], shapes: [
        { rect: [0, 0, inner[0], inner[1]], r: 'pill', fill: c.color ?? 'primary', stroke: false, shine: true }] },
      { name: `${name}_frame`, box: [w, h], offset: [0, 0], shapes: [
        { rect: [sw / 2, sw / 2, w - sw, h - sw], r: 'pill', fill: 'none', sw: 'bold', shade: false }] },
    ];
  }

  if (kind === 'toggle') {
    const [dw, dh] = sizeOf(style, 'toggle', [96, 52]);
    const w = num(c.w, dw), h = num(c.h, dh), sw = style.stroke.bold, on = c.on !== false;
    const track = color => [
      ...(drop > 0 ? [{ rect: [0, drop * 0.6, w, h], r: 'pill', fill: 'ink', stroke: false, shade: false, opacity: style.light.shadowAlpha }] : []),
      { rect: [sw / 2, sw / 2, w - sw, h - sw], r: 'pill', fill: color, sw: 'bold', shade: false },
    ];
    const knob = h - sw * 2.2, travel = w / 2 - h / 2;
    return [
      { name: `${name}_track`, box: [w, h + drop * 0.6], offset: [0, -drop * 0.3], shapes: track(on ? c.color ?? 'primary' : 'surfaceAlt'),
        states: { [on ? 'off' : 'on']: { box: [w, h + drop * 0.6], shapes: track(on ? 'surfaceAlt' : c.color ?? 'primary') } } },
      { name: `${name}_knob`, box: [knob, knob], offset: [on ? travel : -travel, 0], parent: `${name}_track`, shapes: [
        { circle: [knob / 2, knob / 2, knob / 2 - style.stroke.regular / 2], fill: 'text', sw: 'regular', shine: true }] },
    ];
  }

  // badge
  const size = num(c.size, 96), plate = size * 1.25, value = text(c.value);
  const ray = size * 2.1;
  /** @type {any[]} */
  const rays = [];
  for (let i = 0; i < 12; i++) {
    const a0 = (i * 30 - 4) * Math.PI / 180, a1 = (i * 30 + 4) * Math.PI / 180, cx = ray / 2;
    rays.push({ poly: [[cx, cx], [cx + Math.cos(a0) * cx, cx + Math.sin(a0) * cx], [cx + Math.cos(a1) * cx, cx + Math.sin(a1) * cx]], fill: c.glowColor ?? 'accent+40', stroke: false, shade: false, opacity: 0.8 });
  }
  /** @type {any[]} */
  const parts = [
    { name: `${name}_glow`, box: [ray, ray], offset: [0, 0], blend: 'additive', shapes: [{ circle: [ray / 2, ray / 2, ray * 0.3], fill: c.glowColor ?? 'accent+40', stroke: false, shade: false, opacity: 0.7 }, ...rays] },
    { name, box: [plate, plate + drop], offset: [0, -drop / 2], shapes: [
      { circle: [plate / 2, plate / 2 + drop, plate / 2], fill: 'ink', stroke: false, shade: false, opacity: style.light.shadowAlpha },
      { circle: [plate / 2, plate / 2, plate / 2 - style.stroke.bold / 2], fill: c.plateColor ?? 'surfaceAlt', sw: 'bold', shine: true },
      { icon: icon ?? 'coin', box: [(plate - size * 0.78) / 2, (plate - size * 0.78) / 2, size * 0.78], fill: c.color ?? 'reward' },
    ] },
  ];
  if (value) {
    const vs = Math.round(size * 0.3), vw = Math.max(vs * 2.4, value.length * vs * 0.8 + vs * 1.2);
    parts.push({ name: `${name}_value`, box: [vw, vs * 1.9], offset: [0, -plate / 2 - vs * 0.2], parent: name, shapes: [
      { rect: [style.stroke.regular / 2, style.stroke.regular / 2, vw - style.stroke.regular, vs * 1.9 - style.stroke.regular], r: 'pill', fill: c.valueColor ?? 'danger', sw: 'regular', shine: true },
      { text: value, at: [vw / 2, vs * 0.95 + vs / 2], size: vs }] });
  }
  for (const [i, at] of /** @type {Array<[number, number[]]>} */ ([[1, [plate * 0.42, plate * 0.36]], [2, [-plate * 0.44, -plate * 0.1]]])) {
    const s = size * (i === 1 ? 0.34 : 0.24);
    parts.push({ name: `${name}_spark${i}`, box: [s, s], offset: at, blend: 'additive', parent: name, shapes: [{ star: [s / 2, s / 2, s / 2], points: 4, inner: 0.28, fill: '#ffffff', stroke: false, shade: false }] });
  }
  return parts;
}
