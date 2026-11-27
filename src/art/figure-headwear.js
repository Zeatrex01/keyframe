// Head-wear for the bare side-view figure's wardrobe (src/art/figure-wardrobe.js): hats, a headband,
// glasses, facial hair and a mask, each a part of its own on the head bone, so a game puts each one
// on or takes it off by itself, like every other wear item.
//
//   { component: 'figure', build: 'side', bare: true, wear: ['hair', 'cap', 'shades', 'moustache'],
//     headwear: '#d9a930', facialHair: '#3a2a20' }
//
// Colours: `headwear` (hats and headband), `maskColor`, `facialHair` (moustache and beard; the hair's colour
// when not given), `lens` (glasses and shades). Each piece's box is the head's box grown by `pad`
// on every side (same centre), so a brim or a headband's tails fit. A worn hat hides the hat under
// it, a helmet hides every hat and the headband, a mask hides the moustache and the beard.
// Pure: shapes only.

import { darken, lighten } from './style.js';
import { shadowOf } from './figure-form.js';

export const HEADWEAR = Object.freeze(['headband', 'beanie', 'cap', 'hat', 'glasses', 'shades', 'moustache', 'beard', 'mask']);
/** Which head piece hides which, when both are worn. */
export const HEADWEAR_HIDES = Object.freeze({
  helmet: ['headband', 'beanie', 'cap', 'hat'],
  hat: ['beanie', 'cap', 'headband'], cap: ['beanie'],
  mask: ['moustache', 'beard'],
});

const r2 = v => Math.round(v * 100) / 100;
const flat = { stroke: false, shade: false };

/**
 * The head pieces, back to front: facial hair, the mask, glasses, then the headband and the hats.
 * @param {{ hw: number, hh: number, offset: number[], pad: number }} h  the head's measures
 * @param {object} c  the component spec
 * @param {(v: any) => string} hex
 * @param {(p: any, show: boolean) => any} part  marks a piece hidden unless shown
 * @param {(item: string, over?: string) => boolean} shown
 */
export function headwearParts({ hw, hh, offset, pad }, c, hex, part, shown) {
  const W = hw * (1 + 2 * pad), H = hh * (1 + 2 * pad);
  const X = v => r2((v + pad) * hw), Y = v => r2((v + pad) * hh), P = (x, y) => `${X(x)} ${Y(y)}`;
  const cloth = hex(c.headwear ?? 'primary'), whisker = hex(c.facialHair ?? c.hair ?? '#5a3a24'), lens = hex(c.lens ?? '#1e2230'), maskCloth = hex(c.maskColor ?? '#2a2d36');
  const frame = darken(lens, 0.1);
  /** Worn unless a worn piece hides it. */
  const on = item => shown(item) && !Object.entries(HEADWEAR_HIDES).some(([over, hid]) => hid.includes(item) && shown(over));
  const piece = (name, shapes) => part({ name, parent: 'head', box: [r2(W), r2(H)], offset, shapes: shapes.map((s, i) => (i === 0 ? { ...s, bbox: [0, 0, W, H] } : s)) }, on(name));
  const lensAt = [0.77, 0.53];
  return [
    // A full beard along the jaw and round the chin, the mouth left open; then a moustache under the nose.
    piece('beard', [
      { path: `M${P(0.42, 0.62)} Q${P(0.44, 0.96)} ${P(0.66, 1.02)} Q${P(0.88, 1.0)} ${P(0.94, 0.86)} Q${P(0.84, 0.86)} ${P(0.8, 0.88)} Q${P(0.7, 0.8)} ${P(0.62, 0.7)} Q${P(0.52, 0.66)} ${P(0.42, 0.62)} Z`, fill: whisker, sw: 'regular', shade: false },
      { path: `M${P(0.48, 0.74)} Q${P(0.52, 0.92)} ${P(0.66, 0.96)} Q${P(0.56, 0.86)} ${P(0.54, 0.72)} Z`, fill: shadowOf(whisker, 'skin'), ...flat },
    ]),
    piece('moustache', [
      { path: `M${P(0.7, 0.74)} Q${P(0.78, 0.66)} ${P(0.93, 0.68)} Q${P(0.97, 0.72)} ${P(0.95, 0.76)} Q${P(0.86, 0.72)} ${P(0.8, 0.77)} Q${P(0.74, 0.8)} ${P(0.7, 0.74)} Z`, fill: whisker, sw: 'thin', shade: false },
      { path: `M${P(0.76, 0.71)} Q${P(0.84, 0.68)} ${P(0.92, 0.7)}`, fill: 'none', stroke: lighten(whisker, 0.25), sw: 'thin' },
    ]),
    // A cloth mask over the nose and mouth, its strap to the ear.
    piece('mask', [
      { path: `M${P(0.56, 0.6)} L${P(0.97, 0.6)} Q${P(1.02, 0.7)} ${P(0.94, 0.84)} Q${P(0.82, 0.98)} ${P(0.64, 0.96)} Q${P(0.5, 0.86)} ${P(0.5, 0.7)} Z`, fill: maskCloth, sw: 'regular', shade: false },
      { path: `M${P(0.54, 0.62)} L${P(0.4, 0.56)}`, fill: 'none', stroke: darken(maskCloth, 0.2), sw: 'regular' },
      { path: `M${P(0.52, 0.7)} Q${P(0.56, 0.9)} ${P(0.66, 0.95)} Q${P(0.6, 0.84)} ${P(0.58, 0.68)} Z`, fill: shadowOf(maskCloth, 'maskCloth'), ...flat },
      { path: `M${P(0.62, 0.66)} L${P(0.95, 0.66)}`, fill: 'none', stroke: lighten(maskCloth, 0.15), sw: 'thin' },
    ]),
    // Round glasses over the eye, the arm back to the ear; shades are a dark lens with a glint.
    piece('glasses', [
      { circle: [X(lensAt[0]), Y(lensAt[1]), r2(hw * 0.1)], fill: lighten(lens, 0.85), opacity: 0.35, stroke: false, shade: false },
      { circle: [X(lensAt[0]), Y(lensAt[1]), r2(hw * 0.1)], fill: 'none', stroke: frame, sw: 'regular' },
      { path: `M${P(lensAt[0] - 0.1, lensAt[1] - 0.01)} L${P(0.44, 0.52)}`, fill: 'none', stroke: frame, sw: 'regular' },
    ]),
    piece('shades', [
      { path: `M${P(0.64, 0.48)} L${P(0.92, 0.47)} Q${P(0.92, 0.6)} ${P(0.8, 0.6)} Q${P(0.66, 0.6)} ${P(0.64, 0.48)} Z`, fill: lens, sw: 'thin', shade: false },
      { path: `M${P(0.7, 0.51)} L${P(0.82, 0.5)}`, fill: 'none', stroke: lighten(lens, 0.45), sw: 'thin' },
      { path: `M${P(0.65, 0.49)} L${P(0.44, 0.52)}`, fill: 'none', stroke: frame, sw: 'regular' },
    ]),
    // A headband round the brow, knotted at the back with its two tails flying.
    piece('headband', [
      { path: `M${P(0.12, 0.44)} L${P(-0.22, 0.56)} L${P(-0.16, 0.48)} L${P(-0.26, 0.38)} L${P(0.1, 0.36)} Z`, fill: darken(cloth, 0.12), sw: 'thin', shade: false },
      { path: `M${P(0.08, 0.34)} Q${P(0.5, 0.26)} ${P(0.9, 0.3)} L${P(0.91, 0.4)} Q${P(0.5, 0.36)} ${P(0.07, 0.45)} Z`, fill: cloth, sw: 'regular', shade: false },
      { path: `M${P(0.09, 0.42)} Q${P(0.5, 0.33)} ${P(0.91, 0.37)} L${P(0.91, 0.4)} Q${P(0.5, 0.36)} ${P(0.07, 0.45)} Z`, fill: shadowOf(cloth, 'cloth'), ...flat },
    ]),
    // A knitted beanie down to the ears, a folded cuff and a bobble.
    piece('beanie', [
      { path: `M${P(0.05, 0.5)} Q${P(0.0, -0.04)} ${P(0.5, -0.04)} Q${P(0.94, -0.02)} ${P(0.92, 0.4)} L${P(0.06, 0.52)} Z`, fill: cloth, sw: 'regular', shade: false },
      { circle: [X(0.42), Y(-0.08), r2(hw * 0.09)], fill: lighten(cloth, 0.2), sw: 'regular', shade: false },
      { path: `M${P(0.04, 0.4)} L${P(0.92, 0.3)} L${P(0.93, 0.42)} L${P(0.05, 0.53)} Z`, fill: darken(cloth, 0.12), sw: 'regular', shade: false },
      ...[0.24, 0.42, 0.6].map(x => ({ path: `M${P(x, 0.06)} Q${P(x + 0.02, 0.2)} ${P(x + 0.01, 0.34)}`, fill: 'none', stroke: darken(cloth, 0.14), sw: 'thin' })),
    ]),
    // A cap: a crown over the skull and a visor out over the brow, with its shadow on the face.
    piece('cap', [
      { path: `M${P(0.52, 0.38)} L${P(1.0, 0.4)} L${P(0.98, 0.48)} L${P(0.54, 0.46)} Z`, fill: '#000000', opacity: 0.2, ...flat },
      { path: `M${P(0.06, 0.48)} Q${P(0.02, 0.0)} ${P(0.5, 0.0)} Q${P(0.9, 0.0)} ${P(0.92, 0.36)} L${P(0.08, 0.46)} Z`, fill: cloth, sw: 'regular', shade: false },
      { path: `M${P(0.84, 0.32)} Q${P(1.16, 0.3)} ${P(1.26, 0.4)} Q${P(1.06, 0.42)} ${P(0.86, 0.4)} Z`, fill: darken(cloth, 0.08), sw: 'regular', shade: false },
      { path: `M${P(0.08, 0.44)} Q${P(0.06, 0.12)} ${P(0.32, 0.04)} Q${P(0.16, 0.2)} ${P(0.2, 0.44)} Z`, fill: shadowOf(cloth, 'cloth'), ...flat },
      { circle: [X(0.5), Y(-0.01), r2(hw * 0.04)], fill: darken(cloth, 0.1), stroke: false, shade: false },
    ]),
    // A brimmed hat: a creased crown, a band, and a wide brim all round.
    piece('hat', [
      { path: `M${P(0.16, 0.34)} Q${P(0.14, -0.16)} ${P(0.5, -0.16)} Q${P(0.86, -0.16)} ${P(0.84, 0.34)} Z`, fill: cloth, sw: 'regular', shade: false },
      { path: `M${P(0.36, -0.12)} Q${P(0.5, -0.04)} ${P(0.64, -0.12)}`, fill: 'none', stroke: darken(cloth, 0.18), sw: 'thin' },
      { path: `M${P(0.16, 0.22)} L${P(0.84, 0.22)} L${P(0.84, 0.32)} L${P(0.16, 0.32)} Z`, fill: darken(cloth, 0.3), stroke: false, shade: false },
      { ellipse: [X(0.52), Y(0.33), r2(hw * 0.66), r2(hh * 0.07)], fill: darken(cloth, 0.06), sw: 'regular', shade: false },
      { path: `M${P(0.18, 0.04)} Q${P(0.2, -0.12)} ${P(0.36, -0.14)} Q${P(0.26, 0.0)} ${P(0.28, 0.2)} Z`, fill: shadowOf(cloth, 'cloth'), ...flat },
    ]),
  ];
}
