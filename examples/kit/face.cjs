// Face parts shared by every head in the pack, so every head has the same bones, slots and
// attachment names and the same emotion clips can be generated for all of them.
//
// faceParts(cfg) returns the pieces to append after the head's own art (all children of `head`):
//   blushL/R (hidden)   eyeL/R (the whites)   pupilL/R (children of the eye)
//   lidL/R   SLOTS with attachments lid_half, lid_angry, lid_sad, lid_closed, lid_happy (none shown)
//   browL/R   mouth SLOT with mouth_neutral (shown), mouth_smile, mouth_o, mouth_frown, mouth_grr
//   tearL/R, anger, heart, zzz (hidden effects)
// cfg: { fur: colour under the eyes (the lids are painted with it; furL / furR override one side),
//        muzzle: { at, size, color } an oval drawn above the lids and under the nose and mouth, eye: [x, y] of the right eye
//        (the left mirrors it), eyeSize: [rx, ry], iris: colour, mouth: [x, y], brow: colour,
//        browY: offset above the eye, parent: 'head' }
// Placement rule for a head: mouth y = (bottom of the nose) - 17, so the mouth art starts just
// under the nose and never overlaps it; the muzzle patch starts below the eyes.
// `lash`: a human eye. A thin soft rim and a heavy upper lash line, so the eye does not stare;
// a partial lid then brings the lash line down instead of drawing a second ring.
const EYE = (g, w, h, K, A) => { const p = () => { g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - 5, h / 2 - 5, 0, 0, 7); }; p(); if (A?.style === 'anime') { g.fillStyle = '#ffffff'; g.fill(); g.save(); p(); g.clip(); g.fillStyle = 'rgba(126,112,170,0.42)'; g.beginPath(); g.ellipse(w / 2, -h * 0.06, w * 0.7, h * 0.36, 0, 0, 7); g.fill(); g.restore(); return; }
  if (A?.style === 'lash') { g.fillStyle = '#ffffff'; g.fill(); K.shade(g, p, h * 0.72, h, 0.08); p(); g.strokeStyle = 'rgba(43,27,77,0.4)'; g.lineWidth = 3; g.stroke(); g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - 5, h / 2 - 5, 0, Math.PI * 1.06, Math.PI * 1.94); g.strokeStyle = K.ink; g.lineWidth = 6; g.lineCap = 'round'; g.stroke(); return; } K.paint(g, '#ffffff', A?.line ?? 6); K.shade(g, p, h * 0.72, h, 0.08); };
// `soft`: one warm dark disc with a large highlight, for a human face (a ringed iris stares).
const PUPIL = (g, w, h, K, A) => { if (A.style === 'anime') { const e = () => { g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - 1.5, h / 2 - 1.5, 0, 0, 7); }; e(); const lg = g.createLinearGradient(0, 0, 0, h); lg.addColorStop(0, A.iris); lg.addColorStop(0.55, A.iris); lg.addColorStop(1, A.glow); g.fillStyle = lg; g.fill(); g.save(); e(); g.clip();
    // dark where the lid shades it, a ring around the pupil, a pale pool at the bottom
    g.fillStyle = A.deep; g.globalAlpha = 0.62; g.beginPath(); g.ellipse(w / 2, h * 0.04, w * 0.8, h * 0.4, 0, 0, 7); g.fill(); g.globalAlpha = 1;
    g.beginPath(); g.ellipse(w / 2, h * 0.54, w * 0.27, h * 0.25, 0, 0, 7); g.strokeStyle = A.deep; g.globalAlpha = 0.55; g.lineWidth = 2; g.stroke(); g.globalAlpha = 1;
    g.beginPath(); g.ellipse(w / 2, h * 0.54, w * 0.15, h * 0.15, 0, 0, 7); g.fillStyle = A.deep; g.fill();
    g.beginPath(); g.ellipse(w / 2, h * 0.98, w * 0.36, h * 0.16, 0, 0, 7); g.fillStyle = 'rgba(255,255,255,0.45)'; g.fill(); g.restore();
    e(); g.strokeStyle = A.deep; g.lineWidth = 2.4; g.stroke();
    g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(w * 0.3, h * 0.22, w * 0.19, h * 0.13, -0.4, 0, 7); g.fill(); g.beginPath(); g.arc(w * 0.72, h * 0.7, w * 0.06, 0, 7); g.fill(); return; }
  if (A.style === 'soft') { g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - 2, h / 2 - 2, 0, 0, 7); g.fillStyle = '#3a2418'; g.fill(); g.save(); g.clip(); g.beginPath(); g.ellipse(w / 2, h * 0.86, w * 0.42, h * 0.34, 0, 0, 7); g.fillStyle = A.iris; g.fill(); g.restore(); g.beginPath(); g.arc(w * 0.64, h * 0.32, w * 0.17, 0, 7); g.fillStyle = '#ffffff'; g.fill(); g.beginPath(); g.arc(w * 0.36, h * 0.66, w * 0.08, 0, 7); g.fill(); return; } g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - 2, h / 2 - 2, 0, 0, 7); g.fillStyle = K.ink; g.fill(); g.beginPath(); g.ellipse(w / 2, h / 2 + 1, w / 2 - 6, h / 2 - 6, 0, 0, 7); g.fillStyle = A.iris; g.fill(); g.beginPath(); g.ellipse(w / 2, h / 2 + 2, w * 0.2, h * 0.24, 0, 0, 7); g.fillStyle = K.ink; g.fill(); g.beginPath(); g.arc(w * 0.66, h * 0.3, w * 0.13, 0, 7); g.fillStyle = '#ffffff'; g.fill(); g.beginPath(); g.arc(w * 0.36, h * 0.68, w * 0.07, 0, 7); g.fill(); };
// A lid is a patch of fur over the eye; its lower edge is the expression.
// The anime eye's line work, a piece of its own above the iris: a heavy upper lash that tapers
// to the inner corner and flicks at the outer one, the crease above it, a short lower lash.
const LASH = (g, w, h, K, A) => { if (A.out < 0) { g.translate(w, 0); g.scale(-1, 1); }
  // one heavy, fairly flat upper lash: thick over the iris, thinning to both corners, the outer
  // corner turning down a little. No lower line: the iris and a faint corner mark close the eye.
  const cx = w / 2, cy = h / 2, rx = A.rx, ry = A.ry; g.fillStyle = A.line; g.strokeStyle = A.line; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(cx - rx - 1, cy - ry * 0.42); g.quadraticCurveTo(cx - rx * 0.6, cy - ry - 2, cx + rx * 0.1, cy - ry - 2.5); g.quadraticCurveTo(cx + rx * 0.9, cy - ry - 1, cx + rx + 3, cy - ry * 0.2); g.quadraticCurveTo(cx + rx * 0.86, cy - ry + 3, cx + rx * 0.1, cy - ry + 4); g.quadraticCurveTo(cx - rx * 0.62, cy - ry + 3.5, cx - rx - 1, cy - ry * 0.42); g.closePath(); g.fill();
  g.globalAlpha = 0.5; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx + rx + 1, cy + ry * 0.5); g.quadraticCurveTo(cx + rx * 0.9, cy + ry * 0.84, cx + rx * 0.55, cy + ry * 0.98); g.stroke(); g.globalAlpha = 1; };
const LID = (g, w, h, K, A) => {
  const m = A.mirror ? -1 : 1; if (A.mirror) { g.translate(w, 0); g.scale(-1, 1); }
  // The box is the eye's box plus 6 on every side. A partial lid has the eye's own ellipse
  // and outline, so it reads as part of the eye; a full cover reaches past the rim to hide it.
  const full = A.kind === 'closed' || A.kind === 'happy';
  const cx = w / 2, cy = h / 2, rx = w / 2 - (full ? 5 : 11), ry = h / 2 - (full ? 5 : 11);
  const eye = () => { g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, 7); };
  if (A.style === 'anime') { // the lid is skin over the whole box above its edge (so it hides the lash piece), with the lash line on the edge
    const e = { half: [0.52, 0.5], angry: [0.6, 0.36], sad: [0.36, 0.58] }[A.kind]; g.lineCap = 'round'; g.lineJoin = 'round'; g.fillStyle = A.fur; g.strokeStyle = A.line;
    if (e) { g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, h * e[1]); g.lineTo(0, h * e[0]); g.closePath(); g.fill(); g.save(); g.beginPath(); g.ellipse(cx, cy, w / 2 - 9, h / 2 - 9, 0, 0, 7); g.clip(); g.lineWidth = 5.5; g.beginPath(); g.moveTo(0, h * e[0]); g.lineTo(w, h * e[1]); g.stroke(); g.restore(); return; }
    // a full cover: the whole box above the eye's middle, the eye's own curve below it, so the cheek stays untouched
    g.beginPath(); g.moveTo(0, cy); g.lineTo(0, 6); g.quadraticCurveTo(0, 0, 6, 0); g.lineTo(w - 6, 0); g.quadraticCurveTo(w, 0, w, 6); g.lineTo(w, cy); g.ellipse(cx, cy, w / 2 - 8, h / 2 - 8, 0, 0, Math.PI); g.closePath(); g.fill(); const ex = w / 2 - 12, ey = h / 2 - 12; g.lineWidth = 4.5; g.beginPath();
    if (A.kind === 'happy') { g.moveTo(cx - ex, cy + ey * 0.2); g.quadraticCurveTo(cx, cy - ey * 0.75, cx + ex, cy + ey * 0.2); }
    else { g.moveTo(cx - ex, cy - ey * 0.05); g.quadraticCurveTo(cx, cy + ey * 0.55, cx + ex, cy - ey * 0.05); g.moveTo(cx - ex, cy - ey * 0.05); g.lineTo(cx - ex - 5, cy + ey * 0.12); }
    g.stroke(); return; }
  // The edge as y at the two sides of the box, outer side first. Angry: low toward the nose.
  // Sad: low toward the outside. (Checked on rendered frames; the box is mirrored for one eye.)
  const edge = { half: [0.5, 0.5], angry: [0.6, 0.3], sad: [0.32, 0.58], closed: [1.2, 1.2], happy: [1.2, 1.2] }[A.kind];
  if ((A.style === 'lash' || A.style === 'anime') && !full) { g.save(); g.beginPath(); g.ellipse(cx, cy, rx + 4.5, ry + 4.5, 0, 0, 7); g.clip(); g.beginPath(); g.moveTo(-4, -4); g.lineTo(w + 4, -4); g.lineTo(w + 4, h * edge[1]); g.lineTo(-4, h * edge[0]); g.closePath(); g.fillStyle = A.fur; g.fill(); g.restore(); g.save(); g.beginPath(); g.ellipse(cx, cy, rx + 1, ry + 1, 0, 0, 7); g.clip(); g.beginPath(); g.moveTo(-4, h * edge[0]); g.lineTo(w + 4, h * edge[1]); g.strokeStyle = K.ink; g.lineWidth = 6; g.lineCap = 'round'; g.stroke(); g.restore(); return; }
  // A closed eye is only its line: the clips hide the white and the pupil, so no patch of skin is
  // painted over the face (a patch never matches the head's shading and shows as a ring).
  if (full) { const ex = rx - 6, ey = ry - 6; g.strokeStyle = K.ink; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); if (A.kind === 'happy') { g.moveTo(cx - ex * 0.85, cy + ey * 0.12); g.quadraticCurveTo(cx, cy - ey * 0.8, cx + ex * 0.85, cy + ey * 0.12); } else { g.moveTo(cx - ex * 0.85, cy - ey * 0.1); g.quadraticCurveTo(cx, cy + ey * 0.5, cx + ex * 0.85, cy - ey * 0.1); } g.stroke(); return; }
  g.save(); eye(); g.clip(); g.beginPath(); g.moveTo(-4, -4); g.lineTo(w + 4, -4); g.lineTo(w + 4, h * edge[1]); g.lineTo(-4, h * edge[0]); g.closePath(); g.fillStyle = A.fur; g.fill();
  if (edge[0] < 1) { g.beginPath(); g.moveTo(-4, h * edge[0]); g.lineTo(w + 4, h * edge[1]); g.strokeStyle = K.ink; g.lineWidth = 6; g.lineCap = 'round'; g.stroke(); }
  g.restore();
  if (edge[0] < 1) { g.save(); g.beginPath(); g.moveTo(-4, -4); g.lineTo(w + 4, -4); g.lineTo(w + 4, h * edge[1]); g.lineTo(-4, h * edge[0]); g.closePath(); g.clip(); eye(); g.strokeStyle = K.ink; g.lineWidth = 6; g.stroke(); g.restore(); }
  else { const ex = rx - 6, ey = ry - 6; g.strokeStyle = K.ink; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); if (A.kind === 'happy') { g.moveTo(cx - ex * 0.85, cy + ey * 0.12); g.quadraticCurveTo(cx, cy - ey * 0.8, cx + ex * 0.85, cy + ey * 0.12); } else { g.moveTo(cx - ex * 0.85, cy - ey * 0.1); g.quadraticCurveTo(cx, cy + ey * 0.5, cx + ex * 0.85, cy - ey * 0.1); } g.stroke(); }
};
const BROW = (g, w, h, K, A) => { if (A.style === 'anime') { if (A.out < 0) { g.translate(w, 0); g.scale(-1, 1); } g.beginPath(); g.moveTo(8, h * 0.7); g.quadraticCurveTo(w * 0.5, h * 0.2, w - 8, h * 0.5); g.strokeStyle = A.color; g.lineWidth = 2; g.lineCap = 'round'; g.stroke(); return; }
  K.rr(g, 3, 3, w - 6, h - 6, (h - 6) / 2); g.fillStyle = A.color; g.fill(); g.strokeStyle = K.ink; g.lineWidth = 3; g.stroke(); };
const BLUSH = (g, w, h, K, A) => { const r = g.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2); r.addColorStop(0, 'rgba(255,105,140,0.85)'); r.addColorStop(1, 'rgba(255,105,140,0)'); g.translate(0, h / 2); g.scale(1, h / w); g.translate(0, -w / 2); g.fillStyle = r; g.beginPath(); g.arc(w / 2, w / 2, w / 2, 0, 7); g.fill(); };
const MOUTH = (g, w, h, K, A) => {
  const cx = w / 2; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = K.ink; g.lineWidth = 6;
  if (A.style === 'anime') { // small, thin-lined mouths
    g.strokeStyle = A.line; g.lineWidth = 2.8;
    if (A.kind === 'neutral') { g.beginPath(); g.moveTo(cx - 8, 23); g.quadraticCurveTo(cx, 29, cx + 8, 23); g.stroke(); }
    if (A.kind === 'frown') { g.beginPath(); g.moveTo(cx - 9, 30); g.quadraticCurveTo(cx, 22, cx + 9, 30); g.stroke(); }
    if (A.kind === 'o') { g.beginPath(); g.ellipse(cx, 29, 6, 8, 0, 0, 7); g.fillStyle = '#8c2f45'; g.fill(); g.stroke(); }
    if (A.kind === 'smile') { const p = () => { g.beginPath(); g.moveTo(cx - 19, 18); g.quadraticCurveTo(cx, 23, cx + 19, 18); g.quadraticCurveTo(cx + 15, 45, cx, 45); g.quadraticCurveTo(cx - 15, 45, cx - 19, 18); g.closePath(); }; p(); g.fillStyle = '#d9667a'; g.fill(); g.save(); p(); g.clip(); g.beginPath(); g.ellipse(cx, 46, 12, 9, 0, 0, 7); g.fillStyle = '#ffb3bd'; g.fill(); g.restore(); p(); g.stroke(); }
    if (A.kind === 'grr') { g.beginPath(); g.moveTo(cx - 13, 24); g.lineTo(cx - 6, 29); g.lineTo(cx, 24); g.lineTo(cx + 6, 29); g.lineTo(cx + 13, 24); g.stroke(); }
    return; }
  if (A.kind === 'neutral' && A.style === 'human') { g.beginPath(); g.moveTo(cx - 17, 20); g.quadraticCurveTo(cx, 34, cx + 17, 20); g.stroke(); }
  else if (A.kind === 'neutral') { g.beginPath(); g.moveTo(cx - 20, 16); g.quadraticCurveTo(cx - 12, 30, cx, 18); g.quadraticCurveTo(cx + 12, 30, cx + 20, 16); g.stroke(); }
  if (A.kind === 'frown') { g.beginPath(); g.moveTo(cx - 18, 32); g.quadraticCurveTo(cx, 14, cx + 18, 32); g.stroke(); }
  if (A.kind === 'o') { g.beginPath(); g.ellipse(cx, 28, 11, 14, 0, 0, 7); K.paint(g, '#7a1f3d', 6); }
  if (A.kind === 'smile') { const p = () => { g.beginPath(); g.moveTo(cx - 26, 14); g.quadraticCurveTo(cx, 20, cx + 26, 14); g.quadraticCurveTo(cx + 22, 46, cx, 46); g.quadraticCurveTo(cx - 22, 46, cx - 26, 14); g.closePath(); }; p(); K.paint(g, '#7a1f3d', 6); g.save(); p(); g.clip(); g.beginPath(); g.ellipse(cx, 47, 15, 11, 0, 0, 7); g.fillStyle = '#ff7f9c'; g.fill(); g.restore(); p(); g.stroke(); }
  if (A.kind === 'grr' && A.style === 'human') { const p = () => K.rr(g, cx - 19, 18, 38, 20, 8); p(); K.paint(g, '#ffffff', 6); g.save(); p(); g.clip(); g.strokeStyle = 'rgba(43,27,77,0.55)'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx - 20, 28); g.lineTo(cx + 20, 28); for (const x of [-9, 0, 9]) { g.moveTo(cx + x, 18); g.lineTo(cx + x, 38); } g.stroke(); g.restore(); }
  else if (A.kind === 'grr') { const p = () => K.rr(g, cx - 26, 14, 52, 28, 10); p(); K.paint(g, '#7a1f3d', 6); g.save(); p(); g.clip(); g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(cx - 26, 12); for (let i = 0; i <= 6; i++) g.lineTo(cx - 26 + i * 8.7, i % 2 ? 26 : 12); g.closePath(); g.fill(); g.beginPath(); g.moveTo(cx - 26, 44); for (let i = 0; i <= 6; i++) g.lineTo(cx - 26 + i * 8.7, i % 2 ? 32 : 44); g.closePath(); g.fill(); g.restore(); p(); g.stroke(); }
};
const TEAR = (g, w, h, K) => { const p = () => { g.beginPath(); g.moveTo(w / 2, 3); g.quadraticCurveTo(w - 2, h * 0.62, w / 2, h - 3); g.quadraticCurveTo(2, h * 0.62, w / 2, 3); g.closePath(); }; p(); K.paint(g, K.grad(g, 0, h, ['#bfeaff', '#4db2ff']), 4); };
const ANGER = (g, w, h, K) => { g.strokeStyle = '#e02447'; g.lineWidth = 7; g.lineCap = 'round'; const c = w / 2, a = 7, b = w / 2 - 5; for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { g.beginPath(); g.moveTo(c + sx * b, c + sy * a); g.quadraticCurveTo(c + sx * a, c + sy * a, c + sx * a, c + sy * b); g.stroke(); } };
const HEART = (g, w, h, K) => { const p = () => { g.beginPath(); g.moveTo(w / 2, h - 5); g.bezierCurveTo(-6, h * 0.5, w * 0.14, 2, w / 2, h * 0.3); g.bezierCurveTo(w * 0.86, 2, w + 6, h * 0.5, w / 2, h - 5); g.closePath(); }; p(); K.paint(g, K.grad(g, 0, h, ['#ff8fb0', '#f0406f']), 5); K.gloss(g, p, 4, 4, w - 8, h - 8, 0.45); };
const ZZZ = (g, w, h, K) => { g.font = '900 ' + (h - 6) + 'px ui-sans-serif,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.strokeStyle = K.ink; g.lineWidth = 6; g.strokeText('z', w / 2, h / 2); g.fillStyle = '#cfe6ff'; g.fillText('z', w / 2, h / 2); };

exports.faceParts = cfg => {
  const LINE = cfg.line ?? '#2b1b4d', [psx, psy] = cfg.pupilScale ?? [1.4, 1.4];
  const P = cfg.parent ?? 'head', [ex, ey] = cfg.eye, [rx, ry] = cfg.eyeSize ?? [25, 29], [mx, my] = cfg.mouth, by = cfg.browY ?? ry + 11;
  const pieces = [];
  for (const [side, s] of [['L', -1], ['R', 1]]) pieces.push({ name: 'blush' + side, parent: P, at: cfg.blush ? [s * cfg.blush[0], cfg.blush[1]] : [s * (ex + rx + 4), ey - ry - 8], size: [44, 26], hidden: true, draw: BLUSH });
  for (const [side, s] of [['L', -1], ['R', 1]]) {
    pieces.push({ name: 'eye' + side, parent: P, at: [s * ex, ey], size: [rx * 2 + 10, ry * 2 + 10], draw: EYE, args: { line: cfg.eyeLine, style: cfg.eyeStyle, out: s } });
    // The eye's mask: the pupil draws only inside the white, so a glance or a squint can never cross
    // the eye's outline. The lid stays outside the mask: its own drawing already follows the eye's
    // shape with soft edges, and a mask's hard edge would let the white show through as a dotted ring.
    // (Not for the anime eye.)
    if (cfg.eyeStyle !== 'anime') {
      const ix = rx - 2.5, iy = ry - 2.5, points = Array.from({ length: 28 }, (_, k) => { const a = -k / 28 * Math.PI * 2; return [+(s * ex + ix * Math.cos(a)).toFixed(2), +(ey + iy * Math.sin(a)).toFixed(2)]; });
      pieces.push({ name: 'eyeClip' + side, on: 'eye' + side, clip: { end: 'pupil' + side, points } });
    }
    pieces.push({ name: 'pupil' + side, parent: 'eye' + side, at: [s * ex, ey], size: [rx * psx, ry * psy].map(Math.round), draw: PUPIL, args: { iris: cfg.iris ?? '#4a8f3c', style: cfg.pupil, deep: cfg.irisDeep, glow: cfg.irisGlow } });
    if (cfg.eyeStyle === 'anime') pieces.push({ name: 'lash' + side, on: 'eye' + side, at: [s * ex, ey], size: [rx * 2 + 22, ry * 2 + 22], draw: LASH, args: { out: s, rx, ry, line: LINE } });
    for (const kind of ['half', 'angry', 'sad', 'closed', 'happy']) pieces.push({ name: 'lid_' + kind, slot: 'lid' + side, parent: 'eye' + side, at: [s * ex, ey], size: [rx * 2 + 22, ry * 2 + 22], draw: LID, args: { kind, fur: cfg['fur' + side] ?? cfg.fur, mirror: s > 0, style: cfg.eyeStyle, line: LINE } });
  }
  // The muzzle is its own layer above the lids: a lid paints fur, and must never paint it onto the muzzle.
  if (cfg.muzzle) pieces.push({ name: 'muzzle', parent: P, at: cfg.muzzle.at, size: cfg.muzzle.size, args: { color: cfg.muzzle.color }, draw: (g, w, h, K, A) => { g.fillStyle = A.color; g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - 1, h / 2 - 1, 0, 0, 7); g.fill(); } });
  for (const [side, s] of [['L', -1], ['R', 1]]) pieces.push({ name: 'brow' + side, parent: P, at: [s * ex, ey + by], size: [38, 13], draw: BROW, args: { color: cfg.brow ?? '#8a4a14', style: cfg.eyeStyle, out: s } });
  for (const kind of ['neutral', 'smile', 'o', 'frown', 'grr']) pieces.push({ name: 'mouth_' + kind, slot: 'mouth', shown: kind === 'neutral', parent: P, at: [mx, my], size: [80, 58], draw: MOUTH, args: { kind, style: cfg.mouthStyle, line: LINE } });
  for (const [side, s] of [['L', -1], ['R', 1]]) pieces.push({ name: 'tear' + side, parent: P, at: [s * (ex + 6), ey - ry - 14], size: [18, 26], hidden: true, draw: TEAR });
  pieces.push({ name: 'anger', parent: P, at: cfg.anger ?? [ex + 40, ey + ry + 32], size: [46, 46], hidden: true, draw: ANGER });
  pieces.push({ name: 'heart', parent: 'root', at: [ex + 30, ey + ry + 60], size: [44, 42], hidden: true, draw: HEART });
  pieces.push({ name: 'zzz', parent: 'root', at: [ex + 40, ey + ry + 50], size: [34, 34], hidden: true, draw: ZZZ });
  return pieces;
};
