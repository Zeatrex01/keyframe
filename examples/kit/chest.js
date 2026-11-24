// "Reward chest": drops in, lands with a squash, rattles twice (the second bigger), bursts open
// with a flash and a beam of light, and three cards fly out on staggered arcs and flip. Then a
// glow loop. Roadmap #12. Teaches staging (one idea at a time), timing (a long wind-up and a fast
// payoff), overshoot and settle on the lid, and events on the contact frame.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRig } from './rig.js';
import { INK, star, paint, gloss, glow, shadow, sparkle } from './style.js';
import { fr, fresh } from './studio.js';
import { finish, rgba } from './showcase.js';

const NAME = 'chest';
const DIR = fileURLToPath(new URL(`../showcase/${NAME}/`, import.meta.url));
const VIEW = { x: -430, y: -360, width: 860, height: 645 };
const GROUND = -330, MOUTH = [0, -150], BOX_H = 195;
// kind, tint, final x, final y, final turn
export const CARDS = [['coins', '#f5a31a', -205, 92, 9], ['star', '#ff5d9a', 0, 150, 0], ['gem', '#2f9dff', 205, 92, -9]];

const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
const BASE = (g, w, h) => {
  const p = () => rr(g, 8, 8, w - 16, h - 16, 18);
  p(); paint(g, g.linear(0, 0, 0, h, ['#8a5cf0', '#5a33c4']), 8);
  g.save(); p(); g.clip(); g.fillStyle = 'rgba(20,10,60,0.22)'; for (let x = 60; x < w; x += 62) g.fillRect(x, 0, 5, h); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 8, w, 16); g.restore();
  for (const x of [8, w - 44]) { rr(g, x, 8, 36, h - 16, 10); paint(g, g.linear(0, 0, 0, h, ['#ffd95a', '#f0a01c']), 7); }
  rr(g, 8, h - 44, w - 16, 36, 12); paint(g, g.linear(0, h - 44, 0, h, ['#ffd95a', '#e89512']), 7);
  rr(g, w / 2 - 34, 2, 68, 78, 14); paint(g, g.linear(0, 0, 0, 80, ['#ffe873', '#f0a01c']), 7);
  g.beginPath(); g.arc(w / 2, 36, 11, 0, 7); g.fillStyle = INK; g.fill(); g.fillRect(w / 2 - 5, 36, 10, 24);
};
const LID = (g, w, h, { open }) => {
  if (open) { // seen from the front, thrown back: the inside of the lid, glowing
    const p = () => { g.beginPath(); g.moveTo(26, h - 8); g.lineTo(8, 60); g.quadraticCurveTo(w / 2, -30, w - 8, 60); g.lineTo(w - 26, h - 8); g.closePath(); };
    p(); paint(g, g.linear(0, 0, 0, h, ['#3a1f8a', '#27135e']), 8);
    g.save(); p(); g.clip(); g.fillStyle = g.radial(w / 2, h, 10, h, ['rgba(255,230,120,0.9)', 'rgba(255,230,120,0)']); g.fillRect(0, 0, w, h); g.restore();
    g.beginPath(); g.moveTo(8, 60); g.quadraticCurveTo(w / 2, -30, w - 8, 60); g.strokeStyle = '#ffd95a'; g.lineWidth = 12; g.stroke(); g.strokeStyle = INK; g.lineWidth = 3; g.stroke();
    return;
  }
  const p = () => { g.beginPath(); g.moveTo(8, h - 8); g.lineTo(8, 70); g.quadraticCurveTo(w / 2, -34, w - 8, 70); g.lineTo(w - 8, h - 8); g.closePath(); };
  p(); paint(g, g.linear(0, 0, 0, h, ['#a77bff', '#6a3fe0']), 8); gloss(g, p, 20, 8, w - 40, h * 0.6, 0.35);
  g.save(); p(); g.clip();
  for (const x of [8, w - 44]) { g.fillStyle = '#f5b52e'; g.fillRect(x, 0, 36, h); g.beginPath(); g.rect(x, -10, 36, h + 20); g.strokeStyle = INK; g.lineWidth = 7; g.stroke(); }
  g.fillStyle = '#f5b52e'; g.fillRect(0, h - 34, w, 30); g.beginPath(); g.rect(-10, h - 34, w + 20, 40); g.strokeStyle = INK; g.lineWidth = 7; g.stroke();
  g.restore(); p(); g.strokeStyle = INK; g.lineWidth = 8; g.stroke();
};
const BEAM = (g, w, h) => {
  g.fillStyle = g.linear(0, h, 0, 0, ['rgba(255,236,150,0.95)', 'rgba(255,220,120,0.4)', 'rgba(255,220,120,0)']);
  g.beginPath(); g.moveTo(w * 0.3, h); g.lineTo(0, 0); g.lineTo(w, 0); g.lineTo(w * 0.7, h); g.closePath(); g.fill();
};
const RAYS = (g, w, h) => {
  const c = w / 2, n = 14;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, d = Math.PI / n * 0.62;
    g.fillStyle = g.radial(c, c, 20, c, ['rgba(255,214,110,0.5)', 'rgba(255,200,90,0.22)', 'rgba(255,200,90,0)']);
    g.beginPath(); g.moveTo(c, c); g.arc(c, c, c, a - d, a + d); g.closePath(); g.fill();
  }
};
const CARD = (g, w, h, { back, kind, tint }) => {
  const p = () => rr(g, 6, 6, w - 12, h - 12, 16);
  if (back) {
    p(); paint(g, g.linear(0, 0, 0, h, ['#7a52e8', '#4a28b0']), 7);
    g.save(); p(); g.clip(); g.fillStyle = 'rgba(255,255,255,0.1)';
    for (let y = -h; y < h * 2; y += 26) { g.save(); g.translate(0, y); g.rotate(-0.5); g.fillRect(-w, 0, w * 3, 10); g.restore(); }
    g.restore(); star(g, w / 2, h / 2, 34, 16); paint(g, '#ffd95a', 6); return;
  }
  p(); paint(g, g.linear(0, 0, 0, h, ['#fffaf0', '#ffe9c4']), 7);
  rr(g, 14, 14, w - 28, h - 28, 10); g.strokeStyle = tint; g.lineWidth = 4; g.stroke();
  const cx = w / 2, cy = h * 0.46;
  if (kind === 'coins') for (const [dx, dy] of [[-16, 14], [16, 14], [0, -8]]) { g.beginPath(); g.arc(cx + dx, cy + dy, 22, 0, 7); paint(g, g.linear(0, cy - 30, 0, cy + 40, ['#ffe066', '#f5a31a']), 5); star(g, cx + dx, cy + dy + 1, 10, 5); g.fillStyle = '#fff3b0'; g.fill(); }
  if (kind === 'gem') {
    g.beginPath(); g.moveTo(cx, cy + 40); g.lineTo(cx - 40, cy - 6); g.lineTo(cx - 22, cy - 32); g.lineTo(cx + 22, cy - 32); g.lineTo(cx + 40, cy - 6); g.closePath();
    paint(g, g.linear(0, cy - 32, 0, cy + 40, ['#8fe9ff', '#2f9dff']), 6);
    g.beginPath(); g.moveTo(cx - 40, cy - 6); g.lineTo(cx + 40, cy - 6); g.moveTo(cx - 14, cy - 6); g.lineTo(cx, cy + 40); g.lineTo(cx + 14, cy - 6); g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 3; g.stroke();
  }
  if (kind === 'star') { star(g, cx, cy, 44, 22); paint(g, g.linear(0, cy - 44, 0, cy + 44, ['#ffb3d1', '#ff5d9a']), 6); star(g, cx, cy, 18, 9); g.fillStyle = 'rgba(255,255,255,0.6)'; g.fill(); }
  // a reward line in place of text: three pips in the card's colour
  for (let i = -1; i <= 1; i++) { g.beginPath(); g.arc(cx + i * 22, h - 40, 7, 0, 7); g.fillStyle = tint; g.fill(); }
};
const RING = (g, w, h) => { g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 8, 0, 7); g.strokeStyle = '#fff7c9'; g.lineWidth = 8; g.stroke(); };

export const rig = {
  name: NAME, bounds: VIEW, density: 1.5, events: ['land', 'open', 'card_1', 'card_2', 'card_3'],
  bones: [
    { name: 'stage', at: [0, 0] },
    { name: 'chest', parent: 'stage', at: [0, GROUND] },
    ...CARDS.map((c, i) => ({ name: `card${i + 1}`, parent: 'stage', at: MOUTH })),
  ],
  pieces: [
    { name: 'glow', parent: 'stage', at: [0, 20], size: [720, 720], draw: (g, w, h) => glow(g, w, h, [132, 98, 255, 0.75]), hidden: true },
    { name: 'rays', parent: 'stage', at: [0, 20], size: [820, 820], draw: RAYS, hidden: true, blend: 'additive' },
    { name: 'shadow', parent: 'stage', at: [0, GROUND - 6], size: [380, 60], draw: (g, w, h) => shadow(g, w, h, 0.6) },
    { name: 'lid_open', slot: 'lidBack', parent: 'chest', at: [0, -70], pivot: [0, -150], size: [330, 170], draw: LID, args: { open: true } },
    { name: 'beam', parent: 'chest', at: [0, 110], pivot: [0, -150], size: [420, 520], draw: BEAM, hidden: true, blend: 'additive' },
    ...CARDS.flatMap(([kind, tint], i) => [
      { name: `card_back${i + 1}`, slot: `cardArt${i + 1}`, on: `card${i + 1}`, at: MOUTH, size: [150, 204], draw: CARD, args: { back: true } },
      { name: `card_front${i + 1}`, slot: `cardArt${i + 1}`, on: `card${i + 1}`, at: MOUTH, size: [150, 204], draw: CARD, args: { kind, tint } }]),
    { name: 'box', parent: 'chest', at: [0, -235], pivot: [0, GROUND], size: [310, 200], draw: BASE },
    { name: 'lid_closed', slot: 'lid', shown: true, parent: 'chest', at: [0, -95], pivot: [0, GROUND + BOX_H], size: [326, 130], draw: LID, args: {} },
    { name: 'flash', parent: 'chest', at: MOUTH, size: [520, 520], draw: (g, w, h) => glow(g, w, h, [255, 255, 255, 1]), hidden: true, blend: 'additive' },
    ...CARDS.map(([, , x, y], i) => ({ name: `ring${i + 1}`, parent: 'stage', at: [x, y], size: [190, 190], draw: RING, hidden: true, blend: 'additive' })),
    ...[[-250, 260, 54], [262, 230, 42], [-40, 300, 36]].map(([x, y, s], i) => ({ name: `sparkle${i + 1}`, parent: 'stage', at: [x, y], size: [s, s], draw: (g, w, h) => sparkle(g, w, h), hidden: true, blend: 'additive' })),
  ],
};

const k = (frame, more) => ({ time: fr(frame), ...more });
const T = 84;                       // appear: 2.8 s
const LAND = 10, OPEN = 56, LAUNCH = [60, 63, 66], FLIGHT = 12;
const sc = (frame, x, y, curve) => k(frame, { x, y, ...(curve ? { curve } : {}) });
const tr = sc;
const ro = (frame, value, curve) => k(frame, { value, ...(curve ? { curve } : {}) });
const col = (frame, a, curve) => k(frame, { color: rgba(a), ...(curve ? { curve } : {}) });
const att = (frame, name) => k(frame, { name });

// keys past the clip's end are dropped and two keys on one time keep the later one
const fit = keys => keys.filter(x => x.time <= fr(T) + 1e-9).filter((x, j, a) => j === a.length - 1 || x.time !== a[j + 1].time);
function cardFlight(i, start) {
  const out = cardKeys(i, start);
  return Object.fromEntries(Object.entries(out).map(([c, keys]) => [c, fit(keys)]));
}
function cardKeys(i, start) {
  const [, , x, y, turn] = CARDS[i], dx = x - MOUTH[0], dy = y - MOUTH[1], land = start + FLIGHT;
  return {
    // x and y take different eases: up fast out of the chest, sideways later, so each card arcs
    translate: [tr(0, 0, 0), tr(start, 0, 0, i === 1 ? 'outCubic' : 'outQuart'), tr(start + 5, dx * 0.38, dy * 0.82, 'inOutSine'), tr(land, dx, dy, 'outSine'), tr(land + 3, dx, dy - 4, 'inOutSine'), tr(T, dx, dy)],
    rotate: [ro(0, 0), ro(start, 0, 'outCubic'), ro(start + 5, turn * 1.6 + (i - 1) * 8, 'outBack'), ro(land, turn, 'inOutSine'), ro(T, turn)],
    // the flip: edge-on at the middle of the flight (the art swaps there), past full size, settle
    scale: [sc(0, 0.6, 0.6), sc(start, 0.6, 0.6, 'outQuad'), sc(start + 6, 0.06, 1, 'outBack'), sc(start + 9, 1.08, 1.08, 'inOutSine'), sc(land, 1, 1), sc(T, 1, 1)],
  };
}

export const brief = {
  name: NAME, title: 'Reward chest', kind: 'Prop', principles: 'prop',
  subject: 'A treasure chest on a reward screen, with three reward cards inside.',
  intent: 'The reward moment, staged one idea at a time: the chest falls in and lands, rattles twice (the second bigger, so the payoff is earned), bursts open with a flash and a beam, and the cards fly out one after another and flip. A long wind-up, a fast payoff, then a glow that can loop while the player looks.',
  display: { width: 360, pixelsPerUnit: +(360 / 660).toFixed(3) },
  teaches: ['staging', 'timing', 'overshoot and settle', 'events on the contact frame'],
  preview: { clip: 'glow', time: 0.5 },
  events: { land: [fr(LAND)], open: [fr(OPEN)], card_1: [fr(LAUNCH[0] + FLIGHT)], card_2: [fr(LAUNCH[1] + FLIGHT)], card_3: [fr(LAUNCH[2] + FLIGHT)] },
  clips: [
    { name: 'appear', seconds: 2.8, loop: false, track: 0, does: 'drop, land squash (land), two rattles growing, the lid bursts with a flash (open), a beam, three cards fly out 3 frames apart on arcs, flip and land (card_1..3)' },
    { name: 'glow', seconds: 2, loop: true, track: 0, does: 'the open chest after the reveal: rays sway, the beam breathes, the cards float out of phase, sparkles twinkle' },
  ],
};

export const clips = {
  appear: {
    bones: {
      // the fall: accelerates in, contact on LAND, one small bounce
      chest: {
        translate: [tr(0, 0, 640, 'inQuad'), tr(LAND, 0, 0, 'outQuad'), tr(LAND + 4, 0, 16, 'inQuad'), tr(LAND + 8, 0, 0), tr(T, 0, 0)],
        // rattle 1 (small), a held breath, rattle 2 (bigger), the burst
        rotate: [ro(0, 0), ro(30, 0, 'outSine'), ro(32, -3, 'inOutSine'), ro(34, 3, 'inOutSine'), ro(36, -2, 'inOutSine'), ro(38, 0), ro(43, 0, 'outSine'),
          ro(45, -6, 'inOutSine'), ro(47, 6, 'inOutSine'), ro(49, -6, 'inOutSine'), ro(51, 4, 'outCubic'), ro(54, 0), ro(T, 0)],
      },
      // squash and stretch on the box, a leaf bone: volume kept (x * y close to 1)
      box: { scale: [sc(0, 0.9, 1.12), sc(LAND - 2, 0.9, 1.12, 'outQuad'), sc(LAND, 1.22, 0.82, 'outCubic'), sc(LAND + 3, 0.93, 1.07, 'inOutSine'), sc(LAND + 7, 1.02, 0.98, 'outSine'), sc(LAND + 10, 1, 1),
        sc(51, 1, 1, 'inOutQuad'), sc(OPEN, 1.1, 0.91, 'outExpo'), sc(OPEN + 2, 0.9, 1.11, 'inOutSine'), sc(OPEN + 6, 1.03, 0.97, 'outSine'), sc(OPEN + 10, 1, 1), sc(T, 1, 1)] },
      // the lid rides the box top while it squashes, lifts a little on each rattle, then bursts
      lid: {
        translate: [tr(0, 0, 22), tr(LAND - 2, 0, 22, 'outQuad'), tr(LAND, 0, -35, 'outCubic'), tr(LAND + 3, 0, 14, 'inOutSine'), tr(LAND + 7, 0, -4, 'outSine'), tr(LAND + 10, 0, 0),
          tr(31, 0, 0, 'outQuad'), tr(33, 0, 7, 'inQuad'), tr(35, 0, 0), tr(46, 0, 0, 'outQuad'), tr(48, 0, 13, 'inQuad'), tr(50, 0, 0), tr(51, 0, 0, 'inOutQuad'),
          tr(OPEN, 0, -18, 'outExpo'), tr(OPEN + 3, 0, 90), tr(T, 0, 90)],
        scale: [sc(0, 0.9, 1), sc(LAND - 2, 0.9, 1, 'outQuad'), sc(LAND, 1.22, 1, 'outCubic'), sc(LAND + 3, 0.93, 1, 'inOutSine'), sc(LAND + 7, 1.02, 1, 'outSine'), sc(LAND + 10, 1, 1), sc(T, 1, 1)],
      },
      // overshoot and settle: the thrown-back lid swings past its rest and comes back
      lidBack: { scale: [sc(0, 0.7, 0.4), sc(OPEN + 3, 0.7, 0.4, 'outBack'), sc(OPEN + 7, 1.06, 1.14, 'inOutSine'), sc(OPEN + 11, 0.99, 0.95, 'outSine'), sc(OPEN + 15, 1, 1), sc(T, 1, 1)],
        rotate: [ro(0, 0), ro(OPEN + 3, 0, 'outCubic'), ro(OPEN + 7, -5, 'inOutSine'), ro(OPEN + 11, 2, 'outSine'), ro(OPEN + 15, 0), ro(T, 0)] },
      beam: { scale: [sc(0, 0.6, 0.2), sc(OPEN + 1, 0.6, 0.2, 'outExpo'), sc(OPEN + 6, 1.05, 1.08, 'inOutSine'), sc(OPEN + 12, 1, 1), sc(T, 1, 1)] },
      flash: { scale: [sc(0, 0.5, 0.5), sc(OPEN, 0.5, 0.5, 'outQuart'), sc(OPEN + 3, 1.3, 1.3, 'outSine'), sc(OPEN + 7, 1.5, 1.5), sc(T, 1.5, 1.5)] },
      rays: { rotate: [ro(0, 0), ro(OPEN, 0, 'outCubic'), ro(T, 24)], scale: [sc(0, 0.6, 0.6), sc(OPEN, 0.6, 0.6, 'outBack'), sc(OPEN + 10, 1, 1), sc(T, 1.04, 1.04)] },
      shadow: { scale: [sc(0, 0.3, 0.3, 'inQuad'), sc(LAND, 1.1, 1.1, 'outQuad'), sc(LAND + 4, 0.96, 0.96, 'inQuad'), sc(LAND + 8, 1, 1), sc(T, 1, 1)] },
      ...Object.fromEntries(LAUNCH.map((start, i) => [`card${i + 1}`, cardFlight(i, start)])),
      ...Object.fromEntries(LAUNCH.map((start, i) => [`ring${i + 1}`, { scale: fit([sc(0, 0.8, 0.8), sc(start + FLIGHT, 0.8, 0.8, 'outCubic'), sc(start + FLIGHT + 6, 1.45, 1.45), sc(T, 1.45, 1.45)]) }])),
    },
    slots: {
      lid: { attachment: [att(0, 'lid_closed'), att(OPEN + 3, null)] },
      lidBack: { attachment: [att(0, null), att(OPEN + 3, 'lid_open')] },
      ...Object.fromEntries(LAUNCH.map((start, i) => [`cardArt${i + 1}`, { attachment: [att(0, null), att(start, `card_back${i + 1}`), att(start + 6, `card_front${i + 1}`)] }])),
      flash: { rgba: [col(0, 0), col(OPEN - 1, 0), col(OPEN, 1), col(OPEN + 2, 1, 'outQuad'), col(OPEN + 7, 0)] },
      beam: { rgba: [col(0, 0), col(OPEN + 1, 0, 'outQuad'), col(OPEN + 4, 1), col(T, 0.85)] },
      glow: { rgba: [col(0, 0), col(32, 0, 'outQuad'), col(33, 0.25, 'inQuad'), col(36, 0), col(47, 0, 'outQuad'), col(48, 0.4, 'inQuad'), col(52, 0), col(OPEN, 0, 'outCubic'), col(OPEN + 8, 0.9), col(T, 0.8)] },
      rays: { rgba: [col(0, 0), col(OPEN + 2, 0, 'outCubic'), col(OPEN + 12, 1), col(T, 0.9)] },
      ...Object.fromEntries(LAUNCH.map((start, i) => [`ring${i + 1}`, { rgba: [col(0, 0), col(start + FLIGHT - 1, 0), col(start + FLIGHT, 0.95, 'outQuad'), col(start + FLIGHT + 6, 0)] }])),
    },
    events: [k(LAND, { name: 'land' }), k(OPEN, { name: 'open' }), ...LAUNCH.map((start, i) => k(start + FLIGHT, { name: `card_${i + 1}` }))],
  },
};

// The loop after the reveal: everything in its open pose, alive.
const G = 60;
const bob = i => {
  const [, , x, y, turn] = CARDS[i], dx = x - MOUTH[0], dy = y - MOUTH[1], o = [0, 7, 3][i], amp = [8, 10, 7][i];
  return {
    translate: [tr(0, dx, dy, 'inOutSine'), tr(o + 14, dx, dy + amp, 'inOutSine'), tr(o + 20, dx, dy + amp, 'inOutSine'), tr(o + 44, dx, dy - amp * 0.4, 'inOutSine'), tr(G, dx, dy)],
    rotate: [ro(0, turn), ro(o + 16, turn + (i - 1 || 1) * 3, 'inOutSine'), ro(o + 40, turn - (i - 1 || 1) * 2, 'inOutSine'), ro(G, turn)],
  };
};
clips.glow = {
  bones: {
    ...Object.fromEntries(CARDS.map((c, i) => [`card${i + 1}`, bob(i)])),
    lid: { translate: [tr(0, 0, 90), tr(G, 0, 90)] },
    rays: { rotate: [ro(0, 24, 'inOutSine'), ro(26, 30, 'inOutSine'), ro(32, 30, 'inOutQuad'), ro(G, 24)], scale: [sc(0, 1.04, 1.04, 'inOutSine'), sc(30, 1.1, 1.1, 'inOutQuad'), sc(G, 1.04, 1.04)] },
    beam: { scale: [sc(0, 1, 1, 'inOutQuad'), sc(22, 1.07, 1.02, 'inOutSine'), sc(40, 0.97, 1, 'inOutCubic'), sc(G, 1, 1)] },
    lidBack: { rotate: [ro(0, 0, 'inOutSine'), ro(28, -5, 'inOutQuad'), ro(G, 0)] },
    box: { scale: [sc(0, 1, 1, 'inOutSine'), sc(26, 1.015, 0.985, 'outSine'), sc(34, 1.015, 0.985, 'inOutSine'), sc(G, 1, 1)] },
    ...Object.fromEntries([[0, 1, 'outBack', 30], [20, 0.85, 'outCubic', -26], [38, 0.95, 'outQuart', 22]].map(([start, size, ease, turn], i) => [`sparkle${i + 1}`, {
      scale: [sc(0, 0.2, 0.2), sc(start, 0.2, 0.2, ease), sc(start + 6, size, size, 'inQuad'), sc(start + 14, 0.2, 0.2), sc(G, 0.2, 0.2)].filter((x, j, a) => j === a.length - 1 || x.time !== a[j + 1].time),
      rotate: [ro(0, 0), ro(start, 0, 'outSine'), ro(start + 2, -turn * 0.15, 'inOutCubic'), ro(start + 14, turn, 'stepped'), ro(start + 15, 0), ro(G, 0)].filter((x, j, a) => j === a.length - 1 || x.time !== a[j + 1].time),
    }])),
  },
  slots: {
    lid: { attachment: [att(0, null)] },
    lidBack: { attachment: [att(0, 'lid_open')] },
    ...Object.fromEntries(CARDS.map((c, i) => [`cardArt${i + 1}`, { attachment: [att(0, `card_front${i + 1}`)] }])),
    beam: { rgba: [col(0, 0.85, 'inOutSine'), col(24, 1, 'inOutSine'), col(G, 0.85)] },
    glow: { rgba: [col(0, 0.8, 'inOutSine'), col(30, 0.95, 'inOutSine'), col(G, 0.8)] },
    rays: { rgba: [col(0, 0.9), col(G, 0.9)] },
    ...Object.fromEntries([0, 20, 38].map((start, i) => [`sparkle${i + 1}`, { rgba: [col(0, 0), col(start, 0, 'outQuad'), col(start + 4, 1, 'inQuad'), col(start + 14, 0), col(G, 0)].filter((x, j, a) => j === a.length - 1 || x.time !== a[j + 1].time) }])),
  },
};

export async function build() {
  fresh(DIR, NAME);
  buildRig(rig, DIR);
  await finish(DIR, NAME, brief, clips, { viewport: VIEW, strip: { width: 200, columns: 6 } });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
