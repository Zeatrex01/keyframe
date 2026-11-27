// add_effect — bursts, emitters, trails, flashes, glows and shakes as ordinary bones, slots and keys.

import { projectOf } from '../project.js';
import { writeTransform } from '../../deliver/transform.js';
import { addEffect, EFFECTS, EMIT_PRESETS, EMIT_MAX } from '../../spine/effects.js';
import { readAssetSvg } from '../../core/asset-library.js';
import { svgSize } from '../../engine/svg.js';
import { compileSkeleton, poseAt, setupPose } from '../../engine/index.js';
import { buildFxPage } from '../../render/fx-art.js';

/** The library pack an emitter draws from when `art` names a bare item. */
export const EFFECT_PACK = 'keyframe-vfx';

/**
 * The library item an emitter draws, sized in skeleton units (its longest side is `size`).
 * @returns {{ region: string, ref: string, width: number, height: number } | null}
 */
export function emitterArt(spec) {
  const preset = typeof spec.preset === 'string' ? EMIT_PRESETS[spec.preset] : undefined;
  const art = spec.art ?? (spec.sprite ? null : preset?.art ?? 'dot');
  if (!art) return null;
  const ref = String(art).startsWith('asset:') ? String(art) : `asset:${EFFECT_PACK}/${art}`;
  const { width, height } = svgSize(readAssetSvg(ref));
  const size = typeof spec.size === 'number' && spec.size > 0 ? spec.size : preset?.size ?? 24;
  const k = size / Math.max(width, height);
  const [pack, item] = ref.slice('asset:'.length).split('/');
  return { region: `fx/${pack}/${item}`, ref, width: width * k, height: height * k };
}

/**
 * Where an emitter lets its particles go: the source bone at the emit time of the clip, in the
 * space of the root bone (the clip posed on the studio's engine; the setup pose for a new clip).
 * @returns {{ x: number, y: number } | null}
 */
export function releaseAt(sk, { animation, at = 0, bone, sprite }) {
  const source = bone ?? (sprite?.slot ? sk.slots?.find(s => s.name === sprite.slot)?.bone : null);
  const root = sk.bones?.find(b => !b.parent);
  if (!source || !root || source === root.name || !sk.bones.some(b => b.name === source)) return null;
  const model = compileSkeleton(sk);
  const clip = sk.animations?.[animation];
  const pose = clip && Object.keys(clip).length ? poseAt(model, animation, Math.max(0, Number(at) || 0)) : setupPose(model);
  const of = name => pose.bones.find(b => b.data.name === name);
  const p = of(source), r = of(root.name);
  const dx = p.worldX - r.worldX, dy = p.worldY - r.worldY, det = r.a * r.d - r.b * r.c || 1;
  return { x: (r.d * dx - r.b * dy) / det, y: (r.a * dy - r.c * dx) / det };
}

const SPRITE = { type: 'object', short: '{ slot, attachment? }: the art reused', description: 'The art the effect reuses: a slot and one of its attachments (default the slot\'s setup attachment). For emit with library art: the slot the particles draw in front of.' };

export default {
  name: 'add_effect',
  tier: 'core',
  writes: true,
  summary: 'Adds an effect to a clip (emitter, burst, trail, flash, glow, shake) as plain bones, slots and keys every player shows alike.',
  description: `Effects as data, not a particle engine: what it writes is plain skeleton JSON, so the studio, the Godot export and any Spine runtime play it identically and every key stays editable. Kinds: ${EFFECTS.join(', ')}.
- emit: a particle emitter, simulated once and written as keys (exact under gravity and drag). \`preset\`: ${Object.keys(EMIT_PRESETS).join(', ')}; any setting in \`tune\` overrides it. It draws \`art\` (an item of the ${EFFECT_PACK} library pack: ${'dot, glow, spark, streak, puff, ring, flare, slash, shard, flame, confetti'}, or any asset:<pack>/<item>; default the preset's) on the delivery's own atlas page, or reuses \`sprite\`. It emits from \`bone\` at \`at\` s for \`duration\` s (0 = all at once), \`count\` 1-${EMIT_MAX} particles; particles share slots when their lives do not overlap. They stay where they were let go (tune.follow: ride the bone instead); gravity always pulls down the screen. Tune: life [min, max] s, speed [min, max] units/s, direction (deg, 90 up), spread (deg), gravity (units/s², negative rises), drag (1/s), shape (point, circle, ring, rect, line) with radius, width, height, x, y; scale [values over the life], spin [min, max] deg/s or align (turn along the flight), color [rrggbb over the life], palette [rrggbb, one per particle], alpha, fade [in, out] (fractions of the life), size (the art's longest side, units), additive, loop (lives past the end continue from the start: a seamless looping clip), seed, name.
- burst: \`count\` copies of \`sprite\` fly out from its bone (or \`bone\`) at \`at\` s, \`duration\` per particle; aim and feel in \`tune\`. Coins from a chest, sparks from a hit, confetti.
- trail: \`count\` ghosts of \`sprite\` follow its bone, fading (\`tune.delay\`, \`tune.strength\`). The bone must already move in the clip.
- flash: an additive copy of \`sprite\` lights up at \`at\` for \`duration\` (\`tune.color\`, \`tune.strength\`): a hit flash, a reward pop.
- glow: the same copy pulsing (\`tune.cycles\`, \`tune.period\`).
- shake: \`bone\` jitters around its place, decaying over \`duration\` (\`tune.amplitude\`, \`tune.frequency\`). Shake a bone that does not already travel in the clip (a parent made for it).
Effects other than emit reuse existing art. Writes through the delivery model like every other write; then look at it with see_animation.`,
  inputSchema: {
    type: 'object', required: ['kind', 'animation'], additionalProperties: false,
    properties: {
      file: { type: 'string', short: 'skeleton; empty = base', description: 'Project-relative skeleton (a delivery is updated in place; a base becomes a new delivery).' },
      into: { type: 'string', short: 'new delivery name', description: 'Only when `file` is a base: the new delivery file; default <base>_v2.json.' },
      kind: { type: 'string', enum: [...EFFECTS], short: 'effect', description: 'The effect.' },
      animation: { type: 'string', short: 'clip (created if new)', description: 'The clip it is written into (created when it does not exist).' },
      sprite: SPRITE,
      preset: { type: 'string', enum: Object.keys(EMIT_PRESETS), short: 'emit recipe', description: 'For emit: a ready-made emitter (tune overrides any of its settings).' },
      art: { type: 'string', short: 'emit sprite', description: `For emit: the art each particle draws, an item of the ${EFFECT_PACK} pack (spark, puff, flame, ...) or asset:<pack>/<item>. Default the preset's.` },
      bone: { type: 'string', short: 'origin; shake: the bone', description: 'For shake: the bone that jitters. For burst and emit: the bone the particles start from (default the sprite\'s bone, else the root).' },
      at: { type: 'number', minimum: 0, short: 'start time (s)', description: 'When the effect starts, in seconds.' },
      duration: { type: 'number', minimum: 0, maximum: 30, short: 'how long (s)', description: 'Length of a flash or shake, of each burst particle, or how long an emitter emits (0 = all at once).' },
      count: { type: 'number', minimum: 1, maximum: EMIT_MAX, short: 'particles / ghosts', description: `Burst particles (1-64), emitter particles (1-${EMIT_MAX}) or trail ghosts (1-12).` },
      tune: { type: 'object', short: 'per-kind settings (see help)', description: 'Per-kind settings, all optional. Burst: name (bones are fx_<name>), direction (deg, 0 right, 90 up; default 90), spread (deg 0-360; default 360), distance (units; default 140), gravity (0..1, default 0.35), spin (deg, default 240), scale [start, end] (default [1, 0.3]), stagger (s, default 0.02), x and y (start offset, default 0), additive, seed (default 1). Trail: delay (s between ghosts, default 0.04), strength (0..1 first ghost opacity, default 0.5), additive (default true). Flash and glow light up `sprite` itself. Flash: color (rrggbb, default ffffff), strength (0..1, default 1). Glow: color, strength (default 0.6), period (s, default 1.2), cycles (default 2). Shake: amplitude (units, default 8), frequency (Hz, default 24).' },
    },
  },
  run({ file, into, tune, ...rest }, { session }) {
    const spec = { ...(tune ?? {}), ...rest };
    if (spec.kind === 'emit') {
      const art = emitterArt(spec);
      if (art) spec.artSprite = art;
    }
    return writeTransform({ projectDir: projectOf(session).dir, file, into, drawEffects: buildFxPage, transform: sk => {
      if (spec.kind === 'emit' && !spec.follow && !spec.release) {
        const release = releaseAt(sk, spec);
        if (release) spec.release = release;
      }
      const { skeleton, report } = addEffect(sk, /** @type {any} */ (spec));
      return { skeleton, report: { effect: spec.kind, animation: spec.animation, added: report, next: `see_animation { animation: "${spec.animation}" } to look at it.` } };
    } });
  },
};
