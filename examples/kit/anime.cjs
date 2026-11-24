// An anime-style character, waist up: the portrait a mobile game shows in dialogue and menus.
// An original design, drawn the way anime is drawn: thin dark-brown line work instead of a heavy
// outline, a head that narrows to a small chin, tall eyes under a heavy lash, hair in tapered
// clumps with a band of shine, and flat two-tone (cel) shading.
// The face is the pack's face rig, so every head's emotion clips run on it unchanged.
const { buildIcon } = require('./kit.cjs'); const { faceParts } = require('./face.cjs');
const C = { skin: '#fff2ea', shade: '#f8d6ca', line: '#5a3a44', hair: '#f7a6c2', hairShade: '#dc7aa0', hairLight: '#ffe0ea', hairLine: '#7a3552', navy: '#3c4a82', cloth: '#ffffff', clothShade: '#dde2f5', red: '#e8546a', redShade: '#c23c55' };
exports.VIEW = { x: -180, y: -250, width: 360, height: 385 };
const HEAD = (g, w, h, K, A) => {
  // wide soft cheeks that turn in late to a small chin
  const c = w / 2;
  const p = () => { g.beginPath(); g.moveTo(c, 6); g.bezierCurveTo(c + 56, 6, w - 5, 44, w - 5, 100); g.bezierCurveTo(w - 5, 132, w - 16, 156, w - 40, 176); g.bezierCurveTo(w - 58, 190, c + 20, 197, c + 6, 199); g.quadraticCurveTo(c, 201, c - 6, 199); g.bezierCurveTo(c - 20, 197, 58, 190, 40, 176); g.bezierCurveTo(16, 156, 5, 132, 5, 100); g.bezierCurveTo(5, 44, c - 56, 6, c, 6); g.closePath(); };
  p(); g.fillStyle = A.skin; g.fill(); g.save(); p(); g.clip();
  g.fillStyle = A.shade; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, 72); g.quadraticCurveTo(c, 84, 0, 72); g.closePath(); g.fill();
  for (const s of [-1, 1]) { const x = c + s * 54, y = 160; g.save(); g.translate(x, y); g.scale(1, 0.55); const r = g.createRadialGradient(0, 0, 1, 0, 0, 26); r.addColorStop(0, 'rgba(255,150,160,0.5)'); r.addColorStop(1, 'rgba(255,150,160,0)'); g.fillStyle = r; g.beginPath(); g.arc(0, 0, 26, 0, 7); g.fill(); g.restore(); }
  g.restore(); p(); g.strokeStyle = A.line; g.lineWidth = 1.7; g.lineJoin = 'round'; g.stroke();
};
const HAIRBACK = (g, w, h, K, A) => { g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - 3, h / 2 - 3, 0, 0, 7); g.fillStyle = A.shade; g.fill(); g.strokeStyle = A.line; g.lineWidth = 1.9; g.stroke(); };
// A side lock: a long tapered strand from the temple to the chest, with a slow S in it.
const LOCK = (g, w, h, K, A) => { if (A.mirror) { g.translate(w, 0); g.scale(-1, 1); }
  const p = () => { g.beginPath(); g.moveTo(w * 0.4, 4); g.bezierCurveTo(w - 3, h * 0.15, w - 2, h * 0.5, w * 0.72, h * 0.72); g.quadraticCurveTo(w * 0.6, h * 0.9, w * 0.3, h - 3); g.quadraticCurveTo(w * 0.22, h * 0.8, w * 0.12, h * 0.6); g.bezierCurveTo(2, h * 0.4, 2, h * 0.15, w * 0.4, 4); g.closePath(); };
  p(); g.fillStyle = A.hair; g.fill(); g.save(); p(); g.clip(); g.fillStyle = A.shade; g.beginPath(); g.moveTo(0, h * 0.55); g.quadraticCurveTo(w * 0.6, h * 0.62, w, h * 0.5); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fill(); g.strokeStyle = A.light; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(w * 0.5, h * 0.16); g.quadraticCurveTo(w * 0.36, h * 0.3, w * 0.42, h * 0.46); g.stroke(); g.restore();
  p(); g.strokeStyle = A.line; g.lineWidth = 1.9; g.lineJoin = 'round'; g.stroke(); };
// The fringe: a cap of hair with volume above the skull, falling in tapered clumps whose tips
// stop at the top of the eyes; the two outer clumps frame the face and come down past the cheek.
const FRINGE = (g, w, h, K, A) => {
  // a few large smooth clumps: one each side over the eyes and a long V between the eyes
  const c = w / 2;
  const p = () => { g.beginPath(); g.moveTo(c, 5); g.bezierCurveTo(w - 46, 3, w - 3, 46, w - 4, 108); g.quadraticCurveTo(w - 6, 122, w - 14, 128);
    g.quadraticCurveTo(w - 22, 104, w - 34, 84); g.quadraticCurveTo(w - 40, 98, w - 56, 104); g.quadraticCurveTo(w - 62, 84, w - 74, 62);
    g.quadraticCurveTo(w - 80, 104, c + 4, 136); g.quadraticCurveTo(c - 14, 98, c - 34, 60);
    g.quadraticCurveTo(c - 40, 92, 56, 104); g.quadraticCurveTo(44, 100, 34, 84); g.quadraticCurveTo(24, 106, 14, 128);
    g.quadraticCurveTo(6, 122, 4, 108); g.bezierCurveTo(3, 46, 46, 3, c, 5); g.closePath(); };
  p(); const lg = g.createLinearGradient(0, 0, 0, h); lg.addColorStop(0, A.hair); lg.addColorStop(1, A.shade); g.fillStyle = lg; g.fill(); g.save(); p(); g.clip();
  // soft light on the crown and down one side, the way the reference style lights hair
  g.fillStyle = A.light; g.globalAlpha = 0.55; g.beginPath(); g.ellipse(c - 34, 46, 44, 18, -0.5, 0, 7); g.fill(); g.beginPath(); g.ellipse(c + 50, 62, 26, 10, 0.6, 0, 7); g.fill(); g.globalAlpha = 1;
  g.strokeStyle = A.line; g.globalAlpha = 0.4; g.lineWidth = 1.3; g.lineCap = 'round';
  for (const [x0, y0, x1, y1, x2, y2] of [[c - 34, 60, c - 24, 34, c - 6, 14], [w - 74, 62, w - 84, 36, c + 8, 14], [34, 84, 30, 54, 44, 30], [w - 34, 84, w - 30, 54, w - 44, 30], [c + 2, 120, c - 6, 96, c - 12, 76]]) { g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(x1, y1, x2, y2); g.stroke(); }
  g.restore(); p(); g.strokeStyle = A.line; g.lineWidth = 1.7; g.lineJoin = 'round'; g.stroke();
};
// A twin tail: one thick smooth length of hair that swells below the tie and tapers to a point,
// with a second length behind it. `wisp` is a loose strand on a child bone, so the end moves later.
const TAIL = (g, w, h, K, A) => { if (A.mirror) { g.translate(w, 0); g.scale(-1, 1); }
  const bez = (p, t) => { const u = 1 - t; return [u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6], u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7]]; };
  const blade = (p, w0, fill, light) => { const L = [], R = [], n = 36, half = t => w0 / 2 * Math.min(1, 0.4 + 3 * t) * Math.pow(1 - t, 0.6); for (let i = 0; i <= n; i++) { const t = i / n, [x, y] = bez(p, t), [x2, y2] = bez(p, Math.min(1, t + 0.01)), [x1, y1] = bez(p, Math.max(0, t - 0.01)), d = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / d, ny = (x2 - x1) / d; L.push([x + nx * half(t), y + ny * half(t)]); R.push([x - nx * half(t), y - ny * half(t)]); }
    const path = () => { g.beginPath(); L.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](x, y)); [...R].reverse().forEach(([x, y]) => g.lineTo(x, y)); g.closePath(); };
    path(); g.fillStyle = fill; g.fill(); g.save(); path(); g.clip();
    if (light) { g.strokeStyle = light; g.globalAlpha = 0.6; g.lineWidth = w0 * 0.22; g.lineCap = 'round'; g.beginPath(); for (let i = 5; i <= 22; i++) { const [x, y] = [(L[i][0] * 0.7 + R[i][0] * 0.3), (L[i][1] * 0.7 + R[i][1] * 0.3)]; g[i === 5 ? 'moveTo' : 'lineTo'](x, y); } g.stroke(); g.globalAlpha = 1; }
    g.strokeStyle = A.line; g.globalAlpha = 0.35; g.lineWidth = 1.2; g.beginPath(); for (let i = 3; i <= 32; i++) { const [x, y] = [(L[i][0] * 0.35 + R[i][0] * 0.65), (L[i][1] * 0.35 + R[i][1] * 0.65)]; g[i === 3 ? 'moveTo' : 'lineTo'](x, y); } g.stroke(); g.restore(); g.globalAlpha = 1;
    path(); g.strokeStyle = A.line; g.lineWidth = 1.7; g.lineJoin = 'round'; g.stroke(); };
  if (A.wisp) { blade([w * 0.3, 4, w * 0.9, h * 0.3, w * 0.8, h * 0.7, w * 0.35, h - 4], w * 0.36, A.hair); return; }
  blade([36, 30, 150, 60, 176, 260, 140, 470], 52, A.shade);
  blade([30, 22, 132, 50, 168, 250, 112, 500], 68, A.hair, A.light);
};
const TIE = (g, w, h, K, A) => { g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 3, 0, 7); g.fillStyle = A.color; g.fill(); g.strokeStyle = A.line; g.lineWidth = 1.8; g.stroke(); g.beginPath(); g.arc(w * 0.4, h * 0.38, w * 0.14, 0, 7); g.fillStyle = 'rgba(255,255,255,0.6)'; g.fill(); };
const STRAND = (g, w, h, K, A) => { g.beginPath(); g.moveTo(w * 0.32, h - 3); g.bezierCurveTo(w * 0.1, h * 0.4, w * 0.5, 2, w - 4, h * 0.34); g.bezierCurveTo(w * 0.62, h * 0.26, w * 0.5, h * 0.6, w * 0.6, h - 3); g.closePath(); g.fillStyle = A.hair; g.fill(); g.strokeStyle = A.line; g.lineWidth = 2.2; g.lineJoin = 'round'; g.stroke(); };
const TORSO = (g, w, h, K, A) => {
  const k = w / 240; g.scale(k, k); w = 240; h = h / k;
  const c = w / 2; g.lineJoin = 'round'; g.lineCap = 'round'; const ink = (lw = 1.9 / k) => { g.strokeStyle = A.line; g.lineWidth = lw; g.stroke(); };
  // slim arms hanging a little away from the waist
  for (const s of [-1, 1]) { const arm = () => { g.beginPath(); g.moveTo(c + s * 56, 96); g.lineTo(c + s * 86, 102); g.quadraticCurveTo(c + s * 92, 150, c + s * 85, 188); g.quadraticCurveTo(c + s * 80, 220, c + s * 80, h + 8); g.lineTo(c + s * 62, h + 8); g.quadraticCurveTo(c + s * 60, 220, c + s * 64, 188); g.quadraticCurveTo(c + s * 66, 150, c + s * 56, 96); g.closePath(); };
    arm(); g.fillStyle = A.skin; g.fill(); g.save(); arm(); g.clip(); g.fillStyle = A.shade; g.fillRect(s > 0 ? c + 56 : c - 70, 96, 14, h); g.fillRect(c - 100, 96, 200, 22); g.restore(); arm(); ink(); }
  // the body: narrow sloping shoulders, a waist
  const body = () => { g.beginPath(); g.moveTo(c - 15, 10); g.lineTo(c - 58, 32); g.lineTo(c - 52, 86); g.quadraticCurveTo(c - 43, 140, c - 42, 180); g.quadraticCurveTo(c - 44, 215, c - 48, h + 8); g.lineTo(c + 48, h + 8); g.quadraticCurveTo(c + 44, 215, c + 42, 180); g.quadraticCurveTo(c + 43, 140, c + 52, 86); g.lineTo(c + 58, 32); g.lineTo(c + 15, 10); g.closePath(); };
  body(); g.fillStyle = A.cloth; g.fill(); g.save(); body(); g.clip();
  g.fillStyle = A.clothShade; g.beginPath(); g.moveTo(c + 22, 90); g.quadraticCurveTo(c + 30, 170, c + 26, h + 8); g.lineTo(c + 70, h + 8); g.lineTo(c + 70, 90); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(c - 40, 150); g.quadraticCurveTo(c - 20, 168, c - 1, 153); g.quadraticCurveTo(c + 20, 168, c + 40, 150); g.quadraticCurveTo(c + 24, 180, c, 166); g.quadraticCurveTo(c - 24, 180, c - 40, 150); g.closePath(); g.fill();
  g.fillStyle = A.skin; g.beginPath(); g.moveTo(c - 15, 6); g.lineTo(c, 92); g.lineTo(c + 15, 6); g.closePath(); g.fill(); g.fillStyle = A.shade; g.beginPath(); g.moveTo(c - 15, 6); g.lineTo(c - 9, 40); g.lineTo(c + 9, 40); g.lineTo(c + 15, 6); g.closePath(); g.fill(); g.restore();
  body(); ink();
  // short sleeves with a navy cuff
  for (const s of [-1, 1]) { const sleeve = () => { g.beginPath(); g.moveTo(c + s * 40, 24); g.quadraticCurveTo(c + s * 70, 26, c + s * 84, 52); g.quadraticCurveTo(c + s * 93, 84, c + s * 91, 112); g.lineTo(c + s * 55, 104); g.quadraticCurveTo(c + s * 60, 70, c + s * 50, 40); g.closePath(); };
    sleeve(); g.fillStyle = A.cloth; g.fill(); g.save(); sleeve(); g.clip(); if (s > 0) { g.fillStyle = A.clothShade; g.fillRect(c + 72, 0, 40, h); } g.strokeStyle = A.navy; g.lineWidth = 10; g.beginPath(); g.moveTo(c + s * 94, 110); g.lineTo(c + s * 52, 101); g.stroke(); g.strokeStyle = '#ffffff'; g.lineWidth = 1.8; g.beginPath(); g.moveTo(c + s * 94, 107); g.lineTo(c + s * 52, 98); g.stroke(); g.restore(); sleeve(); ink(); }
  // the sailor collar, two white stripes
  const collar = () => { g.beginPath(); g.moveTo(c - 15, 8); g.lineTo(c - 56, 30); g.lineTo(c - 46, 84); g.lineTo(c, 120); g.lineTo(c + 46, 84); g.lineTo(c + 56, 30); g.lineTo(c + 15, 8); g.lineTo(c, 92); g.closePath(); };
  collar(); g.fillStyle = A.navy; g.fill(); ink();
  g.strokeStyle = '#ffffff'; g.lineWidth = 1.8; for (const d of [0, 5]) { g.beginPath(); g.moveTo(c - 51 + d, 33 + d * 0.3); g.lineTo(c - 42 + d, 80 - d * 0.4); g.lineTo(c, 113 - d); g.lineTo(c + 42 - d, 80 - d * 0.4); g.lineTo(c + 51 - d, 33 + d * 0.3); g.stroke(); }
};
const NECK = (g, w, h, K, A) => { g.fillStyle = A.skin; g.fillRect(4, 0, w - 8, h); g.fillStyle = A.shade; g.beginPath(); g.moveTo(4, 0); g.lineTo(w - 4, 0); g.lineTo(w - 4, h * 0.5); g.quadraticCurveTo(w / 2, h * 0.78, 4, h * 0.5); g.closePath(); g.fill(); g.strokeStyle = A.line; g.lineWidth = 1.9; g.beginPath(); g.moveTo(4, 0); g.lineTo(4, h); g.moveTo(w - 4, 0); g.lineTo(w - 4, h); g.stroke(); };
const BOW = (g, w, h, K, A) => { const c = w / 2; g.lineJoin = 'round'; const ink = () => { g.strokeStyle = A.line; g.lineWidth = 1.8; g.stroke(); };
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(c + s * 3, 20); g.lineTo(c + s * 15, h - 4); g.lineTo(c + s * 2, h - 13); g.closePath(); g.fillStyle = A.shade; g.fill(); ink(); g.beginPath(); g.moveTo(c, 15); g.quadraticCurveTo(c + s * 22, -2, c + s * (c - 4), 6); g.quadraticCurveTo(c + s * (c - 2), 18, c + s * (c - 7), 29); g.quadraticCurveTo(c + s * 20, 30, c, 19); g.closePath(); g.fillStyle = A.color; g.fill(); ink(); }
  g.beginPath(); g.ellipse(c, 17, 6.5, 7.5, 0, 0, 7); g.fillStyle = A.color; g.fill(); ink(); };
const hair = { hair: C.hair, shade: C.hairShade, light: C.hairLight, line: C.hairLine };
const face = faceParts({ fur: C.skin, line: C.line, eye: [47, -31], eyeSize: [24, 28], eyeStyle: 'anime', pupil: 'anime', pupilScale: [1.68, 1.76], iris: '#35b8a0', irisDeep: '#0f4f4a', irisGlow: '#d6fff4', blush: [54, -68], mouth: [0, -80], mouthStyle: 'anime', brow: C.hairLine });
// the side locks and the fringe go over the eyes and lids (a lid is a patch of skin: hair must cover it) but under the brows, the way anime shows brows through hair
face.splice(face.findIndex(p => p.name === 'browL'), 0,
  { name: 'earL', parent: 'head', at: [-88, -30], pivot: [-84, 24], size: [34, 124], draw: LOCK, args: hair },
  { name: 'earR', parent: 'head', at: [88, -30], pivot: [84, 24], size: [34, 124], draw: LOCK, args: { ...hair, mirror: true } },
  { name: 'fringe', parent: 'head', at: [0, 23], pivot: [0, 60], size: [212, 170], draw: FRINGE, args: hair });
// The twin tails: one long piece each, swinging from its tie, and a loose strand on a child bone.
const tails = [['L', -1], ['R', 1]].flatMap(([side, s]) => [
  { name: 'tail' + side + '1', parent: 'head', at: [s * 148, -196], pivot: [s * 92, 58], size: [180, 510], draw: TAIL, args: { ...hair, mirror: s < 0 } },
  { name: 'tail' + side + '2', parent: 'tail' + side + '1', at: [s * 176, -250], pivot: [s * 178, -160], size: [40, 190], draw: TAIL, args: { ...hair, wisp: true, mirror: s < 0 } },
]);
const icon = { name: 'anime', ground: -436, shadow: false, bounds: exports.VIEW, pieces: [
  { name: 'hairBack', parent: 'head', at: [0, 2], size: [204, 204], draw: HAIRBACK, args: hair },
  ...tails,
  { name: 'torso', at: [0, -268], pivot: [0, -436], size: [336, 336], draw: TORSO, args: { skin: C.skin, shade: C.shade, line: C.line, navy: C.navy, cloth: C.cloth, clothShade: C.clothShade } },
  { name: 'neck', parent: 'torso', at: [0, -110], size: [30, 34], draw: NECK, args: { skin: C.skin, shade: C.shade, line: C.line } },
  { name: 'ribbon', parent: 'torso', at: [0, -288], pivot: [0, -268], size: [84, 68], draw: BOW, args: { color: C.red, shade: C.redShade, line: C.line } },
  { name: 'head', parent: 'torso', at: [0, -8], pivot: [0, -104], size: [188, 200], draw: HEAD, args: { skin: C.skin, shade: C.shade, line: C.line } },
  { name: 'tieL', parent: 'head', at: [-88, 60], size: [30, 30], draw: TIE, args: { color: C.red, line: C.line } },
  { name: 'tieR', parent: 'head', at: [88, 60], size: [30, 30], draw: TIE, args: { color: C.red, line: C.line } },
  ...face,
  { name: 'nose', parent: 'head', at: [0, -58], size: [6, 6], draw: (g, w, h, K, A) => { g.beginPath(); g.arc(w / 2, h / 2, 1.3, 0, 7); g.fillStyle = A.line; g.globalAlpha = 0.6; g.fill(); }, args: { line: C.line } },
  { name: 'strand', parent: 'head', at: [8, 110], pivot: [2, 94], size: [36, 40], draw: STRAND, args: hair },
] };
if (require.main === module) buildIcon(icon, __dirname + '/pack').then(r => console.log('anime bones:', r.bones.length));
