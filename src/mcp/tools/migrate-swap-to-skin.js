// migrate_swap_to_skin — fold per-colour copies of one motion into one clip plus named skins.

import { projectOf } from '../project.js';
import { writeTransform } from '../../deliver/transform.js';
import { scan, migrate } from '../../spine/skin-migration.js';

export default {
  name: 'migrate_swap_to_skin',
  tier: 'advanced',
  writes: true,
  summary: 'Without groups: suggests clip families that differ only in attachments. With groups: folds each family into one clip plus named skins.',
  description: 'For clips that repeat the same motion once per colour or material (Bronze_Chest, Gold_Chest, Silver_Chest): without `groups` the tool only suggests families (clips identical once attachment timelines are stripped) and writes nothing. With `groups` it folds each group into the base clip plus one named skin per variant, creating no new art: skins only re-point existing images. A group that fails any check is skipped whole and the reason reported. The result is proven: every original clip, sampled under its new skin, matches the surviving clip on the runtime, and the file has no new fatal finding.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      file: { type: 'string', short: 'skeleton; empty = the folder base', description: 'Project-relative skeleton (a delivery is updated in place; a base becomes a new delivery).' },
      into: { type: 'string', short: 'new delivery name (base source only)', description: 'Only when `file` is a base: the new delivery file; default <base>_v2.json.' },
      groups: {
        type: 'array', short: '[{ base, animation?, variants: [{ animation, skinName }] }]',
        description: 'Explicit families: base is the clip that already shows the setup look; each variant becomes a skin.',
        items: {
          type: 'object', required: ['base', 'variants'],
          properties: {
            base: { type: 'string' }, animation: { type: 'string' },
            variants: { type: 'array', items: { type: 'object', required: ['animation', 'skinName'], properties: { animation: { type: 'string' }, skinName: { type: 'string' } } } },
          },
        },
      },
      allowMotionDrift: { type: 'boolean', short: 'fold even if motion differs', description: 'Fold a variant whose motion differs from the base (the lost motion is named). Default false.' },
      overwriteSkins: { type: 'boolean', short: 'replace same-named skins', description: 'Replace an existing skin of the same name (never the default skin). Default false.' },
    },
  },
  run({ file, into, groups, allowMotionDrift = false, overwriteSkins = false }, { session }) {
    const project = projectOf(session);
    if (!groups?.length) {
      const { sk, rel } = project.skeleton(file);
      return { file: rel, written: false, ...scan(sk), note: 'Suggestions only. Pass groups to migrate.' };
    }
    return writeTransform({ projectDir: project.dir, file, into, transform: sk => {
      const { skeleton, ...report } = migrate(sk, groups, { allowMotionDrift, overwriteSkins });
      return { skeleton, report };
    } });
  },
};
