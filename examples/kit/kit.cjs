// Icon kit: draws layered placeholder-free vector art in a headless browser, packs an atlas and
// writes a Spine 4.2 rig whose setup pose is the finished icon. One skeleton per icon.
//
// An icon is { name, pieces: [...] }. A piece is:
//   { name, parent?, at:[x,y], pivot?:[x,y], size:[w,h], draw(g,w,h,K), blend?, hidden? }
//   at     centre of the art in icon space (256 x 256, origin at the centre, y UP)
//   pivot  where its bone sits in icon space (default: the art centre); it rotates and scales there
//   parent name of the piece whose bone carries this one (default: 'body')
//   draw   runs in the browser on a 2D canvas of w x h logical px (y DOWN), drawn at 3x
// Every icon also gets: root > body (pivot at the bottom centre, for squash and jumps), a ground
// `shadow`, two `sparkle` slots and a notification `badge` (the last three hidden in setup).
const fs = require('fs'), path = require('path'); const { chromium } = require('playwright');

const HELPERS = `
const K = {
  ink: '#2b1b4d',
  // rounded rectangle path
  rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); },
  // n-point star path centred at cx,cy
  star(g, cx, cy, outer, inner, n = 5, rot = -Math.PI / 2) { g.beginPath(); for (let i = 0; i < n * 2; i++) { const r = i % 2 ? inner : outer, a = rot + i * Math.PI / n; g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); },
  // vertical gradient
  grad(g, y0, y1, stops) { const lg = g.createLinearGradient(0, y0, 0, y1); stops.forEach((c, i) => lg.addColorStop(i / (stops.length - 1), c)); return lg; },
  // fill the current path with a gradient, then a chunky dark outline (the shared look of the pack)
  paint(g, fill, line = 7) { g.fillStyle = fill; g.fill(); if (line) { g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = K.ink; g.lineWidth = line; g.stroke(); } },
  // soft white highlight clipped to the current path: call after paint() with the same path rebuilt by fn
  gloss(g, pathFn, x, y, w, h, alpha = 0.38) { g.save(); pathFn(); g.clip(); const lg = g.createLinearGradient(0, y, 0, y + h); lg.addColorStop(0, 'rgba(255,255,255,' + alpha + ')'); lg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = lg; g.beginPath(); g.ellipse(x + w / 2, y + h * 0.18, w * 0.62, h * 0.42, 0, 0, 7); g.fill(); g.restore(); },
  // darker band at the bottom, clipped to the path (gives volume)
  shade(g, pathFn, y, h, alpha = 0.18) { g.save(); pathFn(); g.clip(); g.fillStyle = 'rgba(43,27,77,' + alpha + ')'; g.fillRect(-999, y, 9999, h); g.restore(); },
};`;

const COMMON = [
  { name: 'shadow', parent: 'root', at: [0, -112], size: [190, 34], draw: (g, w, h) => { g.translate(w / 2, h / 2); g.scale(1, h / w); const r = g.createRadialGradient(0, 0, 2, 0, 0, w / 2); r.addColorStop(0, 'rgba(20,10,45,0.5)'); r.addColorStop(1, 'rgba(20,10,45,0)'); g.fillStyle = r; g.beginPath(); g.arc(0, 0, w / 2, 0, 7); g.fill(); } },
];
const SPARK = (g, w, h, K) => { K.star(g, w / 2, h / 2, w / 2 - 2, w * 0.12, 4); g.fillStyle = '#fff7c9'; g.fill(); g.beginPath(); g.arc(w / 2, h / 2, w * 0.13, 0, 7); g.fillStyle = '#ffffff'; g.fill(); };
const BADGE = (g, w, h, K) => { g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 5, 0, 7); K.paint(g, K.grad(g, 0, h, ['#ff6b6b', '#e02447']), 6); K.gloss(g, () => { g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 5, 0, 7); }, 6, 6, w - 12, h - 12, 0.45); g.fillStyle = '#fff'; g.font = '900 34px ui-sans-serif,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', w / 2, h / 2 + 2); };

async function buildIcon(icon, outRoot) {
  const ground = icon.ground ?? -104;
  const pieces = [...(icon.shadow === false ? [] : COMMON.map(p => ({ ...p, at: [0, ground - 8] }))), ...icon.pieces,
    { name: 'sparkle1', parent: 'root', at: icon.sparkles?.[0] ?? [-86, 78], size: [46, 46], draw: SPARK, hidden: true, blend: 'additive' },
    { name: 'sparkle2', parent: 'root', at: icon.sparkles?.[1] ?? [92, 34], size: [34, 34], draw: SPARK, hidden: true, blend: 'additive' },
    { name: 'badge', parent: 'root', at: icon.badge ?? [84, 88], size: [60, 60], draw: BADGE, hidden: true }];
  const browser = await chromium.launch(); const page = await browser.newPage();
  const art = await page.evaluate(({ helpers, defs }) => {
    const K = new Function(helpers + '; return K;')(); const S = 3, PAD = 4, SW = 2048;
    const out = defs.map(d => { const c = document.createElement('canvas'); c.width = d.w * S; c.height = d.h * S; const g = c.getContext('2d'); g.scale(S, S); new Function('g', 'w', 'h', 'K', 'A', 'return (' + d.draw + ')(g, w, h, K, A);')(g, d.w, d.h, K, d.args || {}); return { name: d.name, c }; });
    let x = PAD, y = PAD, rowH = 0; const regions = [];
    for (const p of out) { if (x + p.c.width + PAD > SW) { x = PAD; y += rowH + PAD; rowH = 0; } regions.push({ name: p.name, x, y, w: p.c.width, h: p.c.height }); x += p.c.width + PAD; rowH = Math.max(rowH, p.c.height); }
    const sheet = document.createElement('canvas'); sheet.width = SW; sheet.height = y + rowH + PAD; const sg = sheet.getContext('2d'); out.forEach((p, i) => sg.drawImage(p.c, regions[i].x, regions[i].y));
    return { data: sheet.toDataURL('image/png'), W: sheet.width, H: sheet.height, regions };
  }, { helpers: HELPERS, defs: pieces.filter(p => p.draw).map(p => ({ name: p.name, w: p.size[0], h: p.size[1], draw: p.draw.toString(), args: p.args })) });
  await browser.close();
  const dir = path.join(outRoot, icon.name); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, icon.name + '.png'), Buffer.from(art.data.split(',')[1], 'base64'));
  let atlas = icon.name + '.png\nsize: ' + art.W + ',' + art.H + '\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n';
  for (const r of art.regions) atlas += r.name + '\n  rotate: false\n  xy: ' + r.x + ', ' + r.y + '\n  size: ' + r.w + ', ' + r.h + '\n  orig: ' + r.w + ', ' + r.h + '\n  offset: 0, 0\n  index: -1\n';
  fs.writeFileSync(path.join(dir, icon.name + '.atlas'), atlas);
  // Every bone is placed in the picture (`at` / `pivot`, and `aim`: the point its x axis looks
  // at, which also gives its length); the local values Spine wants are worked out from the parent.
  const BODY = [0, icon.ground ?? -104], world = { root: { p: [0, 0], rot: 0 }, body: { p: BODY, rot: 0 } };
  const turn = ([x, y], deg) => { const r = deg * Math.PI / 180, c = Math.cos(r), n = Math.sin(r); return [x * c - y * n, x * n + y * c]; };
  const bones = [{ name: 'root' }, { name: 'body', parent: 'root', x: BODY[0], y: BODY[1] }], slots = [], att = {}, looks = {};
  // A piece may name a `slot`: pieces sharing one are its attachments (an eye's lids, a mouth's
  // shapes). The first declares the bone (at / pivot / parent); `shown: true` picks the one in
  // the setup pose (none when no piece says so). A piece without `slot` is its own slot.
  // Bones first, parents before children whatever the drawing order (an ear is drawn behind
  // the head it hangs from); then slots in drawing order.
  const first = new Map();
  // `on`: the piece is one more slot on a bone another piece defines (an outline layer behind its fill).
  for (const p of pieces) { if (p.on) continue; const slotName = p.slot ?? p.name; if (!first.has(slotName)) first.set(slotName, p); }
  for (const b of icon.bones ?? []) first.set(b.name, { parent: b.parent, at: b.at, aim: b.aim, artless: true });
  const addBone = slotName => {
    if (slotName in world) return;
    const p = first.get(slotName);
    if (!p) throw new Error(icon.name + ': no piece defines the bone "' + slotName + '"');
    const parent = p.parent ?? 'body', pivot = p.pivot ?? p.at;
    addBone(parent);
    const up = world[parent];
    const rot = p.aim ? Math.atan2(p.aim[1] - pivot[1], p.aim[0] - pivot[0]) * 180 / Math.PI : 0;
    const [x, y] = turn([pivot[0] - up.p[0], pivot[1] - up.p[1]], -up.rot);
    const local = +(rot - up.rot).toFixed(2);
    world[slotName] = { p: pivot, rot, length: p.aim ? Math.hypot(p.aim[0] - pivot[0], p.aim[1] - pivot[1]) : 0 };
    bones.push({ name: slotName, parent, x: +x.toFixed(2), y: +y.toFixed(2), ...(local ? { rotation: local } : {}), ...(p.aim ? { length: +Math.hypot(p.aim[0] - pivot[0], p.aim[1] - pivot[1]).toFixed(2) } : {}) });
  };
  for (const slotName of first.keys()) addBone(slotName);
  for (const p of pieces) {
    const slotName = p.slot ?? p.name;
    if (!(slotName in att)) {
      slots.push({ name: slotName, bone: p.on ?? slotName, ...(p.slot ? {} : { attachment: p.name }), ...(p.hidden ? { color: 'ffffff00' } : {}), ...(p.blend ? { blend: p.blend } : {}) });
      att[slotName] = {};
    }
    const { p: pivot, rot, length } = world[p.on ?? slotName];
    // `clip`: a clipping attachment (no art): the slots from this one to `clip.end` draw only inside
    // the polygon `clip.points`, given in the picture like everything else.
    if (p.clip) {
      const vertices = p.clip.points.flatMap(([x, y]) => turn([x - pivot[0], y - pivot[1]], -rot).map(v => +v.toFixed(2)));
      att[slotName][p.name] = { type: 'clipping', end: p.clip.end, vertexCount: p.clip.points.length, vertices };
      slots.find(s => s.name === slotName).attachment = p.name;
      continue;
    }
    const [ax, ay] = turn([p.at[0] - pivot[0], p.at[1] - pivot[1]], -rot);
    // `along`: the art is a limb drawn top to bottom; it lies along its bone from the joint
    // (its top) to the next joint, whatever way the bone points. Otherwise the art stays
    // upright where it was drawn.
    const placed = p.along ? { x: +(length / 2 + (p.along === true ? 0 : p.along)).toFixed(2), y: 0, rotation: 90, width: p.size[0], height: p.size[1] }
      : { x: +ax.toFixed(2), y: +ay.toFixed(2), ...(rot ? { rotation: +(-rot).toFixed(2) } : {}), width: p.size[0], height: p.size[1] };
    // A piece may belong to one or more named SKINS (an outfit, a hairstyle): the slot then
    // shows the attachment called after the slot, and each skin says which art that is.
    if (p.skin) {
      slots.find(s => s.name === slotName).attachment = slotName;
      for (const look of [].concat(p.skin)) { looks[look] ??= {}; looks[look][slotName] = { [slotName]: { path: p.name, ...placed } }; }
      continue;
    }
    if (p.slot && p.shown) slots.find(s => s.name === slotName).attachment = p.name;
    att[slotName][p.name] = placed;
  }
  const ik = (icon.ik ?? []).map((c, order) => ({ name: c.name, order, bones: c.bones, target: c.target, ...(c.bendPositive === false ? { bendPositive: false } : {}), ...(c.stretch ? { stretch: true } : {}) }));
  const sk = { skeleton: { hash: icon.name, spine: '4.2.43', ...(icon.bounds ?? { x: -140, y: -140, width: 280, height: 280 }), images: '', audio: '' }, bones, slots, ...(ik.length ? { ik } : {}), skins: [{ name: 'default', attachments: Object.fromEntries(Object.entries(att).filter(([, v]) => Object.keys(v).length)) }, ...Object.entries(looks).map(([name, attachments]) => ({ name, attachments }))], animations: {} };
  fs.writeFileSync(path.join(dir, icon.name + '.json'), JSON.stringify(sk, null, 1) + '\n');
  return { dir, bones: bones.map(b => b.name) };
}
module.exports = { buildIcon };
