// The shared human: ONE rig for every child character. A boy, a girl, and each outfit is a
// SKIN on the same bones, so every clip (the face emotions and the body moves) plays on all.
//
//   root > body (on the ground) > hips > thighL/R > shinL/R            (IK legL/R -> footTargetL/R)
//                               > waist > top > armL/R > forearmL/R > handL/R  (IK armL/R -> handTargetL/R)
//                                             > neck > head > the face rig (face.js)
//   body > footTargetL/R > footL/R (the shoe rides its target, so a planted foot stays flat)
//   top > chestControl > handTargetL/R (unrotated axes: x is sideways, y is up)
// Nothing above the head is ever scaled: breathing is the chest rising, a hop is the body
// travelling. That is what keeps the face intact.
//
// Proportions (a young child, about two heads tall): the head is the largest shape; shoulders
// about half the head's width; hands end at the hips; feet flat on the ground.
const { faceParts } = require('./face.cjs');
// The body is drawn on a small grid and enlarged about the neck by B, so its proportion to the
// head is one number: at 1.7 the child stands about 2.6 heads tall, with shoulders about 0.9 of
// the head's width and legs as long as the trunk.
const B = 1.7, NECK_Y = -104;
const GROUND = Math.round(NECK_Y + (-283 - NECK_Y) * B);
exports.GROUND = GROUND;
exports.BOUNDS = { x: -170, y: GROUND - 22, width: 340, height: 110 - (GROUND - 22) };
exports.VIEW = { x: -200, y: GROUND - 30, width: 400, height: 125 - (GROUND - 30) };

// ── drawing (each runs in the browser; colours and shapes come in through A) ──
const CAPSULE = (g, w, h, K, A) => { const p = () => K.rr(g, 5, 5, w - 10, h - 10, (w - 10) / 2); p(); K.paint(g, A.color, 6); if (A.cuff) { g.save(); p(); g.clip(); g.fillStyle = A.cuff; g.fillRect(0, h - 5 - A.cuffH, w, A.cuffH + 6); g.restore(); p(); g.strokeStyle = K.ink; g.lineWidth = 6; g.stroke(); } };
const FOREARM = (g, w, h, K, A) => { const r = (w - 8) / 2, aw = w - 14; const arm = () => K.rr(g, (w - aw) / 2, 4, aw, h - r - 8, aw / 2); arm(); K.paint(g, A.skin, 6); g.beginPath(); g.arc(w / 2, h - r - 4, r, 0, 7); K.paint(g, A.skin, 6); g.save(); arm(); g.clip(); g.fillStyle = A.skin; g.fillRect(0, 0, w, h - 2 * r - 2); g.restore(); };
const NECK = (g, w, h, K, A) => { K.rr(g, 4, 2, w - 8, h - 4, 8); K.paint(g, A.skin, 6); g.fillStyle = 'rgba(43,27,77,0.12)'; g.fillRect(6, 4, w - 12, 8); };
const SHOE = (g, w, h, K, A) => { if (A.mirror) { g.translate(w, 0); g.scale(-1, 1); } const p = () => { g.beginPath(); g.moveTo(8, h - 6); g.lineTo(8, 14); g.quadraticCurveTo(10, 5, 22, 6); g.quadraticCurveTo(w - 6, 8, w - 5, h - 12); g.quadraticCurveTo(w - 5, h - 6, w - 12, h - 6); g.closePath(); }; p(); K.paint(g, A.color, 6); g.save(); p(); g.clip(); g.fillStyle = A.sole; g.fillRect(0, h - 12, w, 12); if (A.strap) { g.fillStyle = A.strap; g.fillRect(14, 6, 8, h); } g.restore(); p(); g.strokeStyle = K.ink; g.lineWidth = 6; g.stroke(); };
// A top: shoulders, a neckline, an optional chest mark. The same outline for every top.
const TOP = (g, w, h, K, A) => {
  if (A.part === 'line') { g.translate(6, 6); w -= 12; h -= 12; }
  const p = () => { g.beginPath(); g.moveTo(20, 6); g.quadraticCurveTo(w / 2, 20, w - 20, 6); g.quadraticCurveTo(w - 4, 8, w - 6, 26); g.lineTo(w - 12, h - 10); g.quadraticCurveTo(w - 12, h - 5, w - 20, h - 5); g.lineTo(20, h - 5); g.quadraticCurveTo(12, h - 5, 12, h - 10); g.lineTo(6, 26); g.quadraticCurveTo(4, 8, 20, 6); g.closePath(); };
  p(); if (A.part === 'line') { K.paint(g, K.ink, 12); return; }
  g.fillStyle = K.grad(g, 0, h, [A.color, A.shade]); g.fill();
  g.save(); p(); g.clip();
  if (A.stripe) { g.fillStyle = A.stripe; g.fillRect(0, h * 0.42, w, 13); }
  if (A.trim) { g.strokeStyle = A.trim; g.lineWidth = 7; g.beginPath(); g.moveTo(22, 4); g.quadraticCurveTo(w / 2, 22, w - 22, 4); g.stroke(); }
  g.restore();
  if (A.mark === 'star') { K.star(g, w / 2, h * 0.56, 15, 6.5); K.paint(g, A.markColor, 4); }
  if (A.mark === 'heart') { g.beginPath(); const cx = w / 2, cy = h * 0.5; g.moveTo(cx, cy + 15); g.bezierCurveTo(cx - 24, cy, cx - 12, cy - 16, cx, cy - 4); g.bezierCurveTo(cx + 12, cy - 16, cx + 24, cy, cx, cy + 15); g.closePath(); K.paint(g, A.markColor, 4); }
};
const SHORTS = (g, w, h, K, A) => { const p = () => { g.beginPath(); g.moveTo(8, 6); g.lineTo(w - 8, 6); g.lineTo(w - 4, h - 6); g.lineTo(w / 2 + 5, h - 6); g.lineTo(w / 2, h * 0.52); g.lineTo(w / 2 - 5, h - 6); g.lineTo(4, h - 6); g.closePath(); }; p(); K.paint(g, K.grad(g, 0, h, [A.color, A.shade]), 6); if (A.band) { g.save(); p(); g.clip(); g.fillStyle = A.band; g.fillRect(0, 0, w, 13); g.restore(); p(); g.strokeStyle = K.ink; g.lineWidth = 6; g.lineJoin = 'round'; g.stroke(); } };
const SKIRT = (g, w, h, K, A) => { const p = () => { g.beginPath(); g.moveTo(24, 6); g.lineTo(w - 24, 6); g.quadraticCurveTo(w - 6, h * 0.5, w - 4, h - 12); g.quadraticCurveTo(w * 0.75, h - 2, w / 2, h - 10); g.quadraticCurveTo(w * 0.25, h - 2, 4, h - 12); g.quadraticCurveTo(6, h * 0.5, 24, 6); g.closePath(); }; p(); K.paint(g, K.grad(g, 0, h, [A.color, A.shade]), 6); g.save(); p(); g.clip(); g.strokeStyle = 'rgba(43,27,77,0.18)'; g.lineWidth = 4; for (const x of [0.3, 0.5, 0.7]) { g.beginPath(); g.moveTo(w * (0.5 + (x - 0.5) * 0.5), 10); g.lineTo(w * x, h); g.stroke(); } if (A.band) { g.fillStyle = A.band; g.fillRect(0, 0, w, 12); } g.restore(); p(); g.strokeStyle = K.ink; g.lineWidth = 6; g.stroke(); };
// The head outline is shared by the skin and every fringe (same box, same path), so hair hugs the skull.
const HEAD = (g, w, h, K, A) => {
  const p = () => { g.beginPath(); g.moveTo(w / 2, 8); g.bezierCurveTo(w - 36, 8, w - 8, 50, w - 8, 112); g.bezierCurveTo(w - 8, 156, w - 52, h - 8, w / 2, h - 8); g.bezierCurveTo(52, h - 8, 8, 156, 8, 112); g.bezierCurveTo(8, 50, 36, 8, w / 2, 8); g.closePath(); };
  if (A.part === 'skin') {
    p(); K.paint(g, A.skin); g.save(); p(); g.clip();
    g.fillStyle = 'rgba(255,120,120,0.28)'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(w / 2 + s * 62, 146, 17, 11, 0, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(43,27,77,0.10)'; g.fillRect(0, h - 24, w, 30);
    g.restore(); p(); g.strokeStyle = K.ink; g.lineWidth = 7; g.stroke(); return;
  }
  // a fringe: its lower edge is the style; everything above it is hair
  const edges = {
    locks: () => { g.moveTo(-2, 74); g.quadraticCurveTo(18, 66, 26, 40); g.quadraticCurveTo(50, 50, 74, 34); g.quadraticCurveTo(100, 64, 124, 36); g.quadraticCurveTo(150, 50, 176, 38); g.quadraticCurveTo(186, 64, w + 2, 74); },
    spikes: () => { g.moveTo(-2, 70); g.lineTo(20, 44); g.lineTo(34, 58); g.lineTo(56, 30); g.lineTo(76, 54); g.lineTo(102, 26); g.lineTo(126, 54); g.lineTo(148, 32); g.lineTo(168, 58); g.lineTo(184, 44); g.lineTo(w + 2, 70); },
  };
  const edge = edges[A.style];
  const hair = () => { g.beginPath(); edge(); g.lineTo(w + 2, -2); g.lineTo(-2, -2); g.closePath(); };
  g.save(); p(); g.clip(); hair(); g.fillStyle = K.grad(g, 0, 60, [A.hair, A.dark]); g.fill();
  g.beginPath(); edge(); g.strokeStyle = K.ink; g.lineWidth = 6; g.lineJoin = 'round'; g.stroke();
  const lg = g.createLinearGradient(0, 8, 0, 34); lg.addColorStop(0, 'rgba(255,255,255,0.30)'); lg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = lg; hair(); g.clip(); g.beginPath(); g.ellipse(w / 2 - 10, 16, 62, 12, 0, 0, 7); g.fill();
  g.restore();
  g.save(); hair(); g.clip(); p(); g.strokeStyle = K.ink; g.lineWidth = 7; g.stroke(); g.restore();
};
const HAIRBACK = (g, w, h, K, A) => { const p = () => { g.beginPath(); g.moveTo(w / 2, 8); g.bezierCurveTo(w - 40, 6, w - 6, 40, w - 8, 92); g.quadraticCurveTo(w - 10, h - 6, w - 34, h - 8); g.lineTo(34, h - 8); g.quadraticCurveTo(10, h - 6, 8, 92); g.bezierCurveTo(6, 40, 40, 6, w / 2, 8); g.closePath(); }; p(); K.paint(g, K.grad(g, 0, h, [A.hair, A.dark])); K.gloss(g, p, 30, 4, w - 60, 40, 0.18); };
const PIGTAIL = (g, w, h, K, A) => { if (A.mirror) { g.translate(w, 0); g.scale(-1, 1); } g.beginPath(); g.moveTo(w - 12, 8); g.bezierCurveTo(22, -2, -6, 44, 12, h - 8); g.bezierCurveTo(46, h - 4, w, 56, w - 6, 22); g.closePath(); K.paint(g, K.grad(g, 0, h, [A.hair, A.dark])); g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(30, 24); g.quadraticCurveTo(16, 36, 14, 54); g.stroke(); g.beginPath(); g.arc(w - 14, 16, 9, 0, 7); K.paint(g, A.tie, 5); };
// A boy's side tuft: a short spike of hair at the temple.
const TUFT = (g, w, h, K, A) => { if (A.mirror) { g.translate(w, 0); g.scale(-1, 1); } g.beginPath(); g.moveTo(w - 6, 6); g.quadraticCurveTo(10, 8, 6, h * 0.55); g.quadraticCurveTo(18, h * 0.5, 22, h - 8); g.quadraticCurveTo(w - 4, h * 0.7, w - 6, 6); g.closePath(); K.paint(g, K.grad(g, 0, h, [A.hair, A.dark]), 6); };
const LOBE = (g, w, h, K, A) => { if (A.mirror) { g.translate(w, 0); g.scale(-1, 1); } g.beginPath(); g.ellipse(w / 2 + 2, h / 2, w / 2 - 6, h / 2 - 5, 0, 0, 7); K.paint(g, A.skin, 6); g.beginPath(); g.ellipse(w / 2 + 1, h / 2 + 1, w / 2 - 11, h / 2 - 11, 0, 0, 7); g.fillStyle = A.light; g.fill(); };
const NOSE = (g, w, h, K) => { g.beginPath(); g.moveTo(5, 4); g.quadraticCurveTo(w / 2, h + 2, w - 5, 4); g.strokeStyle = K.ink; g.lineWidth = 4; g.lineCap = 'round'; g.stroke(); };

// A limb segment: a capsule whose round ends are centred on its two joints, optionally with a band
// at one end (a sock, a sleeve). It comes in two parts on the same bone: `line`, the dark outline,
// and the fill. Every outline of a limb is drawn before any of its fills, so the limb reads as one
// shape with one outline, and a bent knee or elbow shows no seam.
const LIMB = (g, w, h, K, A) => { if (A.part === 'line') { g.translate(6, 6); w -= 12; h -= 12; } const p = () => K.rr(g, 4, 4, w - 8, h - 8, (w - 8) / 2); p(); if (A.part === 'line') { K.paint(g, K.ink, 12); return; } g.fillStyle = A.color; g.fill(); g.save(); p(); g.clip(); if (A.band) { g.fillStyle = A.band; if (A.bandAt === 'top') g.fillRect(0, 0, w, A.bandH + 4); else g.fillRect(0, h - A.bandH - 4, w, A.bandH + 4); g.fillStyle = 'rgba(43,27,77,0.5)'; g.fillRect(0, A.bandAt === 'top' ? A.bandH + 2 : h - A.bandH - 6, w, 3); } g.restore(); };
// A hand: a round mitten with a small thumb, straight on the end of the forearm.
const HAND = (g, w, h, K, A) => { if (A.part === 'line') { g.translate(6, 6); w -= 12; h -= 12; } if (A.mirror) { g.translate(w, 0); g.scale(-1, 1); } const shapes = [() => { g.beginPath(); g.ellipse(w * 0.2, h * 0.46, w * 0.13, h * 0.2, 0, 0, 7); }, () => { g.beginPath(); g.ellipse(w * 0.56, h / 2, w * 0.36, h / 2 - 5, 0, 0, 7); }]; for (const shape of shapes) { shape(); if (A.part === 'line') K.paint(g, K.ink, 12); else { g.fillStyle = A.skin; g.fill(); } } };
// A sneaker seen from the front: a toe cap, laces, a sole.
const SNEAKER = (g, w, h, K, A) => { if (A.mirror) { g.translate(w, 0); g.scale(-1, 1); } const p = () => { g.beginPath(); g.moveTo(7, h - 6); g.lineTo(7, h * 0.45); g.quadraticCurveTo(8, 6, w * 0.42, 6); g.quadraticCurveTo(w - 6, 8, w - 5, h * 0.6); g.lineTo(w - 5, h - 6); g.closePath(); }; p(); K.paint(g, A.color, 6); g.save(); p(); g.clip(); g.fillStyle = A.sole; g.fillRect(0, h - 13, w, 14); g.fillStyle = A.cap ?? 'rgba(255,255,255,0.85)'; g.beginPath(); g.ellipse(w * 0.72, h * 0.62, w * 0.26, h * 0.3, 0, 0, 7); g.fill(); if (A.strap) { g.fillStyle = A.strap; g.fillRect(w * 0.2, h * 0.3, w * 0.5, 7); } else { g.strokeStyle = A.lace ?? '#ffffff'; g.lineWidth = 3; for (const y of [0.3, 0.46]) { g.beginPath(); g.moveTo(w * 0.22, h * y); g.lineTo(w * 0.5, h * y); g.stroke(); } } g.restore(); p(); g.strokeStyle = K.ink; g.lineWidth = 6; g.lineJoin = 'round'; g.stroke(); g.strokeStyle = 'rgba(43,27,77,0.55)'; g.lineWidth = 3; g.beginPath(); g.moveTo(8, h - 13); g.lineTo(w - 6, h - 13); g.stroke(); };
// The lower part of a top (belly and hem), on the spine so the body can bend at the waist.
const WAIST = (g, w, h, K, A) => { if (A.part === 'line') { g.translate(6, 6); w -= 12; h -= 12; } const p = () => K.rr(g, 5, 2, w - 10, h - 6, 12); p(); if (A.part === 'line') { K.paint(g, K.ink, 12); return; } g.fillStyle = A.shade; g.fill(); g.save(); p(); g.clip(); if (A.hem) { g.fillStyle = A.hem; g.fillRect(0, h - 15, w, 12); } g.restore(); };

// ── the looks: each is a skin naming its hair and its clothes ──
const LOOKS = {
  boy_casual: { hair: 'boy', hairColor: ['#6b4226', '#4f2f1a'], top: { color: '#4aa3ff', shade: '#2f86e6', mark: 'star', markColor: '#ffd35a', trim: '#ffffff', hem: '#ffffff' }, sleeve: '#4aa3ff', cuff: '#ffffff', sock: '#ffffff', bottom: { kind: 'shorts', color: '#3b4aa8', shade: '#2c3888' }, shoe: { color: '#ff5d5d', sole: '#ffffff' } },
  boy_sport: { hair: 'boy', hairColor: ['#6b4226', '#4f2f1a'], top: { color: '#ff9a3d', shade: '#f07c1c', stripe: '#ffffff', trim: '#ffffff', hem: '#ffffff' }, sleeve: '#ff9a3d', cuff: '#ffffff', sock: '#ff9a3d', bottom: { kind: 'shorts', color: '#f4f4fb', shade: '#d9d9ea', band: '#ff9a3d' }, shoe: { color: '#3b6cff', sole: '#ffffff' } },
  girl_casual: { hair: 'girl', hairColor: ['#8f4a2b', '#6e3520'], tie: '#ff5d7a', top: { color: '#ff7fb0', shade: '#f0609a', mark: 'heart', markColor: '#ffffff', trim: '#ffffff', hem: '#ffffff' }, sleeve: '#ff7fb0', cuff: '#ffffff', sock: '#ffd1e3', bottom: { kind: 'shorts', color: '#5b7fd1', shade: '#4667b8', band: '#ffffff' }, shoe: { color: '#ffffff', sole: '#ff7fb0' } },
  girl_dress: { hair: 'girl', hairColor: ['#8f4a2b', '#6e3520'], tie: '#9b6bff', top: { color: '#a77bff', shade: '#8a5cf0', trim: '#ffe37a' }, sleeve: '#a77bff', cuff: '#ffe37a', sock: '#ffffff', bottom: { kind: 'skirt', color: '#a77bff', shade: '#7f52e6', band: '#ffe37a' }, shoe: { color: '#7a4fe0', sole: '#ffffff', strap: '#ffe37a' } },
};
exports.LOOKS = Object.keys(LOOKS);

exports.humanParts = (cfg = {}) => {
  const SKIN = cfg.skin ?? '#ffcd9c', LIGHT = cfg.skinLight ?? '#ffe3c6';
  const P = [];
  const each = fn => { for (const [side, s] of [['L', -1], ['R', 1]]) fn(side, s); };
  const byHair = kind => Object.keys(LOOKS).filter(k => LOOKS[k].hair === kind);
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  // The joints, on the small grid (the right side; the left mirrors it). A knee and an elbow
  // sit slightly outward of the straight line, so each limb has a bend to start from and the
  // IK always folds the same way.
  const J = { hips: [0, -186], spine: [0, -178], chest: [0, -152], neck: [0, -114], shoulder: [44, -122], elbow: [51, -157.5], wrist: [49, -193], hip: [19, -192], knee: [28, -232], ankle: [21, -274] };
  const m = (p, s) => [s * p[0], p[1]];
  for (const kind of ['boy', 'girl']) { const [hair, dark] = LOOKS[byHair(kind)[0]].hairColor; P.push({ name: 'hairBack_' + kind, slot: 'hairBack', skin: byHair(kind), parent: 'head', at: kind === 'girl' ? [0, 36] : [0, 44], size: kind === 'girl' ? [224, 136] : [214, 112], draw: HAIRBACK, args: { hair, dark } }); }
  // legs: thigh and shin (two-bone IK to the foot target), the shoe rides the target so it stays flat
  const seg = (a, b, w) => [w, Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]) + w)];
  const line = p => { const o = { ...p, name: (p.slot ?? p.name) + '_line', on: p.slot ?? p.name, grow: 12, args: { ...p.args, part: 'line' } }; delete o.slot; delete o.skin; delete o.parent; return o; };
  const first = Object.keys(LOOKS)[0];
  // a point d past b on the line from a through b: the hand continues the forearm
  const past = (a, b, d) => { const n = Math.hypot(b[0] - a[0], b[1] - a[1]); return [b[0] + (b[0] - a[0]) / n * d, b[1] + (b[1] - a[1]) / n * d]; };
  each((side, s) => {
    const thigh = { name: 'thigh' + side, parent: 'hips', at: mid(m(J.hip, s), m(J.knee, s)), pivot: m(J.hip, s), aim: m(J.knee, s), along: true, size: seg(J.hip, J.knee, 32), draw: LIMB, args: { color: SKIN } };
    // the shin stops a little short of the ankle, so its round end hides inside the shoe
    const shin = (look, L) => ({ name: 'shin_' + look + '_' + side, slot: 'shin' + side, skin: look, parent: 'thigh' + side, at: mid(m(J.knee, s), m(J.ankle, s)), pivot: m(J.knee, s), aim: m(J.ankle, s), along: -6, size: [28, seg(J.knee, J.ankle, 28)[1] - 7], draw: LIMB, args: { color: SKIN, band: L.sock, bandH: 12 } });
    P.push(line(thigh), line(shin(first, LOOKS[first])), thigh, ...Object.entries(LOOKS).map(([look, L]) => shin(look, L)));
  });
  each((side, s) => { for (const [look, L] of Object.entries(LOOKS)) P.push({ name: 'shoe_' + look + '_' + side, slot: 'foot' + side, skin: look, parent: 'footTarget' + side, at: [s * 25, -274], pivot: m(J.ankle, s), size: [44, 24], draw: SNEAKER, args: { ...L.shoe, mirror: s < 0 } }); });
  // the garments on the trunk: bottom on the hips, belly and hem on the spine, chest and shoulders on the chest
  for (const [look, L] of Object.entries(LOOKS)) P.push({ name: 'bottom_' + look, slot: 'bottom', skin: look, parent: 'hips', ...(L.bottom.kind === 'skirt' ? { at: [0, -197], size: [128, 52], draw: SKIRT } : { at: [0, -193], size: [88, 42], draw: SHORTS }), pivot: J.hips, args: L.bottom });
  P.push({ name: 'neck', parent: 'top', at: [0, -110], pivot: J.neck, aim: [0, -104], size: [34, 24], draw: NECK, args: { skin: SKIN } });
  // the top is two parts (belly on the spine, chest on the chest) under one outline
  const waist = (look, L) => ({ name: 'waist_' + look, slot: 'waist', skin: look, parent: 'hips', at: [0, -167], pivot: J.spine, aim: J.chest, size: [88, 32], draw: WAIST, args: { shade: L.top.shade, hem: L.top.hem } });
  const top = (look, L) => ({ name: 'top_' + look, slot: 'top', skin: look, parent: 'waist', at: [0, -138], pivot: J.chest, aim: J.neck, size: [100, 58], draw: TOP, args: L.top });
  P.push(line(waist(first, LOOKS[first])), line(top(first, LOOKS[first])), ...Object.entries(LOOKS).map(([look, L]) => waist(look, L)), ...Object.entries(LOOKS).map(([look, L]) => top(look, L)));
  // arms: upper arm and forearm (two-bone IK to the hand target), then the hand; one outline for all three
  each((side, s) => {
    const arm = (look, L) => ({ name: 'arm_' + look + '_' + side, slot: 'arm' + side, skin: look, parent: 'top', at: mid(m(J.shoulder, s), m(J.elbow, s)), pivot: m(J.shoulder, s), aim: m(J.elbow, s), along: true, size: seg(J.shoulder, J.elbow, 28), draw: LIMB, args: { color: SKIN, band: L.sleeve, bandAt: 'top', bandH: 34 } });
    const forearm = { name: 'forearm' + side, parent: 'arm' + side, at: mid(m(J.elbow, s), m(J.wrist, s)), pivot: m(J.elbow, s), aim: m(J.wrist, s), along: true, size: seg(J.elbow, J.wrist, 24), draw: LIMB, args: { color: SKIN } };
    const hand = { name: 'hand' + side, parent: 'forearm' + side, at: m(past(J.elbow, J.wrist, 8), s), pivot: m(J.wrist, s), aim: m(past(J.elbow, J.wrist, 16), s), along: true, size: [28, 30], draw: HAND, args: { skin: SKIN, mirror: s > 0 } };
    P.push(line(arm(first, LOOKS[first])), line(forearm), line(hand), ...Object.entries(LOOKS).map(([look, L]) => arm(look, L)), forearm, hand);
  });
  // the head, on the neck
  for (const kind of ['boy', 'girl']) each((side, s) => { const [hair, dark] = LOOKS[byHair(kind)[0]].hairColor;
    if (kind === 'girl') for (const look of byHair('girl')) P.push({ name: 'pigtail_' + look + '_' + side, slot: 'ear' + side, skin: look, parent: 'head', at: [s * 104, 10], pivot: [s * 86, 40], size: [64, 92], draw: PIGTAIL, args: { hair, dark, tie: LOOKS[look].tie, mirror: s > 0 } });
    else P.push({ name: 'tuft_' + side, slot: 'ear' + side, skin: byHair('boy'), parent: 'head', at: [s * 96, 22], pivot: [s * 86, 40], size: [40, 56], draw: TUFT, args: { hair, dark, mirror: s > 0 } }); });
  each((side, s) => P.push({ name: 'earLobe' + side, parent: 'head', at: [s * 99, -26], size: [34, 42], draw: LOBE, args: { skin: SKIN, light: LIGHT, mirror: s > 0 } }));
  P.push({ name: 'head', parent: 'neck', at: [0, -13], pivot: [0, -104], size: [204, 188], draw: HEAD, args: { part: 'skin', skin: SKIN, freckle: '#e8956a' } });
  for (const kind of ['boy', 'girl']) { const [hair, dark] = LOOKS[byHair(kind)[0]].hairColor; P.push({ name: 'fringe_' + kind, slot: 'fringe', skin: byHair(kind), parent: 'head', at: [0, -13], pivot: [0, 60], size: [204, 188], draw: HEAD, args: { part: 'fringe', style: kind === 'girl' ? 'locks' : 'spikes', hair, dark } }); }
  P.push(...faceParts({ fur: SKIN, eye: [40, -22], eyeSize: [19, 22], eyeStyle: 'lash', pupil: 'soft', blush: [62, -65], iris: cfg.iris ?? '#7a4a2a', mouth: [0, -70], brow: '#6e3520', mouthStyle: 'human' }));
  P.push({ name: 'nose', parent: 'head', at: [0, -46], size: [22, 14], draw: NOSE });
  // enlarge the body about the neck (the head and everything on it keeps its size)
  const big = ([x, y]) => [+(x * B).toFixed(1), +(NECK_Y + (y - NECK_Y) * B).toFixed(1)];
  const onHead = new Set(['head']); let grew = true;
  while (grew) { grew = false; for (const p of P) { const key = p.slot ?? p.name; if (!onHead.has(key) && onHead.has(p.parent)) { onHead.add(key); grew = true; } } }
  // the eye masks belong to the face (on the head), so they keep the head's size like the eyes do
  for (const p of P) { if (onHead.has(p.slot ?? p.name) || p.parent === 'root' || p.clip) continue; p.at = big(p.at); if (p.pivot) p.pivot = big(p.pivot); if (p.aim) p.aim = big(p.aim); p.size = p.size.map(v => Math.round(v * B) + (p.grow ?? 0)); }
  // bones without art: the hips, and the four IK targets (feet in the world, hands on the chest)
  // chestControl sits on the chest with unrotated axes, so a hand target's x is sideways and its y is up.
  const bones = [{ name: 'hips', parent: 'body', at: big(J.hips) }, { name: 'chestControl', parent: 'top', at: big(J.chest) }];
  const ik = [];
  each((side, s) => {
    bones.push({ name: 'footTarget' + side, parent: 'body', at: big(m(J.ankle, s)) }, { name: 'handTarget' + side, parent: 'chestControl', at: big(m(J.wrist, s)) });
    ik.push({ name: 'leg' + side, bones: ['thigh' + side, 'shin' + side], target: 'footTarget' + side, bendPositive: s < 0 }, { name: 'arm' + side, bones: ['arm' + side, 'forearm' + side], target: 'handTarget' + side, bendPositive: s < 0 });
  });
  return { pieces: P, bones, ik, joints: Object.fromEntries(Object.entries(J).map(([k, v]) => [k, big(v)])) };
};
