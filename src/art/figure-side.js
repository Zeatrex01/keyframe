// A side-view figure for platformers and side-scrollers: a character in profile, facing right,
// jointed for running, jumping and attacking. Flip it with a negative x scale on the root to face
// left. The far arm and leg draw behind the body in a darker tone, the near ones in front.
//
//   { component: 'figure', build: 'side', h: 300, skin: 'skin', shirt: 'primary', pants: 'secondary', hair: 'ink+25' }
//
// Dressed for a fight with `armor: 'plate' | 'leather'` and `weapons: ['sword', 'spear', 'bow', 'axe']`
// (src/art/figure-gear.js): armour pieces and a weapon are parts of their own, so a game swaps them.
//
// Parts (y up, the origin on the ground under the hips): body (the torso, turning at the hips: it
// carries everything, so moving it moves the whole character), head (turning at the neck), eye,
// and upperArm/forearm/hand and thigh/shin/foot, each with Back (far) and Front (near).
// Pure: shapes only, rendered by src/art/shapes.js.

import { colorOf, darken } from './style.js';
import { armourPieces, weaponPart, arrowPart } from './figure-gear.js';
import { wardrobeParts } from './figure-wardrobe.js';

export const SIDE_PARTS = Object.freeze(['upperArmBack', 'forearmBack', 'handBack', 'thighBack', 'shinBack', 'footBack', 'body', 'head', 'eye',
  'thighFront', 'shinFront', 'footFront', 'upperArmFront', 'forearmFront', 'handFront']);

const r2 = v => Math.round(v * 100) / 100;

/** A tapered limb hanging from its joint (round at both ends), its pivot at the joint. */
function limb(name, parent, joint, len, w1, w2, fill, sw) {
  const W = Math.max(w1, w2), H = len + w1 / 2 + w2 / 2, cx = W / 2, a = w1 / 2 - sw / 2, b = Math.max(1, w2 / 2 - sw / 2), top = w1 / 2, bot = w1 / 2 + len;
  return {
    name, parent, box: [r2(W), r2(H)],
    offset: [r2(joint[0]), r2(joint[1] + w1 / 2 - H / 2)],
    pivot: [0, r2(H / 2 - w1 / 2)],
    shapes: [{ path: `M${r2(cx - a)} ${r2(top)} L${r2(cx - b)} ${r2(bot)} A${r2(b)} ${r2(b)} 0 0 0 ${r2(cx + b)} ${r2(bot)} L${r2(cx + a)} ${r2(top)} A${r2(a)} ${r2(a)} 0 0 0 ${r2(cx - a)} ${r2(top)} Z`,
      fill, sw: 'regular', bbox: [0, 0, W, H] }],
  };
}

/**
 * The parts of a side-view figure.
 * @param {object} c  { h, skin, shirt, pants, hair, shoes, armor, weapons, metal, leather, trim, wood, blade }
 * @param {object} style  a validated style guide
 */
export function sideParts(c, style) {
  const H = Number.isFinite(c.h) && c.h >= 60 && c.h <= 4000 ? c.h : 300;
  const k = v => r2(v * H);
  const hex = v => colorOf(style, v);
  const skin = hex(c.skin ?? (style.palette.skin ? 'skin' : 'accent+55'));
  // Bare (src/art/figure-wardrobe.js): a bald body in one plain base layer, everything else worn over it.
  const bare = c.bare === true, base = hex(c.base ?? '#c9c3b9');
  const shirt = bare ? base : hex(c.shirt ?? 'primary'), pants = bare ? base : hex(c.pants ?? 'secondary'), hair = hex(c.hair ?? 'ink+25'), shoes = bare ? base : hex(c.shoes ?? 'ink+20');
  const back = col => darken(col, 0.16);   // the far side, a step into the shade
  const sw = style.stroke.color === 'none' ? 0 : style.stroke.regular;

  // Heights from the ground up.
  // `bulk` (0.75-1.4) makes the build slimmer or broader: the torso, arms and legs widen, the bones stay.
  const bulk = Number.isFinite(c.bulk) ? Math.min(1.4, Math.max(0.75, c.bulk)) : 1;
  const footH = k(0.05), shin = k(0.14), thigh = k(0.15), legW = r2(k(0.085) * bulk);
  const hip = footH + shin + thigh;
  const torsoH = k(0.29), torsoW = r2(k(0.19) * bulk);
  const torsoBottom = hip - legW * 0.5, torsoTop = torsoBottom + torsoH;
  const headH = k(0.3), headW = k(0.28), headY = torsoTop + headH * 0.42;
  const armW = r2(k(0.07) * bulk), upperArm = k(0.13), forearm = k(0.12), handD = k(0.065);
  const shoulder = [k(0.0), torsoTop - armW * 0.7];

  // The measures gear is fitted to (figure-gear.js).
  const armAt = s => { const sx = shoulder[0] + (s === 'Back' ? k(0.015) : -k(0.01)); return { shoulder: [sx, shoulder[1]], elbow: [sx, shoulder[1] - upperArm] }; };
  const legAt = s => { const x = s === 'Back' ? k(0.02) : -k(0.01); return { x, hip, knee: hip - thigh }; };
  const d0 = handD + sw, wristFront = [armAt('Front').elbow[0], armAt('Front').elbow[1] - forearm];
  const g = { H, armW, forearm, legW, shin, thigh, torsoW, torsoH, torsoBottom, headW, headH, headCenter: [k(0.02), headY],
    arms: { Back: armAt('Back'), Front: armAt('Front') }, legs: { Back: legAt('Back'), Front: legAt('Front') },
    grip: [wristFront[0] + d0 * 0.02, wristFront[1] - d0 * 0.32] };
  const gear = armourPieces(g, bare ? { ...c, armor: null } : c, hex);
  const fw0 = k(0.13), fh0 = footH + legW * 0.25;
  const wardrobe = bare ? wardrobeParts({ ...g, sw, upperArm,
    limbs: Object.fromEntries(['Back', 'Front'].flatMap(s => {
      const a = armAt(s), l = legAt(s);
      return [[`upperArm${s}`, [a.shoulder, upperArm, armW, armW * 0.85]], [`forearm${s}`, [a.elbow, forearm, armW * 0.82, armW * 0.72]],
        [`thigh${s}`, [[l.x, hip], thigh, legW, legW * 0.85]], [`shin${s}`, [[l.x, hip - thigh], shin, legW * 0.82, legW * 0.7]]];
    })),
    feet: Object.fromEntries(['Back', 'Front'].map(s => [s, { x: legAt(s).x, fw: fw0, fh: fh0, heel: fw0 * 0.3, legW }])),
    torso: { W: torsoW, H: torsoH, bottom: torsoBottom, legW }, head: { hw: headW, hh: headH, offset: [k(0.02), r2(headY)] } }, c, hex) : null;
  const weapon = weaponPart(g, c, hex), arrow = arrowPart(g, c, hex);

  /** @type {any[]} */
  const parts = [];
  const arm = (s, tone) => {
    const sx = armAt(s).shoulder[0];
    parts.push(limb(`upperArm${s}`, 'body', [sx, shoulder[1]], upperArm, armW, armW * 0.85, tone(shirt), sw));
    const worn = wardrobe?.arm(s, tone);
    if (worn) parts.push(...worn.upper);
    const elbow = [sx, shoulder[1] - upperArm];
    parts.push(limb(`forearm${s}`, `upperArm${s}`, elbow, forearm, armW * 0.82, armW * 0.72, tone(bare ? base : skin), sw));
    if (worn) parts.push(...worn.lower);
    const [bracer, pauldron] = gear.arm(s, tone);
    if (bracer) parts.push(bracer);
    // The weapon goes under the near fist, so the fingers close over its grip.
    if (s === 'Front' && weapon) parts.push(weapon);
    if (s === 'Front' && arrow) parts.push(arrow);
    const d = handD + sw, wrist = [elbow[0], elbow[1] - forearm];
    // A fist, the thumb on top towards the front.
    parts.push({ name: `hand${s}`, parent: `forearm${s}`, box: [r2(d * 1.2), r2(d * 1.2)], offset: [r2(wrist[0]), r2(wrist[1] - d * 0.3)], pivot: [0, r2(d * 0.3)], shapes: [
      { circle: [r2(d * 0.6), r2(d * 0.62), r2(d / 2 - sw / 2)], fill: tone(skin), sw: 'regular' },
      { ellipse: [r2(d * 0.86), r2(d * 0.46), r2(d * 0.15), r2(d * 0.2)], fill: tone(skin), sw: 'thin' },
    ] });
    if (pauldron) parts.push(pauldron);
    if (worn) parts.push(...worn.top);
  };
  const leg = (s, tone) => {
    const x = s === 'Back' ? k(0.02) : -k(0.01);
    parts.push(limb(`thigh${s}`, 'body', [x, hip], thigh, legW, legW * 0.85, tone(pants), sw));
    const worn = gear.leg(s, tone), dressed = wardrobe?.leg(s, tone);
    parts.push(...worn.thigh);
    if (dressed) parts.push(...dressed.thigh);
    parts.push(limb(`shin${s}`, `thigh${s}`, [x, hip - thigh], shin, legW * 0.82, legW * 0.7, tone(pants), sw));
    parts.push(...worn.shin);
    if (dressed) parts.push(...dressed.shin);
    // A shoe pointing forward (+x), turning at the ankle over its heel.
    const fw = k(0.13), fh = footH + legW * 0.25, heel = fw * 0.3;
    parts.push({ name: `foot${s}`, parent: `shin${s}`, box: [r2(fw), r2(fh)], offset: [r2(x - heel + fw / 2), r2(fh / 2)], pivot: [r2(heel - fw / 2), r2(fh / 2 - legW * 0.3)], shapes: [
      { path: `M${r2(sw / 2)} ${r2(fh - sw / 2)} L${r2(sw / 2)} ${r2(fh * 0.3)} Q${r2(sw / 2)} ${r2(sw / 2)} ${r2(fh * 0.5)} ${r2(sw / 2)} L${r2(fw * 0.55)} ${r2(sw / 2)} Q${r2(fw - sw / 2)} ${r2(fh * 0.25)} ${r2(fw - sw / 2)} ${r2(fh * 0.75)} L${r2(fw - sw / 2)} ${r2(fh - sw / 2)} Z`,
        fill: tone(shoes), sw: 'regular', bbox: [0, 0, fw, fh] }] });
    if (dressed) parts.push(...dressed.foot);
  };
  const same = col => col;

  // Back to front: the far arm and leg, the body and head, the near leg and arm.
  arm('Back', back); leg('Back', back);
  // The body: a shirt with the chest to the front, the top of the trousers at the hips.
  const W = torsoW, Ht = torsoH, x0 = sw / 2, x1 = W - sw / 2;
  parts.push({ name: 'body', owner: true, box: [r2(W), r2(Ht)], offset: [0, r2(torsoBottom + Ht / 2)], pivot: [0, r2(-Ht / 2 + legW * 0.5)], shapes: [
    { path: `M${r2(x0 + W * 0.12)} ${r2(sw / 2)} L${r2(x1 - W * 0.3)} ${r2(sw / 2)} Q${r2(x1)} ${r2(Ht * 0.06)} ${r2(x1)} ${r2(Ht * 0.4)} L${r2(x1 - W * 0.04)} ${r2(Ht - sw / 2)} L${r2(x0 + W * 0.04)} ${r2(Ht - sw / 2)} L${r2(x0)} ${r2(Ht * 0.25)} Q${r2(x0)} ${r2(sw / 2)} ${r2(x0 + W * 0.12)} ${r2(sw / 2)} Z`,
      fill: shirt, sw: 'regular', bbox: [0, 0, W, Ht] },
    { rect: [r2(x0 + W * 0.03), r2(Ht * 0.76), r2(W * 0.94 - sw), r2(Ht * 0.24 - sw / 2)], r: 'sm', fill: pants, sw: 'regular', shade: false },
  ] });
  if (bare) parts[parts.length - 1].shapes.pop();   // no trousers top on the bare body
  parts.push(...gear.body());
  if (wardrobe) parts.push(...wardrobe.body());
  // The head in profile, facing right: the skull, the face to the front with a nose and a chin, an
  // ear in the middle, hair over the top and the back, a brow and a mouth.
  const hw = headW, hh = headH;
  const hx = v => r2(v * hw), hy = v => r2(v * hh);
  parts.push({ name: 'head', parent: 'body', box: [r2(hw), r2(hh)], offset: [k(0.02), r2(headY)], pivot: [k(-0.03), r2(-hh * 0.42)], shapes: [
    { path: `M${hx(0.12)} ${hy(0.5)} Q${hx(0.08)} ${hy(0.04)} ${hx(0.52)} ${hy(0.04)} Q${hx(0.88)} ${hy(0.05)} ${hx(0.9)} ${hy(0.4)} L${hx(0.98)} ${hy(0.58)} Q${hx(0.99)} ${hy(0.63)} ${hx(0.92)} ${hy(0.64)} Q${hx(0.92)} ${hy(0.9)} ${hx(0.66)} ${hy(0.95)} Q${hx(0.4)} ${hy(0.98)} ${hx(0.28)} ${hy(0.86)} Q${hx(0.14)} ${hy(0.74)} ${hx(0.12)} ${hy(0.5)} Z`,
      fill: skin, sw: 'regular', bbox: [0, 0, hw, hh] },
    { path: `M${hx(0.1)} ${hy(0.62)} Q${hx(0.02)} ${hy(0.02)} ${hx(0.55)} ${hy(0.02)} Q${hx(0.9)} ${hy(0.04)} ${hx(0.9)} ${hy(0.3)} Q${hx(0.72)} ${hy(0.24)} ${hx(0.6)} ${hy(0.32)} Q${hx(0.5)} ${hy(0.4)} ${hx(0.42)} ${hy(0.36)} Q${hx(0.3)} ${hy(0.48)} ${hx(0.24)} ${hy(0.7)} Q${hx(0.14)} ${hy(0.72)} ${hx(0.1)} ${hy(0.62)} Z`,
      fill: hair, sw: 'regular', bbox: [0, 0, hw * 0.9, hh * 0.72] },
    { ellipse: [hx(0.4), hy(0.56), r2(hw * 0.07), r2(hh * 0.09)], fill: skin, sw: 'thin' },
    { path: `M${hx(0.66)} ${hy(0.42)} Q${hx(0.74)} ${hy(0.39)} ${hx(0.82)} ${hy(0.42)}`, fill: 'none', stroke: darken(hair, 0.15), sw: 'regular' },
    { ellipse: [hx(0.7), hy(0.74), r2(hw * 0.07), r2(hh * 0.035)], fill: 'danger+50', stroke: false, shade: false, opacity: 0.5 },
    { path: `M${hx(0.8)} ${hy(0.8)} Q${hx(0.85)} ${hy(0.82)} ${hx(0.89)} ${hy(0.79)}`, fill: 'none', stroke: 'danger-35', sw: 'regular' },
  ] });
  // The eye, a part of its own so it blinks (scale y) without the head.
  const ed = hw * 0.11;
  parts.push({ name: 'eye', parent: 'head', box: [r2(ed * 1.2), r2(ed * 1.6)], offset: [r2(k(0.02) - hw / 2 + hw * 0.76), r2(headY + hh / 2 - hh * 0.54)], shapes: [
    { ellipse: [r2(ed * 0.6), r2(ed * 0.8), r2(ed * 0.45), r2(ed * 0.72)], fill: 'ink+10', stroke: false, shade: false },
    { circle: [r2(ed * 0.78), r2(ed * 0.5), r2(ed * 0.16)], fill: '#ffffff', stroke: false, shade: false },
  ] });
  if (bare) { const head = parts.find(p => p.name === 'head'); head.shapes.splice(1, 1); }   // bald: the hair is worn
  parts.push(...gear.head());
  if (wardrobe) parts.push(...wardrobe.head());
  leg('Front', same); arm('Front', same);
  return parts;
}
