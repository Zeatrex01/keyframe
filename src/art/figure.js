// A jointed figure: the starting body for a character, drawn in the style guide and split the way
// an animator needs it. Every limb is three parts (upper, lower, and a hand or a foot), each turning
// at its joint: the pivot sits where it meets the part it hangs from, and the ends overlap with
// round caps so a bent elbow or knee never shows a gap. The far arm and leg draw behind the body.
//
//   { component: 'figure', h: 320, build: 'kid', skin: 'skin', shirt: 'primary', pants: 'secondary', hair: 'ink+25' }
//
// Parts (y up, the origin between the feet on the ground): body, head, upperArmL/R, forearmL/R,
// handL/R, thighL/R, shinL/R, footL/R. L is the figure's left (the viewer's right); it draws behind.
// Pure: shapes only, rendered by src/art/shapes.js.

/** Proportions as shares of the height: a kid has a big head and short limbs, an adult the reverse. */
const BUILDS = Object.freeze({
  kid: { head: 0.28, torso: 0.3, torsoW: 0.28, upperArm: 0.12, forearm: 0.11, hand: 0.075, limb: 0.08, thigh: 0.15, shin: 0.14, foot: 0.06, footL: 0.16 },
  adult: { head: 0.16, torso: 0.33, torsoW: 0.23, upperArm: 0.17, forearm: 0.15, hand: 0.055, limb: 0.06, thigh: 0.23, shin: 0.21, foot: 0.045, footL: 0.13 },
});
export const FIGURE_BUILDS = Object.freeze(Object.keys(BUILDS));
export const FIGURE_PARTS = Object.freeze(['thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'upperArmL', 'forearmL', 'handL', 'body', 'head',
  'upperArmR', 'forearmR', 'handR']);

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
 * The parts of a figure.
 * @param {object} c  { h, build, skin, shirt, pants, hair, shoes, face }
 * @param {object} style  a validated style guide
 */
export function figureParts(c, style) {
  const H = Number.isFinite(c.h) && c.h >= 60 && c.h <= 4000 ? c.h : 320;
  const B = BUILDS[c.build] ?? BUILDS.kid;
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
  // A prefix names a second figure in the same drawing (kid_ body, kid_ head...).
  const pre = typeof c.prefix === 'string' && /^[A-Za-z][A-Za-z0-9]{0,15}$/.test(c.prefix) ? `${c.prefix}_` : '';
  return pre ? parts.map(p => ({ ...p, name: pre + p.name, ...(p.parent ? { parent: pre + p.parent } : {}) })) : parts;
}
