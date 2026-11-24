// merge_animation — bring an animation from another skeleton into this one (the Spine editor cannot).

import fs from 'node:fs';
import { projectOf } from '../project.js';
import { writeTransform } from '../../deliver/transform.js';
import { mergeAnimation, describeAnimations } from '../../spine/merge.js';
import { StudioError } from '../../shared/errors.js';

export default {
  name: 'merge_animation',
  tier: 'advanced',
  writes: true,
  summary: 'Copies an animation from another skeleton into this one, with the bones, slots and art it needs; conflicts retargeted or renamed.',
  description: 'Merging two skeletons is something the Spine editor cannot do (CLI import appends a second skeleton; Import Data drops animations). This brings one animation from `source` into the target skeleton together with the bones, slots, attachments, constraints and events it depends on. Names that already exist are `retarget`ed onto the target\'s own parts (default) or `rename`d with a prefix. The merged file is proven on the runtime: the animation poses shared bones and slots exactly as in its source. Without `animation`, lists the source\'s animations and what each depends on, writing nothing.',
  inputSchema: {
    type: 'object', required: ['source'], additionalProperties: false,
    properties: {
      source: { type: 'string', description: 'Project-relative skeleton that owns the animation.' },
      animation: { type: 'string', short: 'clip to bring; empty = list', description: 'Animation to merge; empty lists the source animations and their dependencies.' },
      file: { type: 'string', short: 'receiving skeleton; empty = the folder base', description: 'Project-relative skeleton that receives the animation (a delivery is updated in place; a base becomes a new delivery).' },
      into: { type: 'string', short: 'new delivery name (base receiver only)', description: 'Only when `file` is a base: the new delivery file; default <base>_v2.json.' },
      onConflict: { type: 'string', enum: ['retarget', 'rename'], short: 'retarget | rename', description: 'Existing names: retarget onto the target\'s parts (default) or rename with the prefix.' },
      prefix: { type: 'string', short: 'rename prefix (default merged_)', description: 'Prefix for renamed parts (default merged_).' },
      as: { type: 'string', short: 'name in the target', description: 'Name the merged animation gets in the target; default its source name.' },
    },
  },
  run({ source, animation, file, into, onConflict, prefix, as }, { session }) {
    const project = projectOf(session);
    let sourceJson;
    try { sourceJson = JSON.parse(fs.readFileSync(project.resolve(source), 'utf8')); } catch (err) {
      throw new StudioError('file-not-found', `The source skeleton could not be read: ${source} (${err.message}).`, { source });
    }
    if (!animation) return { source, written: false, animations: describeAnimations(sourceJson) };
    return writeTransform({ projectDir: project.dir, file, into, transform: sk => {
      const { skeleton, report } = mergeAnimation(sk, sourceJson, animation, { onConflict, prefix, as });
      return { skeleton, report: { merged: animation, from: source, ...report } };
    } });
  },
};
