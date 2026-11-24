// Gear for the side-view figure (src/art/figure-side.js): armour and weapons as parts of their own,
// so one skeleton is dressed in different ways and a game swaps them at run time.
//
//   { component: 'figure', build: 'side', armor: 'plate', weapons: ['sword', 'spear', 'bow'] }
//
// Armour: helmet (on the head), cuirass (on the body, with a belt), pauldron, bracer, tasset and greave on
// each arm and leg, the far ones a tone darker. `armor` picks the look the figure wears; the other
// look is a state of every piece (`helmet_leather` or `helmet_plate`), so a game changes outfits by
// switching attachments, and hides a piece by clearing its slot.
// Weapons: one `weapon` part in the near hand, the fist closed over its grip. The first weapon is the
// part's own look, the others are its states (`weapon_spear`, `weapon_bow`); a clip switches to the
// weapon its stance needs, and an unarmed clip clears the slot.
// Pure: shapes only.

import { darken } from './style.js';

export const ARMOR_LOOKS = Object.freeze(['plate', 'leather']);
export const WEAPONS = Object.freeze(['sword', 'spear', 'bow', 'axe']);

const r2 = v => Math.round(v * 100) / 100;

/** The colours of a look: metal plates with a gold trim, or brown leather with darker straps. */
function lookColors(look, c, hex) {
  const metal = hex(c.metal ?? '#b9c2cd'), leather = hex(c.leather ?? '#8a5a3a'), trim = hex(c.trim ?? 'reward');
  return look === 'plate' ? { main: metal, line: darken(metal, 0.28), trim, belt: leather } : { main: leather, line: darken(leather, 0.3), trim: darken(leather, 0.25), belt: darken(leather, 0.2) };
}

/** A piece in both looks: the worn one drawn, the other a state. */
function piece(name, parent, box, center, draw, worn, c, hex, tone) {
  const other = ARMOR_LOOKS.find(l => l !== worn);
  const shapesOf = look => { const col = lookColors(look, c, hex); return draw(look, { main: tone(col.main), line: tone(col.line), trim: tone(col.trim), belt: tone(col.belt) }); };
  return { name, parent, box: [r2(box[0]), r2(box[1])], offset: [r2(center[0]), r2(center[1])],
    shapes: shapesOf(worn), states: { [other]: { box: [r2(box[0]), r2(box[1])], shapes: shapesOf(other) } } };
}

/**
 * Armour pieces, by where they go in the draw order.
 * @param {object} g  the figure's measures (figure-side.js)
 * @param {object} c  the component spec
 * @param {(v: any) => string} hex
 * @returns {{ arm: (s: string, tone: Function) => any[], leg: (s: string, tone: Function) => { thigh: any[], shin: any[] }, body: () => any[], head: () => any[] }}
 */
export function armourPieces(g, c, hex) {
  const worn = ARMOR_LOOKS.includes(c.armor) ? c.armor : c.armor ? 'plate' : null;
  const none = { arm: () => [], leg: () => ({ thigh: [], shin: [] }), body: () => [], head: () => [] };
  if (!worn) return none;
  const same = col => col;
  return {
    // A rounded shoulder plate over the top of the arm, and a bracer on the forearm.
    arm: (s, tone) => {
      const a = g.arms[s], W = g.armW * 1.8, H = g.armW * 1.45, bw = g.armW * 0.98, bh = g.forearm * 0.8;
      return [
        // Tapered with the forearm, from below the elbow to the wrist.
        piece(`bracer${s}`, `forearm${s}`, [bw, bh], [a.elbow[0], a.elbow[1] - g.forearm * 0.5], (look, k) => [
          { path: `M${r2(bw * 0.02)} ${r2(bh * 0.04)} L${r2(bw * 0.98)} ${r2(bh * 0.04)} L${r2(bw * 0.92)} ${r2(bh * 0.96)} L${r2(bw * 0.08)} ${r2(bh * 0.96)} Z`, fill: k.main, sw: 'regular', bbox: [0, 0, bw, bh] },
          { line: [r2(bw * 0.12), r2(bh * 0.3), r2(bw * 0.88), r2(bh * 0.3)], stroke: k.line, sw: 'thin' },
          { line: [r2(bw * 0.14), r2(bh * 0.72), r2(bw * 0.86), r2(bh * 0.72)], stroke: look === 'plate' ? k.trim : k.line, sw: 'thin' },
        ], worn, c, hex, tone),
        piece(`pauldron${s}`, `upperArm${s}`, [W, H], [a.shoulder[0] + g.armW * 0.05, a.shoulder[1] - g.armW * 0.12], (look, k) => [
          { path: `M${r2(W * 0.06)} ${r2(H * 0.78)} Q${r2(W * 0.04)} ${r2(H * 0.06)} ${r2(W * 0.5)} ${r2(H * 0.06)} Q${r2(W * 0.96)} ${r2(H * 0.06)} ${r2(W * 0.94)} ${r2(H * 0.78)} Q${r2(W * 0.5)} ${r2(H * 0.96)} ${r2(W * 0.06)} ${r2(H * 0.78)} Z`, fill: k.main, sw: 'regular', bbox: [0, 0, W, H] },
          { path: `M${r2(W * 0.12)} ${r2(H * 0.56)} Q${r2(W * 0.5)} ${r2(H * 0.74)} ${r2(W * 0.88)} ${r2(H * 0.56)}`, fill: 'none', stroke: look === 'plate' ? k.trim : k.line, sw: 'regular' },
        ], worn, c, hex, tone),
      ];
    },
    // A tasset over the top of the thigh, and a knee cop with a shin plate.
    leg: (s, tone) => {
      const l = g.legs[s], W = g.legW * 0.96, H = g.shin * 0.82 + g.legW * 0.4, tw = g.legW * 1.08, th = g.thigh * 0.62;
      return {
        thigh: [piece(`tasset${s}`, `thigh${s}`, [tw, th], [l.x, l.hip - th / 2 + g.legW * 0.05], (look, k) => [
          { path: `M${r2(tw * 0.04)} ${r2(th * 0.02)} L${r2(tw * 0.96)} ${r2(th * 0.02)} L${r2(tw * 0.92)} ${r2(th * 0.9)} Q${r2(tw * 0.5)} ${r2(th * 1)} ${r2(tw * 0.08)} ${r2(th * 0.9)} Z`, fill: k.main, sw: 'regular', bbox: [0, 0, tw, th] },
          { line: [r2(tw * 0.08), r2(th * 0.36), r2(tw * 0.92), r2(th * 0.36)], stroke: k.line, sw: 'thin' },
          { line: [r2(tw * 0.1), r2(th * 0.66), r2(tw * 0.9), r2(th * 0.66)], stroke: k.line, sw: 'thin' },
        ], worn, c, hex, tone)],
        shin: [piece(`greave${s}`, `shin${s}`, [W, H], [l.x, l.knee + g.legW * 0.4 - H / 2], (look, k) => [
          { rect: [r2(W * 0.08), r2(g.legW * 0.42), r2(W * 0.84), r2(H - g.legW * 0.42)], r: 'sm', fill: k.main, sw: 'regular' },
          { ellipse: [r2(W / 2), r2(g.legW * 0.42), r2(W * 0.46), r2(g.legW * 0.36)], fill: look === 'plate' ? k.main : k.line, sw: 'regular' },
          { line: [r2(W * 0.5), r2(g.legW * 0.9), r2(W * 0.5), r2(H * 0.9)], stroke: k.line, sw: 'thin' },
        ], worn, c, hex, tone)],
      };
    },
    // A cuirass over the shirt, belted at the waist.
    body: () => {
      // The body's own outline, a little wider all round, so no shirt shows at its edges.
      const B = g.torsoW, H = g.torsoH, m = 2.5 * g.H / 300, W = B + 2 * m, X = v => r2(m + v), x1 = B;
      return [piece('cuirass', 'body', [W, H], [0, g.torsoBottom + H / 2], (look, k) => [
        { path: `M${X(B * 0.12)} ${r2(H * 0.02)} L${X(x1 - B * 0.3)} ${r2(H * 0.02)} Q${X(x1 + m * 0.6)} ${r2(H * 0.07)} ${X(x1 + m * 0.6)} ${r2(H * 0.4)} L${X(x1 - B * 0.03)} ${r2(H * 0.82)} L${X(B * 0.03)} ${r2(H * 0.82)} L${X(-m * 0.6)} ${r2(H * 0.25)} Q${X(-m * 0.6)} ${r2(H * 0.02)} ${X(B * 0.12)} ${r2(H * 0.02)} Z`, fill: k.main, sw: 'regular', bbox: [0, 0, W, H] },
        look === 'plate'
          ? { path: `M${r2(W * 0.5)} ${r2(H * 0.12)} Q${r2(W * 0.86)} ${r2(H * 0.34)} ${r2(W * 0.8)} ${r2(H * 0.66)}`, fill: 'none', stroke: k.line, sw: 'thin' }
          : { path: `M${r2(W * 0.08)} ${r2(H * 0.34)} L${r2(W * 0.95)} ${r2(H * 0.34)} M${r2(W * 0.07)} ${r2(H * 0.54)} L${r2(W * 0.95)} ${r2(H * 0.54)}`, fill: 'none', stroke: k.line, sw: 'thin' },
        { rect: [r2(W * 0.03), r2(H * 0.72), r2(W * 0.94), r2(H * 0.12)], r: 'sm', fill: k.belt, sw: 'regular', shade: false },
        { rect: [r2(W * 0.74), r2(H * 0.7), r2(W * 0.14), r2(H * 0.16)], r: 'sm', fill: k.trim, sw: 'thin', shade: false },
      ], worn, c, hex, same)];
    },
    // A helmet over the skull, its rim at the brow and a ridge over the top.
    head: () => {
      const W = g.headW, H = g.headH, x = v => r2(v * W), y = v => r2(v * H);
      return [piece('helmet', 'head', [W, H], g.headCenter, (look, k) => [
        { path: `M${x(0.07)} ${y(0.7)} Q${x(0)} ${y(0)} ${x(0.52)} ${y(0)} Q${x(0.96)} ${y(0.02)} ${x(0.95)} ${y(0.44)} L${x(0.45)} ${y(0.44)} Q${x(0.34)} ${y(0.46)} ${x(0.3)} ${y(0.7)} Z`, fill: k.main, sw: 'regular', bbox: [0, 0, W, H * 0.7] },
        { path: `M${x(0.93)} ${y(0.4)} L${x(0.44)} ${y(0.4)}`, fill: 'none', stroke: look === 'plate' ? k.trim : k.line, sw: 'regular' },
        { path: `M${x(0.5)} ${y(0.02)} Q${x(0.7)} ${y(0.16)} ${x(0.68)} ${y(0.38)}`, fill: 'none', stroke: k.line, sw: 'thin' },
      ], worn, c, hex, same)];
    },
  };
}

/**
 * The weapon in the near hand: the first weapon drawn, the others as states. Every look shares one
 * box with the grip at the same point, so the part turns about the fist whatever it holds.
 * @param {object} g  the figure's measures
 * @param {object} c  the component spec
 * @param {(v: any) => string} hex
 * @returns {any | null}
 */
export function weaponPart(g, c, hex) {
  const list = (Array.isArray(c.weapons) ? c.weapons : typeof c.weapons === 'string' ? [c.weapons] : []).filter(w => WEAPONS.includes(w));
  if (!list.length) return null;
  const s = g.H / 300, W = 270 * s, H = 170 * s, gx = 105 * s, gy = 85 * s;
  const metal = hex(c.metal ?? '#b9c2cd'), blade = hex(c.blade ?? '#e3e8ee'), wood = hex(c.wood ?? '#9a6a3e'), grip = hex(c.leather ?? '#8a5a3a'), trim = hex(c.trim ?? 'reward');
  const X = v => r2(gx + v * s), Y = v => r2(gy + v * s);
  const draw = {
    // A straight sword pointing forward: pommel, grip, cross-guard, blade.
    sword: [
      { rect: [X(-11), Y(-3.5), r2(22 * s), r2(7 * s)], r: 'sm', fill: grip, sw: 'thin', shade: false },
      { path: `M${X(13)} ${Y(-5.5)} L${X(96)} ${Y(-4)} L${X(110)} ${Y(0)} L${X(96)} ${Y(4)} L${X(13)} ${Y(5.5)} Z`, fill: blade, sw: 'regular', bbox: [X(13), Y(-5.5), r2(97 * s), r2(11 * s)] },
      { line: [X(18), Y(0), X(92), Y(0)], stroke: darken(blade, 0.18), sw: 'thin' },
      { rect: [X(9), Y(-15), r2(5 * s), r2(30 * s)], r: 'sm', fill: trim, sw: 'thin' },
      { circle: [X(-14), Y(0), r2(5 * s)], fill: trim, sw: 'thin' },
    ],
    // A long spear held a third of the way along: a wooden shaft and a leaf-shaped head.
    spear: [
      { rect: [X(-100), Y(-2.6), r2(226 * s), r2(5.2 * s)], r: 'sm', fill: wood, sw: 'thin', shade: false },
      { path: `M${X(124)} ${Y(-6)} Q${X(140)} ${Y(-7)} ${X(162)} ${Y(0)} Q${X(140)} ${Y(7)} ${X(124)} ${Y(6)} Z`, fill: metal, sw: 'regular', bbox: [X(124), Y(-7), r2(38 * s), r2(14 * s)] },
      { rect: [X(118), Y(-4), r2(7 * s), r2(8 * s)], r: 'sm', fill: trim, sw: 'thin' },
    ],
    // A short bow, the grip in the fist, its string towards the archer.
    bow: [
      { line: [X(-22), Y(-76), X(-22), Y(76)], stroke: darken(blade, 0.1), sw: 'thin' },
      { path: `M${X(-22)} ${Y(-76)} Q${X(22)} ${Y(0)} ${X(-22)} ${Y(76)}`, fill: 'none', stroke: wood, sw: r2(6 * s) },
      { rect: [X(-3), Y(-7), r2(7 * s), r2(14 * s)], r: 'sm', fill: grip, sw: 'thin', shade: false },
    ],
    // A one-handed axe: a short haft and a bearded head.
    axe: [
      { rect: [X(-14), Y(-3), r2(84 * s), r2(6 * s)], r: 'sm', fill: wood, sw: 'thin', shade: false },
      { path: `M${X(54)} ${Y(-4)} L${X(54)} ${Y(-18)} Q${X(70)} ${Y(-24)} ${X(74)} ${Y(-12)} L${X(72)} ${Y(14)} Q${X(62)} ${Y(22)} ${X(58)} ${Y(8)} L${X(54)} ${Y(4)} Z`, fill: metal, sw: 'regular', bbox: [X(54), Y(-24), r2(20 * s), r2(46 * s)] },
    ],
  };
  const [first, ...rest] = list;
  return { name: 'weapon', parent: 'handFront', box: [r2(W), r2(H)],
    offset: [r2(g.grip[0] + W / 2 - gx), r2(g.grip[1] - H / 2 + gy)], pivot: [r2(gx - W / 2), r2(H / 2 - gy)],
    shapes: draw[first], ...(rest.length ? { states: Object.fromEntries(rest.map(w => [w, { box: [r2(W), r2(H)], shapes: draw[w] }])) } : {}) };
}
