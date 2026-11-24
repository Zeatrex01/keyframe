// "Play button": one UI button whose states are clips. Art drawn here, clips written through
// the studio. Teaches UI timing (short anticipation, overshoot sized for a button, readable at
// 160 px wide) and tracks (the badge plays on track 1 while the button idles on track 0).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRig } from './rig.js';
import { EDGE, paint, gloss, glow, shadow } from './style.js';
import { fr, fresh } from './studio.js';
import { finish, rgba } from './showcase.js';

const NAME = 'play-button';
const DIR = fileURLToPath(new URL(`../showcase/${NAME}/`, import.meta.url));
const W = 220, H = 92, R = 40;               // the button face, in skeleton units
const BOUNDS = { x: -130, y: -70, width: 260, height: 150 };

const pill = (g, w, h, inset = 6) => { g.beginPath(); g.roundRect(inset, inset, w - 2 * inset, h - 2 * inset, R); };
const FACE = (g, w, h, { off }) => {
  const p = () => pill(g, w, h);
  p(); paint(g, g.linear(0, 6, 0, h - 6, off ? ['#c9c6d6', '#9c98ad'] : ['#ffd88a', '#f4ae3f', '#e0901f']), 6);
  gloss(g, p, 14, 8, w - 28, h * 0.55, off ? 0.3 : 0.5);
};
const RIM = (g, w, h, { off }) => { pill(g, w, h); paint(g, off ? '#6f6a80' : '#b5650f', 6); };
// "PLAY" in thick round strokes over a soft shadow, and a play triangle: no font needed
const LETTERS = [
  [[[0, 40], [0, 0], [14, 0]], [[14, 0], 'arc', [14, 11, 11, -Math.PI / 2, Math.PI / 2]], [[14, 22], [0, 22]]], // P
  [[[30, 0], [30, 40], [48, 40]]], // L
  [[[56, 40], [68, 0], [80, 40]], [[61, 27], [75, 27]]], // A
  [[[88, 0], [99, 19], [110, 0]], [[99, 19], [99, 40]]], // Y
];
function word(g, color, width) {
  g.strokeStyle = color; g.lineWidth = width;
  for (const letter of LETTERS) for (const stroke of letter) {
    g.beginPath();
    if (stroke[1] === 'arc') { const [cx, cy, r, a0, a1] = stroke[2]; g.moveTo(...stroke[0]); g.arc(cx, cy, r, a0, a1); }
    else stroke.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](x, y));
    g.stroke();
  }
}
const LABEL = (g, w, h) => { g.translate((w - 110) / 2, (h - 40) / 2); g.save(); g.translate(0, 2.5); word(g, 'rgba(150,80,0,0.35)', 9); g.restore(); word(g, '#ffffff', 8); };
const ICON = (g, w, h) => {
  const tri = () => { g.beginPath(); g.moveTo(10, 8); g.lineTo(w - 8, h / 2); g.lineTo(10, h - 8); g.closePath(); };
  tri(); g.fillStyle = '#ffffff'; g.fill(); g.strokeStyle = EDGE; g.lineWidth = 2; g.stroke();
};
const SHINE = (g, w, h) => { g.save(); g.translate(w / 2, h / 2); g.rotate(0.35); g.fillStyle = g.linear(-w / 2, 0, w / 2, 0, ['rgba(255,255,255,0)', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']); g.fillRect(-w / 2, -h, w, h * 2); g.restore(); };
const BADGE = (g, w, h) => {
  g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 4, 0, 7); paint(g, g.linear(0, 0, 0, h, ['#ff8fa2', '#f06a82', '#cc2f4e']), 5);
  gloss(g, () => { g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 4, 0, 7); }, 6, 4, w - 12, h - 12, 0.45);
  g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.beginPath(); g.moveTo(w / 2, h * 0.27); g.lineTo(w / 2, h * 0.55); g.stroke();
  g.beginPath(); g.arc(w / 2, h * 0.72, 3.6, 0, 7); g.fillStyle = '#ffffff'; g.fill();
};
const RING = (g, w, h) => { g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 5, 0, 7); g.strokeStyle = 'rgba(255,170,185,0.95)'; g.lineWidth = 5; g.stroke(); };

// the clipping polygon of the face, so the shine never leaves it
const facePoints = (() => { const pts = [], hw = W / 2 - 9, hh = H / 2 - 9, r = hh; for (let i = 0; i <= 10; i++) { const a = Math.PI / 2 + i * Math.PI / 10; pts.push([-hw + r + Math.cos(a) * r, 4 + Math.sin(a) * r]); } for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 10; pts.push([hw - r + Math.cos(a) * r, 4 + Math.sin(a) * r]); } return pts; })();

export const rig = {
  name: NAME, bounds: BOUNDS, density: 2,
  bones: [{ name: 'button', at: [0, 0] }, { name: 'face', parent: 'button', at: [0, 0] }],
  pieces: [
    { name: 'glow', parent: 'body', at: [0, 2], size: [300, 170], draw: (g, w, h) => glow(g, w, h, [255, 196, 110, 0.75]), hidden: true, blend: 'additive' },
    { name: 'shadow', parent: 'body', at: [0, -56], size: [220, 30], draw: (g, w, h) => shadow(g, w, h, 0.55) },
    { name: 'rim', slot: 'rim', shown: true, parent: 'button', at: [0, -6], pivot: [0, 0], size: [W + 12, H + 12], draw: RIM, args: {} },
    { name: 'rim_off', slot: 'rim', parent: 'button', at: [0, -6], pivot: [0, 0], size: [W + 12, H + 12], draw: RIM, args: { off: true } },
    { name: 'face', slot: 'faceArt', shown: true, on: 'face', at: [0, 4], size: [W + 12, H + 12], draw: FACE, args: {} },
    { name: 'face_off', slot: 'faceArt', on: 'face', at: [0, 4], size: [W + 12, H + 12], draw: FACE, args: { off: true } },
    { name: 'faceClip', on: 'face', at: [0, 0], clip: { points: facePoints, end: 'shine' } },
    { name: 'shine', parent: 'face', at: [-150, 4], size: [44, 130], draw: SHINE, blend: 'additive' },
    { name: 'icon', parent: 'face', at: [-70, 4], size: [44, 52], draw: ICON },
    { name: 'label', on: 'face', at: [27, 4], size: [130, 60], draw: LABEL },
    { name: 'badge', parent: 'button', at: [110, 50], size: [50, 50], draw: BADGE, hidden: true },
    { name: 'badgeRing', parent: 'badge', at: [110, 50], size: [60, 60], draw: RING, hidden: true, blend: 'additive' },
  ],
};

// keys: [frame, value(s), curve]
const s = (frame, v, curve) => ({ time: fr(frame), x: v, y: v, ...(curve ? { curve } : {}) });
const t = (frame, x, y, curve) => ({ time: fr(frame), x, y, ...(curve ? { curve } : {}) });
const r = (frame, value, curve) => ({ time: fr(frame), value, ...(curve ? { curve } : {}) });
const at = (seconds, more) => ({ time: seconds, ...more });

export const brief = {
  name: NAME, title: 'Play button', kind: 'UI', principles: 'ui',
  subject: 'A game menu Play button with a notification badge, drawn in the kit\'s clean style (soft gradients, thin tinted edges) in the studio\'s amber.',
  intent: 'Every state a button lives through as a clip, timed for UI: quick, small anticipation, an overshoot sized for a button, every move readable at 160 px wide. The badge plays on track 1 over the idling button on track 0.',
  display: { width: 160, pixelsPerUnit: +(160 / BOUNDS.width).toFixed(3) },
  teaches: ['UI timing', 'overshoot', 'readable at real size', 'tracks'],
  preview: { clip: 'badge_pulse', time: 0.3 },
  clips: [
    { name: 'idle', seconds: 2.4, loop: true, track: 0, does: 'a 2% breath with a short hold at the top, the triangle nudges forward once' },
    { name: 'hover_in', seconds: 0.15, loop: false, track: 0, does: 'grows to 1.05 past a 1.07 peak, a shine sweeps the face, the glow comes up' },
    { name: 'press', seconds: 0.1, loop: false, track: 0, does: 'squashes to 0.9 as the face sinks into its rim' },
    { name: 'release', seconds: 0.22, loop: false, track: 0, does: 'springs to 1.08 and settles on 1.0, the face pops back up' },
    { name: 'disabled', seconds: 0.2, loop: false, track: 0, does: 'swaps to the grey art and dims the label; nothing moves' },
    { name: 'badge_pop', seconds: 0.3, loop: false, track: 1, does: 'the badge pops 0 to 1.15 to 1.0 with a wobble and a ring' },
    { name: 'badge_pulse', seconds: 2.0, loop: true, track: 1, does: 'a dip, a pulse to 1.14 and a ring, then a rest' },
  ],
};

export const clips = {
  idle: { bones: {
    button: { scale: [s(0, 1, 'inOutSine'), s(30, 1.022), s(38, 1.022, 'inOutQuad'), s(72, 1)] },
    shadow: { scale: [s(0, 1, 'inOutSine'), s(32, 0.95), s(40, 0.95, 'inOutCubic'), s(72, 1)] },
    face: { translate: [t(0, 0, 0, 'outSine'), t(28, 0, 4), t(40, 0, 4, 'inOutSine'), t(72, 0, 0)] },
    icon: { translate: [t(0, 0, 0), t(46, 0, 0, 'outQuad'), t(49, -2, 0, 'outBack'), t(53, 6, 0, 'inOutSine'), t(62, 0, 0), t(72, 0, 0)] },
  } },
  hover_in: { bones: {
    button: { scale: [at(0, { x: 1, y: 1, curve: 'outCubic' }), at(0.1, { x: 1.07, y: 1.07, curve: 'inOutSine' }), at(0.15, { x: 1.05, y: 1.05 })] },
    face: { translate: [at(0, { x: 0, y: 0, curve: 'outQuad' }), at(0.08, { x: 0, y: 4, curve: 'inOutSine' }), at(0.15, { x: 0, y: 3 })] },
    shine: { translate: [at(0, { x: 0, y: 0, curve: 'inQuad' }), at(0.05, { x: 60, y: 0, curve: 'outCubic' }), at(0.15, { x: 300, y: 0 })] },
  }, slots: { glow: { rgba: [at(0, { color: rgba(0) }), at(0.15, { color: rgba(0.7) })] } } },
  press: { bones: {
    button: { scale: [at(0, { x: 1.05, y: 1.05, curve: 'outCubic' }), at(0.067, { x: 0.9, y: 0.9, curve: 'inOutSine' }), at(0.1, { x: 0.92, y: 0.92 })] },
    face: { translate: [at(0, { x: 0, y: 3, curve: 'outQuad' }), at(0.04, { x: 0, y: -7, curve: 'inOutSine' }), at(0.1, { x: 0, y: -6 })] },
  }, slots: { glow: { rgba: [at(0, { color: rgba(0.7) }), at(0.04, { color: rgba(1) }), at(0.1, { color: rgba(0.85) })] } } },
  release: { bones: {
    button: { scale: [at(0, { x: 0.92, y: 0.92, curve: 'outCubic' }), at(0.1, { x: 1.08, y: 1.08, curve: 'inOutSine' }), at(0.167, { x: 0.98, y: 0.98, curve: 'outSine' }), at(0.22, { x: 1, y: 1 })] },
    face: { translate: [at(0, { x: 0, y: -6, curve: 'outBack' }), at(0.08, { x: 0, y: 3, curve: 'inOutQuad' }), at(0.15, { x: 0, y: 0 }), at(0.22, { x: 0, y: 0 })] },
    icon: { translate: [at(0, { x: 0, y: 0, curve: 'outCubic' }), at(0.09, { x: 7, y: 0, curve: 'inOutSine' }), at(0.22, { x: 0, y: 0 })] },
  }, slots: { glow: { rgba: [at(0, { color: rgba(0.85) }), at(0.06, { color: rgba(1), curve: 'linear' }), at(0.22, { color: rgba(0) })] } } },
  disabled: { slots: {
    rim: { attachment: [{ time: 0, name: 'rim_off' }] },
    faceArt: { attachment: [{ time: 0, name: 'face_off' }] },
    icon: { rgba: [at(0, { color: 'ffffffff' }), at(0.2, { color: 'd9d6e4b3' })] },
    label: { rgba: [at(0, { color: 'ffffffff' }), at(0.2, { color: 'd9d6e4b3' })] },
  } },
  badge_pop: { bones: {
    badge: { scale: [at(0, { x: 0.3, y: 0.3, curve: 'outCubic' }), at(0.2, { x: 1.15, y: 1.15, curve: 'inOutSine' }), at(0.3, { x: 1, y: 1 })],
      rotate: [at(0, { value: -16, curve: 'outCubic' }), at(0.17, { value: 8, curve: 'inOutSine' }), at(0.3, { value: 0 })] },
    badgeRing: { scale: [at(0, { x: 0.8, y: 0.8, curve: 'outQuad' }), at(0.12, { x: 1.4, y: 1.4, curve: 'outSine' }), at(0.3, { x: 1.8, y: 1.8 })] },
  }, slots: {
    badge: { rgba: [at(0, { color: rgba(0) }), at(0.033, { color: rgba(1) })] },
    badgeRing: { rgba: [at(0, { color: rgba(0) }), at(0.1, { color: rgba(0.9) }), at(0.3, { color: rgba(0) })] },
  } },
  badge_pulse: { bones: {
    badge: { scale: [s(0, 1, 'inQuad'), s(4, 0.94, 'outBack'), s(9, 1.14, 'inOutSine'), s(14, 0.98, 'outSine'), s(19, 1), s(60, 1)],
      rotate: [r(0, 0), r(4, 0, 'outCubic'), r(9, -7, 'inOutSine'), r(13, 5, 'inOutSine'), r(17, -2, 'outSine'), r(22, 0), r(60, 0)] },
    badgeRing: { scale: [s(0, 1), s(8, 1, 'outCubic'), s(27, 2, 'stepped'), s(30, 1), s(60, 1)] },
  }, slots: {
    badge: { rgba: [at(0, { color: rgba(1) }), at(2, { color: rgba(1) })] },
    badgeRing: { rgba: [at(0, { color: rgba(0) }), at(fr(8), { color: rgba(0), curve: 'outQuad' }), at(fr(10), { color: rgba(0.85), curve: 'inQuad' }), at(fr(27), { color: rgba(0) }), at(2, { color: rgba(0) })] },
  } },
};

export async function build() {
  fresh(DIR, NAME);
  buildRig(rig, DIR);
  await finish(DIR, NAME, brief, clips, { viewport: { x: -135, y: -75, width: 270, height: 160 } });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
