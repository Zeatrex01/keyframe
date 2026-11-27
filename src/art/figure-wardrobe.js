// A wardrobe for the bare side-view figure (src/art/figure-side.js with `bare: true`): the figure is a
// bald body in a plain base layer, and every garment and armour piece is a part of its own on the
// bone it covers, so a game puts each one on or takes it off by itself.
//
//   { component: 'figure', build: 'side', bare: true, wear: ['hair', 'shirt', 'trousers', 'boots', 'cuirass'] }
//
// Items (`wear` lists the ones worn; the rest are drawn too, hidden, for the game to show):
//   cloth   hair (`hairStyle`: short, spiky, long, swept, bun, afro, horseshoe; bald = no hair worn), shirt (body and both sleeves), trousers (waist and both legs), boots
//   head    headband, beanie, cap, hat, glasses, shades, moustache, beard, mask (src/art/figure-headwear.js)
//   armour  helmet, cuirass, pauldrons (shoulder plate and upper-arm tube), vambraces, cuisses, greaves, sabatons
// Every piece covers the whole of its body part, a little wider all round, so nothing under it shows
// at its edges. Armour hides the cloth on its own part (a worn cuirass hides the shirt and waist, a
// helmet the hair), so nothing shows through a gap either.
// Pure: shapes only.

import { darken, lighten } from './style.js';
import { form, formPart, shade, lame, rivets, shadowOf, footPath, solePath } from './figure-form.js';
import { HEADWEAR, HEADWEAR_HIDES, headwearParts } from './figure-headwear.js';

export { HEADWEAR };
/** How far a head piece's box reaches past the head, as a fraction of the head, on every side. */
const PAD = 0.3;

export const CLOTH = Object.freeze(['hair', 'shirt', 'trousers', 'boots']);
export const ARMOUR = Object.freeze(['helmet', 'cuirass', 'pauldrons', 'vambraces', 'cuisses', 'greaves', 'sabatons']);
/** Which armour hides which cloth, by the part they share. */
const HIDES = Object.freeze({ ...HEADWEAR_HIDES, helmet: ['hair', ...HEADWEAR_HIDES.helmet], cuirass: ['shirt', 'trousers'], pauldrons: ['shirt'], vambraces: ['shirt'], cuisses: ['trousers'], greaves: ['trousers'], sabatons: ['boots'] });

const r2 = v => Math.round(v * 100) / 100;
const flat = { stroke: false, shade: false };

/**
 * A piece over a limb: the limb's own form (src/art/figure-form.js) grown by `m`, shaded as its
 * material, its pivot at the joint. `extra(f)` adds detail inside the form.
 * @param {string} name @param {string} parent @param {any[]} limb  [joint, length, width, end width, profile, from]
 * @param {number} m @param {string} fill @param {string} mat @param {(f: any) => any[]} [extra]
 */
const piece = (name, parent, limb, m, fill, mat, extra = () => []) => formPart(name, parent, limb, m, f => [...shade(f, fill, mat), ...extra(f)]);

/** The lower part of a limb from `from` (0-1) down. */
const lower = (limb, from) => [limb[0], limb[1], limb[2], limb[3], limb[4], from];

/** The torso's outline in a W x H box (the chest to the front, +x); the bare torso is a form instead. */
export function torsoPath(W, H, sw) {
  const x0 = sw / 2, x1 = W - sw / 2;
  return `M${r2(x0 + W * 0.12)} ${r2(sw / 2)} L${r2(x1 - W * 0.3)} ${r2(sw / 2)} Q${r2(x1)} ${r2(H * 0.06)} ${r2(x1)} ${r2(H * 0.4)} L${r2(x1 - W * 0.04)} ${r2(H - sw / 2)} L${r2(x0 + W * 0.04)} ${r2(H - sw / 2)} L${r2(x0)} ${r2(H * 0.25)} Q${r2(x0)} ${r2(sw / 2)} ${r2(x0 + W * 0.12)} ${r2(sw / 2)} Z`;
}

export const HAIR_STYLES = Object.freeze(['short', 'spiky', 'long', 'swept', 'bun', 'afro', 'horseshoe']);

/**
 * The hair over the top and the back of the head, in one of HAIR_STYLES: in the head's box grown by
 * `pad` (a fraction of the head) on every side, so big hair (an afro, a bun) fits.
 */
export function hairPath(hw, hh, style = 'short', pad = 0) {
  const hx = v => r2((v + pad) * hw), hy = v => r2((v + pad) * hh);
  const short = `M${hx(0.1)} ${hy(0.62)} Q${hx(0.02)} ${hy(0.02)} ${hx(0.55)} ${hy(0.02)} Q${hx(0.9)} ${hy(0.04)} ${hx(0.9)} ${hy(0.3)} Q${hx(0.72)} ${hy(0.24)} ${hx(0.6)} ${hy(0.32)} Q${hx(0.5)} ${hy(0.4)} ${hx(0.42)} ${hy(0.36)} Q${hx(0.3)} ${hy(0.48)} ${hx(0.24)} ${hy(0.7)} Q${hx(0.14)} ${hy(0.72)} ${hx(0.1)} ${hy(0.62)} Z`;
  // Bun: short hair drawn back into a knot at the back of the crown. Afro: a round cloud well past
  // the skull, open at the face. Horseshoe: bald on top, a ring of hair round the back at ear height.
  if (style === 'bun') { const cx = 0.16, cy = 0.1, r = 0.14; return `${short} M${hx(cx - r)} ${hy(cy)} A${r2(r * hw)} ${r2(r * hh)} 0 1 0 ${hx(cx + r)} ${hy(cy)} A${r2(r * hw)} ${r2(r * hh)} 0 1 0 ${hx(cx - r)} ${hy(cy)} Z`; }
  if (style === 'afro') return `M${hx(0.14)} ${hy(0.78)} Q${hx(-0.16)} ${hy(0.7)} ${hx(-0.12)} ${hy(0.4)} Q${hx(-0.2)} ${hy(0.1)} ${hx(0.04)} ${hy(-0.06)} Q${hx(0.14)} ${hy(-0.24)} ${hx(0.4)} ${hy(-0.2)} Q${hx(0.6)} ${hy(-0.28)} ${hx(0.8)} ${hy(-0.12)} Q${hx(1.06)} ${hy(-0.04)} ${hx(1.02)} ${hy(0.22)} Q${hx(1.04)} ${hy(0.36)} ${hx(0.9)} ${hy(0.36)} Q${hx(0.74)} ${hy(0.26)} ${hx(0.6)} ${hy(0.32)} Q${hx(0.46)} ${hy(0.38)} ${hx(0.4)} ${hy(0.36)} Q${hx(0.3)} ${hy(0.5)} ${hx(0.3)} ${hy(0.72)} Q${hx(0.22)} ${hy(0.8)} ${hx(0.14)} ${hy(0.78)} Z`;
  if (style === 'horseshoe') return `M${hx(0.1)} ${hy(0.64)} Q${hx(0.04)} ${hy(0.42)} ${hx(0.14)} ${hy(0.3)} Q${hx(0.26)} ${hy(0.28)} ${hx(0.3)} ${hy(0.36)} Q${hx(0.24)} ${hy(0.42)} ${hx(0.3)} ${hy(0.5)} Q${hx(0.26)} ${hy(0.64)} ${hx(0.24)} ${hy(0.72)} Q${hx(0.14)} ${hy(0.74)} ${hx(0.1)} ${hy(0.64)} Z`;
  // Spiky: tufts standing up over the crown. Long: down the back to the nape, a fringe in front.
  // Swept: a high quiff swept back.
  if (style === 'spiky') return `M${hx(0.1)} ${hy(0.64)} L${hx(0.04)} ${hy(0.3)} L${hx(0.16)} ${hy(0.2)} L${hx(0.14)} ${hy(0.02)} L${hx(0.32)} ${hy(0.1)} L${hx(0.42)} ${hy(-0.04)} L${hx(0.54)} ${hy(0.08)} L${hx(0.7)} ${hy(0)} L${hx(0.74)} ${hy(0.14)} L${hx(0.94)} ${hy(0.16)} L${hx(0.86)} ${hy(0.3)} Q${hx(0.7)} ${hy(0.26)} ${hx(0.6)} ${hy(0.32)} Q${hx(0.48)} ${hy(0.4)} ${hx(0.4)} ${hy(0.36)} Q${hx(0.3)} ${hy(0.5)} ${hx(0.24)} ${hy(0.72)} Q${hx(0.14)} ${hy(0.74)} ${hx(0.1)} ${hy(0.64)} Z`;
  if (style === 'long') return `M${hx(0.18)} ${hy(0.98)} Q${hx(0.0)} ${hy(0.8)} ${hx(0.04)} ${hy(0.4)} Q${hx(0.06)} ${hy(0.0)} ${hx(0.55)} ${hy(0.01)} Q${hx(0.94)} ${hy(0.04)} ${hx(0.92)} ${hy(0.42)} Q${hx(0.84)} ${hy(0.3)} ${hx(0.74)} ${hy(0.3)} Q${hx(0.6)} ${hy(0.36)} ${hx(0.44)} ${hy(0.36)} Q${hx(0.3)} ${hy(0.5)} ${hx(0.32)} ${hy(0.98)} Z`;
  if (style === 'swept') return `M${hx(0.1)} ${hy(0.6)} Q${hx(0.0)} ${hy(0.1)} ${hx(0.4)} ${hy(-0.02)} Q${hx(0.82)} ${hy(-0.1)} ${hx(1.0)} ${hy(0.12)} Q${hx(0.9)} ${hy(0.14)} ${hx(0.86)} ${hy(0.24)} Q${hx(0.7)} ${hy(0.22)} ${hx(0.58)} ${hy(0.3)} Q${hx(0.44)} ${hy(0.36)} ${hx(0.4)} ${hy(0.34)} Q${hx(0.3)} ${hy(0.46)} ${hx(0.24)} ${hy(0.68)} Q${hx(0.14)} ${hy(0.7)} ${hx(0.1)} ${hy(0.6)} Z`;
  return short;
}

/** A shoe pointing forward in a fw x fh box. */
export function shoePath(fw, fh) {
  return footPath(fw, fh);
}

/**
 * The wardrobe's parts, by where they go in the draw order.
 * @param {object} g  the figure's measures (figure-side.js): limbs, feet, torso, head, sw, H
 * @param {object} c  the component spec: wear, shirt, pants, shoes, hair, metal, trim
 * @param {(v: any) => string} hex
 */
export function wardrobeParts(g, c, hex) {
  const wear = new Set(Array.isArray(c.wear) ? c.wear : []);
  // A cloth part is shown when its item is worn and no armour worn on the same part hides it.
  const shown = (item, over) => wear.has(item) && !(over && wear.has(over) && (HIDES[over] ?? []).includes(item));
  const m = g.sw + g.H * 0.004, mA = m + g.H * 0.005;   // cloth sits close, armour stands off it by its thickness
  const shirt = hex(c.shirt ?? '#e9dfc9'), pants = hex(c.pants ?? '#6b4a33'), shoes = hex(c.shoes ?? '#7a4e2e'), hair = hex(c.hair ?? '#5a3a24');
  const metal = hex(c.metal ?? '#b9c2cd'), trim = hex(c.trim ?? 'reward'), leather = hex(c.leather ?? '#6b4428');
  const part = (p, show) => (show ? p : { ...p, hidden: true });
  const rv = g.H * 0.006;   // rivet radius
  /** A leather strap across a form at t, with its buckle to the front. */
  const strap = (f, t, tone) => {
    const [x, y] = f.edge(t + 0.035, 1, 0.16);
    return [{ path: f.across(t, t + 0.07), fill: tone(leather), sw: 'thin', shade: false },
      { rect: [r2(x - rv * 1.6), r2(y - rv * 1.7), r2(rv * 3.2), r2(rv * 3.4)], fill: 'none', stroke: tone(trim), sw: 'thin' }];
  };
  return {
    // Upper arm: sleeve, then the rerebrace; forearm: sleeve, then the vambrace with its elbow cop;
    // the shoulder plate itself goes over the whole arm, last.
    arm: (s, tone) => {
      const up = g.limbs[`upperArm${s}`], fore = g.limbs[`forearm${s}`], M = tone(metal);
      return {
        upper: [
          part(piece(`sleeve${s}`, `upperArm${s}`, up, m, tone(shirt), 'cloth', f => [
            { path: f.side(-1, 0.72, 0.96, 0.55), fill: shadowOf(tone(shirt), 'cloth'), ...flat }]), shown('shirt', 'pauldrons')),
          part(piece(`rerebrace${s}`, `upperArm${s}`, up, mA, M, 'metal', f => [...lame(f, 0.42, M), ...lame(f, 0.7, M)]), wear.has('pauldrons')),
        ],
        lower: [
          part(piece(`cuff${s}`, `forearm${s}`, fore, m, tone(shirt), 'cloth', f => [
            { path: f.across(0.86, 1.02), fill: tone(darken(shirt, 0.14)), sw: 'thin', shade: false }]), shown('shirt', 'vambraces')),
          part(piece(`vambrace${s}`, `forearm${s}`, fore, mA, M, 'metal', f => {
            // The couter: a round cop over the elbow with a fan behind it, its rim rolled.
            const [ex, ey] = f.edge(0, 1, 0.5), r = f.W * 0.42;
            return [...lame(f, 0.3, M), ...strap(f, 0.66, tone),
              { path: `M${r2(ex - r * 1.25)} ${r2(ey + r * 0.2)} Q${r2(ex - r * 1.1)} ${r2(ey - r * 1.1)} ${r2(ex)} ${r2(ey - r * 0.6)} L${r2(ex)} ${r2(ey + r * 0.6)} Z`, fill: shadowOf(M, 'metal'), sw: 'thin', shade: false },
              { circle: [r2(ex), r2(ey), r2(r)], fill: M, sw: 'regular', shade: false },
              { circle: [r2(ex + r * 0.18), r2(ey - r * 0.18), r2(r * 0.55)], fill: lighten(M, 0.14), ...flat }];
          }), wear.has('vambraces')),
        ],
        top: [part(pauldron(`pauldron${s}`, `upperArm${s}`, up, mA, M, tone(trim)), wear.has('pauldrons'))],
      };
    },
    leg: (s, tone) => {
      const th = g.limbs[`thigh${s}`], sh = g.limbs[`shin${s}`], M = tone(metal), P = tone(pants);
      return {
        thigh: [
          // a fold behind the knee: a shadow wedge and a light ridge
          part(piece(`trouser${s}`, `thigh${s}`, th, m, P, 'cloth', f => [
            { path: f.side(-1, 0.74, 1, 0.6), fill: shadowOf(P, 'cloth'), ...flat },
            { path: f.side(1, 0.8, 0.92, 0.1, 0.12), fill: lighten(P, 0.16), ...flat }]), shown('trousers', 'cuisses')),
          part(piece(`cuisse${s}`, `thigh${s}`, th, mA, M, 'metal', f => [...lame(f, 0.62, M),
            // the tassets: two plates hanging over the top of the thigh, wider than it, the upper over the lower
            { path: f.across(0.16, 0.4, -0.1), fill: M, sw: 'regular', shade: false }, ...lame(f, 0.4, M, 0.04),
            { path: f.across(-0.06, 0.2, -0.14), fill: M, sw: 'regular', shade: false }, ...lame(f, 0.2, M, 0.04)]), wear.has('cuisses')),
        ],
        shin: [
          part(piece(`legging${s}`, `shin${s}`, sh, m, P, 'cloth'), shown('trousers', 'greaves')),
          // the boot's shaft up the lower shin, its cuff turned over
          part(piece(`bootShaft${s}`, `shin${s}`, lower(sh, 0.5), m * 1.6, tone(shoes), 'leather', f => [
            { path: f.across(0.5, 0.62, -0.04), fill: tone(darken(shoes, 0.14)), sw: 'regular', shade: false },
            { path: f.across(0.5, 0.53, 0.04), fill: tone(lighten(shoes, 0.14)), ...flat }]), shown('boots', 'greaves')),
          part(piece(`greave${s}`, `shin${s}`, sh, mA, M, 'metal', f => {
            // The poleyn: a knee cop with a side wing, over the top of the greave.
            const [kx, ky] = f.edge(0.02, 1, 0.42), r = f.W * 0.44;
            return [...lame(f, 0.3, M), ...lame(f, 0.84, M, 0.04),
              { path: `M${r2(kx - r * 1.3)} ${r2(ky + r * 0.1)} Q${r2(kx - r)} ${r2(ky + r * 1.3)} ${r2(kx + r * 0.2)} ${r2(ky + r * 0.9)} L${r2(kx)} ${r2(ky)} Z`, fill: shadowOf(M, 'metal'), sw: 'thin', shade: false },
              { circle: [r2(kx), r2(ky), r2(r)], fill: M, sw: 'regular', shade: false },
              { circle: [r2(kx + r * 0.18), r2(ky - r * 0.2), r2(r * 0.55)], fill: lighten(M, 0.14), ...flat }];
          }), wear.has('greaves')),
        ],
        foot: [
          part(shoe(`boot${s}`, `foot${s}`, g.feet[s], m, tone(shoes)), shown('boots', 'sabatons')),
          part(shoe(`sabaton${s}`, `foot${s}`, g.feet[s], mA, M, true), wear.has('sabatons')),
        ],
      };
    },
    body: () => {
      const { W, len, bottom, hip } = g.torso;
      /** @param {string} name @param {number} k @param {string} fill @param {string} mat @param {(f: any) => any[]} [extra] */
      const over = (name, k, fill, mat, extra = () => []) => {
        const f = form('torso', len, W, k), cy = bottom + f.H / 2 - k;
        return { name, parent: 'body', box: [r2(f.W), r2(f.H)], offset: [r2(f.W / 2 - f.cx), r2(cy)], pivot: [r2(f.cx - f.W / 2), r2(hip - cy)], shapes: [...shade(f, fill, mat), ...extra(f)] };
      };
      const M = metal;
      return [
        part(over('shirt', m, shirt, 'cloth', f => [
          { path: f.side(1, 0.02, 0.14, 0.4), fill: shadowOf(shirt, 'cloth'), ...flat },   // the collar's opening
          { path: f.across(0.7, 0.76), fill: shadowOf(shirt, 'cloth'), ...flat }]), shown('shirt', 'cuirass')),
        // The top of the trousers at the hips, over the shirt's tail.
        part({ ...over('waist', m, pants, 'cloth'), shapes: [] }, shown('trousers', 'cuirass')),
        part(over('cuirass', mA, M, 'metal', f => [
          // the gorget's rolled rim at the neck, a lame at the bottom of the breastplate
          { path: f.across(-0.04, 0.06, 0.08), fill: lighten(M, 0.12), sw: 'thin', shade: false },
          ...lame(f, 0.58, M, 0.04), ...rivets(f, [[0.3, 0.12]], M, rv),
          // the belt, its buckle, then the faulds hanging below it, each lame over the next
          ...strap(f, 0.7, c => c),
          { path: f.tail(0.86), fill: M, sw: 'regular', shade: false }, ...lame(f, 0.86, M, 0.04),
          { path: f.tail(0.97), fill: M, sw: 'regular', shade: false }, ...lame(f, 0.97, M, 0.04)]), wear.has('cuirass')),
      ].map(p => (p.name === 'waist' ? { ...p, shapes: waistShapes(g, m, pants) } : p));
    },
    head: () => {
      const { hw, hh, offset } = g.head;
      const k = 1.03, HW = hw * k, HH = hh * k, x = v => r2(v * HW), y = v => r2(v * HH), M = metal;
      const X = v => r2((v + PAD) * hw), Y = v => r2((v + PAD) * hh), style = HAIR_STYLES.includes(c.hairStyle) ? c.hairStyle : 'short';
      return [
        // The hair's box is the head's grown by PAD on every side (same centre), so big hair fits.
        part({ name: 'hair', parent: 'head', box: [r2(hw * (1 + 2 * PAD)), r2(hh * (1 + 2 * PAD))], offset, shapes: [
          { path: hairPath(hw, hh, style, PAD), fill: hair, sw: 'regular', shade: false, bbox: [0, 0, hw * (1 + 2 * PAD), hh * (1 + 2 * PAD)] },
          ...(style === 'horseshoe' ? [] : [
            { path: `M${X(0.12)} ${Y(0.5)} Q${X(0.14)} ${Y(0.14)} ${X(0.5)} ${Y(0.08)} Q${X(0.3)} ${Y(0.22)} ${X(0.22)} ${Y(0.5)} Z`, fill: shadowOf(hair, 'skin'), ...flat },
            { path: `M${X(0.46)} ${Y(0.07)} Q${X(0.7)} ${Y(0.06)} ${X(0.8)} ${Y(0.16)} Q${X(0.64)} ${Y(0.12)} ${X(0.46)} ${Y(0.07)} Z`, fill: lighten(hair, 0.3), ...flat }])] }, shown('hair', 'helmet')),
        ...headwearParts({ hw, hh, offset, pad: PAD }, c, hex, part, shown),
        // Over the whole skull, the back of the head and the nape; the face stays open under a brim.
        part({ name: 'helmet', parent: 'head', box: [r2(HW), r2(HH)], offset: [offset[0], r2(offset[1] + (HH - hh) / 2)], shapes: [
          { path: `M${x(0.5)} ${y(0.43)} L${x(0.98)} ${y(0.43)} L${x(0.98)} ${y(0.5)} L${x(0.5)} ${y(0.52)} Z`, fill: '#000000', opacity: 0.22, ...flat },   // the brim's shadow on the face
          { path: `M${x(0.06)} ${y(0.76)} Q${x(0.0)} ${y(0.02)} ${x(0.52)} ${y(0.02)} Q${x(0.96)} ${y(0.04)} ${x(0.94)} ${y(0.38)} L${x(0.52)} ${y(0.42)} Q${x(0.43)} ${y(0.46)} ${x(0.42)} ${y(0.76)} Z`, fill: M, sw: 'regular', shade: false, bbox: [0, 0, HW, HH * 0.76] },
          { path: `M${x(0.07)} ${y(0.72)} Q${x(0.02)} ${y(0.12)} ${x(0.4)} ${y(0.05)} Q${x(0.14)} ${y(0.24)} ${x(0.2)} ${y(0.74)} Z`, fill: shadowOf(M, 'metal'), ...flat },
          { path: `M${x(0.56)} ${y(0.07)} Q${x(0.84)} ${y(0.1)} ${x(0.88)} ${y(0.3)} Q${x(0.76)} ${y(0.16)} ${x(0.56)} ${y(0.07)} Z`, fill: lighten(M, 0.2), ...flat },
          { path: `M${x(0.52)} ${y(0.03)} Q${x(0.24)} ${y(0.06)} ${x(0.14)} ${y(0.3)}`, fill: 'none', stroke: lighten(M, 0.15), sw: 'thin' },   // the comb's ridge
          // the brim, standing out over the brow, and the rolled rim round the nape
          { path: `M${x(0.5)} ${y(0.37)} L${x(0.93)} ${y(0.36)} Q${x(0.99)} ${y(0.38)} ${x(0.97)} ${y(0.42)} L${x(0.52)} ${y(0.44)} Z`, fill: M, sw: 'regular', shade: false },
          { path: `M${x(0.52)} ${y(0.41)} L${x(0.97)} ${y(0.4)} L${x(0.96)} ${y(0.42)} L${x(0.52)} ${y(0.44)} Z`, fill: shadowOf(M, 'metal'), ...flat },
          { path: `M${x(0.06)} ${y(0.7)} L${x(0.42)} ${y(0.7)} L${x(0.42)} ${y(0.76)} L${x(0.06)} ${y(0.76)} Z`, fill: lighten(M, 0.1), sw: 'thin', shade: false },
          { path: `M${x(0.08)} ${y(0.68)} L${x(0.42)} ${y(0.68)}`, fill: 'none', stroke: trim, sw: 'thin' },
        ] }, wear.has('helmet')),
      ];
    },
  };
}

/** The trousers' top: the torso form from the waist down. */
function waistShapes(g, m, pants) {
  const f = form('torso', g.torso.len, g.torso.W, m);
  return [{ path: f.tail(0.74), fill: pants, sw: 'regular', shade: false }, { path: f.across(0.74, 0.8), fill: shadowOf(pants, 'cloth'), stroke: false, shade: false }];
}

/** A pauldron: a domed shoulder cop over one lame, the dome's edge rolled and casting a shadow on the lame. */
function pauldron(name, parent, [joint, , w1], m, fill, trim) {
  const W = (w1 + 2 * m) * 1.36, H = (w1 + 2 * m) * 1.3, p = (x, y) => `${r2(x * W)} ${r2(y * H)}`;
  const flatS = { stroke: false, shade: false };
  return { name, parent, box: [r2(W), r2(H)], offset: [r2(joint[0]), r2(joint[1] - w1 * 0.15)], pivot: [0, r2(w1 * 0.15)], shapes: [
    { path: `M${p(0.08, 0.92)} Q${p(0.5, 1.02)} ${p(0.92, 0.92)} L${p(0.9, 0.99)} Q${p(0.5, 1.06)} ${p(0.1, 0.99)} Z`, fill: '#000000', opacity: 0.22, ...flatS },   // its shadow on the arm
    { path: `M${p(0.04, 0.6)} Q${p(0.5, 0.7)} ${p(0.96, 0.6)} L${p(0.94, 0.9)} Q${p(0.5, 0.98)} ${p(0.06, 0.9)} Z`, fill, sw: 'regular', shade: false },
    { path: `M${p(0.06, 0.62)} Q${p(0.5, 0.72)} ${p(0.94, 0.62)} L${p(0.94, 0.72)} Q${p(0.5, 0.82)} ${p(0.06, 0.72)} Z`, fill: shadowOf(fill, 'metal'), ...flatS },
    { path: `M${p(0.07, 0.84)} Q${p(0.5, 0.92)} ${p(0.93, 0.84)} L${p(0.93, 0.88)} Q${p(0.5, 0.96)} ${p(0.07, 0.88)} Z`, fill: lighten(fill, 0.14), ...flatS },
    { path: `M${p(0.04, 0.62)} Q${p(0.0, 0.04)} ${p(0.5, 0.04)} Q${p(1.0, 0.04)} ${p(0.96, 0.62)} Q${p(0.5, 0.72)} ${p(0.04, 0.62)} Z`, fill, sw: 'regular', shade: false, bbox: [0, 0, W, H] },
    { path: `M${p(0.07, 0.6)} Q${p(0.03, 0.1)} ${p(0.36, 0.07)} Q${p(0.18, 0.3)} ${p(0.24, 0.65)} Z`, fill: shadowOf(fill, 'metal'), ...flatS },
    { path: `M${p(0.56, 0.1)} Q${p(0.86, 0.12)} ${p(0.9, 0.42)} Q${p(0.76, 0.22)} ${p(0.56, 0.1)} Z`, fill: lighten(fill, 0.2), ...flatS },
    { path: `M${p(0.08, 0.58)} Q${p(0.5, 0.67)} ${p(0.92, 0.58)}`, fill: 'none', stroke: trim, sw: 'regular' },
  ] };
}

/** A boot or a sabaton over the foot, on the foot's bone (the same centre and ankle). */
function shoe(name, parent, { x, fw, fh, heel, legW }, m, fill, plates = false) {
  const W = fw + 2 * m, H = fh + 2 * m, p = (a, b) => `${r2(a * W)} ${r2(b * H)}`;
  const mat = plates ? 'metal' : 'leather', flatS = { stroke: false, shade: false };
  return { name, parent, box: [r2(W), r2(H)], offset: [r2(x - heel + fw / 2), r2(fh / 2)], pivot: [r2(heel - fw / 2), r2(fh / 2 - legW * 0.3)], shapes: [
    { path: footPath(W, H), fill, sw: 'regular', shade: false, bbox: [0, 0, W, H] },
    { path: `M${p(0.06, 0.4)} Q${p(0.08, 0.1)} ${p(0.26, 0.06)} L${p(0.3, 0.8)} L${p(0.06, 0.8)} Z`, fill: shadowOf(fill, mat), ...flatS },
    // metal: overlapping lames down the instep; leather: a light toe cap
    ...(plates ? [0.5, 0.64, 0.78].flatMap(f => [
      { path: `M${p(f, 0.12 + (f - 0.5) * 0.9)} Q${p(f + 0.07, 0.5)} ${p(f + 0.04, 0.8)} L${p(f + 0.07, 0.8)} Q${p(f + 0.1, 0.5)} ${p(f + 0.03, 0.14 + (f - 0.5) * 0.9)} Z`, fill: shadowOf(fill, 'metal'), ...flatS },
      { path: `M${p(f - 0.03, 0.14 + (f - 0.5) * 0.9)} Q${p(f + 0.03, 0.5)} ${p(f, 0.8)} L${p(f + 0.03, 0.8)} Q${p(f + 0.06, 0.5)} ${p(f, 0.13 + (f - 0.5) * 0.9)} Z`, fill: lighten(fill, 0.16), ...flatS }])
      : [{ path: `M${p(0.7, 0.42)} Q${p(0.92, 0.46)} ${p(0.95, 0.66)} Q${p(0.82, 0.54)} ${p(0.7, 0.42)} Z`, fill: lighten(fill, 0.2), ...flatS }]),
    { path: solePath(W, H), fill: darken(fill, 0.35), ...flatS },
  ] };
}
