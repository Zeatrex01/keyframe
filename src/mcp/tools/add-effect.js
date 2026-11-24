// add_effect — bursts, trails, flashes, glows and shakes as ordinary bones, slots and keys.

import { projectOf } from '../project.js';
import { writeTransform } from '../../deliver/transform.js';
import { addEffect, EFFECTS } from '../../spine/effects.js';

const SPRITE = { type: 'object', short: '{ slot, attachment? }: the art reused', description: 'The art the effect reuses: a slot and one of its attachments (default the slot\'s setup attachment).' };

export default {
  name: 'add_effect',
  tier: 'core',
  writes: true,
  summary: 'Adds an effect to a clip (burst, trail, flash, glow, shake) as ordinary bones, slots and keys every player shows the same.',
  description: `Effects as data, not a particle engine: what it writes is plain skeleton JSON, so the studio, the Godot export and any Spine runtime play it identically and every key stays editable. Kinds: ${EFFECTS.join(', ')}.
- burst: \`count\` copies of \`sprite\` fly out from its bone (or \`bone\`) at \`at\` s, \`duration\` per particle; aim and feel in \`tune\`. Coins from a chest, sparks from a hit, confetti.
- trail: \`count\` ghosts of \`sprite\` follow its bone, fading (\`tune.delay\`, \`tune.strength\`). The bone must already move in the clip.
- flash: an additive copy of \`sprite\` lights up at \`at\` for \`duration\` (\`tune.color\`, \`tune.strength\`): a hit flash, a reward pop.
- glow: the same copy pulsing (\`tune.cycles\`, \`tune.period\`).
- shake: \`bone\` jitters around its place, decaying over \`duration\` (\`tune.amplitude\`, \`tune.frequency\`). Shake a bone that does not already travel in the clip (a parent made for it).
Effects reuse existing art (nothing is drawn). Writes through the delivery model like every other write; then look at it with see_animation.`,
  inputSchema: {
    type: 'object', required: ['kind', 'animation'], additionalProperties: false,
    properties: {
      file: { type: 'string', short: 'skeleton; empty = base', description: 'Project-relative skeleton (a delivery is updated in place; a base becomes a new delivery).' },
      into: { type: 'string', short: 'new delivery name', description: 'Only when `file` is a base: the new delivery file; default <base>_v2.json.' },
      kind: { type: 'string', enum: [...EFFECTS], short: 'effect', description: 'The effect.' },
      animation: { type: 'string', short: 'clip (created if new)', description: 'The clip it is written into (created when it does not exist).' },
      sprite: SPRITE,
      bone: { type: 'string', short: 'shake: bone; burst: origin', description: 'For shake: the bone that jitters. For burst: the bone the particles start from (default the sprite\'s bone).' },
      at: { type: 'number', minimum: 0, short: 'start time (s)', description: 'When the effect starts, in seconds.' },
      duration: { type: 'number', minimum: 0.01, maximum: 30, short: 'how long (s)', description: 'Length of a flash or shake, or of each burst particle.' },
      count: { type: 'number', minimum: 1, maximum: 64, short: 'particles / ghosts', description: 'Burst particles (1-64) or trail ghosts (1-12).' },
      tune: { type: 'object', short: 'per-kind settings (see help)', description: 'Per-kind settings, all optional. Burst: name (bones are fx_<name>), direction (deg, 0 right, 90 up; default 90), spread (deg 0-360; default 360), distance (units; default 140), gravity (0..1, default 0.35), spin (deg, default 240), scale [start, end] (default [1, 0.3]), stagger (s, default 0.02), x and y (start offset, default 0), additive, seed (default 1). Trail: delay (s between ghosts, default 0.04), strength (0..1 first ghost opacity, default 0.5), additive (default true). Flash and glow light up `sprite` itself. Flash: color (rrggbb, default ffffff), strength (0..1, default 1). Glow: color, strength (default 0.6), period (s, default 1.2), cycles (default 2). Shake: amplitude (units, default 8), frequency (Hz, default 24).' },
    },
  },
  run({ file, into, tune, ...rest }, { session }) {
    const spec = { ...(tune ?? {}), ...rest };
    return writeTransform({ projectDir: projectOf(session).dir, file, into, transform: sk => {
      const { skeleton, report } = addEffect(sk, /** @type {any} */ (spec));
      return { skeleton, report: { effect: spec.kind, animation: spec.animation, added: report, next: `see_animation { animation: "${spec.animation}" } to look at it.` } };
    } });
  },
};
