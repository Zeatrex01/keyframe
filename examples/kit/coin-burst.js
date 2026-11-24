// "Coin burst": the reward effect casual games play when coins are collected. A white flash, a
// ring that overshoots its size, eight coins popping out on staggered arcs, spinning, easing
// into the counter, each landing with a squash, a flash and a `coin_land` event. Coin and
// sparkle art come from the old victory screen's drawings. Teaches arcs, stagger, spacing
// (fast out, slow in) and exaggeration.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRig } from './rig.js';
import { star, paint, gloss, glow, sparkle } from './style.js';
import { fr, fresh } from './studio.js';
import { finish, rgba } from './showcase.js';

const NAME = 'coin-burst';
const DIR = fileURLToPath(new URL(`../showcase/${NAME}/`, import.meta.url));
const VIEW = { x: -220, y: -175, width: 440, height: 330 };
const CENTER = [-70, -75], COUNTER = [118, 112], COINS = 8;

const COIN = (g, w, h) => {
  const c = () => { g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 4, 0, 7); };
  c(); paint(g, g.linear(0, 0, 0, h, ['#ffe066', '#f5a31a']), 4.5);
  g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 10, 0, 7); g.strokeStyle = 'rgba(160,90,0,0.55)'; g.lineWidth = 2.5; g.stroke();
  star(g, w / 2, h / 2 + 1, w * 0.2, w * 0.1); g.fillStyle = '#fff3b0'; g.fill();
  gloss(g, c, 4, 4, w - 8, h * 0.6, 0.45);
};
const RING = (g, w, h) => { g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 8, 0, 7); g.strokeStyle = '#fff3c4'; g.lineWidth = 7; g.stroke(); };
const SPARKS = (g, w, h) => {
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2 + (i % 2) * 0.2, r0 = w * (i % 2 ? 0.3 : 0.24), r1 = w * (i % 2 ? 0.42 : 0.48);
    g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * r0, h / 2 + Math.sin(a) * r0); g.lineTo(w / 2 + Math.cos(a) * r1, h / 2 + Math.sin(a) * r1);
    g.strokeStyle = i % 3 ? '#ffe9a8' : '#ffffff'; g.lineWidth = i % 2 ? 5 : 7; g.stroke();
  }
};
const PANEL = (g, w, h) => {
  g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, (h - 8) / 2); paint(g, g.linear(0, 0, 0, h, ['#3b2f6e', '#241c48']), 5);
  g.beginPath(); g.roundRect(46, h / 2 - 7, w - 66, 14, 7); g.fillStyle = 'rgba(10,6,25,0.55)'; g.fill();
};
const BAR = (g, w, h) => { g.beginPath(); g.roundRect(1, 1, w - 2, h - 2, (h - 2) / 2); g.fillStyle = g.linear(0, 0, 0, h, ['#ffe58a', '#f4ae3f']); g.fill(); };

const spread = i => { // where coin i pops to: a fan above the burst, alternating sides
  const a = (160 - i * 20 + (i % 2 ? 7 : -5)) * Math.PI / 180, d = 112 + (i % 3) * 24;
  return [Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d)];
};

export const rig = {
  name: NAME, bounds: VIEW, density: 2, events: ['coin_land'],
  bones: [{ name: 'burst', at: CENTER }, { name: 'counter', at: COUNTER }],
  pieces: [
    { name: 'burstGlow', parent: 'burst', at: CENTER, size: [260, 260], draw: (g, w, h) => glow(g, w, h, [255, 190, 90, 0.8]), hidden: true, blend: 'additive' },
    { name: 'ring', parent: 'burst', at: CENTER, size: [120, 120], draw: RING, hidden: true, blend: 'additive' },
    { name: 'sparks', parent: 'burst', at: CENTER, size: [150, 150], draw: SPARKS, hidden: true, blend: 'additive' },
    { name: 'panel', on: 'counter', at: COUNTER, size: [150, 54], draw: PANEL },
    { name: 'bar', parent: 'counter', at: [COUNTER[0] + 13, COUNTER[1]], pivot: [COUNTER[0] - 29, COUNTER[1]], size: [84, 12], draw: BAR },
    { name: 'counterCoin', parent: 'counter', at: [COUNTER[0] - 50, COUNTER[1]], size: [44, 44], draw: COIN },
    { name: 'counterFlash', parent: 'counterCoin', at: [COUNTER[0] - 50, COUNTER[1]], size: [110, 110], draw: (g, w, h) => glow(g, w, h, [255, 255, 255, 0.95]), hidden: true, blend: 'additive' },
    ...Array.from({ length: COINS }, (_, i) => ({ name: `coin${i + 1}`, parent: 'burst', at: CENTER, size: [48, 48], draw: COIN, hidden: true })),
    { name: 'flash', parent: 'burst', at: CENTER, size: [200, 200], draw: (g, w, h) => glow(g, w, h, [255, 255, 255, 1]), hidden: true, blend: 'additive' },
    ...[[-30, 30, 46], [70, 34, 34], [44, -34, 40]].map(([dx, dy, size], i) => ({ name: `sparkle${i + 1}`, parent: 'counter', at: [COUNTER[0] + dx, COUNTER[1] + dy], size: [size, size], draw: (g, w, h) => sparkle(g, w, h), hidden: true, blend: 'additive' })),
  ],
};

const k = (frame, more, end = 30) => ({ time: fr(Math.min(frame, end)), ...more });
// keys clamped to the clip's ends can meet: keep the last of two keys on one time
const kS = (frame, more) => k(frame, more, 45);
const tidy = clip => JSON.parse(JSON.stringify(clip, (key, v) => Array.isArray(v) && v.length && v[0]?.time !== undefined ? v.filter((x, i) => i === v.length - 1 || x.time !== v[i + 1].time) : v));
const POP = ['outCubic', 'outQuart', 'outExpo', 'outCubic', 'outQuart', 'outExpo', 'outCubic', 'outQuart'];
const FLY = ['inOutCubic', 'inOutQuad', 'inOutSine', 'inOutQuart', 'inOutCubic', 'inOutQuad', 'inOutSine', 'inOutQuart'];
const START = [1, 3, 5, 8, 10, 12, 14, 16];     // 2 to 3 frames apart
const POP_F = 5, FLY_F = 7;
export const LANDS = START.map(s => s + POP_F + FLY_F);

function coinClip(i) {
  const s = START[i], [px, py] = spread(i), land = LANDS[i], tx = COUNTER[0] - 50 - CENTER[0], ty = COUNTER[1] - CENTER[1];
  return {
    // x and y take different eases, so the path curves: out fast, a short hang, then in to the counter
    translate: [k(0, { x: 0, y: 0 }), k(s, { x: 0, y: 0, curve: POP[i] }), k(s + POP_F, { x: px, y: py, curve: FLY[i] }), k(land, { x: tx, y: ty }), k(30, { x: tx, y: ty })],
    // a spin: the coin turns edge-on and back while it flies, then squashes on contact
    scale: [k(0, { x: 0.6, y: 0.6 }), k(s, { x: 0.6, y: 0.6, curve: 'outBack' }), k(s + 3, { x: 1.1, y: 1.1, curve: 'inOutSine' }), k(s + 6, { x: 0.25, y: 1, curve: 'inOutSine' }),
      k(s + 9, { x: 1, y: 1, curve: 'outQuad' }), k(land, { x: 1.25, y: 0.8, curve: 'outCubic' }), k(land + 2, { x: 0.8, y: 0.8 }), k(30, { x: 0.8, y: 0.8 })],
    rotate: [k(0, { value: 0 }), k(s, { value: 0, curve: 'outCubic' }), k(land, { value: (i % 2 ? 1 : -1) * (200 + i * 15) }), k(30, { value: (i % 2 ? 1 : -1) * (200 + i * 15) })],
  };
}

export const brief = {
  name: NAME, title: 'Coin burst', kind: 'Effect', principles: 'effect',
  subject: 'A coin reward effect: a burst, eight coins and the coin counter they fly into, with sparkles.',
  intent: 'The moment a player collects coins. Everything bigger than life (the flash and the ring overshoot), every coin on its own arc and its own frame, fast out of the burst and easing into the counter; the game hears each landing as an event.',
  display: { width: 240, pixelsPerUnit: +(240 / VIEW.width).toFixed(3) },
  teaches: ['arcs', 'stagger', 'spacing', 'exaggeration', 'events on the contact frame'],
  preview: { clip: 'burst', time: fr(10) },
  events: { coin_land: LANDS.map(fr) },
  clips: [
    { name: 'burst', seconds: 1, loop: false, track: 0, does: '2 frames of white flash, the ring expands and fades, 8 coins pop 2 to 3 frames apart, spin, land in the counter with a squash, a flash and a coin_land event each; the bar fills' },
    { name: 'sparkle', seconds: 1.5, loop: true, track: 1, does: 'three sparkles twinkle in turn around the counter' },
  ],
};

const counterKeys = () => {
  const scale = [k(0, { x: 1, y: 1 })];
  LANDS.forEach((land, i) => { const peak = 1.16 - i * 0.01; scale.push(k(land, { x: 1, y: 1, curve: 'outCubic' }), k(land + 1, { x: peak, y: peak, curve: 'inOutSine' })); });
  scale.push(k(LANDS.at(-1) + 4, { x: 1, y: 1 }), k(30, { x: 1, y: 1 }));
  // a key on both sides of every landing keeps the bumps from smearing into each other
  const dedup = []; for (const key of scale) { if (dedup.length && Math.abs(dedup.at(-1).time - key.time) < 1e-6) dedup[dedup.length - 1] = key; else dedup.push(key); }
  return dedup;
};

export const clips = {
  burst: tidy({
    bones: {
      ...Object.fromEntries(Array.from({ length: COINS }, (_, i) => [`coin${i + 1}`, coinClip(i)])),
      ring: { scale: [k(0, { x: 0.3, y: 0.3, curve: 'outCubic' }), k(9, { x: 1.7, y: 1.7, curve: 'outSine' }), k(16, { x: 1.9, y: 1.9 })] },
      sparks: { scale: [k(0, { x: 0.4, y: 0.4, curve: 'outExpo' }), k(6, { x: 1.5, y: 1.5, curve: 'outSine' }), k(12, { x: 1.7, y: 1.7 })], rotate: [k(0, { value: 0, curve: 'outCubic' }), k(6, { value: 14, curve: 'outSine' }), k(12, { value: 18 })] },
      flash: { scale: [k(0, { x: 0.6, y: 0.6, curve: 'outQuad' }), k(2, { x: 1.3, y: 1.3, curve: 'inQuad' }), k(5, { x: 1.1, y: 1.1 })] },
      burst: { translate: [k(0, { x: 0, y: 0, curve: 'outQuad' }), k(1, { x: 0, y: -4, curve: 'outBack' }), k(4, { x: 0, y: 3, curve: 'inOutSine' }), k(9, { x: 0, y: 0 })] },
      counterCoin: { scale: counterKeys(), rotate: [k(0, { value: 0 }), k(LANDS[0], { value: 0, curve: 'outCubic' }), k(LANDS[0] + 3, { value: -12, curve: 'inOutSine' }), k(LANDS[4] + 2, { value: 9, curve: 'inOutSine' }), k(LANDS.at(-1) + 1, { value: -6, curve: 'outBack' }), k(30, { value: 0 })] },
      counter: { translate: [k(0, { x: 0, y: 0 }), k(LANDS[0], { x: 0, y: 0, curve: 'outQuad' }), k(LANDS[0] + 2, { x: 0, y: 4, curve: 'inOutSine' }), k(LANDS.at(-1) + 2, { x: 0, y: 3, curve: 'outBack' }), k(30, { x: 0, y: 0 })] },
      bar: { scale: [k(0, { x: 0.3, y: 1 }), ...LANDS.map((land, i) => k(land + 1, { x: +(0.3 + (i + 1) * 0.0875).toFixed(3), y: 1, curve: i % 2 ? 'outBack' : 'outCubic' })), k(30, { x: 1, y: 1 })] },
    },
    slots: {
      flash: { rgba: [k(0, { color: rgba(0) }), k(1, { color: rgba(1) }), k(2, { color: rgba(1), curve: 'outQuad' }), k(5, { color: rgba(0) })] },
      ring: { rgba: [k(0, { color: rgba(1) }), k(6, { color: rgba(0.8), curve: 'inQuad' }), k(16, { color: rgba(0) })] },
      sparks: { rgba: [k(0, { color: rgba(1) }), k(5, { color: rgba(0.9), curve: 'inCubic' }), k(12, { color: rgba(0) })] },
      burstGlow: { rgba: [k(0, { color: rgba(0) }), k(2, { color: rgba(0.9), curve: 'outSine' }), k(14, { color: rgba(0) })] },
      counterFlash: { rgba: [k(0, { color: rgba(0) }), k(LANDS[0] - 1, { color: rgba(0) }), ...LANDS.flatMap(land => [k(land, { color: rgba(0.95) }), k(land + 2, { color: rgba(0.2) })]), k(30, { color: rgba(0) })] },
      ...Object.fromEntries(START.map((s, i) => [`coin${i + 1}`, { rgba: [k(0, { color: rgba(0) }), k(s - 1, { color: rgba(0) }), k(s, { color: rgba(1) }), k(LANDS[i] + 1, { color: rgba(1) }), k(LANDS[i] + 2, { color: rgba(0) })] }])),
    },
    events: LANDS.map((land, i) => ({ time: fr(land), name: 'coin_land', int: i + 1 })),
  }),
  sparkle: tidy({
    bones: Object.fromEntries([[0, 1.0, 'outBack', 40], [15, 0.8, 'outCubic', -30], [28, 0.9, 'outQuart', 25]].map(([start, size, ease, turn], i) => [`sparkle${i + 1}`, {
      scale: [kS(0, { x: 0.2, y: 0.2 }), kS(start, { x: 0.2, y: 0.2, curve: ease }), kS(start + 5, { x: size, y: size, curve: 'inQuad' }), kS(start + 12, { x: 0.2, y: 0.2 }), kS(45, { x: 0.2, y: 0.2 })],
      rotate: [kS(0, { value: 0 }), kS(start, { value: 0, curve: 'outSine' }), kS(start + 2, { value: -turn * 0.15, curve: 'inOutCubic' }), kS(start + 12, { value: turn, curve: 'stepped' }), kS(start + 13, { value: 0 }), kS(45, { value: 0 })],
    }])),
    slots: Object.fromEntries([0, 15, 28].map((start, i) => [`sparkle${i + 1}`, { rgba: [kS(0, { color: rgba(0) }), kS(start, { color: rgba(0), curve: 'outQuad' }), kS(start + 4, { color: rgba(1), curve: 'inQuad' }), kS(start + 12, { color: rgba(0) }), kS(45, { color: rgba(0) })] }])),
  }),
};

export async function build() {
  fresh(DIR, NAME);
  buildRig(rig, DIR);
  await finish(DIR, NAME, brief, clips, { viewport: VIEW, strip: { width: 200, columns: 6 } });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
