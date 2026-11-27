// bake_animation — what constraints compute, written as plain keys a phone engine just reads.

import { projectOf } from '../project.js';
import { writeTransform } from '../../deliver/transform.js';
import { bakeAnimations } from '../../understand/bake.js';

export default {
  name: 'bake_animation',
  tier: 'core',
  writes: true,
  summary: 'Bakes constraint results (physics, IK, transform, path) or curves into plain linear bone keys, verified by replay on the runtime.',
  description: 'Drives the animation (on the studio\'s engine, which evaluates IK, transform and physics constraints; only a rig with path constraints needs the Spine add-on, and the tool says so) and writes the pose the constraints actually produce as ordinary bone keys, so the engine stops evaluating them every frame. `what`: "physics" (default; physics simulated forward on a fixed 1/60 grid and its blocks dropped), "curves" (bezier interpolation resampled into dense linear keys), "all" (both, plus ik/transform/path). `remove` chooses separately which constraint blocks leave the file; `keepLive` names bones left exactly as the base has them. The result checks itself: the delivered file is replayed on the runtime without the removed constraints and world positions are compared (tolerance 0.5). A physics bake is a recording of one deterministic playthrough: exact for decorative motion, a loss for physics that reacts to gameplay; the report says so.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      file: { type: 'string', short: 'skeleton; empty = the folder base', description: 'Project-relative skeleton (a delivery is updated in place; a base becomes a new delivery).' },
      into: { type: 'string', short: 'new delivery name (base source only)', description: 'Only when `file` is a base: the new delivery file; default <base>_v2.json.' },
      animations: { type: 'array', items: { type: 'string' }, short: 'clips to bake; empty = all', description: 'Animations to bake; empty bakes every animation.' },
      what: { type: 'string', enum: ['physics', 'curves', 'all'], short: 'physics | curves | all', description: 'What is baked away (default physics).' },
      remove: { type: 'array', items: { type: 'string', enum: ['physics', 'ik', 'transform', 'path'] }, short: 'constraint kinds to drop', description: 'Constraint kinds whose blocks leave the file; default follows `what`.' },
      fps: { type: 'number', minimum: 1, maximum: 60, short: 'key rate (snapped to 60/N)', description: 'Key rate, snapped to a divisor of 60 so samples land on simulation steps (default 30).' },
      physicsStep: { type: 'integer', minimum: 1, maximum: 8, short: 'keep 1 of N physics samples', description: 'Physics-driven bones keep one key in every N samples; first and last are always kept (default 1).' },
      keepLive: { type: 'array', items: { type: 'string' }, short: 'bones left as in the base', description: 'Bones not baked, left exactly as the base has them.' },
      skin: { type: 'string', short: 'skin to measure with', description: 'Skin active while measuring; empty uses the default.' },
    },
  },
  run({ file, into, ...options }, { session }) {
    return writeTransform({ projectDir: projectOf(session).dir, file, into, transform: async sk => {
      const { skeleton, ...report } = await bakeAnimations(sk, options);
      return { skeleton, report };
    } });
  },
};
