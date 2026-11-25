// A wardrobe for the bare side-view figure (src/art/figure-side.js with `bare: true`): the figure is a
// bald body in a plain base layer, and every garment and armour piece is a part of its own on the
// bone it covers, so a game puts each one on or takes it off by itself.
//
//   { component: 'figure', build: 'side', bare: true, wear: ['hair', 'shirt', 'trousers', 'boots', 'cuirass'] }
//
// Items (`wear` lists the ones worn; the rest are drawn too, hidden, for the game to show):
//   cloth   hair (`hairStyle`: short, spiky, long, swept), shirt (body and both sleeves), trousers (waist and both legs), boots
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

/** The lower `f` of a limb: [joint, length, width at the joint, width at the end]. */
const lower = ([joint, len, w1, w2], f) => [[joint[0], joint[1] - len * (1 - f)], len * f, w1 + (w2 - w1) * (1 - f), w2];

/** The torso's outline in a W x H box (the chest to the front, +x). */
export function torsoPath(W, H, sw) {
  const x0 = sw / 2, x1 = W - sw / 2;
  return `M${r2(x0 + W * 0.12)} ${r2(sw / 2)} L${r2(x1 - W * 0.3)} ${r2(sw / 2)} Q${r2(x1)} ${r2(H * 0.06)} ${r2(x1)} ${r2(H * 0.4)} L${r2(x1 - W * 0.04)} ${r2(H - sw / 2)} L${r2(x0 + W * 0.04)} ${r2(H - sw / 2)} L${r2(x0)} ${r2(H * 0.25)} Q${r2(x0)} ${r2(sw / 2)} ${r2(x0 + W * 0.12)} ${r2(sw / 2)} Z`;
}

export const HAIR_STYLES = Object.freeze(['short', 'spiky', 'long', 'swept']);

/** The hair over the top and the back of the head, in the head's box, in one of HAIR_STYLES. */
export function hairPath(hw, hh, style = 'short') {
  const hx = v => r2(v * hw), hy = v => r2(v * hh);
  // Spiky: tufts standing up over the crown. Long: down the back to the nape, a fringe in front.
  // Swept: a high quiff swept back.
  if (style === 'spiky') return `M${hx(0.1)} ${hy(0.64)} L${hx(0.04)} ${hy(0.3)} L${hx(0.16)} ${hy(0.2)} L${hx(0.14)} ${hy(0.02)} L${hx(0.32)} ${hy(0.1)} L${hx(0.42)} ${hy(-0.04)} L${hx(0.54)} ${hy(0.08)} L${hx(0.7)} ${hy(0)} L${hx(0.74)} ${hy(0.14)} L${hx(0.94)} ${hy(0.16)} L${hx(0.86)} ${hy(0.3)} Q${hx(0.7)} ${hy(0.26)} ${hx(0.6)} ${hy(0.32)} Q${hx(0.48)} ${hy(0.4)} ${hx(0.4)} ${hy(0.36)} Q${hx(0.3)} ${hy(0.5)} ${hx(0.24)} ${hy(0.72)} Q${hx(0.14)} ${hy(0.74)} ${hx(0.1)} ${hy(0.64)} Z`;
  if (style === 'long') return `M${hx(0.18)} ${hy(0.98)} Q${hx(0.0)} ${hy(0.8)} ${hx(0.04)} ${hy(0.4)} Q${hx(0.06)} ${hy(0.0)} ${hx(0.55)} ${hy(0.01)} Q${hx(0.94)} ${hy(0.04)} ${hx(0.92)} ${hy(0.42)} Q${hx(0.84)} ${hy(0.3)} ${hx(0.74)} ${hy(0.3)} Q${hx(0.6)} ${hy(0.36)} ${hx(0.44)} ${hy(0.36)} Q${hx(0.3)} ${hy(0.5)} ${hx(0.32)} ${hy(0.98)} Z`;
  if (style === 'swept') return `M${hx(0.1)} ${hy(0.6)} Q${hx(0.0)} ${hy(0.1)} ${hx(0.4)} ${hy(-0.02)} Q${hx(0.82)} ${hy(-0.1)} ${hx(1.0)} ${hy(0.12)} Q${hx(0.9)} ${hy(0.14)} ${hx(0.86)} ${hy(0.24)} Q${hx(0.7)} ${hy(0.22)} ${hx(0.58)} ${hy(0.3)} Q${hx(0.44)} ${hy(0.36)} ${hx(0.4)} ${hy(0.34)} Q${hx(0.3)} ${hy(0.46)} ${hx(0.24)} ${hy(0.68)} Q${hx(0.14)} ${hy(0.7)} ${hx(0.1)} ${hy(0.6)} Z`;
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
        part(tube(`rerebrace${s}`, `upperArm${s}`, g.limbs[`upperArm${s}`], mA, tone(metal), (W, H) => [...band(0.5, tone(line))(W, H), ...band(0.7, tone(line))(W, H),
          { line: [r2(W * 0.1), r2(H * 0.88), r2(W * 0.9), r2(H * 0.88)], stroke: tone(trim), sw: 'thin' }]), wear.has('pauldrons')),
      ],
      lower: [
        part(tube(`cuff${s}`, `forearm${s}`, g.limbs[`forearm${s}`], m, tone(shirt), (W, H) => [
          { rect: [r2(W * 0.06), r2(H * 0.8), r2(W * 0.88), r2(H * 0.12)], r: 'sm', fill: tone(darken(shirt, 0.12)), sw: 'thin', shade: false }]), shown('shirt', 'vambraces')),
        part(tube(`vambrace${s}`, `forearm${s}`, g.limbs[`forearm${s}`], mA, tone(metal), (W, H) => [
          { line: [r2(W * 0.14), r2(H * 0.3), r2(W * 0.86), r2(H * 0.3)], stroke: tone(trim), sw: 'thin' },
          { line: [r2(W * 0.16), r2(H * 0.78), r2(W * 0.84), r2(H * 0.78)], stroke: tone(line), sw: 'thin' }]), wear.has('vambraces')),
      ],
      top: [part(pauldron(`pauldron${s}`, `upperArm${s}`, g.limbs[`upperArm${s}`], mA, tone(metal), tone(trim)), wear.has('pauldrons'))],
    }),
    leg: (s, tone) => ({
      thigh: [
        part(tube(`trouser${s}`, `thigh${s}`, g.limbs[`thigh${s}`], m, tone(pants), (W, H) => [
          { path: `M${r2(W * 0.62)} ${r2(H * 0.55)} Q${r2(W * 0.74)} ${r2(H * 0.7)} ${r2(W * 0.66)} ${r2(H * 0.84)}`, fill: 'none', stroke: tone(darken(pants, 0.2)), sw: 'thin' }]), shown('trousers', 'cuisses')),
        part(tube(`cuisse${s}`, `thigh${s}`, g.limbs[`thigh${s}`], mA, tone(metal), (W, H) => [
          // a tasset flaring over the top of the thigh
          { path: `M${r2(-W * 0.06)} ${r2(H * 0.02)} L${r2(W * 1.06)} ${r2(H * 0.02)} L${r2(W * 0.98)} ${r2(H * 0.3)} Q${r2(W * 0.5)} ${r2(H * 0.36)} ${r2(W * 0.02)} ${r2(H * 0.3)} Z`, fill: tone(metal), sw: 'regular', bbox: [0, 0, W, H * 0.36] },
          { line: [r2(W * 0.04), r2(H * 0.16), r2(W * 0.96), r2(H * 0.16)], stroke: tone(trim), sw: 'thin' },
          { line: [r2(W * 0.12), r2(H * 0.62), r2(W * 0.88), r2(H * 0.62)], stroke: tone(line), sw: 'thin' }]), wear.has('cuisses')),
      ],
      shin: [
        part(tube(`legging${s}`, `shin${s}`, g.limbs[`shin${s}`], m, tone(pants)), shown('trousers', 'greaves')),
        // the boot's shaft up the lower shin, its cuff turned over
        part(tube(`bootShaft${s}`, `shin${s}`, lower(g.limbs[`shin${s}`], 0.45), m * 1.6, tone(shoes), (W, H, top) => [
          { rect: [0, 0, r2(W), r2(top * 1.6)], r: 'sm', fill: tone(darken(shoes, 0.12)), sw: 'regular', shade: false }]), shown('boots', 'greaves')),
        part(tube(`greave${s}`, `shin${s}`, g.limbs[`shin${s}`], mA, tone(metal), (W, H, top) => [
          { path: `M${r2(W * 0.08)} ${r2(top * 1.2)} Q${r2(W * 0.5)} ${r2(top * 0.1)} ${r2(W * 1.04)} ${r2(top * 0.9)} Q${r2(W * 0.6)} ${r2(top * 2.1)} ${r2(W * 0.08)} ${r2(top * 1.2)} Z`, fill: tone(metal), sw: 'regular', bbox: [0, 0, W, top * 2] },
          { line: [r2(W * 0.16), r2(top * 1.9), r2(W * 0.84), r2(top * 1.9)], stroke: tone(trim), sw: 'thin' },
          { path: `M${r2(W * 0.7)} ${r2(top * 2.1)} Q${r2(W * 0.8)} ${r2(H * 0.55)} ${r2(W * 0.68)} ${r2(H * 0.92)}`, fill: 'none', stroke: tone(line), sw: 'thin' }]), wear.has('greaves')),
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
          (BW, BH) => ({ path: `M${r2(BW * 0.02)} ${r2(BH * 0.8)} L${r2(BW * 0.98)} ${r2(BH * 0.8)} L${r2(BW * 1.0)} ${r2(BH * 0.9)} L${r2(BW * 0.0)} ${r2(BH * 0.9)} Z`, fill: metal, sw: 'regular', bbox: [0, 0, BW, BH] }),
          (BW, BH) => ({ path: `M${r2(BW * 0.0)} ${r2(BH * 0.89)} L${r2(BW * 1.0)} ${r2(BH * 0.89)} L${r2(BW * 1.03)} ${r2(BH * 1.0)} L${r2(BW * -0.03)} ${r2(BH * 1.0)} Z`, fill: metal, sw: 'regular', bbox: [0, 0, BW, BH] }),
        ]), wear.has('cuirass')),
      ];
    },
    head: () => {
      const { hw, hh, offset } = g.head;
      const k = 1.03, HW = hw * k, HH = hh * k, x = v => r2(v * HW), y = v => r2(v * HH);
      return [
        part({ name: 'hair', parent: 'head', box: [r2(hw), r2(hh)], offset, shapes: [{ path: hairPath(hw, hh, HAIR_STYLES.includes(c.hairStyle) ? c.hairStyle : 'short'), fill: hair, sw: 'regular', bbox: [0, 0, hw, hh] }] }, shown('hair', 'helmet')),
        // Over the whole skull, the back of the head and the nape; the face stays open.
        part({ name: 'helmet', parent: 'head', box: [r2(HW), r2(HH)], offset: [offset[0], r2(offset[1] + (HH - hh) / 2)], shapes: [
          { path: `M${x(0.06)} ${y(0.74)} Q${x(0.0)} ${y(0.02)} ${x(0.52)} ${y(0.02)} Q${x(0.96)} ${y(0.04)} ${x(0.94)} ${y(0.42)} L${x(0.52)} ${y(0.42)} Q${x(0.43)} ${y(0.46)} ${x(0.42)} ${y(0.74)} Z`, fill: metal, sw: 'regular', bbox: [0, 0, HW, HH * 0.74] },
          { path: `M${x(0.07)} ${y(0.7)} L${x(0.41)} ${y(0.7)}`, fill: 'none', stroke: trim, sw: 'regular' },
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
    { path: `M${r2(W * 0.2)} ${r2(H * 0.36)} Q${r2(W * 0.5)} ${r2(H * 0.5)} ${r2(W * 0.8)} ${r2(H * 0.36)}`, fill: 'none', stroke: darken(fill, 0.25), sw: 'thin' },
  ] };
}

/** A boot or a sabaton over the shoe, on the foot's bone (the same centre and ankle). */
function shoe(name, parent, { x, fw, fh, heel, legW }, m, fill, plates) {
  const W = fw + 2 * m, H = fh + 2 * m;
  return { name, parent, box: [r2(W), r2(H)], offset: [r2(x - heel + fw / 2), r2(fh / 2)], pivot: [r2(heel - fw / 2), r2(fh / 2 - legW * 0.3)], shapes: [
    { path: shoePath(W, H, 0), fill, sw: 'regular', bbox: [0, 0, W, H] },
    ...(plates ? [0.42, 0.58, 0.74].map(f => ({ path: `M${r2(W * f)} ${r2(H * 0.06)} Q${r2(W * (f + 0.08))} ${r2(H * 0.5)} ${r2(W * (f + 0.06))} ${r2(H * 0.94)}`, fill: 'none', stroke: plates, sw: 'thin' }))
      : [{ rect: [r2(W * 0.02), r2(H * 0.82), r2(W * 0.96), r2(H * 0.16)], r: 'sm', fill: darken(fill, 0.25), sw: 'thin', shade: false }]),
  ] };
}
