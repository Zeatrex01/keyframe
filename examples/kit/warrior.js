// "Warrior": the side-view figure dressed for a fight (src/art/figure-gear.js), with a stance and
// an attack for each weapon it carries, an unarmed punch, a run and a jump. One skeleton: plate
// armour with leather as the other look of every piece, and a sword, spear, bow and axe in one
// weapon slot that each clip switches at its first key. Teaches weight shift with planted feet
// (write_animation `plant`), a stance per weapon, and a run with a moment in the air.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tool, fresh } from './studio.js';
import { finish } from './showcase.js';

const NAME = 'warrior';
const DIR = fileURLToPath(new URL(`../showcase/${NAME}/`, import.meta.url));
const VIEW = { x: -170, y: -10, width: 400, height: 300 };

// A key list [[time, value, curve?]]: the curve runs from that key to the next.
const K = (pairs, def = 'inOutSine') => pairs.map(([time, value, c], i) => ({ time, value, ...(i < pairs.length - 1 ? { curve: c ?? def } : {}) }));
const T = (tr, def = 'inOutSine') => tr.map(([time, x, y, c], i) => ({ time, x, y, ...(i < tr.length - 1 ? { curve: c ?? def } : {}) }));
const hold = (v, end) => K([[0, v], [end, v]]);
const weapon = name => ({ weapon: { attachment: [{ time: 0, name }] } });
// A fighting stance: front foot ahead, back foot behind, knees bent (the feet are planted on top).
const stance = (end, f = 1, body0 = 0) => ({
  thighFront: { rotate: hold(56, end) }, shinFront: { rotate: hold(-57, end) }, footFront: { rotate: hold(1 - body0, end) },
  thighBack: { rotate: hold(-14, end) }, shinBack: { rotate: hold(-42, end) }, footBack: { rotate: hold(56 - body0, end) },
});
export const clips = {
  idle_sword: { slots: weapon('weapon'), bones: { ...stance(1.6, 1, -6),
    body: { rotate: K([[0, -6], [0.8, -4], [1.6, -6]]), translate: T([[0, 0, -21], [0.8, -1, -24], [1.6, 0, -21]]) },
    head: { rotate: K([[0, 4], [0.9, 6], [1.6, 4]]) },
    upperArmFront: { rotate: K([[0, 34], [0.85, 30], [1.6, 34]]) }, forearmFront: { rotate: K([[0, 72], [0.9, 76], [1.6, 72]]) }, handFront: { rotate: K([[0, -46], [0.95, -52], [1.6, -46]]) },
    upperArmBack: { rotate: K([[0, 24], [0.8, 20], [1.6, 24]]) }, forearmBack: { rotate: K([[0, 70], [0.85, 74], [1.6, 70]]) },
  } },
  attack_sword: { slots: weapon('weapon'), bones: { ...stance(0.75, 1, -6),
    body: { rotate: K([[0, -6], [0.16, 12, 'inCubic'], [0.24, -18, 'outQuad'], [0.42, -16], [0.75, -6]]), translate: T([[0, 0, -21], [0.16, -8, -23, 'inCubic'], [0.24, 9, -27, 'outQuad'], [0.42, 8, -27], [0.75, 0, -21]]) },
    head: { rotate: K([[0, 4], [0.18, -4], [0.27, 10], [0.45, 8], [0.78, 4]]) },
    upperArmFront: { rotate: K([[0, 34], [0.16, 160, 'inCubic'], [0.24, 66, 'outQuad'], [0.28, 56], [0.44, 54], [0.75, 34]]) },
    forearmFront: { rotate: K([[0, 72], [0.16, 50, 'inCubic'], [0.24, -6, 'outQuad'], [0.28, -10], [0.44, -8], [0.75, 72]]) },
    handFront: { rotate: K([[0, -46], [0.16, 30, 'inCubic'], [0.24, -20, 'outQuad'], [0.28, -36], [0.44, -34], [0.75, -46]]) },
    upperArmBack: { rotate: K([[0, 24], [0.18, 60], [0.26, -40], [0.45, -34], [0.78, 24]]) }, forearmBack: { rotate: K([[0, 70], [0.18, 90], [0.26, 40], [0.45, 44], [0.78, 70]]) },
  } },
  idle_spear: { slots: weapon('weapon_spear'), bones: { ...stance(1.6, 1, -4),
    body: { rotate: K([[0, -4], [0.8, -2], [1.6, -4]]), translate: T([[0, -2, -19], [0.8, -3, -22], [1.6, -2, -19]]) },
    head: { rotate: K([[0, 2], [0.9, 4], [1.6, 2]]) },
    upperArmFront: { rotate: K([[0, 22], [0.85, 20], [1.6, 22]]) }, forearmFront: { rotate: K([[0, 72], [0.9, 74], [1.6, 72]]) }, handFront: { rotate: K([[0, -84], [0.95, -88], [1.6, -84]]) },
    upperArmBack: { rotate: K([[0, 6], [0.8, 4], [1.6, 6]]) }, forearmBack: { rotate: K([[0, 84], [0.85, 86], [1.6, 84]]) },
  } },
  attack_spear: { slots: weapon('weapon_spear'), bones: { ...stance(0.8, 1, -4),
    body: { rotate: K([[0, -4], [0.2, 6, 'inCubic'], [0.28, -14, 'outQuad'], [0.46, -12], [0.8, -4]]), translate: T([[0, -2, -19], [0.2, -12, -21, 'inCubic'], [0.28, 10, -25, 'outQuad'], [0.33, 11, -25], [0.48, 10, -25], [0.8, -2, -19]]) },
    head: { rotate: K([[0, 2], [0.22, -2], [0.31, 6], [0.48, 5], [0.82, 2]]) },
    upperArmFront: { rotate: K([[0, 22], [0.2, -4, 'inCubic'], [0.28, 78, 'outQuad'], [0.33, 80], [0.48, 79], [0.8, 22]]) },
    forearmFront: { rotate: K([[0, 72], [0.21, 96, 'inCubic'], [0.28, 12, 'outQuad'], [0.34, 10], [0.49, 11], [0.81, 72]]) },
    handFront: { rotate: K([[0, -84], [0.22, -86, 'inCubic'], [0.3, -88, 'outQuad'], [0.5, -88], [0.82, -84]]) },
    upperArmBack: { rotate: K([[0, 6], [0.22, -10], [0.3, 50], [0.48, 48], [0.82, 6]]) }, forearmBack: { rotate: K([[0, 84], [0.22, 96], [0.3, 40], [0.48, 42], [0.82, 84]]) },
  } },
  idle_bow: { slots: weapon('weapon_bow'), bones: { ...stance(1.6, 0.7, -2),
    body: { rotate: K([[0, -2], [0.8, 0], [1.6, -2]]), translate: T([[0, 0, -14], [0.8, 0, -16], [1.6, 0, -14]]) },
    head: { rotate: K([[0, 0], [0.9, 2], [1.6, 0]]) },
    upperArmFront: { rotate: K([[0, 24], [0.85, 22], [1.6, 24]]) }, forearmFront: { rotate: K([[0, 16], [0.9, 18], [1.6, 16]]) }, handFront: { rotate: K([[0, -36], [0.95, -38], [1.6, -36]]) },
    upperArmBack: { rotate: K([[0, 10], [0.8, 8], [1.6, 10]]) }, forearmBack: { rotate: K([[0, 30], [0.85, 34], [1.6, 30]]) },
  } },
  shoot_bow: { slots: weapon('weapon_bow'), bones: { ...stance(1.1, 0.7, -2),
    body: { rotate: K([[0, -2], [0.3, 4], [0.62, 6, 'stepped'], [0.64, 0, 'outQuad'], [0.8, 2], [1.1, -2]]), translate: T([[0, 0, -14], [0.3, -4, -17], [0.62, -6, -17], [0.66, -2, -17], [1.1, 0, -14]]) },
    head: { rotate: K([[0, 0], [0.3, -6], [0.62, -6], [0.7, -4], [1.1, 0]]) },
    upperArmFront: { rotate: K([[0, 24], [0.3, 92, 'outCubic'], [0.62, 92], [0.7, 96], [0.9, 92], [1.1, 24]]) },
    forearmFront: { rotate: K([[0, 16], [0.3, 0], [0.62, 0], [0.7, 2], [1.1, 16]]) },
    handFront: { rotate: K([[0, -36], [0.3, -92], [0.62, -92], [0.7, -96], [1.1, -36]]) },
    upperArmBack: { rotate: K([[0, 10], [0.3, 84, 'outCubic'], [0.6, 76], [0.64, 52, 'outQuad'], [0.82, 46], [1.1, 10]]) },
    forearmBack: { rotate: K([[0, 30], [0.3, 150, 'outCubic'], [0.6, 160], [0.64, 120, 'outQuad'], [0.82, 116], [1.1, 30]]) },
  } },
  punch: { slots: weapon(null), bones: { ...stance(0.7, 1, -4),
    body: { rotate: K([[0, -4], [0.18, 8, 'inCubic'], [0.25, -16, 'outQuad'], [0.42, -14], [0.7, -4]]), translate: T([[0, 0, -21], [0.18, -8, -23, 'inCubic'], [0.25, 9, -25, 'outQuad'], [0.42, 8, -25], [0.7, 0, -21]]) },
    head: { rotate: K([[0, 2], [0.2, -4], [0.28, 8], [0.45, 6], [0.72, 2]]) },
    upperArmFront: { rotate: K([[0, 30], [0.18, 16, 'inCubic'], [0.25, 92, 'outQuad'], [0.42, 89], [0.7, 30]]) },
    forearmFront: { rotate: K([[0, 100], [0.18, 116, 'inCubic'], [0.25, 0, 'outQuad'], [0.42, 4], [0.7, 100]]) },
    upperArmBack: { rotate: K([[0, 40], [0.2, 60], [0.28, -30], [0.44, -26], [0.72, 40]]) }, forearmBack: { rotate: K([[0, 100], [0.2, 110], [0.28, 110], [0.44, 104], [0.72, 100]]) },
  } },
  run: { slots: weapon('weapon'), bones: {
    body: { rotate: K([[0, -12], [0.15, -9], [0.3, -12], [0.45, -9], [0.6, -12]]), translate: T([[0, 0, -6], [0.08, 0, -12, 'outQuad'], [0.2, 0, 8, 'outSine'], [0.3, 0, -6, 'inQuad'], [0.38, 0, -12, 'outQuad'], [0.5, 0, 8, 'outSine'], [0.6, 0, -6]], 'inOutSine') },
    head: { rotate: K([[0, 8], [0.1, 10], [0.25, 6], [0.4, 10], [0.55, 6], [0.6, 8]]) },
    thighFront: { rotate: K([[0, 42], [0.15, 0], [0.3, -46], [0.45, 30], [0.6, 42]]) },
    shinFront: { rotate: K([[0, -12], [0.15, -40], [0.3, -24], [0.42, -110], [0.6, -12]]) },
    footFront: { rotate: K([[0, 8], [0.17, 0], [0.32, -28], [0.47, 10], [0.6, 8]]) },
    thighBack: { rotate: K([[0, -46], [0.15, 30], [0.3, 42], [0.45, 0], [0.6, -46]]) },
    shinBack: { rotate: K([[0, -24], [0.12, -110], [0.3, -12], [0.45, -40], [0.6, -24]]) },
    footBack: { rotate: K([[0, -28], [0.17, 10], [0.32, 8], [0.47, 0], [0.6, -28]]) },
    upperArmFront: { rotate: K([[0, -30], [0.33, 50], [0.6, -30]]) }, forearmFront: { rotate: K([[0, 80], [0.18, 64], [0.36, 90], [0.48, 70], [0.6, 80]]) }, handFront: { rotate: K([[0, -40], [0.33, -60], [0.6, -40]]) },
    upperArmBack: { rotate: K([[0, 50], [0.33, -34], [0.6, 50]]) }, forearmBack: { rotate: K([[0, 80], [0.18, 96], [0.36, 70], [0.48, 90], [0.6, 80]]) },
  } },
  jump: { slots: weapon('weapon'), bones: {
    body: { rotate: K([[0, 0], [0.15, -10], [0.22, -4, 'outQuad'], [0.45, 0], [0.7, -2, 'outQuad'], [0.78, -10], [1, 0]]), translate: T([[0, 0, 0], [0.15, 0, -24, 'inCubic'], [0.22, 0, 0, 'outQuad'], [0.45, 0, 74, 'inQuad'], [0.7, 0, 0, 'outQuad'], [0.78, 0, -24], [0.9, 0, -6], [1, 0, 0]]) },
    head: { rotate: K([[0, 0], [0.15, 8], [0.26, -6], [0.45, 2], [0.74, -4], [0.8, 8], [1, 0]]) },
    thighFront: { rotate: K([[0, 0], [0.15, 42, 'inCubic'], [0.22, 0, 'outQuad'], [0.3, -6], [0.45, 62], [0.62, 18], [0.7, 0, 'outQuad'], [0.78, 42], [0.9, 10], [1, 0]]) },
    shinFront: { rotate: K([[0, 0], [0.15, -87, 'inCubic'], [0.22, 0, 'outQuad'], [0.3, -10], [0.45, -105], [0.62, -24], [0.7, 0, 'outQuad'], [0.78, -87], [0.9, -24], [1, 0]]) },
    footFront: { rotate: K([[0, 0], [0.15, 45], [0.22, 0], [0.3, -30], [0.45, 20], [0.62, 0], [0.7, 0], [0.78, 45], [0.9, 14], [1, 0]]) },
    thighBack: { rotate: K([[0, 0], [0.15, 42, 'inCubic'], [0.22, 0, 'outQuad'], [0.32, -14], [0.47, 40], [0.64, 8], [0.7, 0, 'outQuad'], [0.78, 42], [0.9, 10], [1, 0]]) },
    shinBack: { rotate: K([[0, 0], [0.15, -87, 'inCubic'], [0.22, 0, 'outQuad'], [0.32, -20], [0.47, -90], [0.64, -14], [0.7, 0, 'outQuad'], [0.78, -87], [0.9, -24], [1, 0]]) },
    footBack: { rotate: K([[0, 0], [0.15, 45], [0.22, 0], [0.32, -36], [0.47, 30], [0.64, 0], [0.7, 0], [0.78, 45], [0.9, 14], [1, 0]]) },
    upperArmFront: { rotate: K([[0, 0], [0.16, -30, 'inCubic'], [0.3, 120, 'outQuad'], [0.45, 130], [0.65, 70], [0.74, 30], [0.8, -20], [1, 0]]) },
    forearmFront: { rotate: K([[0, 10], [0.16, 30], [0.26, 20], [0.45, 40], [0.65, 30], [0.8, 50], [1, 10]]) },
    upperArmBack: { rotate: K([[0, 0], [0.18, -36, 'inCubic'], [0.32, 110, 'outQuad'], [0.47, 120], [0.67, 60], [0.76, 20], [0.82, -24], [1, 0]]) },
    forearmBack: { rotate: K([[0, 10], [0.18, 30], [0.28, 20], [0.47, 40], [0.67, 30], [0.82, 50], [1, 10]]) },
  } },
};
const on = (f, b) => [{ bone: 'footFront', at: [f, 13.7] }, { bone: 'footBack', at: [b, 13.7] }];
const PLANT = { idle_sword: on(34, -40), attack_sword: on(34, -40), idle_spear: on(34, -40), attack_spear: on(34, -40), idle_bow: on(30, -36), shoot_bow: on(30, -36), punch: on(34, -40), jump: [{ bone: 'footFront', from: 0, to: 0.22 }, { bone: 'footBack', from: 0, to: 0.22 }, { bone: 'footFront', from: 0.7, to: 1 }, { bone: 'footBack', from: 0.7, to: 1 }] };

// Each body part eases in its own way, so the parts do not move to one rhythm: the hips smooth, the
// arms sharper, the head and the hands quick to settle.
const EASE = [[/^body$/, 'inOutSine'], [/^head$/, 'inOutQuad'], [/^upperArm/, 'inOutCubic'], [/^(forearm|hand)/, 'inOutQuad'], [/^(thigh|shin|foot)/, 'inOutSine']];
for (const clip of Object.values(clips)) {
  for (const [bone, timelines] of Object.entries(clip.bones)) {
    const ease = EASE.find(([re]) => re.test(bone))[1];
    for (const keys of Object.values(timelines)) for (const k of keys) if (k.curve === 'inOutSine') k.curve = ease;
  }
}
// Idles hold the head still for a moment: a beat for the eye to rest on.
for (const name of ['idle_sword', 'idle_spear', 'idle_bow']) {
  const head = clips[name].bones.head.rotate;
  head.splice(1, 0, { ...head[1], time: 0.5, curve: 'linear' }, { ...head[1], time: 0.7 });
  head.splice(3, 1);
}

/** @type {Record<string, { plant?: any[] }>} */
const EXTRA = Object.fromEntries(Object.entries(PLANT).map(([clip, plant]) => [clip, { plant }]));

export const brief = {
  name: NAME,
  title: 'Warrior',
  kind: 'Character',
  principles: 'character',
  subject: 'A platformer hero in profile, dressed for a fight: plate armour (leather as the other look of every piece) and a weapon slot that holds a sword, a spear, a bow or an axe.',
  intent: 'One dressable skeleton for a side-scroller: a guard stance and an attack for each weapon, a punch with no weapon, a run and a jump. The body drives every blow and the feet stay planted where they stand while the hips shift.',
  display: { width: 320, pixelsPerUnit: 1.2 },
  teaches: ['weight shift with planted feet', 'a stance per weapon', 'anticipation and impact', 'a run with a moment in the air'],
  preview: { clip: 'attack_sword', time: 0.3, viewport: VIEW },
  clips: [
    { name: 'idle_sword', seconds: 1.6, loop: true, does: 'guard stance, sword up and forward, breathing over planted feet' },
    { name: 'attack_sword', seconds: 0.78, loop: false, does: 'raise the sword overhead, cut down and forward driven by the hips, hold the hit, recover' },
    { name: 'idle_spear', seconds: 1.6, loop: true, does: 'spear level at the hip, both hands on it, breathing' },
    { name: 'attack_spear', seconds: 0.82, loop: false, does: 'draw back, thrust with the whole body, hold, recover' },
    { name: 'idle_bow', seconds: 1.6, loop: true, does: 'bow low in the near hand, relaxed' },
    { name: 'shoot_bow', seconds: 1.1, loop: false, does: 'raise the bow, draw to the cheek, hold, release with a recoil' },
    { name: 'punch', seconds: 0.72, loop: false, does: 'no weapon: guard, a short pull back, a straight punch from the hips, hold, recover' },
    { name: 'run', seconds: 0.6, loop: true, does: 'two strides with a moment in the air after each push-off, arms opposite the legs, sword in hand' },
    { name: 'jump', seconds: 1, loop: false, does: 'crouch with the feet planted, launch, tuck at the top, land into a planted crouch and stand' },
  ],
};

export async function build() {
  fresh(DIR, NAME);
  fs.mkdirSync(DIR, { recursive: true });
  for (const f of fs.readdirSync(DIR)) if (f !== 'README.md') fs.rmSync(path.join(DIR, f), { recursive: true, force: true });
  await tool(DIR, 'draw_rig', { name: NAME, parts: [{ name: NAME, component: { component: 'figure', build: 'side', h: 300, armor: 'plate', weapons: ['sword', 'spear', 'bow', 'axe'], shirt: 'secondary', pants: 'ink+35', shoes: '#5a3a26' }, at: [0, 0] }] });
  await finish(DIR, NAME, brief, clips, { viewport: VIEW, extra: EXTRA });
  // Sprite sheets for engines without a skeletal runtime, every clip framed alike.
  for (const c of brief.clips) await tool(DIR, 'export_art', { file: `${NAME}.parts.json`, kinds: ['clip'], animation: c.name, fps: 12, size: 256, loop: c.loop });
  const out = path.join(DIR, `${NAME}-export`);
  for (const f of fs.readdirSync(out)) if (!f.includes('@sheet.')) fs.rmSync(path.join(out, f), { recursive: true, force: true });
  for (const folder of ['.backup', '.keyframe']) fs.rmSync(path.join(DIR, folder), { recursive: true, force: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
