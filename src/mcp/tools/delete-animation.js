// delete_animation — remove clips from a delivery, all or nothing; never from a base.

import { projectOf } from '../project.js';
import { deleteFromDelivery } from '../../deliver/write.js';

export default {
  name: 'delete_animation',
  tier: 'core',
  writes: true,
  summary: 'Deletes named animations from a delivery file, all or nothing; owner files are refused.',
  description: 'Removes the named animations from a studio delivery file in place; everything else (bones, slots, skins, constraints, other animations) is untouched. Owner files are refused: the base is never written. All or nothing: if any name is missing, nothing is deleted and the available names are returned. Names are identity: no trimming. The delivery is backed up first.',
  inputSchema: {
    type: 'object', required: ['file', 'animations'], additionalProperties: false,
    properties: {
      file: { type: 'string', description: 'Project-relative delivery file.' },
      animations: { type: 'array', items: { type: 'string' }, description: 'Animation names to delete.' },
    },
  },
  run({ file, animations }, { session }) {
    return deleteFromDelivery({ projectDir: projectOf(session).dir, file, names: animations });
  },
};
