// Raster art in (experimental): a picture another AI painted becomes parts the studio rigs.
//
//   keyOut      a flat key background (magenta, green) or a real alpha channel becomes clean alpha;
//               the key colour that bled into soft edges is taken out again (despill)
//   findPieces  the separate pieces of a parts sheet: connected regions of opaque pixels
//   assembleSideBiped  named pieces of a side-view figure placed on a skeleton: limbs hang from
//               shoulder and hip, each turns at the centre of its rounded top end
//   placeGear   accessories (hat, weapon, shield, quiver, cape, pouch) on the bone that carries them
//   rasterRig   the parts, as images, become an atlas page and a Spine 4.2 skeleton; gear goes in skins
//
// What it cannot do: split one fused figure into parts (that needs the parts drawn apart, or a
// mesh bound to a skeleton over the whole picture; see tools/raster-trial.js).
//
// Pure: RGBA images in ({ width, height, data }), plain data out.

import { StudioError } from '../shared/errors.js';
import { rigFromImages } from './svg-rig.js';

/** The key colour: the colour most of the border has, or null when the border is already transparent. */
export function detectKey(img) {
  const { width: w, height: h, data } = img;
  const counts = new Map();
  let clear = 0, total = 0;
  const visit = (x, y) => {
    const i = (y * w + x) * 4;
    total++;
    if (data[i + 3] < 16) { clear++; return; }
    const k = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  for (let x = 0; x < w; x++) { visit(x, 0); visit(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { visit(0, y); visit(w - 1, y); }
  if (clear > total / 2) return null;
  const [best, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (n < total * 0.6) throw new StudioError('bad-argument', 'The picture has no flat background colour along its border; ask for one flat key colour (#FF00FF) or a transparent background.', { share: n / total });
  // The average of the pixels in that bucket, so the key is exact rather than bucketed.
  const sum = [0, 0, 0]; let m = 0;
  const [br, bg, bb] = best.split(',').map(Number);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] >> 4 === br && data[i + 1] >> 4 === bg && data[i + 2] >> 4 === bb) { sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; m++; }
  }
  return sum.map(v => Math.round(v / m));
}

/**
 * Alpha from the key colour. Within `inner` of the key a pixel is background, beyond `outer` it is
 * art, between the two it is a soft edge whose key share is taken out of its colour.
 * @returns {{ width: number, height: number, data: Uint8Array, key: number[]|null }}
 */
export function keyOut(img, { key = detectKey(img), inner = 60, outer = 150 } = {}) {
  const { width, height } = img;
  const data = new Uint8Array(img.data);
  if (!key) return { width, height, data, key: null };
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.hypot(data[i] - key[0], data[i + 1] - key[1], data[i + 2] - key[2]);
    let a = d <= inner ? 0 : d >= outer ? 1 : (d - inner) / (outer - inner);
    // Magenta or green fringes: a pixel that leans toward the key more than its neighbours do.
    if (a > 0 && a < 1) {
      for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, Math.round((data[i + c] - (1 - a) * key[c]) / a)));
    }
    a *= data[i + 3] / 255;
    data[i + 3] = Math.round(a * 255);
    if (data[i + 3] === 0) { data[i] = data[i + 1] = data[i + 2] = 0; }
  }
  return { width, height, data, key };
}

/**
 * The pieces of a parts sheet: 8-connected regions of pixels at least `alphaMin` opaque, larger
 * than `minShare` of the picture. Each comes cropped (with `pad` px of its soft edge), largest first
 * is not assumed: they are listed in reading order (top to bottom, then left to right).
 */
export function findPieces(img, { alphaMin = 128, minShare = 0.0004, pad = 3 } = {}) {
  const { width: w, height: h, data } = img;
  const label = new Int32Array(w * h);
  const pieces = [];
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (label[start] || data[start * 4 + 3] < alphaMin) continue;
    const id = pieces.length + 1;
    let x0 = w, y0 = h, x1 = -1, y1 = -1, area = 0;
    label[start] = id; stack.push(start);
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p - x) / w;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (!label[q] && data[q * 4 + 3] >= alphaMin) { label[q] = id; stack.push(q); }
      }
    }
    pieces.push({ id, area, box: [x0, y0, x1 - x0 + 1, y1 - y0 + 1] });
  }
  const kept = pieces.filter(p => p.area >= minShare * w * h);
  // Crop each with its soft edge: pixels of its own label, plus unlabelled soft pixels in its box.
  const out = kept.map(p => {
    const [bx, by, bw, bh] = p.box;
    const x0 = Math.max(0, bx - pad), y0 = Math.max(0, by - pad), x1 = Math.min(w, bx + bw + pad), y1 = Math.min(h, by + bh + pad);
    const cw = x1 - x0, ch = y1 - y0, crop = new Uint8Array(cw * ch * 4);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const q = (y0 + y) * w + (x0 + x);
      if (label[q] === p.id || (label[q] === 0 && data[q * 4 + 3] > 0)) crop.set(data.subarray(q * 4, q * 4 + 4), (y * cw + x) * 4);
    }
    return { box: [x0, y0, cw, ch], area: p.area, image: { width: cw, height: ch, data: crop } };
  });
  const rowOf = p => Math.round((p.box[1] + p.box[3] / 2) / (h / 8));
  out.sort((a, b) => rowOf(a) - rowOf(b) || a.box[0] - b.box[0]);
  return out.map((p, i) => ({ index: i + 1, ...p }));
}

/** The parts of a side-view figure, back to front, and the joint each hangs from. */
export const SIDE_BIPED = Object.freeze([
  { name: 'upperArmBack', hang: 'shoulder' }, { name: 'forearmBack', hang: 'upperArmBack' },
  { name: 'thighBack', hang: 'hip' }, { name: 'shinBack', hang: 'thighBack' },
  { name: 'torso' },
  { name: 'thighFront', hang: 'hip' }, { name: 'shinFront', hang: 'thighFront' },
  { name: 'head', hang: 'neck' },
  { name: 'upperArmFront', hang: 'shoulder' }, { name: 'forearmFront', hang: 'upperArmFront' },
]);

/**
 * The drawing order, back to front, apart from the placing order above: the far limbs go behind the
 * torso, every upper segment covers the rounded top of the one below it (sleeve over forearm, thigh
 * over shin, so a joint never shows two caps), the torso's hem covers the tops of both thighs, and its collar covers the bottom of the neck.
 */
export const SIDE_BIPED_DRAW = Object.freeze(['forearmBack', 'upperArmBack', 'shinBack', 'thighBack', 'shinFront', 'thighFront',
  'head', 'torso', 'forearmFront', 'upperArmFront']);

/**
 * Place named pieces on a side-view skeleton (rig units, y up, feet near y = 0).
 * @param {Record<string, { image: { width: number, height: number } }>} named  piece by part name
 * @param {{ scale?: number, joints?: { shoulder?: number[], hip?: number[], neck?: number[] } }} [options]
 *   scale: rig units per pixel; joints: where on the torso (0..1 of its box, x to the front, y down) shoulder, hip and neck are
 */
export function assembleSideBiped(named, { scale = 0.5, joints = {} } = {}) {
  const missing = SIDE_BIPED.filter(p => !named[p.name]).map(p => p.name);
  if (missing.length) throw new StudioError('bad-argument', `Name a piece for every part; missing: ${missing.join(', ')}.`, { missing });
  const size = n => [named[n].image.width * scale, named[n].image.height * scale];
  const [tw, th] = size('torso');
  const legLength = Math.max(...['Front', 'Back'].map(s => limbReach(size(`thigh${s}`)) + limbReach(size(`shin${s}`))));
  // Torso centre such that the hip sits a leg's length above the ground.
  // The neck is measured: the middle of the torso's top edge (a collar drawn to the front moves it).
  const timg = named.torso.image, collar = rowRun(timg, 0.03);
  // The hip sits well inside the torso, so a hem or a shirt tail covers the round tops of the thighs.
  const J = { shoulder: [0.55, 0.12], hip: [0.5, 0.75], neck: [collar.x / timg.width, 0.03], ...joints };
  const torsoAt = [0, legLength + th * (J.hip[1] - 0.5)];
  const onTorso = (/** @type {number[]} */ f) => [torsoAt[0] + (f[0] - 0.5) * tw, torsoAt[1] + (0.5 - f[1]) * th];
  const parts = new Map();
  parts.set('torso', { name: 'torso', at: torsoAt, pivot: onTorso(J.hip), parent: null, size: [tw, th] });
  const reachEnd = new Map();
  for (const p of SIDE_BIPED) {
    if (p.name === 'torso') continue;
    const [w, h] = size(p.name);
    if (p.name === 'head') {
      // The head turns at the neck: the middle of the neck at the bottom of the piece goes on the
      // torso's neck point, sunk a little so the collar (drawn over it) hides where the neck ends.
      const pivot = onTorso(J.neck), neck = rowRun(named.head.image, 0.97);
      const sink = th * 0.05;
      parts.set('head', { name: 'head', at: [pivot[0] + (w / 2 - neck.x * scale), pivot[1] - sink + h / 2], pivot, parent: 'torso', size: [w, h] });
      continue;
    }
    // A limb hangs straight down from its joint; it turns at the centre of its rounded top end,
    // measured on the picture (a shin with a boot is wider at the bottom than at the knee).
    const pivot = p.hang === 'shoulder' || p.hang === 'hip' ? onTorso(J[p.hang]) : reachEnd.get(p.hang);
    const img = named[p.name].image;
    const top = endCentre(img, 'top'), bottom = endCentre(img, 'bottom');
    const topW = top.width * scale, inset = Math.min(topW / 2, h / 4);
    const at = [pivot[0] + (w / 2 - top.x * scale), pivot[1] + inset - h / 2];
    parts.set(p.name, { name: p.name, at, pivot, parent: p.hang === 'shoulder' || p.hang === 'hip' ? 'torso' : p.hang, size: [w, h] });
    // The next joint: the centre of this limb's shaft just above its bottom end.
    reachEnd.set(p.name, [at[0] - w / 2 + bottom.x * scale, pivot[1] - (h - 2 * inset)]);
  }
  return SIDE_BIPED_DRAW.map(n => parts.get(n));
}
/** @param {number[]} s */
const limbReach = s => s[1] - 2 * Math.min(s[0] / 2, s[1] / 4);

/**
 * The centre (x, px) and width of a limb's shaft near one end: the opaque run in the row a fifth
 * of the way in from that end (a boot or a hand at the far end does not move the knee or elbow).
 */
export function endCentre(img, end) {
  return rowRun(img, end === 'top' ? 0.2 : 0.55);
}

/** The centre (x, px) and width of the opaque run in the row at that fraction of the height. */
export function rowRun(img, fy) {
  const { width: w, height: h, data } = img;
  const y = Math.min(h - 1, Math.max(0, Math.round(h * fy)));
  let x0 = -1, x1 = -1;
  for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] >= 128) { if (x0 < 0) x0 = x; x1 = x; }
  return x0 < 0 ? { x: w / 2, width: w } : { x: (x0 + x1 + 1) / 2, width: x1 - x0 + 1 };
}

/** Where each kind of gear hangs, which bone carries it, and where it is drawn. */
const GEAR_ON = Object.freeze({
  head: { bone: 'head', drawAfter: 'torso' },          // hat, hood, helmet: over the head and the collar
  hand: { bone: 'forearmFront', drawBefore: 'forearmFront' }, // held in the near hand, under the fingers
  offhand: { bone: 'forearmBack', drawAfter: 'forearmBack' }, // shield or lantern in the far hand
  back: { bone: 'torso', drawFirst: true },            // cape, quiver, backpack: behind everything
  hip: { bone: 'torso', drawAfter: 'torso' },          // knife, satchel, pouch: over the hip
});
export const GEAR_KINDS = Object.freeze(Object.keys(GEAR_ON));

/**
 * Gear (accessories) placed on an assembled side-view figure, each on the bone that carries it,
 * so it can be shown or hidden by skin.
 *   head    the gear's box is centred on the head's box and its top sits a little above the head's
 *   hand / offhand  the grip (middle of the gear's bottom eighth) goes in the hand (the forearm
 *           piece near its lower end); `rotate` turns it about the grip (0 = pointing up)
 *   back    the gear's box centre on the upper back of the torso; hip: on the front of the hip
 * `offset` ([dx, dy] in body-sheet pixels, y down) and `rotate` (degrees, counter-clockwise) fine-tune
 * each piece after looking at it; `ratio` is gear-sheet pixels to body-sheet pixels.
 * @param {Array<{ name: string, at: number[], pivot: number[], parent: string|null, size: number[] }>} parts  from assembleSideBiped
 * @param {Record<string, { image: { width: number, height: number, data: Uint8Array } }>} named  the body pieces
 * @param {Array<{ name: string, on: string, image: { width: number, height: number, data: Uint8Array }, offset?: number[], rotate?: number }>} gear
 * @param {{ scale?: number, ratio?: number }} [options]
 */
export function placeGear(parts, named, gear, { scale = 0.5, ratio = 1 } = {}) {
  const byName = new Map(parts.map(p => [p.name, p]));
  const out = [...parts];
  for (const g of gear) {
    const on = GEAR_ON[g.on];
    if (!on) throw new StudioError('bad-argument', `Gear "${g.name}": "on" is one of ${GEAR_KINDS.join(', ')}.`, { gear: g.name });
    if (byName.has(g.name)) throw new StudioError('bad-argument', `Gear "${g.name}" has the name of a body part.`, { gear: g.name });
    const k = scale * ratio, w = g.image.width * k, h = g.image.height * k;
    const [dx, dy] = g.offset ?? [0, 0], off = [dx * scale, -dy * scale];
    const bone = byName.get(on.bone);
    const rot = (g.rotate ?? 0) * Math.PI / 180;
    let pivot, centre;
    if (g.on === 'hand' || g.on === 'offhand') {
      // The hand: the middle of the forearm piece near its lower end, in rig units.
      const img = named[on.bone].image, palm = rowRun(img, 0.86);
      pivot = [bone.at[0] - bone.size[0] / 2 + palm.x * scale + off[0], bone.at[1] + bone.size[1] / 2 - img.height * 0.86 * scale + off[1]];
      const grip = rowRun(g.image, 0.94);
      const fromGrip = [(g.image.width / 2 - grip.x) * k, (0.94 - 0.5) * h];
      centre = [pivot[0] + fromGrip[0] * Math.cos(rot) - fromGrip[1] * Math.sin(rot), pivot[1] + fromGrip[0] * Math.sin(rot) + fromGrip[1] * Math.cos(rot)];
    } else {
      const [bw, bh] = bone.size;
      const anchor = g.on === 'head' ? [bone.at[0], bone.at[1] + bh / 2 + bh * 0.04 - h / 2]
        : g.on === 'back' ? [bone.at[0] - bw * 0.25, bone.at[1] + bh * 0.15] : [bone.at[0] + bw * 0.1, bone.at[1] - bh * 0.2];
      centre = [anchor[0] + off[0], anchor[1] + off[1]];
      pivot = [...bone.pivot];
    }
    const part = { name: g.name, at: centre, pivot, parent: on.bone, size: [w, h], rotation: g.rotate ?? 0, gear: true };
    if (on.drawFirst) out.unshift(part);
    else {
      const i = out.findIndex(p => p.name === (on.drawAfter ?? on.drawBefore));
      out.splice(on.drawAfter ? i + 1 : i, 0, part);
    }
    byName.set(g.name, part);
  }
  return out;
}

/**
 * Raster parts become a rig: an atlas page with every part and a skeleton whose setup pose is the
 * assembled figure.
 * @param {{ name: string, parts: Array<{ name: string, at: number[], pivot: number[], parent: string|null, size: number[], gear?: boolean, rotation?: number }>, images: Record<string, { width: number, height: number, data: Uint8Array }> }} input
 */
export function rasterRig({ name, parts, images }) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new StudioError('bad-argument', 'The rig name is 1-64 letters, digits, _ or -.', { name });
  const rig = rigFromImages({ name, parts, regions: parts.map(p => p.name), images: parts.map(p => images[p.name]) });
  const gear = parts.filter(p => p.gear);
  if (!gear.length) return rig;
  // Gear lives in skins: one per piece, plus "full" with all of it; "default" is the bare body.
  // A turned piece keeps its box centre where placed: the attachment carries the rotation.
  const base = rig.skeleton.skins[0].attachments, moved = {};
  for (const p of gear) {
    const a = base[p.name][p.name];
    if (p.rotation) a.rotation = p.rotation;
    moved[p.name] = base[p.name];
    delete base[p.name];
  }
  rig.skeleton.skins.push(
    { name: 'full', attachments: { ...moved } },
    ...gear.map(p => ({ name: p.name, attachments: { [p.name]: moved[p.name] } })));
  return rig;
}

/** The opaque bounds of an image: [x, y, width, height], or null when it is all clear. */
function opaqueBox({ width: w, height: h, data }) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

/**
 * One fused figure on a skeleton (no cutting): the whole picture is one region on the root, and
 * bones are placed on it from points in picture pixels. paint_weights then binds the picture to
 * them, so it bends where the bones turn.
 * @param {{ name: string, image: { width: number, height: number, data: Uint8Array }, scale?: number,
 *   bones: Array<{ name: string, parent?: string, from: number[], to: number[] }> }} input
 */
export function puppetRig({ name, image, bones, scale = 0.5 }) {
  const box = opaqueBox(image);
  if (!box) throw new StudioError('bad-argument', 'The picture has nothing left once its background is taken out.');
  const [bx, by, bw, bh] = box, pad = 4;
  const x0 = Math.max(0, bx - pad), y0 = Math.max(0, by - pad), cw = Math.min(image.width, bx + bw + pad) - x0, ch = Math.min(image.height, by + bh + pad) - y0;
  const crop = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) crop.set(image.data.subarray(((y0 + y) * image.width + x0) * 4, ((y0 + y) * image.width + x0 + cw) * 4), y * cw * 4);
  // Picture pixels to rig units: x to the right, y up, the bottom centre of the figure at 0, 0.
  const toRig = (/** @type {number[]} */ p) => [(p[0] - (bx + bw / 2)) * scale, (by + bh - p[1]) * scale];
  const world = new Map([['root', { o: [0, 0], angle: 0 }]]);
  const out = [{ name: 'root' }];
  for (const b of bones) {
    const parent = b.parent ?? 'root';
    if (!world.has(parent)) throw new StudioError('bad-argument', `Bone "${b.name}": its parent "${parent}" must come before it.`, { bone: b.name });
    const o = toRig(b.from), tip = toRig(b.to), p = world.get(parent);
    const angle = Math.atan2(tip[1] - o[1], tip[0] - o[0]) * 180 / Math.PI;
    const r = -p.angle * Math.PI / 180, dx = o[0] - p.o[0], dy = o[1] - p.o[1];
    out.push({ name: b.name, parent, length: +Math.hypot(tip[0] - o[0], tip[1] - o[1]).toFixed(2),
      x: +(dx * Math.cos(r) - dy * Math.sin(r)).toFixed(2), y: +(dx * Math.sin(r) + dy * Math.cos(r)).toFixed(2), rotation: +(angle - p.angle).toFixed(2) });
    world.set(b.name, { o, angle });
  }
  const at = toRig([x0 + cw / 2, y0 + ch / 2]);
  const parts = [{ name: 'body', at, pivot: [0, 0], parent: null, size: [cw * scale, ch * scale] }];
  const rig = rigFromImages({ name, parts, regions: ['body'], images: [{ width: cw, height: ch, data: crop }] });
  // The image hangs on the root; the bones only exist to bend it once it is painted.
  rig.skeleton.bones = [...out, { name: 'body', parent: 'root' }];
  return rig;
}
