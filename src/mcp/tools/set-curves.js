// set_curves — change the easing of existing keys without touching their values or times.

import { projectOf } from '../project.js';
import { writeTransform } from '../../deliver/transform.js';
import { recurve } from '../../spine/curves/recurve.js';
import { presetNames } from '../../spine/curves/presets.js';

export default {
  name: 'set_curves',
  tier: 'core',
  writes: true,
  summary: 'Applies an easing preset (or raw handles) to the segments of an animation; key values and times never move.',
  description: `Re-eases existing keys: every selected segment gets the preset's exact Spine bezier for its own key pair (cx in seconds), "linear" removes the curve, "stepped" holds. Key values and times never move; attachment, draw order and inherit channels are skipped and reported. Presets: ${presetNames().join(', ')}; or raw normalized handles [x1, y1, x2, y2] with x1 and x2 in 0..1. Filter by bones, slots, channels and a time range (segments whose first key lies in [from, to]). Writes through the delivery model: a delivery is updated in place with a backup; a base becomes a new delivery.`,
  inputSchema: {
    type: 'object', required: ['animation', 'preset'], additionalProperties: false,
    properties: {
      file: { type: 'string', short: 'skeleton; empty = the folder base', description: 'Project-relative skeleton (a delivery is updated in place; a base becomes a new delivery).' },
      into: { type: 'string', short: 'new delivery name (base source only)', description: 'Only when `file` is a base: the new delivery file; default <base>_v2.json.' },
      animation: { type: 'string', description: 'Animation to re-ease.' },
      preset: { short: 'preset name, "linear", "stepped" or [x1,y1,x2,y2]', description: 'A preset name, "linear", "stepped", or four numbers [x1, y1, x2, y2].' },
      bones: { type: 'array', items: { type: 'string' }, short: 'only these bones', description: 'Only these bones; empty = all.' },
      slots: { type: 'array', items: { type: 'string' }, short: 'only these slots', description: 'Only these slots; empty = all.' },
      channels: { type: 'array', items: { type: 'string' }, short: 'only these channels', description: 'Only these channels (rotate, translate, scale, alpha, rgba, ...); empty = all that carry curves.' },
      from: { type: 'number', minimum: 0, short: 'segments starting at or after (s)', description: 'Only segments whose first key is at or after this time.' },
      to: { type: 'number', minimum: 0, short: 'segments starting at or before (s)', description: 'Only segments whose first key is at or before this time.' },
    },
  },
  run({ file, into, ...options }, { session }) {
    return writeTransform({ projectDir: projectOf(session).dir, file, into, transform: sk => {
      const report = recurve(sk, /** @type {any} */ (options));
      return { skeleton: sk, report };
    } });
  },
};
