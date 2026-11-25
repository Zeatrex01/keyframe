// A wardrobe for the bare side-view figure (src/art/figure-side.js with `bare: true`): the figure is a
// bald body in a plain base layer, and every garment and armour piece is a part of its own on the
// bone it covers, so a game puts each one on or takes it off by itself.
//
//   { component: 'figure', build: 'side', bare: true, wear: ['hair', 'shirt', 'trousers', 'boots', 'cuirass'] }
//
// Items (`wear` lists the ones worn; the rest are drawn too, hidden, for the game to show):
//   cloth   hair, shirt (body and both sleeves), trousers (waist and both legs), boots
//   armour  helmet, cuirass, pauldrons (shoulder plate and upper-arm tube), vambraces, cuisses, greaves, sabatons
// Every piece covers the whole of its body part, a little wider all round, so nothing under it shows
// at its edges. Armour hides the cloth on its own part (a worn cuirass hides the shirt and waist, a
// helmet the hair), so nothing shows through a gap either.
// Pure: shapes only.

import { darken } from './style.js';

export const CLOTH = Object.freeze(['hair', 'shirt', 'trousers', 'boots']);
export const ARMOUR = Object.freeze(['helmet', 'cuirass', 'pauldrons', 'vambraces', 'cuisses', 'greaves', 'sabatons']);
/** Which armour hides which cloth, by the part they share. */
const HIDES = Object.freeze({ helmet: ['hair'], cuirass: ['shirt', 'trousers'], pauldrons: ['shirt'], vambraces: ['shirt'], cuisses: ['trousers'], greaves: ['trousers'], sabatons: ['boots'] });

const r2 = v => Math.round(v * 100) / 100;

/**
 * A tapered tube over a limb (the limb's own outline, `m` wider all round), its pivot at the joint.
 * @param {string} name @param {string} parent @param {any[]} limb  [joint, length, width at the joint, width at the end]
 * @param {number} m @param {string} fill
 * @param {(W: number, H: number, top: number, bot: number) => any[]} [extra]  more shapes in the tube's box
 */
function tube(name, parent, [joint, len, w1, w2], m, fill, extra = () => []) {
  const a1 = w1 + 2 * m, a2 = w2 + 2 * m, W = Math.max(a1, a2), H = len + a1 / 2 + a2 / 2, cx = W / 2;
  const a = a1 / 2, b = a2 / 2, top = a1 / 2, bot = a1 / 2 + len;
  return { name, parent, box: [r2(W), r2(H)], offset: [r2(joint[0]), r2(joint[1] + a1 / 2 - H / 2)], pivot: [0, r2(H / 2 - a1 / 2)],
    shapes: [{ path: `M${r2(cx - a)} ${r2(top)} L${r2(cx - b)} ${r2(bot)} A${r2(b)} ${r2(b)} 0 0 0 ${r2(cx + b)} ${r2(bot)} L${r2(cx + a)} ${r2(top)} A${r2(a)} ${r2(a)} 0 0 0 ${r2(cx - a)} ${r2(top)} Z`,
      fill, sw: 'regular', bbox: [0, 0, W, H] }, ...extra(W, H, top, bot)] };
}

/** The torso's outline in a W x H box (the chest to the front, +x). */
export function torsoPath(W, H, sw) {
  const x0 = sw / 2, x1 = W - sw / 2;
  return `M${r2(x0 + W * 0.12)} ${r2(sw / 2)} L${r2(x1 - W * 0.3)} ${r2(sw / 2)} Q${r2(x1)} ${r2(H * 0.06)} ${r2(x1)} ${r2(H * 0.4)} L${r2(x1 - W * 0.04)} ${r2(H - sw / 2)} L${r2(x0 + W * 0.04)} ${r2(H - sw / 2)} L${r2(x0)} ${r2(H * 0.25)} Q${r2(x0)} ${r2(sw / 2)} ${r2(x0 + W * 0.12)} ${r2(sw / 2)} Z`;
}

/** The hair over the top and the back of the head, in the head's box. */
export function hairPath(hw, hh) {
  const hx = v => r2(v * hw), hy = v => r2(v * hh);
  return `M${hx(0.1)} ${hy(0.62)} Q${hx(0.02)} ${hy(0.02)} ${hx(0.55)} ${hy(0.02)} Q${hx(0.9)} ${hy(0.04)} ${hx(0.9)} ${hy(0.3)} Q${hx(0.72)} ${hy(0.24)} ${hx(0.6)} ${hy(0.32)} Q${hx(0.5)} ${hy(0.4)} ${hx(0.42)} ${hy(0.36)} Q${hx(0.3)} ${hy(0.48)} ${hx(0.24)} ${hy(0.7)} Q${hx(0.14)} ${hy(0.72)} ${hx(0.1)} ${hy(0.62)} Z`;
}

/** A shoe pointing forward in a fw x fh box. */
export function shoePath(fw, fh, sw) {
  return `M${r2(sw / 2)} ${r2(fh - sw / 2)} L${r2(sw / 2)} ${r2(fh * 0.3)} Q${r2(sw / 2)} ${r2(sw / 2)} ${r2(fh * 0.5)} ${r2(sw / 2)} L${r2(fw * 0.55)} ${r2(sw / 2)} Q${r2(fw - sw / 2)} ${r2(fh * 0.25)} ${r2(fw - sw / 2)} ${r2(fh * 0.75)} L${r2(fw - sw / 2)} ${r2(fh - sw / 2)} Z`;
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
  const m = g.sw + g.H * 0.004, mA = m + g.H * 0.006;   // cloth sits close, armour stands off it
  const shirt = hex(c.shirt ?? '#e9dfc9'), pants = hex(c.pants ?? '#6b4a33'), shoes = hex(c.shoes ?? '#7a4e2e'), hair = hex(c.hair ?? '#5a3a24');
  const metal = hex(c.metal ?? '#b9c2cd'), trim = hex(c.trim ?? 'reward'), line = darken(metal, 0.28);
  const part = (p, show) => (show ? p : { ...p, hidden: true });
  const band = (y, col) => (W, H) => [{ line: [r2(W * 0.12), r2(H * y), r2(W * 0.88), r2(H * y)], stroke: col, sw: 'thin' }];
  return {
    // Upper arm: sleeve, then the shoulder plate's tube; forearm: sleeve, then the vambrace;
    // the shoulder plate itself goes over the whole arm, last.
    arm: (s, tone) => ({
      upper: [
        part(tube(`sleeve${s}`, `upperArm${s}`, g.limbs[`upperArm${s}`], m, tone(shirt)), shown('shirt', 'pauldrons')),
        part(tube(`rerebrace${s}`, `upperArm${s}`, g.limbs[`upperArm${s}`], mA, tone(metal), band(0.75, tone(line))), wear.has('pauldrons')),
      ],
      lower: [
        part(tube(`cuff${s}`, `forearm${s}`, g.limbs[`forearm${s}`], m, tone(shirt)), shown('shirt', 'vambraces')),
        part(tube(`vambrace${s}`, `forearm${s}`, g.limbs[`forearm${s}`], mA, tone(metal), (W, H) => [
          { line: [r2(W * 0.14), r2(H * 0.3), r2(W * 0.86), r2(H * 0.3)], stroke: tone(trim), sw: 'thin' },
          { line: [r2(W * 0.16), r2(H * 0.78), r2(W * 0.84), r2(H * 0.78)], stroke: tone(line), sw: 'thin' }]), wear.has('vambraces')),
      ],
      top: [part(pauldron(`pauldron${s}`, `upperArm${s}`, g.limbs[`upperArm${s}`], mA, tone(metal), tone(trim)), wear.has('pauldrons'))],
    }),
    leg: (s, tone) => ({
      thigh: [
        part(tube(`trouser${s}`, `thigh${s}`, g.limbs[`thigh${s}`], m, tone(pants)), shown('trousers', 'cuisses')),
        part(tube(`cuisse${s}`, `thigh${s}`, g.limbs[`thigh${s}`], mA, tone(metal), (W, H) => [
          { line: [r2(W * 0.1), r2(H * 0.34), r2(W * 0.9), r2(H * 0.34)], stroke: tone(line), sw: 'thin' },
          { line: [r2(W * 0.1), r2(H * 0.62), r2(W * 0.9), r2(H * 0.62)], stroke: tone(trim), sw: 'thin' }]), wear.has('cuisses')),
      ],
      shin: [
        part(tube(`legging${s}`, `shin${s}`, g.limbs[`shin${s}`], m, tone(pants)), shown('trousers', 'greaves')),
        part(tube(`greave${s}`, `shin${s}`, g.limbs[`shin${s}`], mA, tone(metal), (W, H, top) => [
          { ellipse: [r2(W / 2), r2(top * 1.1), r2(W * 0.4), r2(top * 0.62)], fill: tone(metal), sw: 'regular' },
          { line: [r2(W * 0.16), r2(top * 1.9), r2(W * 0.84), r2(top * 1.9)], stroke: tone(trim), sw: 'thin' },
          { line: [r2(W * 0.5), r2(top * 2), r2(W * 0.5), r2(H * 0.9)], stroke: tone(line), sw: 'thin' }]), wear.has('greaves')),
      ],
      foot: [
        part(shoe(`boot${s}`, `foot${s}`, g.feet[s], m, tone(shoes)), shown('boots', 'sabatons')),
        part(shoe(`sabaton${s}`, `foot${s}`, g.feet[s], mA, tone(metal), tone(line)), wear.has('sabatons')),
      ],
    }),
    body: () => {
      const { W, H, bottom, legW } = g.torso;
      const over = (name, k, fill, extra = []) => {
        const BW = W + 2 * k, BH = H + 2 * k;
        return { name, parent: 'body', box: [r2(BW), r2(BH)], offset: [0, r2(bottom + H / 2)], pivot: [0, r2(-BH / 2 + k + legW * 0.5)],
          shapes: [{ path: torsoPath(BW, BH, g.sw), fill, sw: 'regular', bbox: [0, 0, BW, BH] }, ...extra.map(f => f(BW, BH))] };
      };
      // The top of the trousers at the hips, over the shirt's tail.
      const waist = { ...over('waist', m, pants), shapes: [] };
      waist.shapes = [{ rect: [r2(waist.box[0] * 0.03), r2(waist.box[1] * 0.74), r2(waist.box[0] * 0.94 - g.sw), r2(waist.box[1] * 0.26 - g.sw / 2)], r: 'sm', fill: pants, sw: 'regular', shade: false }];
      return [
        part(over('shirt', m, shirt, [(BW, BH) => ({ path: `M${r2(BW * 0.55)} ${r2(BH * 0.02)} L${r2(BW * 0.6)} ${r2(BH * 0.16)}`, fill: 'none', stroke: darken(shirt, 0.2), sw: 'thin' })]), shown('shirt', 'cuirass')),
        part(waist, shown('trousers', 'cuirass')),
        part(over('cuirass', mA, metal, [
          (BW, BH) => ({ path: `M${r2(BW * 0.14)} ${r2(BH * 0.03)} L${r2(BW * 0.66)} ${r2(BH * 0.03)}`, fill: 'none', stroke: trim, sw: 'regular' }),
          (BW, BH) => ({ path: `M${r2(BW * 0.52)} ${r2(BH * 0.12)} Q${r2(BW * 0.84)} ${r2(BH * 0.32)} ${r2(BW * 0.8)} ${r2(BH * 0.62)}`, fill: 'none', stroke: line, sw: 'thin' }),
          (BW, BH) => ({ rect: [r2(BW * 0.03), r2(BH * 0.7), r2(BW * 0.94), r2(BH * 0.1)], r: 'sm', fill: darken(pants, 0.1), sw: 'regular', shade: false }),
          (BW, BH) => ({ rect: [r2(BW * 0.74), r2(BH * 0.68), r2(BW * 0.13), r2(BH * 0.14)], r: 'sm', fill: trim, sw: 'thin', shade: false }),
          (BW, BH) => ({ path: `M${r2(BW * 0.06)} ${r2(BH * 0.82)} L${r2(BW * 0.94)} ${r2(BH * 0.82)} L${r2(BW * 0.9)} ${r2(BH * 0.98)} L${r2(BW * 0.1)} ${r2(BH * 0.98)} Z`, fill: metal, sw: 'regular', bbox: [0, 0, BW, BH] }),
        ]), wear.has('cuirass')),
      ];
    },
    head: () => {
      const { hw, hh, offset } = g.head;
      const k = 1.06, HW = hw * k, HH = hh * k, x = v => r2(v * HW), y = v => r2(v * HH);
      return [
        part({ name: 'hair', parent: 'head', box: [r2(hw), r2(hh)], offset, shapes: [{ path: hairPath(hw, hh), fill: hair, sw: 'regular', bbox: [0, 0, hw * 0.9, hh * 0.72] }] }, shown('hair', 'helmet')),
        // Over the whole skull, the back of the head and the nape; the face stays open.
        part({ name: 'helmet', parent: 'head', box: [r2(HW), r2(HH)], offset: [offset[0], r2(offset[1] + (HH - hh) / 2)], shapes: [
          { path: `M${x(0.05)} ${y(0.8)} Q${x(-0.01)} ${y(0.01)} ${x(0.52)} ${y(0.01)} Q${x(0.96)} ${y(0.03)} ${x(0.95)} ${y(0.44)} L${x(0.52)} ${y(0.44)} Q${x(0.44)} ${y(0.5)} ${x(0.44)} ${y(0.8)} Z`, fill: metal, sw: 'regular', bbox: [0, 0, HW, HH * 0.8] },
          { path: `M${x(0.93)} ${y(0.41)} L${x(0.5)} ${y(0.41)}`, fill: 'none', stroke: trim, sw: 'regular' },
          { path: `M${x(0.5)} ${y(0.03)} Q${x(0.72)} ${y(0.16)} ${x(0.7)} ${y(0.38)}`, fill: 'none', stroke: line, sw: 'thin' },
        ] }, wear.has('helmet')),
      ];
    },
  };
}

/** A round plate over the shoulder and the top of the upper arm. */
function pauldron(name, parent, [joint, , w1], m, fill, trim) {
  const W = (w1 + 2 * m) * 1.35, H = (w1 + 2 * m) * 1.2;
  return { name, parent, box: [r2(W), r2(H)], offset: [r2(joint[0]), r2(joint[1] - w1 * 0.1)], pivot: [0, r2(w1 * 0.1)], shapes: [
    { path: `M${r2(W * 0.05)} ${r2(H * 0.8)} Q${r2(W * 0.03)} ${r2(H * 0.05)} ${r2(W * 0.5)} ${r2(H * 0.05)} Q${r2(W * 0.97)} ${r2(H * 0.05)} ${r2(W * 0.95)} ${r2(H * 0.8)} Q${r2(W * 0.5)} ${r2(H * 0.98)} ${r2(W * 0.05)} ${r2(H * 0.8)} Z`, fill, sw: 'regular', bbox: [0, 0, W, H] },
    { path: `M${r2(W * 0.12)} ${r2(H * 0.58)} Q${r2(W * 0.5)} ${r2(H * 0.76)} ${r2(W * 0.88)} ${r2(H * 0.58)}`, fill: 'none', stroke: trim, sw: 'regular' },
  ] };
}

/** A boot or a sabaton over the shoe, on the foot's bone (the same centre and ankle). */
function shoe(name, parent, { x, fw, fh, heel, legW }, m, fill, plates) {
  const W = fw + 2 * m, H = fh + 2 * m;
  return { name, parent, box: [r2(W), r2(H)], offset: [r2(x - heel + fw / 2), r2(fh / 2)], pivot: [r2(heel - fw / 2), r2(fh / 2 - legW * 0.3)], shapes: [
    { path: shoePath(W, H, 0), fill, sw: 'regular', bbox: [0, 0, W, H] },
    ...(plates ? [{ line: [r2(W * 0.5), r2(H * 0.1), r2(W * 0.62), r2(H * 0.9)], stroke: plates, sw: 'thin' }, { line: [r2(W * 0.7), r2(H * 0.2), r2(W * 0.8), r2(H * 0.9)], stroke: plates, sw: 'thin' }] : []),
  ] };
}
