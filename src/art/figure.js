// A jointed figure: the starting body for a character, drawn in the style guide and split the way
// an animator needs it. Every limb is three parts (upper, lower, and a hand or a foot), each turning
// at its joint: the pivot sits where it meets the part it hangs from, and the ends overlap with
// round caps so a bent elbow or knee never shows a gap. The far arm and leg draw behind the body.
//
//   { component: 'figure', h: 360, build: 'upper', skin: 'skin', shirt: 'primary', hair: 'ink+25' }
//
// The default build is 'upper', a waist-up figure for gestures, talking and reactions: body (the
// torso with the neck, turning and breathing at the waist), head (turning at the neck), eyes (a
// part of their own, so they blink), hairBack (behind everything), and upperArm/forearm/hand on
// each side. Its origin is the middle of the waist. The 'kid' and 'adult' builds are full bodies
// standing on the ground (origin between the feet) and add thigh, shin and foot on each side.
// L is the figure's left (the viewer's right); it draws behind.
// Pure: shapes only, rendered by src/art/shapes.js.

/** Proportions as shares of the height: a kid has a big head and short limbs, an adult the reverse. */
const BUILDS = Object.freeze({
  kid: { head: 0.28, torso: 0.3, torsoW: 0.28, upperArm: 0.12, forearm: 0.11, hand: 0.075, limb: 0.08, thigh: 0.15, shin: 0.14, foot: 0.06, footL: 0.16 },
  adult: { head: 0.16, torso: 0.33, torsoW: 0.23, upperArm: 0.17, forearm: 0.15, hand: 0.055, limb: 0.06, thigh: 0.23, shin: 0.21, foot: 0.045, footL: 0.13 },
});
export const FIGURE_BUILDS = Object.freeze(['upper', ...Object.keys(BUILDS)]);
/** The waist-up figure: a torso that breathes, a head that turns, eyes that blink, and arms. */
export const UPPER_PARTS = Object.freeze(['hairBack', 'upperArmL', 'forearmL', 'handL', 'body', 'head', 'eyes', 'upperArmR', 'forearmR', 'handR']);
export const FIGURE_PARTS = Object.freeze(['thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'upperArmL', 'forearmL', 'handL', 'body', 'head',
  'upperArmR', 'forearmR', 'handR']);

import { colorOf, darken } from './style.js';

const r2 = v => Math.round(v * 100) / 100;

/**
 * A limb segment hanging down from its joint: a capsule, its pivot at the top end's centre.
 * @returns {object} a component sub-part
 */
function segment(name, parent, joint, len, w, color, sw, extra = []) {
  const box = [w, len + w];   // the caps overlap the joints above and below by half a width
  return {
    name, parent, box,
    offset: [r2(joint[0]), r2(joint[1] - len / 2)],
    pivot: [0, r2(len / 2)],
    shapes: [{ rect: [sw / 2, sw / 2, w - sw, len + w - sw], r: 'pill', fill: color, sw: 'regular' }, ...extra],
  };
}

/**
 * A tapered limb hanging from its joint: round at both ends, w1 wide at the joint and w2 at the
 * far end, its pivot at the centre of the joint's round end.
 */
function taper(name, parent, joint, len, w1, w2, color, sw) {
  const W = w1, H = len + w1 / 2 + w2 / 2, cx = W / 2, a = w1 / 2 - sw / 2, b = Math.max(1, w2 / 2 - sw / 2), top = w1 / 2, bot = w1 / 2 + len;
  return {
    name, parent, box: [r2(W), r2(H)],
    offset: [r2(joint[0]), r2(joint[1] + w1 / 2 - H / 2)],
    pivot: [0, r2(H / 2 - w1 / 2)],
    shapes: [{ path: `M${r2(cx - a)} ${r2(top)} L${r2(cx - b)} ${r2(bot)} A${r2(b)} ${r2(b)} 0 0 0 ${r2(cx + b)} ${r2(bot)} L${r2(cx + a)} ${r2(top)} A${r2(a)} ${r2(a)} 0 0 0 ${r2(cx - a)} ${r2(top)} Z`,
      fill: color, sw: 'regular', bbox: [0, 0, W, H] }],
  };
}

/** A hand turning at the wrist: a mitten palm, a thumb on the side towards the body, a knuckle line. */
function hand(name, parent, wrist, d, s, skin, style) {
  const side = s === 'L' ? 1 : -1, W = d * 1.25, H = d * 1.35;
  const crease = darken(colorOf(style, skin), 0.22);
  return { name, parent, box: [r2(W), r2(H)], offset: [r2(wrist[0]), r2(wrist[1] - H / 2 + d * 0.12)], pivot: [0, r2(H / 2 - d * 0.12)],
    shapes: [
      { ellipse: [r2(W / 2 - side * d * 0.4), r2(H * 0.42), r2(d * 0.15), r2(d * 0.28)], fill: skin, sw: 'thin' },
      { rect: [r2(W / 2 - d * 0.4), 0, r2(d * 0.8), r2(H - d * 0.04)], r: r2(d * 0.38), fill: skin, sw: 'regular' },
      { path: `M${r2(W / 2 - d * 0.2)} ${r2(H * 0.62)} L${r2(W / 2 - d * 0.2)} ${r2(H * 0.86)} M${r2(W / 2 + d * 0.06)} ${r2(H * 0.62)} L${r2(W / 2 + d * 0.06)} ${r2(H * 0.88)}`, fill: 'none', stroke: crease, sw: 'thin', opacity: 0.6 },
    ] };
}

/** A waist-up figure (see the header). */
function upperParts(c, style) {
  const H = Number.isFinite(c.h) && c.h >= 60 && c.h <= 4000 ? c.h : 360;
  const k = v => r2(v * H);
  const skin = c.skin ?? (style.palette.skin ? 'skin' : 'accent+55');
  const shirt = c.shirt ?? 'primary', hair = c.hair ?? 'ink+25';
  const sw = style.stroke.color === 'none' ? 0 : style.stroke.regular;
  const shade = (col, t) => darken(colorOf(style, col), t);   // a tone of a colour that may itself be a tone
  const torsoH = k(0.52), shoulderW = k(0.5), waistW = k(0.36), neckH = k(0.065), neckW = k(0.095), slope = k(0.05);
  const hw = k(0.27), hh = k(0.32), headY = torsoH + neckH * 0.5 + hh * 0.46;
  const sleeve = k(0.115), elbowW = k(0.085), wristW = k(0.07), handD = k(0.085);
  const upperArm = k(0.25), forearm = k(0.23);
  // The shoulder joint sits inside the round of the shoulder, so a raised arm turns about it.
  const shoulderX = shoulderW / 2 - sleeve * 0.42, shoulderY = torsoH - slope - sleeve * 0.3;

  /** @type {any[]} */
  const parts = [];
  const side = s => (s === 'L' ? 1 : -1);
  const arm = s => {
    const x = side(s) * shoulderX, out = side(s) * k(0.02);
    parts.push(taper(`upperArm${s}`, 'body', [x, shoulderY], upperArm, sleeve, elbowW, shirt, sw));
    const elbow = [x + out, shoulderY - upperArm];
    parts.push(taper(`forearm${s}`, `upperArm${s}`, elbow, forearm, elbowW * 0.94, wristW, c.sleeves === 'long' ? shirt : skin, sw));
    parts.push(hand(`hand${s}`, `forearm${s}`, [elbow[0], elbow[1] - forearm], handD, s, skin, style));
  };

  // The hair behind the head, falling to the nape.
  const bw = hw * 1.1, bh = hh * 0.86;
  parts.push({ name: 'hairBack', parent: 'head', box: [r2(bw), r2(bh)], offset: [0, r2(headY - hh * 0.04)], shapes: [
    { rect: [sw / 2, sw / 2, r2(bw - sw), r2(bh - sw)], r: r2(bw * 0.45), fill: shade(hair, 0.12), sw: 'regular', shade: false }] });
  arm('L');
  // The body: the neck, then the torso: shoulders sloping from the neck, rounded at the arms, and
  // narrower at the waist, with a round neckline. It turns and breathes at the waist.
  const bodyH = torsoH + neckH, W = shoulderW, x0 = sw / 2, x1 = W - sw / 2, top = neckH, bot = bodyH;
  const inset = (shoulderW - waistW) / 2, nx = neckW * 0.75, rs = sleeve * 0.55;
  parts.push({ name: 'body', owner: true, box: [r2(W), r2(bodyH)], offset: [0, r2(bodyH / 2)], pivot: [0, r2(-bodyH / 2)], shapes: [
    { rect: [r2(W / 2 - neckW / 2), 0, r2(neckW), r2(neckH + slope)], r: 'sm', fill: shade(skin, 0.1), sw: 'regular', shade: false },
    { path: `M${r2(W / 2 - nx)} ${r2(top)} L${r2(W / 2 + nx)} ${r2(top)} Q${r2(x1 - rs)} ${r2(top + slope * 0.4)} ${r2(x1 - rs * 0.35)} ${r2(top + slope)} Q${r2(x1)} ${r2(top + slope + rs * 0.4)} ${r2(x1)} ${r2(top + slope + rs)} L${r2(x1 - inset)} ${r2(bot)} L${r2(x0 + inset)} ${r2(bot)} L${r2(x0)} ${r2(top + slope + rs)} Q${r2(x0)} ${r2(top + slope + rs * 0.4)} ${r2(x0 + rs * 0.35)} ${r2(top + slope)} Q${r2(x0 + rs)} ${r2(top + slope * 0.4)} ${r2(W / 2 - nx)} ${r2(top)} Z`,
      fill: shirt, sw: 'regular', bbox: [0, top, W, torsoH] },
    { path: `M${r2(W / 2 - nx)} ${r2(top)} Q${r2(W / 2)} ${r2(top + neckH * 0.9)} ${r2(W / 2 + nx)} ${r2(top)} Z`, fill: shade(skin, 0.1), sw: 'thin', shade: false },
    { path: `M${r2(W / 2)} ${r2(top + torsoH * 0.35)} L${r2(W / 2)} ${r2(top + torsoH * 0.62)}`, fill: 'none', stroke: shade(shirt, 0.18), sw: 'thin', opacity: 0.5 },
  ] });
  // The head: ears, the face, the hair over the forehead, brows, a nose, cheeks and a mouth.
  const HW = hw * 1.14, ox = (HW - hw) / 2;
  const hx = v => r2(ox + v * hw), hy = v => r2(v * hh);
  parts.push({ name: 'head', parent: 'body', box: [r2(HW), r2(hh)], offset: [0, r2(headY)], pivot: [0, r2(-hh * 0.4)], shapes: [
    { ellipse: [hx(0.02), hy(0.56), r2(hw * 0.075), r2(hh * 0.085)], fill: skin, sw: 'thin' },
    { ellipse: [hx(0.98), hy(0.56), r2(hw * 0.075), r2(hh * 0.085)], fill: skin, sw: 'thin' },
    { path: `M${hx(0.03)} ${hy(0.48)} Q${hx(0.02)} ${hy(0.86)} ${hx(0.5)} ${hy(0.99)} Q${hx(0.98)} ${hy(0.86)} ${hx(0.97)} ${hy(0.48)} Q${hx(0.96)} ${hy(0.02)} ${hx(0.5)} ${hy(0.02)} Q${hx(0.04)} ${hy(0.02)} ${hx(0.03)} ${hy(0.48)} Z`,
      fill: skin, sw: 'regular', bbox: [ox, 0, hw, hh] },
    { path: `M${hx(0.01)} ${hy(0.5)} Q${hx(-0.01)} ${hy(0.0)} ${hx(0.5)} ${hy(0.0)} Q${hx(1.01)} ${hy(0.0)} ${hx(0.99)} ${hy(0.5)} Q${hx(0.92)} ${hy(0.3)} ${hx(0.7)} ${hy(0.26)} Q${hx(0.46)} ${hy(0.36)} ${hx(0.28)} ${hy(0.27)} Q${hx(0.08)} ${hy(0.3)} ${hx(0.01)} ${hy(0.5)} Z`,
      fill: hair, sw: 'regular', bbox: [ox, 0, hw, hh * 0.5] },
    { path: `M${hx(0.25)} ${hy(0.43)} Q${hx(0.33)} ${hy(0.4)} ${hx(0.41)} ${hy(0.43)}`, fill: 'none', stroke: shade(hair, 0.15), sw: 'regular' },
    { path: `M${hx(0.59)} ${hy(0.43)} Q${hx(0.67)} ${hy(0.4)} ${hx(0.75)} ${hy(0.43)}`, fill: 'none', stroke: shade(hair, 0.15), sw: 'regular' },
    { path: `M${hx(0.5)} ${hy(0.6)} Q${hx(0.47)} ${hy(0.68)} ${hx(0.52)} ${hy(0.69)}`, fill: 'none', stroke: shade(skin, 0.28), sw: 'thin' },
    { ellipse: [hx(0.24), hy(0.7), r2(hw * 0.075), r2(hh * 0.035)], fill: 'danger+50', stroke: false, shade: false, opacity: 0.5 },
    { ellipse: [hx(0.76), hy(0.7), r2(hw * 0.075), r2(hh * 0.035)], fill: 'danger+50', stroke: false, shade: false, opacity: 0.5 },
    { path: `M${hx(0.42)} ${hy(0.78)} Q${hx(0.5)} ${hy(0.84)} ${hx(0.58)} ${hy(0.78)}`, fill: 'none', stroke: 'danger-35', sw: 'regular' },
  ] });
  // The eyes, a part of their own so they blink (scale y) and look (translate) without the head.
  const ew = hw * 0.6, eh = hh * 0.16;
  parts.push({ name: 'eyes', parent: 'head', box: [r2(ew), r2(eh)], offset: [0, r2(headY + hh * 0.5 - hh * 0.54)], shapes: [
    { ellipse: [r2(ew * 0.2), r2(eh / 2), r2(hw * 0.058), r2(eh * 0.46)], fill: 'ink+10', stroke: false, shade: false },
    { ellipse: [r2(ew * 0.8), r2(eh / 2), r2(hw * 0.058), r2(eh * 0.46)], fill: 'ink+10', stroke: false, shade: false },
    { circle: [r2(ew * 0.2 + hw * 0.02), r2(eh * 0.33), r2(hw * 0.02)], fill: '#ffffff', stroke: false, shade: false },
    { circle: [r2(ew * 0.8 + hw * 0.02), r2(eh * 0.33), r2(hw * 0.02)], fill: '#ffffff', stroke: false, shade: false },
  ] });
  arm('R');
  return parts;
}

/**
 * The parts of a figure.
 * @param {object} c  { h, build, skin, shirt, pants, hair, shoes, sleeves, prefix }
 * @param {object} style  a validated style guide
 */
export function figureParts(c, style) {
  const pre = typeof c.prefix === 'string' && /^[A-Za-z][A-Za-z0-9]{0,15}$/.test(c.prefix) ? `${c.prefix}_` : '';
  const parts = BUILDS[c.build] ? fullParts(c, style) : upperParts(c, style);
  // A prefix names a second figure in the same drawing (kid_ body, kid_ head...).
  return pre ? parts.map(p => ({ ...p, name: pre + p.name, ...(p.parent ? { parent: pre + p.parent } : {}) })) : parts;
}

/** A full figure standing on the ground (the kid and adult builds). */
function fullParts(c, style) {
  const H = Number.isFinite(c.h) && c.h >= 60 && c.h <= 4000 ? c.h : 320;
  const B = BUILDS[c.build];
  const skin = c.skin ?? (style.palette.skin ? 'skin' : 'accent+55');
  const shirt = c.shirt ?? 'primary', pants = c.pants ?? 'secondary', hair = c.hair ?? 'ink+25', shoes = c.shoes ?? 'ink+15';
  const sw = style.stroke.color === 'none' ? 0 : style.stroke.regular;
  const k = v => r2(v * H);
  const limbW = k(B.limb), legW = k(B.limb * 1.2);

  // Heights from the ground up.
  const footH = k(B.foot), shin = k(B.shin), thigh = k(B.thigh);
  const hip = footH + shin + thigh;                       // the hip joints
  const torsoH = k(B.torso), torsoW = k(B.torsoW);
  const torsoBottom = hip - legW * 0.4, torsoTop = torsoBottom + torsoH;
  const headD = k(B.head), headY = torsoTop + headD * 0.42; // the head overlaps the collar a little
  const shoulderY = torsoTop - limbW * 0.6, shoulderX = torsoW / 2 - limbW * 0.35;
  const hipX = torsoW / 2 - legW * 0.6;

  /** @type {any[]} */
  const parts = [];
  const side = s => (s === 'L' ? 1 : -1);   // the figure's left is the viewer's right (+x)

  const leg = s => {
    const x = side(s) * hipX;
    parts.push(segment(`thigh${s}`, 'body', [x, hip], thigh, legW, pants, sw));
    parts.push(segment(`shin${s}`, `thigh${s}`, [x, hip - thigh], shin, legW * 0.9, c.build === 'adult' ? pants : skin, sw));
    const fw = k(B.footL), fh = footH + legW * 0.2;
    parts.push({ name: `foot${s}`, parent: `shin${s}`, box: [fw, fh], offset: [r2(x + side(s) * fw * 0.18), r2(fh / 2)], pivot: [r2(-side(s) * fw * 0.18), r2(fh / 2 - legW * 0.35)],
      shapes: [{ rect: [sw / 2, sw / 2, fw - sw, fh - sw], r: 'pill', fill: shoes, sw: 'regular', shine: true }] });
  };
  const arm = s => {
    const x = side(s) * shoulderX;
    const out = side(s) * limbW * 0.25;     // the arms hang a little away from the body
    parts.push(segment(`upperArm${s}`, 'body', [x, shoulderY], k(B.upperArm), limbW, shirt, sw));
    const elbow = [x + out, shoulderY - k(B.upperArm)];
    parts.push(segment(`forearm${s}`, `upperArm${s}`, elbow, k(B.forearm), limbW * 0.9, skin, sw));
    const hd = k(B.hand) + sw, wrist = [elbow[0], elbow[1] - k(B.forearm)];
    // A hand: a palm with a thumb, turning at the wrist.
    parts.push({ name: `hand${s}`, parent: `forearm${s}`, box: [hd * 1.3, hd * 1.25], offset: [r2(wrist[0]), r2(wrist[1] - hd * 0.32)], pivot: [0, r2(hd * 0.32)],
      shapes: [
        { circle: [r2(hd * 0.65), r2(hd * 0.68), r2(hd / 2 - sw / 2)], fill: skin, sw: 'regular' },
        { ellipse: [r2(hd * 0.65 - side(s) * hd * 0.38), r2(hd * 0.5), r2(hd * 0.17), r2(hd * 0.24)], fill: skin, sw: 'thin' },
      ] });
  };

  // Back to front: both legs under the body (the pants cover the hips), the far arm, the body and
  // head, the near arm.
  leg('L'); leg('R'); arm('L');
  // The body: a shirt over the top of the pants, the owner of the figure.
  parts.push({ name: 'body', owner: true, box: [torsoW, torsoH], offset: [0, r2(torsoBottom + torsoH / 2)], pivot: [0, r2(-torsoH / 2 + legW * 0.4)], shapes: [
    { rect: [sw / 2, sw / 2, torsoW - sw, torsoH - sw], r: 'lg', fill: shirt, sw: 'regular', shine: true },
    { rect: [sw / 2, torsoH * 0.72, torsoW - sw, torsoH * 0.28 - sw / 2], r: 'md', fill: pants, sw: 'regular', shade: false },
  ] });
  // The head: a face (eyes, a smile, cheeks) under a cap of hair, turning at the neck.
  const hw = headD * 0.94, hh = headD;
  parts.push({ name: 'head', parent: 'body', box: [hw, hh], offset: [0, r2(headY)], pivot: [0, r2(-hh * 0.42)], shapes: [
    { ellipse: [r2(hw / 2), r2(hh / 2), r2(hw / 2 - sw / 2), r2(hh / 2 - sw / 2)], fill: skin, sw: 'regular' },
    { path: `M${r2(sw)} ${r2(hh * 0.5)} Q${r2(sw)} ${r2(sw)} ${r2(hw / 2)} ${r2(sw)} Q${r2(hw - sw)} ${r2(sw)} ${r2(hw - sw)} ${r2(hh * 0.5)} Q${r2(hw * 0.7)} ${r2(hh * 0.26)} ${r2(hw * 0.32)} ${r2(hh * 0.3)} Q${r2(hw * 0.12)} ${r2(hh * 0.34)} ${r2(sw)} ${r2(hh * 0.5)} Z`, fill: hair, sw: 'regular', bbox: [0, 0, hw, hh * 0.5] },
    { ellipse: [r2(hw * 0.35), r2(hh * 0.58), r2(hw * 0.055), r2(hh * 0.075)], fill: 'ink', stroke: false, shade: false },
    { ellipse: [r2(hw * 0.65), r2(hh * 0.58), r2(hw * 0.055), r2(hh * 0.075)], fill: 'ink', stroke: false, shade: false },
    { ellipse: [r2(hw * 0.24), r2(hh * 0.72), r2(hw * 0.07), r2(hh * 0.04)], fill: 'danger+45', stroke: false, shade: false, opacity: 0.7 },
    { ellipse: [r2(hw * 0.76), r2(hh * 0.72), r2(hw * 0.07), r2(hh * 0.04)], fill: 'danger+45', stroke: false, shade: false, opacity: 0.7 },
    { path: `M${r2(hw * 0.4)} ${r2(hh * 0.76)} Q${r2(hw * 0.5)} ${r2(hh * 0.84)} ${r2(hw * 0.6)} ${r2(hh * 0.76)}`, fill: 'none', stroke: 'ink', sw: 'thin' },
  ] });
  arm('R');
  return parts;
}
