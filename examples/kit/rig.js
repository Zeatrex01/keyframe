// The example kit's rig builder: pieces of art (drawn with ./canvas.js, or given as pictures)
// become an atlas page and a Spine 4.2 skeleton whose setup pose is the finished picture.
//
// A rig is { name, pieces, bones?, ik?, events?, bounds?, ground?, density? }. A piece is:
//   { name, parent?, at:[x,y], pivot?:[x,y], aim?:[x,y], size:[w,h], draw(g, w, h, args)?, image?, args?,
//     slot?, shown?, on?, blend?, hidden?, color? }
//   at     centre of the art in rig space (origin at the ground centre, y UP)
//   pivot  where its bone sits (default: the art centre); it turns and scales there
//   aim    the point the bone's x axis looks at (gives it a rotation and a length)
//   parent the piece or bone that carries it (default 'body', which sits at [0, ground])
//   draw   paints on a canvas of w x h logical units, y DOWN; `image` is a ready picture instead
//   slot   pieces sharing a slot are its attachments; the first declares the bone, `shown` picks
//          the one in the setup pose
//   on     the piece is one more slot on the bone another piece defines
//   hidden the slot starts transparent (a clip fades it in); `color` sets any setup colour
// `bones` adds bones without art: { name, parent?, at, aim? }.
import fs from 'node:fs';
import path from 'node:path';
import { createContext } from './canvas.js';
import { pack } from './atlas.js';

const turn = ([x, y], deg) => { const r = deg * Math.PI / 180, c = Math.cos(r), n = Math.sin(r); return [x * c - y * n, x * n + y * c]; };
const r2 = v => +v.toFixed(2);

/** Paint every piece that has art: [{ name, image }] at `density` pixels per unit. */
export function paint(pieces, density) {
  return pieces.filter(p => (p.draw || p.image) && !p.clip).map(p => {
    if (p.image) return { name: p.name, image: p.image };
    const g = createContext(p.size[0], p.size[1], density);
    p.draw(g, p.size[0], p.size[1], p.args ?? {});
    return { name: p.name, image: g.toImage() };
  });
}

/** Build the skeleton JSON (no animations) from a rig description. */
export function skeletonOf(rig) {
  const BODY = [0, rig.ground ?? 0];
  const world = { root: { p: [0, 0], rot: 0 }, body: { p: BODY, rot: 0 } };
  const bones = [{ name: 'root' }, { name: 'body', parent: 'root', ...(BODY[1] ? { y: BODY[1] } : {}) }], slots = [], att = {};
  const first = new Map();
  for (const p of rig.pieces) { if (p.on) continue; const slot = p.slot ?? p.name; if (!first.has(slot)) first.set(slot, p); }
  for (const b of rig.bones ?? []) first.set(b.name, { ...b, artless: true });
  const addBone = name => {
    if (name in world) return;
    const p = first.get(name);
    if (!p) throw new Error(`${rig.name}: nothing defines the bone "${name}"`);
    const parent = p.parent ?? 'body', pivot = p.pivot ?? p.at;
    addBone(parent);
    const up = world[parent];
    const rot = p.aim ? Math.atan2(p.aim[1] - pivot[1], p.aim[0] - pivot[0]) * 180 / Math.PI : 0;
    const [x, y] = turn([pivot[0] - up.p[0], pivot[1] - up.p[1]], -up.rot);
    const local = r2(rot - up.rot), length = p.aim ? Math.hypot(p.aim[0] - pivot[0], p.aim[1] - pivot[1]) : (p.length ?? 0);
    world[name] = { p: pivot, rot };
    bones.push({ name, parent, ...(r2(x) ? { x: r2(x) } : {}), ...(r2(y) ? { y: r2(y) } : {}), ...(local ? { rotation: local } : {}), ...(length ? { length: r2(length) } : {}) });
  };
  for (const name of first.keys()) addBone(name);
  for (const p of rig.pieces) {
    const slot = p.slot ?? p.name;
    if (!(slot in att)) {
      const color = p.color ?? (p.hidden ? 'ffffff00' : null);
      slots.push({ name: slot, bone: p.on ?? slot, ...(p.slot ? {} : { attachment: p.name }), ...(color ? { color } : {}), ...(p.blend ? { blend: p.blend } : {}) });
      att[slot] = {};
    }
    const { p: pivot, rot } = world[p.on ?? slot];
    if (p.clip) { // a clipping attachment: slots from this one to `clip.end` draw only inside `clip.points`
      const vertices = p.clip.points.flatMap(([x, y]) => turn([x - pivot[0], y - pivot[1]], -rot).map(r2));
      att[slot][p.name] = { type: 'clipping', end: p.clip.end, vertexCount: p.clip.points.length, vertices };
      slots.find(s => s.name === slot).attachment = p.name;
      continue;
    }
    const [ax, ay] = turn([p.at[0] - pivot[0], p.at[1] - pivot[1]], -rot);
    if (p.slot && p.shown) slots.find(s => s.name === slot).attachment = p.name;
    att[slot][p.name] = { x: r2(ax), y: r2(ay), ...(rot ? { rotation: r2(-rot) } : {}), width: p.size[0], height: p.size[1] };
  }
  const ik = (rig.ik ?? []).map((c, order) => ({ name: c.name, order, bones: c.bones, target: c.target, ...(c.bendPositive === false ? { bendPositive: false } : {}) }));
  const bounds = rig.bounds ?? { x: -140, y: -140, width: 280, height: 280 };
  return {
    skeleton: { hash: rig.name, spine: '4.2.43', ...bounds, images: '', audio: '' },
    bones, slots, ...(ik.length ? { ik } : {}),
    skins: [{ name: 'default', attachments: Object.fromEntries(Object.entries(att).filter(([, v]) => Object.keys(v).length)) }],
    ...(rig.events?.length ? { events: Object.fromEntries(rig.events.map(e => [e, {}])) } : {}),
    animations: {},
  };
}

/** Write <dir>/<name>.json, .atlas and .png. */
export function buildRig(rig, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const art = paint(rig.pieces, rig.density ?? 2);
  const page = pack(art, rig.name + '.png');
  fs.writeFileSync(path.join(dir, rig.name + '.png'), page.png);
  fs.writeFileSync(path.join(dir, rig.name + '.atlas'), page.atlas);
  const sk = skeletonOf(rig);
  fs.writeFileSync(path.join(dir, rig.name + '.json'), JSON.stringify(sk, null, 1) + '\n');
  return { sk, page };
}
