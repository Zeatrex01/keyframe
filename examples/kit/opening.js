// The opening, built through the studio from the drawn mark (mark.json): `intro` (1.2 s), the
// quick one the page plays at every start, and `reveal` (2.8 s), for the README and the launch.
//
// intro: the key flies in from the left, leaves its ghosts behind it as it slows in, lands with a
// ~10% overshoot and a soft flash (add_effect), and settles by 0.9 s; the name rises under it.
//
// reveal: the amber key hops
// in like a ball and leaves an onion skin of itself on each spot it leaves, the two violet ghosts
// of the mark, so the mark is drawn by the motion it stands for. A crouch, a big hop with a lean,
// a landing with squash and a flash, the ghosts recoil after it, and the name rises under it.
// Both are written into examples/opening/mark_v2.json (write_animation, add_effect), then proven
// (check_skeleton, critique_animation) and seen.
//
//   node examples/kit/opening.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tool, clean, fresh, filmstripOf } from './studio.js';

const DIR = fileURLToPath(new URL('../opening/', import.meta.url));
const LOOK = fileURLToPath(new URL('./look/', import.meta.url));

// The key's setup is (42, 60); the ghosts sit at x -70 and -24.5 on the same row, 70 and 84 wide
// against its 112, so the key lands on each spot at that spot's size.
const SPOT1 = -112, SPOT2 = -66.5, SIZE1 = 0.62, SIZE2 = 0.75;
const at = (time, more) => ({ time, ...more });
const v = (time, value, curve) => ({ time, value, ...(curve ? { curve } : {}) });
const xy = (time, x, y, curve) => ({ time, x, y, ...(curve ? { curve } : {}) });
const alpha = (/** @type {number} */ a) => `ffffff${Math.round(a * 255).toString(16).padStart(2, '0')}`;

export const intro = {
  bones: {
    key: {
      translate: [xy(0, -150, 0, 'outCubic'), xy(0.45, 7, 0, 'inOutSine'), xy(0.75, 0, 0)],
      scale: [xy(0, 0.6, 0.6, 'outCubic'), xy(0.45, 1.1, 1.1, 'inOutSine'), xy(0.62, 0.97, 0.97, 'inOutSine'), xy(0.9, 1, 1)],
    },
    ghost1: { translate: [xy(0, -12, 0), xy(0.04, -12, 0, 'outCubic'), xy(0.4, 0, 0)] },
    ghost2: { translate: [xy(0, -12, 0), xy(0.11, -12, 0, 'outCubic'), xy(0.47, 0, 0)] },
    word_keyframe: { translate: [xy(0, 0, -14), xy(0.5, 0, -14, 'outCubic'), xy(0.85, 0, 0)] },
    word_studio: { translate: [xy(0, 0, -14), xy(0.62, 0, -14, 'outCubic'), xy(0.97, 0, 0)] },
  },
  slots: {
    key: { alpha: [v(0, 0, 'outQuad'), v(0.1, 1)] },
    ghost1: { alpha: [v(0, 0), v(0.04, 0, 'outQuad'), v(0.22, 1)] },
    ghost2: { alpha: [v(0, 0), v(0.11, 0, 'outQuad'), v(0.29, 1)] },
    word_keyframe: { alpha: [v(0, 0), v(0.5, 0, 'outCubic'), v(0.85, 1)] },
    word_studio: { alpha: [v(0, 0), v(0.62, 0, 'outCubic'), v(0.97, 1), v(1.2, 1)] },
  },
};

export const reveal = {
  bones: {
    key: {
      // across: eases into each landing, waits on the spot, then goes again
      translatex: [v(0, -210, 'outSine'), v(0.3, SPOT1), v(0.42, SPOT1, 'inOutSine'), v(0.7, SPOT2), v(0.9, SPOT2, 'inOutSine'), v(1.24, 0)],
      // up and down: falls in, two hops, a crouch and a big hop; each arc slows at the top
      translatey: [v(0, 160, 'inQuad'), v(0.3, 0), v(0.42, 0, 'outQuad'), v(0.56, 46, 'inQuad'), v(0.7, 0), v(0.82, 0, 'outQuad'), v(0.9, -6, 'outQuad'),
        v(1.07, 92, 'inQuad'), v(1.24, 0, 'outQuad'), v(1.31, -5, 'inOutSine'), v(1.42, 0)],
      // squash on every landing and before every take-off, stretch in the air, volume kept
      scale: [xy(0, 0.5, 0.5, 'inQuad'), xy(0.3, SIZE1 * 1.1, SIZE1 * 0.86, 'outQuad'), xy(0.36, SIZE1 * 1.14, SIZE1 * 0.8, 'outSine'), xy(0.42, SIZE1 * 0.92, SIZE1 * 1.12, 'outSine'),
        xy(0.56, 0.68, 0.68, 'inSine'), xy(0.7, SIZE2 * 1.12, SIZE2 * 0.84, 'outQuad'), xy(0.78, SIZE2 * 1.04, SIZE2 * 0.96, 'inOutSine'),
        xy(0.9, SIZE2 * 1.16, SIZE2 * 0.78, 'outQuad'), xy(0.98, 0.78, 1, 'inOutSine'), xy(1.12, 1, 1, 'inQuad'),
        xy(1.24, 1.18, 0.84, 'outQuad'), xy(1.34, 0.94, 1.07, 'inOutSine'), xy(1.46, 1.02, 0.99, 'inOutSine'), xy(1.6, 1, 1)],
      // the big hop leans back in the crouch and forward in the air, and settles
      rotate: [v(0.82, 0, 'outQuad'), v(0.9, 9, 'inOutSine'), v(1.08, -12, 'inOutSine'), v(1.24, 4, 'outSine'), v(1.36, -2, 'inOutSine'), v(1.5, 0)],
    },
    // each ghost is left where the key took off, and pops to its size
    ghost1: {
      scale: [xy(0.42, 0.85, 0.85, 'outBack'), xy(0.52, 1.06, 1.06, 'inOutSine'), xy(0.62, 1, 1)],
      // the landing of the key goes through the ghosts behind it, the nearest first
      translate: [xy(1.24, 0, 0), xy(1.29, 0, 0, 'outQuad'), xy(1.35, -5, 0, 'inOutSine'), xy(1.52, 0, 0)],
    },
    ghost2: {
      scale: [xy(0.82, 0.85, 0.85, 'outBack'), xy(0.92, 1.06, 1.06, 'inOutSine'), xy(1.02, 1, 1)],
      translate: [xy(1.24, 0, 0, 'outQuad'), xy(1.31, -6, 0, 'inOutSine'), xy(1.48, 0, 0)],
    },
    word_keyframe: { translate: [xy(0, 0, -16), xy(1.42, 0, -16, 'outCubic'), xy(1.8, 0, 0)] },
    word_studio: { translate: [xy(0, 0, -16), xy(1.58, 0, -16, 'outCubic'), xy(1.96, 0, 0)] },
  },
  slots: {
    key: { alpha: [v(0, 0, 'outQuad'), v(0.08, 1)] },
    ghost1: { alpha: [v(0, 0), v(0.42, 0, 'outQuad'), v(0.5, 1)] },
    ghost2: { alpha: [v(0, 0), v(0.82, 0, 'outQuad'), v(0.9, 1)] },
    key_flash: { attachment: [{ time: 1.22, name: 'key' }],
      rgba: [at(1.22, { color: alpha(0), curve: 'outQuad' }), at(1.27, { color: alpha(0.4), curve: 'inOutSine' }), at(1.52, { color: alpha(0) })] },
    word_keyframe: { alpha: [v(0, 0), v(1.42, 0, 'outCubic'), v(1.78, 1)] },
    word_studio: { alpha: [v(0, 0), v(1.58, 0, 'outCubic'), v(1.94, 1), v(2.8, 1)] },
  },
};

export async function build() {
  fresh(DIR, 'mark');
  await tool(DIR, 'write_animation', { from: 'mark.json', animation: 'intro', clip: intro });
  // The landing flash: an additive copy of the key (slot key_flash), which reveal keys too.
  await tool(DIR, 'add_effect', { file: 'mark_v2.json', kind: 'flash', animation: 'intro', sprite: { slot: 'key' }, at: 0.42, duration: 0.28, tune: { strength: 0.3 } });
  const written = await tool(DIR, 'write_animation', { from: 'mark.json', animation: 'reveal', clip: reveal });
  if (written.file !== 'mark_v2.json') throw new Error(`reveal went to ${written.file}`);
  const checked = await tool(DIR, 'check_skeleton', { file: 'mark_v2.json' });
  const critique = await tool(DIR, 'critique_animation', { file: 'mark_v2.json', animation: 'reveal' });
  const introCritique = await tool(DIR, 'critique_animation', { file: 'mark_v2.json', animation: 'intro' });
  const built = JSON.parse(fs.readFileSync(path.join(DIR, 'mark_v2.json'), 'utf8'));
  if (!built.animations.intro.slots.key_flash) throw new Error('the intro lost its flash');
  clean(DIR);
  const times = [0, 0.15, 0.3, 0.36, 0.5, 0.62, 0.7, 0.9, 1.0, 1.1, 1.24, 1.3, 1.45, 1.65, 1.85, 2.8];
  const strip = await filmstripOf(DIR, 'mark_v2.json', 'reveal', times, path.join(LOOK, 'opening-reveal.png'),
    { width: 240, height: 160, columns: 4, viewport: { x: -190, y: -75, width: 380, height: 253 } });
  console.log(`opening: check ${checked.summary}; intro ${introCritique.verdict}, reveal ${critique.verdict}; ${strip}`);
  return { checked, critique, introCritique };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
