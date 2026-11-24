// "Mika": the anime portrait (waist up), the studio's default sample. Her painted art comes from
// the earlier kit (anime.cjs, drawn in a browser); this script upgrades that rig once and then
// writes her clips through the studio.
//
// The upgrade cuts her right arm out of the painted torso into an arm on two bones (sleeve and
// upper arm, forearm) with an elbow cap and a hand drawn here, so she can wave; the torso keeps a
// closed shoulder where the sleeve was. It also gives the hair and the head bone lengths, so the
// readability measure knows how far their tips travel.
//
// Clips teach overlap and follow-through (the tails trail the head, a few frames per link),
// secondary action (the tails swing less than the head turns), moving holds (nothing frozen) and
// no twinning (left and right tails offset).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAtlas, crop, pack } from './atlas.js';
import { createContext } from './canvas.js';
import { fr, fresh } from './studio.js';
import { finish, rgba } from './showcase.js';

const NAME = 'mika';
const DIR = fileURLToPath(new URL(`../showcase/${NAME}/`, import.meta.url));
const SOURCE = fileURLToPath(new URL('./pack/anime/', import.meta.url));   // the painted rig as anime.cjs writes it
const VIEW = { x: -280, y: -460, width: 600, height: 650 };
const C = { skin: '#fff2ea', shade: '#f8d6ca', line: '#5a3a44' };

// ── the upgrade ──────────────────────────────────────────────────────────────
const PX = 3, TORSO = 336;                                    // the torso picture: 3 pixels per unit, 336 units square
const toTorso = ([X, Y]) => [X / PX - TORSO / 2, TORSO - Y / PX];   // picture pixels to torso-bone space (y up)
const SHOULDER = toTorso([786, 182]), ELBOW = toTorso([818, 742]), WRIST = toTorso([802, 1008]);

function cutArm(torso) {
  const { width: W, height: H, data } = torso, alpha = (x, y) => data[(y * W + x) * 4 + 3];
  // the column where the arm starts on each row: below the armpit the first gap after the body,
  // above it a cut just inside the sleeve's inner outline
  const cut = Array.from({ length: H }, (_, y) => {
    if (y < 296) return 739;
    for (let x = 700; x < W; x++) if (alpha(x, y) < 20) return x;
    return 739;
  });
  const body = new Uint8Array(data), arm = new Uint8Array(data.length);
  for (let y = 0; y < H; y++) for (let x = cut[y]; x < W; x++) { const i = (y * W + x) * 4; arm.set(data.subarray(i, i + 4), i); body.fill(0, i, i + 4); }
  // close the shoulder the sleeve used to cover
  const g = createContext(W, H, 1);
  g.beginPath(); g.moveTo(700, 99); g.quadraticCurveTo(744, 112, 752, 160); g.lineTo(738, 300); g.lineTo(726, 300); g.lineTo(700, 99); g.closePath();
  g.fillStyle = '#ffffff'; g.fill();
  g.beginPath(); g.moveTo(700, 101); g.quadraticCurveTo(744, 112, 752, 160); g.lineTo(735, 300);
  g.strokeStyle = C.line; g.lineWidth = 6; g.stroke();
  const patch = g.toImage().data;
  for (let i = 0; i < body.length; i += 4) {
    const a = patch[i + 3] / 255; if (!a) continue;
    const b = body[i + 3] / 255, out = a + b * (1 - a);
    for (let c = 0; c < 3; c++) body[i + c] = Math.round((patch[i + c] * a + body[i + c] * b * (1 - a)) / out);
    body[i + 3] = Math.round(out * 255);
  }
  const full = { width: W, height: H, data: arm };
  const upper = crop(full, 690, 90, W - 690, 752 - 90), lower = crop(full, 690, 730, W - 690, H - 730);
  return { body: { width: W, height: H, data: body }, upper: { image: upper, at: toTorso([690 + upper.width / 2, 90 + upper.height / 2]) }, lower: { image: lower, at: toTorso([690 + lower.width / 2, 730 + lower.height / 2]) } };
}

// The rest of the forearm (the painted one stops at the frame's edge) and an open hand, palm to
// the viewer, fingers up; the cut end is at the bottom. Shown only while the arm is raised.
const HAND = (g, w, h) => {
  const cx = w / 2, wrist = 50;
  const tube = () => { g.beginPath(); g.moveTo(cx - 14, h); g.lineTo(cx - 11.5, wrist); g.lineTo(cx + 11.5, wrist); g.lineTo(cx + 14, h); g.closePath(); };
  const finger = (x, y, len, wd, tilt) => () => { g.save(); g.translate(x, y); g.rotate(tilt); g.beginPath(); g.roundRect(-wd / 2, -len, wd, len + 8, wd / 2); g.restore(); };
  const palm = () => { g.beginPath(); g.ellipse(cx, wrist - 12, 15.5, 15, 0, 0, 7); };
  const shapes = [finger(cx - 11.5, wrist - 22, 17, 8, -0.2), finger(cx - 3.8, wrist - 25, 20, 8, -0.06), finger(cx + 4.2, wrist - 25, 19, 8, 0.06), finger(cx + 11.5, wrist - 21, 15, 7.5, 0.22),
    finger(cx - 15, wrist - 8, 14, 8, -1.0), palm, tube];
  for (const s of shapes) { s(); g.lineWidth = 3.8; g.strokeStyle = C.line; g.stroke(); }
  for (const s of shapes) { s(); g.fillStyle = C.skin; g.fill(); }
  // the two-tone shading of the painted arm: shade on the side that faces the body
  g.save(); tube(); g.clip(); g.fillStyle = C.shade; g.fillRect(cx + 1, wrist, 20, h); g.restore();
  g.save(); palm(); g.clip(); g.fillStyle = C.shade; g.beginPath(); g.ellipse(cx + 11, wrist - 6, 10, 13, 0, 0, 7); g.fill(); g.restore();
};
const ELBOW_CAP = (g, w, h) => { g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 1.5, 0, 7); g.fillStyle = C.skin; g.fill(); g.strokeStyle = C.line; g.lineWidth = 1.9; g.stroke(); };

const draw = (fn, w, h) => { const g = createContext(w, h, PX); fn(g, w, h); return g.toImage(); };
const angle = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const r2 = v => +v.toFixed(2);
/** A region attachment for a picture centred at `p` (torso space), on a bone at `origin` turned `rot` degrees. */
const placed = (p, origin, rot, w, h) => { const r = -rot * Math.PI / 180, dx = p[0] - origin[0], dy = p[1] - origin[1]; return { x: r2(dx * Math.cos(r) - dy * Math.sin(r)), y: r2(dx * Math.sin(r) + dy * Math.cos(r)), rotation: r2(-rot), width: r2(w), height: r2(h) }; };

export function upgrade() {
  if (!fs.existsSync(SOURCE)) throw new Error('The painted rig is not in ' + SOURCE + ': build it first with the browser kit (see README.md).');
  const sk = JSON.parse(fs.readFileSync(path.join(SOURCE, 'anime.json'), 'utf8'));
  const regions = readAtlas(path.join(SOURCE, 'anime.atlas'));
  const { body, upper, lower } = cutArm(regions.get('torso'));
  regions.set('torso', body);
  regions.set('armR', upper.image); regions.set('forearmR', lower.image);
  regions.set('elbowR', draw(ELBOW_CAP, 32, 32)); regions.set('handR', draw(HAND, 44, 118));
  // bones: shoulder -> elbow -> wrist, children of the torso
  const aArm = angle(SHOULDER, ELBOW), aFore = angle(ELBOW, WRIST);
  const at = name => sk.bones.findIndex(b => b.name === name);
  sk.bones.splice(at('neck'), 0,
    { name: 'armR', parent: 'torso', x: r2(SHOULDER[0]), y: r2(SHOULDER[1]), rotation: r2(aArm), length: r2(dist(SHOULDER, ELBOW)) },
    { name: 'forearmR', parent: 'armR', x: r2(dist(SHOULDER, ELBOW)), rotation: r2(aFore - aArm), length: r2(dist(ELBOW, WRIST)) },
    { name: 'handR', parent: 'forearmR', x: r2(dist(ELBOW, WRIST)), length: 100 });
  const lengths = { torso: 300, head: 180, tailL1: 300, tailR1: 300, tailL2: 180, tailR2: 180, earL: 110, earR: 110, strand: 40, ribbon: 60, hairBack: 100 };
  for (const b of sk.bones) if (lengths[b.name]) b.length = lengths[b.name];
  const iTorso = sk.slots.findIndex(s => s.name === 'torso');
  sk.slots.splice(iTorso + 1, 0, { name: 'elbowR', bone: 'forearmR', attachment: 'elbowR' }, { name: 'forearmR', bone: 'forearmR', attachment: 'forearmR' },
    { name: 'handR', bone: 'handR' }, { name: 'armR', bone: 'armR', attachment: 'armR' });
  const att = sk.skins[0].attachments;
  att.armR = { armR: placed(upper.at, SHOULDER, aArm, upper.image.width / PX, upper.image.height / PX) };
  att.forearmR = { forearmR: placed(lower.at, ELBOW, aFore, lower.image.width / PX, lower.image.height / PX) };
  att.elbowR = { elbowR: { x: 0, y: 0, width: 32, height: 32 } };
  att.handR = { handR: { x: 55, y: 0, rotation: -90, width: 44, height: 118 } };
  sk.skeleton = { ...sk.skeleton, hash: NAME, x: VIEW.x, y: VIEW.y, width: VIEW.width, height: VIEW.height };
  fs.mkdirSync(DIR, { recursive: true });
  const order = sk.skins[0] && [...regions.keys()];
  const page = pack(order.map(name => ({ name, image: regions.get(name) })), NAME + '.png');
  fs.writeFileSync(path.join(DIR, NAME + '.png'), page.png);
  fs.writeFileSync(path.join(DIR, NAME + '.atlas'), page.atlas);
  fs.writeFileSync(path.join(DIR, NAME + '.json'), JSON.stringify(sk, null, 1) + '\n');
}

// ── the clips ────────────────────────────────────────────────────────────────
// keys as [frame, value, curve?]; frames at 30 fps
const rot = keys => ({ rotate: keys.map(([n, value, curve]) => ({ time: fr(n), value, ...(curve ? { curve } : {}) })) });
const ty = keys => ({ translate: keys.map(([n, y, curve]) => ({ time: fr(n), x: 0, y, ...(curve ? { curve } : {}) })) });
const sc = keys => ({ scale: keys.map(([n, v, curve]) => ({ time: fr(n), x: v, y: v, ...(curve ? { curve } : {}) })) });
const swap = keys => ({ attachment: keys.map(([n, name]) => ({ time: fr(n), name })) });
const fade = keys => ({ rgba: keys.map(([n, a, curve]) => ({ time: fr(n), color: rgba(a), ...(curve ? { curve } : {}) })) });
const both = (L, R) => ({ lidL: L, lidR: R ?? L });

export const brief = {
  name: NAME, title: 'Mika', kind: 'Character', principles: 'character',
  subject: 'An original anime girl cut at the waist, the portrait a mobile game shows in dialogue and menus: twin tails, sailor collar, a face rig with lids, brows and mouth shapes, and a right arm that can wave.',
  intent: 'A dialogue portrait that is never frozen. She breathes and blinks, reacts with a short lead-in clip and a loop for each emotion, waves, and goes back to idle; the hair always arrives after the head that moves it.',
  display: { width: 320, pixelsPerUnit: 0.8 },
  teaches: ['overlap and follow-through', 'secondary action', 'moving holds', 'no twinning'],
  preview: { clip: 'wave', time: fr(17), viewport: { x: -330, y: -300, width: 640, height: 480 } },
  clips: [
    { name: 'idle', seconds: 2.4, loop: true, track: 0, does: 'breath with a short top hold, a blink, the head drifts and the tails, locks and strand trail it' },
    { name: 'happy_in', seconds: 0.6, loop: false, track: 0, does: 'a blink and a dip, then a snap up past the pose into a smile; the tails follow two and three frames late' },
    { name: 'happy', seconds: 2.4, loop: true, track: 0, does: 'a light bounce with a held beat, the head rocks out of step, the tails swing behind' },
    { name: 'surprised_in', seconds: 0.4, loop: false, track: 0, does: 'a startled blink and a dip, then up with wide eyes, small pupils, raised brows and an open mouth' },
    { name: 'surprised', seconds: 2, loop: true, track: 0, does: 'the surprise held alive: the body rises and settles, the eyes stay wide, the hair keeps moving' },
    { name: 'wave', seconds: 1.2, loop: false, track: 0, does: 'a small backswing, the arm swings up with an overshoot, three waves with the hand flapping late, and down' },
    { name: 'to_idle', seconds: 0.4, loop: false, track: 0, does: 'a blink covers the change, everything settles back to the rest pose' },
  ],
};

export const clips = {
  idle: {
    bones: {
      torso: ty([[0, 0, 'outSine'], [28, 3.5], [34, 3.5, 'inOutSine'], [72, 0]]),
      head: rot([[0, 0, 'inOutSine'], [31, 2.2, 'inOutQuad'], [38, 1.8, 'inOutSine'], [58, -1.2, 'inOutCubic'], [72, 0]]),
      armR: rot([[0, 0, 'inOutSine'], [30, 0.9, 'outSine'], [36, 0.9, 'inOutSine'], [72, 0]]),
      tailL1: rot([[0, 0, 'inOutSine'], [33, -0.9, 'inOutSine'], [61, 0.5, 'outSine'], [72, 0]]),
      tailL2: rot([[0, 0, 'inOutSine'], [36, -1.4, 'inOutSine'], [64, 0.8, 'outSine'], [72, 0]]),
      tailR1: rot([[0, 0, 'inOutSine'], [34, -0.7, 'inOutQuad'], [62, 0.6, 'outSine'], [72, 0]]),
      tailR2: rot([[0, 0, 'inOutSine'], [38, -1.2, 'inOutQuad'], [66, 0.9, 'outQuad'], [72, 0]]),
      earL: rot([[0, 0, 'inOutSine'], [33, -1.6, 'inOutCubic'], [60, 1, 'outSine'], [72, 0]]),
      earR: rot([[0, 0, 'inOutSine'], [34, -1.3, 'inOutCubic'], [61, 1.2, 'outSine'], [72, 0]]),
      strand: rot([[0, 0, 'inOutSine'], [34, 5, 'inOutQuad'], [55, -4, 'inOutSine'], [72, 0]]),
      ribbon: rot([[0, 0, 'inOutSine'], [32, 3, 'outCubic'], [54, -1, 'inOutSine'], [72, 0]]),
    },
    slots: both(swap([[0, null], [44, 'lid_half'], [45, 'lid_closed'], [47, 'lid_half'], [48, null]])),
  },
  happy_in: {
    bones: {
      torso: ty([[0, 0, 'inQuad'], [3, -5, 'outBack'], [9, 9, 'inOutSine'], [14, 6, 'outSine'], [18, 7]]),
      head: rot([[0, 0, 'inQuad'], [3, -2, 'outBack'], [10, 6, 'inOutSine'], [15, 4, 'outSine'], [18, 4.5]]),
      browL: ty([[0, 0, 'inQuad'], [3, -2, 'outCubic'], [9, 6, 'inOutSine'], [18, 5]]),
      browR: ty([[0, 0, 'inQuad'], [4, -2, 'outCubic'], [10, 6.5, 'inOutSine'], [18, 5.5]]),
      armR: rot([[0, 0, 'inQuad'], [4, -1.5, 'outQuart'], [11, 4, 'inOutSine'], [18, 3]]),
      tailL1: rot([[0, 0, 'outSine'], [5, -1, 'inOutQuad'], [12, 3, 'inOutSine'], [16, -0.8, 'outSine'], [18, 0]]),
      tailL2: rot([[0, 0, 'outSine'], [7, -1.4, 'inOutQuad'], [14, 4, 'outCubic'], [18, 0]]),
      tailR1: rot([[0, 0, 'outSine'], [6, -0.8, 'inOutCubic'], [13, 2.4, 'inOutSine'], [16, -0.6, 'outSine'], [18, 0]]),
      tailR2: rot([[0, 0, 'outSine'], [8, -1.2, 'inOutCubic'], [15, 3.4, 'outQuad'], [18, 0]]),
      earL: rot([[0, 0, 'outQuad'], [5, -3, 'inOutSine'], [12, 5, 'outSine'], [18, 0]]),
      earR: rot([[0, 0, 'outQuad'], [6, -2.5, 'inOutSine'], [13, 4.4, 'outSine'], [18, 0]]),
      strand: rot([[0, 0, 'outCubic'], [6, -6, 'inOutSine'], [13, 8, 'outBack'], [18, 0]]),
    },
    slots: {
      ...both(swap([[0, null], [1, 'lid_closed'], [4, 'lid_happy']])),
      mouth: swap([[0, 'mouth_neutral'], [4, 'mouth_smile']]),
      blushL: fade([[0, 0], [4, 0, 'outSine'], [12, 0.9]]), blushR: fade([[0, 0], [5, 0, 'outSine'], [13, 0.9]]),
    },
  },
  happy: {
    bones: {
      torso: ty([[0, 7, 'outQuad'], [10, 10.5, 'inOutSine'], [24, 7], [28, 7, 'outQuad'], [38, 10.5, 'inOutSine'], [52, 7], [56, 7, 'outQuad'], [64, 9, 'inOutSine'], [72, 7]]),
      head: rot([[0, 4.5, 'inOutSine'], [18, 7, 'inOutQuad'], [50, 2, 'inOutSine'], [72, 4.5]]),
      armR: rot([[0, 3, 'inOutSine'], [12, 5, 'outSine'], [40, 2, 'inOutSine'], [72, 3]]),
      browL: ty([[0, 5, 'outSine'], [12, 7.5, 'inOutSine'], [40, 4.5, 'inOutSine'], [72, 5]]),
      browR: ty([[0, 5.5, 'outSine'], [13, 8, 'inOutSine'], [42, 5, 'inOutSine'], [72, 5.5]]),
      tailL1: rot([[0, 0, 'inOutSine'], [14, -2, 'inOutSine'], [30, 1.5, 'inOutQuad'], [44, -1.8, 'inOutSine'], [58, 1.2, 'inOutSine'], [72, 0]]),
      tailL2: rot([[0, 0, 'inOutSine'], [17, -2.8, 'inOutSine'], [33, 2.2, 'inOutQuad'], [47, -2.4, 'inOutSine'], [61, 1.8, 'inOutSine'], [72, 0]]),
      tailR1: rot([[0, 0, 'inOutSine'], [15, -1.6, 'inOutCubic'], [31, 1.2, 'inOutSine'], [45, -1.5, 'inOutCubic'], [59, 1, 'inOutSine'], [72, 0]]),
      tailR2: rot([[0, 0, 'inOutSine'], [19, -2.4, 'inOutCubic'], [35, 1.9, 'inOutSine'], [49, -2, 'inOutCubic'], [63, 1.5, 'outSine'], [72, 0]]),
      earL: rot([[0, 0, 'inOutSine'], [13, -3, 'outSine'], [41, 2.5, 'inOutSine'], [72, 0]]),
      earR: rot([[0, 0, 'inOutSine'], [14, -2.6, 'outSine'], [43, 2.8, 'inOutSine'], [72, 0]]),
      strand: rot([[0, 0, 'inOutSine'], [12, 6, 'outQuad'], [26, -5, 'inOutSine'], [40, 6, 'outQuad'], [54, -5, 'inOutSine'], [72, 0]]),
    },
    slots: {
      ...both(swap([[0, 'lid_happy']])), mouth: swap([[0, 'mouth_smile']]),
      blushL: fade([[0, 0.9], [72, 0.9]]), blushR: fade([[0, 0.9], [72, 0.9]]),
    },
  },
  surprised_in: {
    bones: {
      torso: ty([[0, 0, 'inQuad'], [2, -3, 'outBack'], [6, 12, 'inOutSine'], [9, 9, 'outSine'], [12, 10]]),
      head: rot([[0, 0, 'inQuad'], [2, 1.5, 'outExpo'], [6, -4, 'inOutSine'], [12, -3]]),
      eyeL: sc([[0, 1, 'inQuad'], [2, 0.96, 'outBack'], [6, 1.12, 'inOutSine'], [12, 1.08]]),
      eyeR: sc([[0, 1, 'inQuad'], [3, 0.96, 'outBack'], [7, 1.13, 'inOutSine'], [12, 1.09]]),
      pupilL: sc([[0, 1, 'outQuad'], [6, 0.78, 'inOutSine'], [12, 0.84]]),
      pupilR: sc([[0, 1, 'outQuad'], [7, 0.78, 'inOutSine'], [12, 0.85]]),
      browL: ty([[0, 0, 'inQuad'], [2, -2, 'outBack'], [6, 10, 'inOutSine'], [12, 8]]),
      browR: ty([[0, 0, 'inQuad'], [3, -2, 'outBack'], [7, 9.5, 'inOutSine'], [12, 8.5]]),
      armR: rot([[0, 0, 'outCubic'], [5, -5, 'inOutSine'], [12, -3.5]]),
      tailL1: rot([[0, 0, 'outSine'], [4, 1, 'inOutQuad'], [8, -4, 'inOutSine'], [12, 1]]),
      tailL2: rot([[0, 0, 'outSine'], [5, 1.4, 'inOutQuad'], [10, -5, 'outSine'], [12, 1.5]]),
      tailR1: rot([[0, 0, 'outSine'], [4, 0.8, 'inOutCubic'], [9, -3.4, 'inOutSine'], [12, 0.8]]),
      tailR2: rot([[0, 0, 'outSine'], [6, 1.2, 'inOutCubic'], [11, -4.4, 'outSine'], [12, 1.2]]),
      earL: rot([[0, 0, 'outQuad'], [4, 2, 'inOutSine'], [9, -5, 'outSine'], [12, -3]]),
      earR: rot([[0, 0, 'outQuad'], [5, 2, 'inOutSine'], [10, -4.5, 'outSine'], [12, -3.5]]),
      strand: rot([[0, 0, 'outQuad'], [5, 5, 'inOutSine'], [9, -9, 'outBack'], [12, -6]]),
    },
    slots: {
      ...both(swap([[0, null], [1, 'lid_closed'], [3, null]])),
      mouth: swap([[0, 'mouth_neutral'], [3, 'mouth_o']]),
    },
  },
  surprised: {
    bones: {
      torso: ty([[0, 10, 'inOutSine'], [20, 13, 'outSine'], [26, 13, 'inOutQuad'], [60, 10]]),
      head: rot([[0, -3, 'inOutSine'], [24, -0.5, 'inOutQuad'], [44, -2, 'inOutSine'], [60, -3]]),
      eyeL: sc([[0, 1.08, 'inOutSine'], [22, 1.11, 'inOutSine'], [60, 1.08]]),
      eyeR: sc([[0, 1.09, 'inOutSine'], [24, 1.12, 'inOutSine'], [60, 1.09]]),
      browL: ty([[0, 8, 'inOutSine'], [21, 10.5, 'outSine'], [40, 7.5, 'inOutSine'], [60, 8]]),
      browR: ty([[0, 8.5, 'inOutSine'], [23, 11, 'outSine'], [42, 8, 'inOutSine'], [60, 8.5]]),
      armR: rot([[0, -3.5, 'inOutSine'], [26, -2, 'inOutQuad'], [60, -3.5]]),
      tailL1: rot([[0, 1, 'inOutSine'], [22, -1.5, 'inOutQuad'], [44, 2, 'inOutSine'], [60, 1]]),
      tailL2: rot([[0, 1.5, 'inOutSine'], [25, -2.2, 'inOutQuad'], [47, 2.8, 'inOutSine'], [60, 1.5]]),
      tailR1: rot([[0, 0.8, 'inOutSine'], [23, -1.2, 'inOutCubic'], [45, 1.6, 'inOutSine'], [60, 0.8]]),
      tailR2: rot([[0, 1.2, 'inOutSine'], [27, -1.8, 'inOutCubic'], [49, 2.4, 'outSine'], [60, 1.2]]),
      earL: rot([[0, -3, 'inOutSine'], [24, -0.5, 'inOutSine'], [60, -3]]),
      earR: rot([[0, -3.5, 'inOutSine'], [26, -1, 'inOutQuad'], [60, -3.5]]),
      strand: rot([[0, -6, 'inOutSine'], [22, -1, 'outQuad'], [40, -8, 'inOutSine'], [60, -6]]),
    },
    slots: { ...both(swap([[0, null]])), mouth: swap([[0, 'mouth_o']]) },
  },
  wave: {
    bones: {
      armR: rot([[0, 0, 'inQuad'], [3, -6, 'outBack'], [11, 140, 'inOutSine'], [20, 134, 'inOutSine'], [28, 138, 'inQuad'], [36, 0]]),
      forearmR: rot([[0, 0, 'inOutSine'], [4, 4, 'outCubic'], [12, 104, 'inOutSine'], [16, 86, 'inOutSine'], [20, 110, 'inOutSine'], [24, 88, 'inOutSine'], [28, 106, 'inQuart'], [36, 0]]),
      handR: rot([[0, 0], [12, 0, 'outQuad'], [15, -16, 'inOutSine'], [19, 15, 'inOutSine'], [23, -13, 'inOutSine'], [27, 12, 'inOutSine'], [31, 0], [36, 0]]),
      head: rot([[0, 0, 'inOutSine'], [6, 1, 'inOutCubic'], [14, -5, 'outSine'], [28, -4, 'inOutSine'], [36, 0]]),
      torso: rot([[0, 0, 'inOutSine'], [10, 2.2, 'outSine'], [28, 2.6, 'inOutSine'], [36, 0]]),
      tailL1: rot([[0, 0, 'inOutSine'], [9, 1.5, 'inOutSine'], [17, -2.4, 'inOutSine'], [30, -1.5, 'inOutSine'], [36, 0]]),
      tailL2: rot([[0, 0, 'inOutSine'], [11, 2, 'inOutSine'], [19, -3.2, 'inOutSine'], [32, -2, 'outSine'], [36, 0]]),
      tailR1: rot([[0, 0, 'inOutSine'], [10, 1.2, 'inOutCubic'], [18, -2, 'inOutSine'], [31, -1.2, 'inOutSine'], [36, 0]]),
      tailR2: rot([[0, 0, 'inOutSine'], [12, 1.7, 'inOutCubic'], [21, -2.8, 'inOutSine'], [33, -1.6, 'outSine'], [36, 0]]),
      earL: rot([[0, 0, 'outSine'], [9, 2, 'inOutSine'], [17, -4, 'inOutSine'], [36, 0]]),
      earR: rot([[0, 0, 'outSine'], [10, 2.4, 'inOutSine'], [18, -4.6, 'inOutSine'], [36, 0]]),
      strand: rot([[0, 0, 'outSine'], [10, 6, 'inOutQuad'], [18, -6, 'outBack'], [36, 0]]),
    },
    slots: {
      handR: swap([[0, null], [6, 'handR'], [35, null]]),
      ...both(swap([[0, null], [8, 'lid_closed'], [10, 'lid_happy'], [29, 'lid_closed'], [31, null]])),
      mouth: swap([[0, 'mouth_neutral'], [9, 'mouth_smile'], [32, 'mouth_neutral']]),
    },
  },
  to_idle: {
    bones: {
      torso: ty([[0, 7, 'inQuad'], [4, -2, 'outBack'], [9, 1, 'inOutSine'], [12, 0]]),
      head: rot([[0, 4, 'inOutSine'], [5, -1, 'outSine'], [12, 0]]),
      browL: ty([[0, 5, 'outCubic'], [6, -1, 'inOutSine'], [12, 0]]),
      browR: ty([[0, 5.5, 'outCubic'], [7, -1, 'inOutSine'], [12, 0]]),
      armR: rot([[0, 3, 'outQuad'], [7, -1, 'inOutSine'], [12, 0]]),
      tailL1: rot([[0, 0, 'outSine'], [6, 2, 'inOutSine'], [10, -1, 'outSine'], [12, 0]]),
      tailR1: rot([[0, 0, 'outSine'], [7, 1.6, 'inOutQuad'], [11, -0.8, 'outSine'], [12, 0]]),
      earL: rot([[0, 0, 'outQuad'], [6, 3, 'inOutSine'], [12, 0]]),
    },
    slots: {
      ...both(swap([[0, 'lid_closed'], [4, null]])),
      mouth: swap([[0, 'mouth_neutral']]),
      blushL: fade([[0, 0.9, 'outQuad'], [6, 0]]), blushR: fade([[0, 0.9, 'outQuad'], [7, 0]]),
    },
  },
};

export async function build() {
  if (!fs.existsSync(path.join(DIR, NAME + '.json'))) upgrade();
  fresh(DIR, NAME);
  await finish(DIR, NAME, brief, clips, { viewport: VIEW, strip: { width: 200, columns: 6 } });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { if (process.argv[2] === '--upgrade') upgrade(); await build(); }
