// "Pip": the full-body character, arms and legs on two-bone IK. The painted art and the rig come
// from the earlier kit (human.cjs, drawn in a browser); this script upgrades that rig once and
// then writes Pip's clips through the studio.
//
// The upgrade dresses the default skin in the casual look (hair, T-shirt, shorts, sneakers), so
// the character reads as a person without choosing a skin; drops the other looks and repacks the
// atlas with only the art in use; and moves the shirt onto `trunk`, a leaf bone at the waist, so
// squash and stretch can be keyed there without shearing anything (the head and arms ride `top`,
// which the clips move with the shirt's top edge).
//
// Clips teach anticipation, squash and stretch with the volume kept, arcs and the timing contrast
// between a walk and a jump.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAtlas, pack } from './atlas.js';
import { fr, fresh } from './studio.js';
import { finish } from './showcase.js';

const NAME = 'pip';
const DIR = fileURLToPath(new URL(`../showcase/${NAME}/`, import.meta.url));
const SOURCE = fileURLToPath(new URL('./pack/human/', import.meta.url));   // the painted rig as human_build.cjs writes it
const LOOK = 'boy_casual';
const VIEW = { x: -230, y: -440, width: 460, height: 600 };
const TOP_AT = 44.2;              // where `top` sits along the waist bone

export function upgrade() {
  if (!fs.existsSync(SOURCE)) throw new Error('The painted rig is not in ' + SOURCE + ': build it first with the browser kit (see README.md).');
  const sk = JSON.parse(fs.readFileSync(path.join(SOURCE, 'human.json'), 'utf8'));
  const regions = readAtlas(path.join(SOURCE, 'human.atlas'));
  const def = sk.skins[0].attachments, look = sk.skins.find(s => s.name === LOOK).attachments;
  for (const [slot, atts] of Object.entries(look)) def[slot] = { ...(def[slot] ?? {}), ...atts };
  sk.skins = [sk.skins[0]];
  // the shirt on a leaf bone at the waist
  const iWaist = sk.bones.findIndex(b => b.name === 'waist');
  sk.bones.splice(iWaist + 1, 0, { name: 'trunk', parent: 'waist', length: 108.8 });
  for (const slot of sk.slots) if (['waist_line', 'waist', 'top_line', 'top'].includes(slot.name)) slot.bone = 'trunk';
  for (const slot of ['top_line', 'top']) for (const att of Object.values(def[slot])) att.x = +(att.x + TOP_AT).toFixed(2);
  sk.skeleton = { ...sk.skeleton, hash: NAME, ...VIEW };
  sk.events = { land: {} };
  // only the art in use
  const used = new Set();
  for (const atts of Object.values(def)) for (const [name, att] of Object.entries(atts)) if (att.type !== 'clipping') used.add(att.path ?? name);
  const items = [...regions.keys()].filter(name => used.has(name)).map(name => ({ name, image: regions.get(name) }));
  fs.mkdirSync(DIR, { recursive: true });
  const page = pack(items, NAME + '.png');
  fs.writeFileSync(path.join(DIR, NAME + '.png'), page.png);
  fs.writeFileSync(path.join(DIR, NAME + '.atlas'), page.atlas);
  fs.writeFileSync(path.join(DIR, NAME + '.json'), JSON.stringify(sk, null, 1) + '\n');
}

// ── the arms: hands placed by angle and reach about the shoulder ─────────────────
// In chestControl space (x sideways, y up): 0 degrees = straight down, 90 = out to the side,
// 180 = straight up; reach 1 = the arm fully straight. No key can ask for more arm than there is.
const SH = [74.8, 51], WR = [83.3, -69.7], ARM = 61.46 + 60.5;
const A0 = Math.atan2(WR[0] - SH[0], SH[1] - WR[1]) * 180 / Math.PI, R0 = Math.hypot(WR[0] - SH[0], WR[1] - SH[1]) / ARM, OUT = 0.9995;
const reach = (s, a, r) => ({ x: +(s * (SH[0] + r * ARM * Math.sin(a * Math.PI / 180) - WR[0])).toFixed(2), y: +(SH[1] - r * ARM * Math.cos(a * Math.PI / 180) - WR[1]).toFixed(2) });
/** s: 1 right, -1 left; keys [frame, angle | null (rest), reach, curve?] */
const arm = (s, keys) => ({ translate: keys.map(([n, a, r, curve], i) => ({ time: fr(n), ...(a === null ? { x: 0, y: 0 } : reach(s, a, r)), ...(i < keys.length - 1 ? { curve: curve ?? 'inOutSine' } : {}) })) });
// a raised arm flips its bend while straight (the other bend of a two-bone IK keeps the elbow outward)
const bend = (s, up, down) => [{ time: 0, bendPositive: s < 0 }, { time: fr(up), bendPositive: s > 0 }, { time: fr(down), bendPositive: s < 0 }];

const xy = keys => ({ translate: keys.map(([n, x, y, curve]) => ({ time: fr(n), x, y, ...(curve ? { curve } : {}) })) });
const rot = keys => ({ rotate: keys.map(([n, value, curve]) => ({ time: fr(n), value, ...(curve ? { curve } : {}) })) });
const sc = keys => ({ scale: keys.map(([n, x, y, curve]) => ({ time: fr(n), x, y, ...(curve ? { curve } : {}) })) });
const swap = keys => ({ attachment: keys.map(([n, name]) => ({ time: fr(n), name })) });
// a blink or a happy squint: the lid shows and the eye under it is hidden (this rig's convention)
function eyes(keys) {
  const out = {};
  for (const side of ['L', 'R']) {
    out['lid' + side] = swap(keys.map(([n, lid]) => [n, lid]));
    out['eye' + side] = swap(keys.map(([n, lid]) => [n, lid === 'lid_closed' || lid === 'lid_happy' ? null : 'eye' + side]));
    out['pupil' + side] = swap(keys.map(([n, lid]) => [n, lid === 'lid_closed' || lid === 'lid_happy' ? null : 'pupil' + side]));
  }
  return out;
}

export const brief = {
  name: NAME, title: 'Pip', kind: 'Character', principles: 'character',
  subject: 'A full-body cartoon kid in a T-shirt and shorts: arms and legs on two-bone IK, the face rig on the head, the shirt on a leaf bone for squash and stretch.',
  intent: 'A small game hero. The jump is the lesson: a crouch before it, a stretch at take-off, a hang at the top, a squash on landing with the volume kept, and a settle; the walk next to it shows how much faster and more even a cycle is.',
  display: { width: 200, pixelsPerUnit: 0.75 },
  teaches: ['anticipation', 'squash and stretch', 'arcs', 'timing'],
  preview: { clip: 'jump', time: fr(9) },
  events: { land: [fr(23)] },
  clips: [
    { name: 'idle', seconds: 2, loop: true, track: 0, does: 'weight shifts from foot to foot over planted feet, a breath, a blink' },
    { name: 'jump', seconds: 1.1, loop: false, track: 0, does: 'crouch, stretch at take-off, tuck and hang at the top, land squash on the contact frame (land), absorb and settle' },
    { name: 'walk', seconds: 1, loop: true, track: 0, does: 'a march on the spot: feet lift in turn, the hips ride over the standing leg, arms swing against the legs' },
    { name: 'cheer', seconds: 1.4, loop: false, track: 0, does: 'a dip, a hop with both fists thrown up, a second pump, and the arms come down' },
  ],
};

export const clips = {
  idle: {
    bones: {
      hips: xy([[0, 0, 0, 'inOutSine'], [16, 6, -2.5, 'inOutQuad'], [22, 6, -2.5, 'inOutSine'], [44, -5, -2, 'inOutSine'], [60, 0, 0]]),
      waist: rot([[0, 0, 'inOutSine'], [18, 2.5, 'inOutQuad'], [46, -2, 'inOutSine'], [60, 0]]),
      top: xy([[0, 0, 0, 'outSine'], [24, 3, 0], [30, 3, 0, 'inOutSine'], [60, 0, 0]]),
      head: rot([[0, 0, 'inOutSine'], [21, -2, 'inOutQuad'], [48, 1.5, 'inOutSine'], [60, 0]]),
      earL: rot([[0, 0, 'inOutSine'], [24, -3, 'inOutSine'], [51, 2.5, 'outSine'], [60, 0]]),
      earR: rot([[0, 0, 'inOutSine'], [25, -2.6, 'inOutCubic'], [52, 2.8, 'outSine'], [60, 0]]),
      handTargetR: arm(1, [[0, null], [20, A0 + 2, R0 - 0.012], [46, A0 - 1, R0 - 0.004], [60, null]]),
      handTargetL: arm(-1, [[0, null], [24, A0 - 1, R0 - 0.004], [50, A0 + 2.5, R0 - 0.014, 'inOutQuad'], [60, null]]),
    },
    slots: eyes([[0, null], [38, 'lid_half'], [39, 'lid_closed'], [41, 'lid_half'], [42, null]]),
  },
  jump: {
    bones: {
      // arcs: up decelerating (outQuad), a hang, down accelerating (inQuad)
      body: xy([[0, 0, 0], [6, 0, 0, 'outQuad'], [15, 0, 88], [18, 0, 91, 'inQuad'], [23, 0, 0], [33, 0, 0]]),
      // anticipation: the crouch; after the landing the knees absorb it
      hips: xy([[0, 0, 0, 'inOutSine'], [5, 0, -36, 'outCubic'], [8, 0, 3, 'inOutSine'], [23, 0, 0, 'outQuad'], [26, 0, -28, 'inOutSine'], [33, 0, 0]]),
      // squash and stretch on the leaf `trunk` (its x is up): crouch, stretch at take-off, squash on contact; x * y stays near 1
      trunk: sc([[0, 1, 1, 'inOutSine'], [5, 0.9, 1.11, 'outExpo'], [8, 1.18, 0.85, 'inOutSine'], [13, 1, 1, 'inCubic'], [21, 1.08, 0.93, 'outCubic'], [23, 0.8, 1.25, 'outBack'], [27, 1.06, 0.94, 'inOutSine'], [31, 1, 1], [33, 1, 1]]),
      // the head and the arms ride the top of the shirt
      top: xy([[0, 0, 0, 'inOutSine'], [5, -10, 0, 'outExpo'], [8, 18, 0, 'inOutSine'], [13, 0, 0, 'inCubic'], [21, 8, 0, 'outCubic'], [23, -21, 0, 'outBack'], [27, 6, 0, 'inOutSine'], [31, 0, 0], [33, 0, 0]]),
      head: rot([[0, 0, 'inOutSine'], [6, -3, 'outCubic'], [11, 3, 'inOutSine'], [24, 2, 'outQuad'], [28, -2, 'inOutSine'], [33, 0]]),
      footTargetL: { ...xy([[0, 0, 0], [7, 0, 0, 'outQuad'], [15, -8, 30, 'inQuad'], [23, 0, 0], [33, 0, 0]]), ...rot([[0, 0], [7, 0, 'outQuad'], [15, 18, 'inQuad'], [23, 0], [33, 0]]) },
      footTargetR: { ...xy([[0, 0, 0], [8, 0, 0, 'outQuad'], [16, 9, 28, 'inQuad'], [23, 0, 0], [33, 0, 0]]), ...rot([[0, 0], [8, 0, 'outQuad'], [16, -17, 'inQuad'], [23, 0], [33, 0]]) },
      handTargetL: arm(-1, [[0, null], [5, A0 + 14, 0.92], [9, 85, OUT], [13, 155, 0.96], [19, 142, 0.9], [23, 85, OUT], [27, 38, 0.86], [33, null]]),
      handTargetR: arm(1, [[0, null], [6, A0 + 12, 0.92], [9, 85, OUT], [14, 150, 0.96], [20, 140, 0.9], [23, 85, OUT], [28, 36, 0.86], [33, null]]),
      shadow: sc([[0, 1, 1, 'outSine'], [6, 1.05, 1.05, 'outQuad'], [15, 0.7, 0.7], [18, 0.7, 0.7, 'inQuad'], [23, 1.1, 1.1, 'outCubic'], [27, 1, 1], [33, 1, 1]]),
    },
    ik: { armL: bend(-1, 9, 23), armR: bend(1, 9, 23) },
    slots: { mouth: swap([[0, 'mouth_neutral'], [7, 'mouth_o'], [23, 'mouth_smile']]) },
    events: [{ time: fr(23), name: 'land' }],
  },
  walk: {
    bones: {
      footTargetL: { ...xy([[0, 0, 0, 'outQuad'], [7, 0, 28, 'inQuad'], [14, 0, 0], [30, 0, 0]]), ...rot([[0, 0, 'outQuad'], [5, 14, 'inOutSine'], [14, 0], [30, 0]]) },
      footTargetR: { ...xy([[0, 0, 0], [15, 0, 0, 'outQuad'], [22, 0, 27, 'inQuad'], [29, 0, 0], [30, 0, 0]]), ...rot([[0, 0], [15, 0, 'outQuad'], [20, -13, 'inOutSine'], [29, 0], [30, 0]]) },
      // the hips drop on each contact and ride over the standing leg
      hips: xy([[0, 0, -5, 'outSine'], [7, 5, 2, 'inOutSine'], [15, 0, -5, 'outSine'], [22, -5, 2, 'inOutSine'], [30, 0, -5]]),
      waist: rot([[0, 0, 'inOutSine'], [8, 3, 'inOutSine'], [16, 0, 'inOutSine'], [23, -3, 'inOutSine'], [30, 0]]),
      top: rot([[0, 0, 'inOutQuad'], [9, -4, 'inOutQuad'], [17, 0, 'inOutQuad'], [24, 4, 'inOutQuad'], [30, 0]]),
      head: rot([[0, 0, 'outSine'], [10, 2.5, 'inOutSine'], [18, 0, 'outSine'], [25, -2.5, 'inOutSine'], [30, 0]]),
      // the arms swing against the legs
      handTargetR: arm(1, [[0, null], [7, A0 + 6, 0.86], [15, null], [22, A0 + 1, R0 - 0.004], [30, null]]),
      handTargetL: arm(-1, [[0, null], [8, A0 + 1, R0 - 0.004], [15, null], [23, A0 + 6, 0.86], [30, null]]),
    },
  },
  cheer: {
    bones: {
      body: xy([[0, 0, 0], [6, 0, 0, 'outQuad'], [11, 0, 40], [13, 0, 41, 'inQuad'], [17, 0, 0], [42, 0, 0]]),
      hips: xy([[0, 0, 0, 'outQuad'], [4, 0, -22, 'outCubic'], [7, 0, 2, 'inOutSine'], [17, 0, 0, 'outQuad'], [20, 0, -18, 'inOutSine'], [26, 0, 0, 'outSine'], [30, 0, -8, 'inOutSine'], [36, 0, 0], [42, 0, 0]]),
      trunk: sc([[0, 1, 1, 'outQuad'], [4, 0.92, 1.09, 'outCubic'], [7, 1.12, 0.9, 'inOutSine'], [12, 1, 1], [17, 1, 1, 'outQuad'], [19, 0.88, 1.14, 'outBack'], [23, 1.04, 0.96, 'inOutSine'], [27, 1, 1], [42, 1, 1]]),
      top: xy([[0, 0, 0, 'outQuad'], [4, -8, 0, 'outCubic'], [7, 12, 0, 'inOutSine'], [12, 0, 0], [17, 0, 0, 'outQuad'], [19, -13, 0, 'outBack'], [23, 4, 0, 'inOutSine'], [27, 0, 0], [42, 0, 0]]),
      head: rot([[0, 0, 'outSine'], [5, -3, 'inOutSine'], [12, 4, 'inOutSine'], [24, -3, 'inOutSine'], [34, 2, 'outSine'], [42, 0]]),
      footTargetL: xy([[0, 0, 0], [6, 0, 0, 'outQuad'], [11, -4, 14, 'inQuad'], [17, 0, 0], [42, 0, 0]]),
      footTargetR: xy([[0, 0, 0], [7, 0, 0, 'outQuad'], [12, 5, 12, 'inQuad'], [17, 0, 0], [42, 0, 0]]),
      handTargetL: arm(-1, [[0, null], [4, A0 + 10, 0.9], [8, 80, OUT], [12, 152, 0.95], [17, 144, 0.88], [23, 155, 0.95], [29, 146, 0.88], [33, 80, OUT], [42, null]]),
      handTargetR: arm(1, [[0, null], [5, A0 + 9, 0.9], [8, 80, OUT], [13, 150, 0.95], [18, 142, 0.88], [24, 154, 0.95], [30, 145, 0.88], [33, 80, OUT], [42, null]]),
      earL: rot([[0, 0, 'outSine'], [8, 6, 'inOutSine'], [19, -5, 'inOutSine'], [30, 3, 'outSine'], [42, 0]]),
      earR: rot([[0, 0, 'outSine'], [9, 5, 'inOutSine'], [20, -6, 'inOutSine'], [31, 3.5, 'outSine'], [42, 0]]),
    },
    ik: { armL: bend(-1, 8, 33), armR: bend(1, 8, 33) },
    slots: { ...eyes([[0, null], [5, 'lid_closed'], [7, 'lid_happy'], [36, 'lid_closed'], [38, null]]), mouth: swap([[0, 'mouth_neutral'], [7, 'mouth_smile'], [38, 'mouth_neutral']]) },
  },
};

export async function build() {
  if (!fs.existsSync(path.join(DIR, NAME + '.json'))) upgrade();
  fresh(DIR, NAME);
  await finish(DIR, NAME, brief, clips, { viewport: VIEW, strip: { width: 160, columns: 6 } });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { if (process.argv[2] === '--upgrade') upgrade(); await build(); }
