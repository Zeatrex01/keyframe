// "Warrior": the side-view figure dressed for a fight (src/art/figure-gear.js), with a stance and
// an attack for each weapon it carries, an unarmed one-two (also as an upper-body layer to play over
// the run and the jump), a run and a jump. One skeleton: plate
// armour with leather as the other look of every piece, and a sword, spear, bow and axe in one
// weapon slot that each stance and attack switches at its first key (the run and the jump leave it
// alone, so they keep whatever weapon the game gave the character). Teaches weight shift with planted feet
// (write_animation `plant`), a stance per weapon, and a run with a moment in the air.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tool, fresh } from './studio.js';
import { finish } from './showcase.js';
import { godotScene } from '../../src/engine/godot.js';

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
  idle_sword: { slots: weapon('weapon'), bones: { ...stance(1.6, 1, -1),
    body: { rotate: K([[0, -1], [0.8, 1], [1.6, -1]]), translate: T([[0, 0, -21], [0.8, -1, -24], [1.6, 0, -21]]) },
    head: { rotate: K([[0, 0], [0.9, 2], [1.6, 0]]) },
    upperArmFront: { rotate: K([[0, 34], [0.85, 30], [1.6, 34]]) }, forearmFront: { rotate: K([[0, 72], [0.9, 76], [1.6, 72]]) }, handFront: { rotate: K([[0, -46], [0.95, -52], [1.6, -46]]) },
    upperArmBack: { rotate: K([[0, 24], [0.8, 20], [1.6, 24]]) }, forearmBack: { rotate: K([[0, 70], [0.85, 74], [1.6, 70]]) },
  } },
  attack_sword: { slots: weapon('weapon'), bones: { ...stance(0.75, 1, -1),
    body: { rotate: K([[0, -1], [0.16, 12, 'inCubic'], [0.24, -18, 'outQuad'], [0.42, -16], [0.75, -1]]), translate: T([[0, 0, -21], [0.16, -8, -23, 'inCubic'], [0.24, 9, -27, 'outQuad'], [0.42, 8, -27], [0.75, 0, -21]]) },
    head: { rotate: K([[0, 4], [0.18, -4], [0.27, 10], [0.45, 8], [0.78, 4]]) },
    upperArmFront: { rotate: K([[0, 34], [0.16, 160, 'inCubic'], [0.24, 66, 'outQuad'], [0.28, 56], [0.44, 54], [0.75, 34]]) },
    forearmFront: { rotate: K([[0, 72], [0.16, 50, 'inCubic'], [0.24, -6, 'outQuad'], [0.28, -10], [0.44, -8], [0.75, 72]]) },
    handFront: { rotate: K([[0, -46], [0.16, 30, 'inCubic'], [0.24, -20, 'outQuad'], [0.28, -36], [0.44, -34], [0.75, -46]]) },
    upperArmBack: { rotate: K([[0, 24], [0.18, 60], [0.26, -40], [0.45, -34], [0.78, 24]]) }, forearmBack: { rotate: K([[0, 70], [0.18, 90], [0.26, 40], [0.45, 44], [0.78, 70]]) },
  } },
  idle_spear: { slots: weapon('weapon_spear'), bones: { ...stance(1.6, 1, -1),
    body: { rotate: K([[0, -1], [0.8, 1], [1.6, -1]]), translate: T([[0, -2, -19], [0.8, -3, -22], [1.6, -2, -19]]) },
    head: { rotate: K([[0, 0], [0.9, 2], [1.6, 0]]) },
    upperArmFront: { rotate: K([[0, 22], [0.85, 20], [1.6, 22]]) }, forearmFront: { rotate: K([[0, 72], [0.9, 74], [1.6, 72]]) }, handFront: { rotate: K([[0, -84], [0.95, -88], [1.6, -84]]) },
    upperArmBack: { rotate: K([[0, 6], [0.8, 4], [1.6, 6]]) }, forearmBack: { rotate: K([[0, 84], [0.85, 86], [1.6, 84]]) },
  } },
  attack_spear: { slots: weapon('weapon_spear'), bones: { ...stance(0.8, 1, -1),
    body: { rotate: K([[0, -1], [0.2, 6, 'inCubic'], [0.28, -14, 'outQuad'], [0.46, -12], [0.8, -1]]), translate: T([[0, -2, -19], [0.2, -12, -21, 'inCubic'], [0.28, 10, -25, 'outQuad'], [0.33, 11, -25], [0.48, 10, -25], [0.8, -2, -19]]) },
    head: { rotate: K([[0, 2], [0.22, -2], [0.31, 6], [0.48, 5], [0.82, 2]]) },
    upperArmFront: { rotate: K([[0, 22], [0.2, -4, 'inCubic'], [0.28, 78, 'outQuad'], [0.33, 80], [0.48, 79], [0.8, 22]]) },
    forearmFront: { rotate: K([[0, 72], [0.21, 96, 'inCubic'], [0.28, 12, 'outQuad'], [0.34, 10], [0.49, 11], [0.81, 72]]) },
    handFront: { rotate: K([[0, -84], [0.22, -86, 'inCubic'], [0.3, -88, 'outQuad'], [0.5, -88], [0.82, -84]]) },
    upperArmBack: { rotate: K([[0, 6], [0.22, -10], [0.3, 50], [0.48, 48], [0.82, 6]]) }, forearmBack: { rotate: K([[0, 84], [0.22, 96], [0.3, 40], [0.48, 42], [0.82, 84]]) },
  } },
  idle_bow: { slots: weapon('weapon_bow'), bones: { ...stance(1.6, 0.7, -1),
    body: { rotate: K([[0, -1], [0.8, 1], [1.6, -1]]), translate: T([[0, 0, -14], [0.8, 0, -16], [1.6, 0, -14]]) },
    head: { rotate: K([[0, 0], [0.9, 2], [1.6, 0]]) },
    upperArmFront: { rotate: K([[0, 24], [0.85, 22], [1.6, 24]]) }, forearmFront: { rotate: K([[0, 16], [0.9, 18], [1.6, 16]]) }, handFront: { rotate: K([[0, -36], [0.95, -38], [1.6, -36]]) },
    upperArmBack: { rotate: K([[0, 10], [0.8, 8], [1.6, 10]]) }, forearmBack: { rotate: K([[0, 30], [0.85, 34], [1.6, 30]]) },
  } },
  shoot_bow: { slots: weapon('weapon_bow'), bones: { ...stance(1.1, 0.7, -1),
    body: { rotate: K([[0, -1], [0.3, 4], [0.62, 6, 'stepped'], [0.64, 0, 'outQuad'], [0.8, 2], [1.1, -1]]), translate: T([[0, 0, -14], [0.3, -4, -17], [0.62, -6, -17], [0.66, -2, -17], [1.1, 0, -14]]) },
    head: { rotate: K([[0, 0], [0.3, -6], [0.62, -6], [0.7, -4], [1.1, 0]]) },
    upperArmFront: { rotate: K([[0, 24], [0.3, 92, 'outCubic'], [0.62, 92], [0.7, 96], [0.9, 92], [1.1, 24]]) },
    forearmFront: { rotate: K([[0, 16], [0.3, 0], [0.62, 0], [0.7, 2], [1.1, 16]]) },
    handFront: { rotate: K([[0, -36], [0.3, -92], [0.62, -92], [0.7, -96], [1.1, -36]]) },
    // The drawing arm: elbow up and back at the nock (where the plant holds the hand), a short
    // recoil back past the cheek on the release, then down.
    upperArmBack: { rotate: K([[0, 10], [0.3, -118.7, 'outCubic'], [0.62, -118.7, 'outQuad'], [0.68, -132], [0.84, -110], [1.1, 10]]) },
    forearmBack: { rotate: K([[0, 30], [0.3, 165.1, 'outCubic'], [0.62, 165.1, 'outQuad'], [0.68, 150], [0.84, 120], [1.1, 30]]) },
    handBack: { rotate: K([[0, 0], [0.3, -172.4, 'outCubic'], [0.62, -172.4], [0.84, -120], [1.1, 0]]) },
  } },
  idle_unarmed: { slots: weapon(null), bones: { ...stance(1.6, 1, -1),
    body: { rotate: K([[0, -1], [0.8, 1], [1.6, -1]]), translate: T([[0, 0, -21], [0.8, -1, -24], [1.6, 0, -21]]) },
    head: { rotate: K([[0, 2], [0.9, 4], [1.6, 2]]) },
    upperArmFront: { rotate: K([[0, 30], [0.85, 26], [1.6, 30]]) }, forearmFront: { rotate: K([[0, 100], [0.9, 106], [1.6, 100]]) },
    upperArmBack: { rotate: K([[0, 40], [0.8, 36], [1.6, 40]]) }, forearmBack: { rotate: K([[0, 100], [0.85, 106], [1.6, 100]]) },
  } },
  // A one-two: the jab with the near fist, the cross with the far one, each from the guard back to
  // it, so a game chains them (punch, punch_cross, punch...). Short enough to keep the game moving.
  punch: { slots: weapon(null), bones: { ...stance(0.45, 1, -1),
    body: { rotate: K([[0, -1], [0.08, 3, 'inCubic'], [0.14, -10, 'outQuad'], [0.24, -9], [0.45, -1]]), translate: T([[0, 0, -21], [0.08, -3, -22, 'inCubic'], [0.14, 6, -23, 'outQuad'], [0.24, 5, -23], [0.45, 0, -21]]) },
    head: { rotate: K([[0, 2], [0.1, 0], [0.16, 6], [0.26, 5], [0.45, 2]]) },
    upperArmFront: { rotate: K([[0, 30], [0.08, 22, 'inCubic'], [0.14, 92, 'outQuad'], [0.24, 89], [0.45, 30]]) },
    forearmFront: { rotate: K([[0, 100], [0.08, 112, 'inCubic'], [0.14, 0, 'outQuad'], [0.25, 4], [0.45, 100]]) },
    upperArmBack: { rotate: K([[0, 40], [0.09, 44], [0.16, 34], [0.26, 36], [0.45, 40]]) }, forearmBack: { rotate: K([[0, 100], [0.1, 104], [0.17, 108], [0.27, 106], [0.45, 100]]) },
  } },
  punch_cross: { slots: weapon(null), bones: { ...stance(0.5, 1, -1),
    body: { rotate: K([[0, -1], [0.1, 4, 'inCubic'], [0.17, -14, 'outQuad'], [0.28, -12], [0.5, -1]]), translate: T([[0, 0, -21], [0.1, -4, -22, 'inCubic'], [0.17, 9, -25, 'outQuad'], [0.28, 8, -25], [0.5, 0, -21]]) },
    head: { rotate: K([[0, 2], [0.12, -1], [0.19, 7], [0.3, 6], [0.5, 2]]) },
    upperArmBack: { rotate: K([[0, 40], [0.1, 52, 'inCubic'], [0.17, 92, 'outQuad'], [0.28, 89], [0.5, 40]]) },
    forearmBack: { rotate: K([[0, 100], [0.1, 112, 'inCubic'], [0.17, 0, 'outQuad'], [0.29, 4], [0.5, 100]]) },
    upperArmFront: { rotate: K([[0, 30], [0.11, 26], [0.18, 12], [0.29, 14], [0.5, 30]]) }, forearmFront: { rotate: K([[0, 100], [0.12, 104], [0.19, 122], [0.3, 120], [0.5, 100]]) },
  } },
  run: { bones: {
    // Contact, down, passing, push-off in each step, the down quick after the contact and the
    // flight the longest: the hips lowest just after contact and highest in the air, the support
    // foot travelling back at an even speed so the stride holds at game speed. Every key is passed
    // through ("smooth"), never stopped at; the hips lead, the knees and feet trail the thighs, and
    // the arms and head trail the legs.
    body: { rotate: K([[0.0, -5.0], [0.033, -7.0], [0.116, -5.5], [0.216, -2.7], [0.283, -4.2], [0.333, -7.0], [0.416, -5.5], [0.516, -2.7], [0.583, -4.2], [0.6, -5.0]], 'smooth'), translate: T([[0.0, 0, -6.0], [0.033, 0, -10.0], [0.116, 0, -9.1], [0.216, 0, 1.3], [0.283, 0, -3.6], [0.333, 0, -10.0], [0.416, 0, -9.1], [0.516, 0, 1.3], [0.583, 0, -3.6], [0.6, 0, -6.0]], 'smooth') },
    head: { rotate: K([[0, 5.3], [0.067, 2.6], [0.167, 5.6], [0.217, 7.4], [0.317, 4.4], [0.367, 2.6], [0.467, 5.6], [0.517, 7.4], [0.6, 5.3]], 'smooth') },
    thighFront: { rotate: K([[0.0, 26.4], [0.05, 28.5], [0.133, 9.8], [0.233, -19.1], [0.3, -38.0], [0.35, -20.0], [0.433, 18.0], [0.533, 40.0], [0.6, 26.4]], 'smooth') }, shinFront: { rotate: K([[0.0, -26.5], [0.017, -32.6], [0.067, -55.0], [0.15, -34.5], [0.25, -5.1], [0.317, -60.3], [0.367, -107.2], [0.45, -106.2], [0.55, -58.7], [0.6, -26.5]], 'smooth') }, footFront: { rotate: K([[0.0, 5.1], [0.033, 23.0], [0.083, 36.9], [0.166, 26.8], [0.266, -11.9], [0.333, -14.1], [0.383, -5.6], [0.466, 3.9], [0.566, 6.4], [0.6, 5.1]], 'smooth') },
    thighBack: { rotate: K([[0.0, -38.0], [0.05, -20.0], [0.133, 18.0], [0.233, 40.0], [0.3, 26.4], [0.35, 28.5], [0.433, 9.8], [0.533, -19.1], [0.6, -38.0]], 'smooth') }, shinBack: { rotate: K([[0.0, -40.0], [0.017, -60.3], [0.067, -107.2], [0.15, -106.2], [0.25, -58.7], [0.317, -32.6], [0.367, -55.0], [0.45, -34.5], [0.55, -5.1], [0.6, -40.0]], 'smooth') }, footBack: { rotate: K([[0.0, -20.0], [0.033, -14.1], [0.083, -5.6], [0.166, 3.9], [0.266, 6.4], [0.333, 23.0], [0.383, 36.9], [0.466, 26.8], [0.566, -11.9], [0.6, -20.0]], 'smooth') },
    upperArmFront: { rotate: K([[0, -25.8], [0.1, -19.0], [0.2, 16.7], [0.3, 45.8], [0.4, 39.0], [0.5, 3.3], [0.6, -25.8]], 'smooth') }, forearmFront: { rotate: K([[0, 69.3], [0.117, 70.4], [0.217, 79.8], [0.317, 87.4], [0.417, 85.6], [0.517, 76.2], [0.6, 69.3]], 'smooth') }, handFront: { rotate: K([[0, -45.0], [0.083, -42.1], [0.183, -44.1], [0.283, -50.0], [0.383, -53.9], [0.483, -51.9], [0.6, -45.0]], 'smooth') },
    upperArmBack: { rotate: K([[0, 45.8], [0.1, 39.0], [0.2, 3.3], [0.3, -25.8], [0.4, -19.0], [0.5, 16.7], [0.6, 45.8]], 'smooth') }, forearmBack: { rotate: K([[0, 90.7], [0.117, 89.6], [0.217, 80.2], [0.317, 72.6], [0.417, 74.4], [0.517, 83.8], [0.6, 90.7]], 'smooth') },
  } },
  jump: { bones: {
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
// Two-handed holds: the back hand rides the spear shaft behind the front fist, and on the bow it
// holds the arrow's nock through the draw (`plant` with `on`: the point travels with the weapon).
const SHAFT = { bone: 'handBack', on: 'weapon', at: [-60, 0] }, NOCK = { bone: 'handBack', on: 'weapon', at: [-76, -2] };
const PLANT = { idle_sword: on(34, -40), attack_sword: on(34, -40), idle_spear: [...on(34, -40), SHAFT], attack_spear: [...on(34, -40), SHAFT], idle_bow: on(30, -36), shoot_bow: [...on(30, -36), { ...NOCK, from: 0.3, to: 0.62 }], punch: on(34, -40), punch_cross: on(34, -40), jump: [{ bone: 'footFront', from: 0, to: 0.22 }, { bone: 'footBack', from: 0, to: 0.22 }, { bone: 'footFront', from: 0.7, to: 1 }, { bone: 'footBack', from: 0.7, to: 1 }] };

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
for (const name of ['idle_sword', 'idle_spear', 'idle_bow', 'idle_unarmed']) {
  const head = clips[name].bones.head.rotate;
  head.splice(1, 0, { ...head[1], time: 0.5, curve: 'linear' }, { ...head[1], time: 0.7 });
  head.splice(3, 1);
}

// The axe fights like the sword: the same stance and cut, the axe in the hand.
clips.idle_axe = { ...structuredClone(clips.idle_sword), slots: weapon('weapon_axe') };
clips.attack_axe = { ...structuredClone(clips.attack_sword), slots: weapon('weapon_axe') };
Object.assign(PLANT, { idle_axe: PLANT.idle_sword, attack_axe: PLANT.attack_sword, idle_unarmed: PLANT.punch });

// The punches again for the upper body alone (arms and head, nothing below the shoulders), to play
// over the run or the jump on a second layer: the legs keep running while the fists fly.
for (const name of ['punch', 'punch_cross']) {
  const upper = Object.fromEntries(Object.entries(clips[name].bones).filter(([bone]) => /^(head|upperArm|forearm|hand)/.test(bone)));
  clips[`${name}_upper`] = { bones: structuredClone(upper) };
}

// The arrow shows on the bow from the nock to the release (the game sends its own arrow flying);
// every other clip puts it away, so no clip inherits a nocked arrow from an interrupted shot.
for (const [name, clip] of Object.entries(clips)) {
  clip.slots = { ...clip.slots, arrow: { attachment: name === 'shoot_bow' ? [{ time: 0, name: null }, { time: 0.3, name: 'arrow' }, { time: 0.62, name: null }] : [{ time: 0, name: null }] } };
}
// The string comes back with the hand: the drawn bow from the nock to the release.
clips.shoot_bow.slots.weapon = { attachment: [{ time: 0, name: 'weapon_bow' }, { time: 0.3, name: 'weapon_drawn' }, { time: 0.62, name: 'weapon_bow' }] };

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
    { name: 'idle_axe', seconds: 1.6, loop: true, does: 'the sword stance with the axe in hand' },
    { name: 'attack_axe', seconds: 0.78, loop: false, does: 'the overhead cut with the axe' },
    { name: 'idle_unarmed', seconds: 1.6, loop: true, does: 'no weapon: fists up in guard, breathing over planted feet' },
    { name: 'punch', seconds: 0.45, loop: false, does: 'no weapon: a jab with the near fist from the guard, a short pull back, hold, back to the guard' },
    { name: 'punch_cross', seconds: 0.5, loop: false, does: 'no weapon: the cross with the far fist, turning the hips into it; chains after the jab for a one-two' },
    { name: 'punch_upper', seconds: 0.45, loop: false, does: 'the jab for the arms and head only, to play over the run or the jump on a second layer' },
    { name: 'punch_cross_upper', seconds: 0.5, loop: false, does: 'the cross for the arms and head only, to play over the run or the jump' },
    { name: 'run', seconds: 0.6, loop: true, does: 'two strides with a moment in the air after each push-off, arms opposite the legs; keeps whatever weapon the game gave it' },
    { name: 'jump', seconds: 1, loop: false, does: 'crouch with the feet planted, launch, tuck at the top, land into a planted crouch and stand; keeps the weapon in hand' },
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
  // Ready for Godot: copy godot/ into a project with the Keyframe add-on and drop warrior.kfscene in.
  const godot = path.join(DIR, 'godot');
  fs.mkdirSync(godot, { recursive: true });
  const scene = godotScene(JSON.parse(fs.readFileSync(path.join(DIR, `${NAME}_v2.json`), 'utf8')), { atlasText: fs.readFileSync(path.join(DIR, `${NAME}_v2.atlas`), 'utf8'), name: NAME });
  fs.writeFileSync(path.join(godot, `${NAME}.kfscene`), JSON.stringify(scene) + '\n');
  for (const page of scene.pages) fs.copyFileSync(path.join(DIR, page.name), path.join(godot, page.name));
  for (const folder of ['.backup', '.keyframe']) fs.rmSync(path.join(DIR, folder), { recursive: true, force: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
