// brief — what the skeleton is and what each clip is for, confirmed before writing motion.

import { projectOf } from '../project.js';
import { readBrief, writeBrief } from '../../core/brief.js';
import { proposeBrief, validateBrief, SUBJECTS, INTENTS } from '../../understand/subject.js';
import { StudioError } from '../../shared/errors.js';

export default {
  name: 'brief',
  tier: 'core',
  writes: true,
  summary: 'What the skeleton is (character, creature, prop, UI, VFX, scene) and what each clip is for; the studio proposes, you confirm.',
  description: `Before writing motion, know the subject. Without \`brief\` it answers the stored brief of the skeleton, or the studio's proposal: the subject classified from bone and slot names, hierarchy and blend modes (${SUBJECTS.join(', ')}), with confidence and evidence; each clip's intent (${INTENTS.join(', ')}) and whether it loops; the display size and pixels per skeleton unit; the timing of typical clips for the subject. Confirm or correct it by passing \`brief\` (subject, clips [{ name, intent, seconds, loop }], display { height }, note): it is stored in .keyframe/brief.json, and critique_animation then judges each clip as its brief says (loop seam, readability at the display size, checks that do not apply to the subject). Clips not written yet may be listed: they are the plan.`,
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      file: { type: 'string', short: 'skeleton; empty = the folder base', description: 'Project-relative skeleton JSON.' },
      brief: { type: 'object', short: 'the confirmed brief to store', description: 'subject (one of the subjects), clips: [{ name, intent, seconds, loop }], display: { height in px }, note. Omit to read.' },
    },
  },
  run({ file, brief }, { session }) {
    const project = projectOf(session);
    const { sk, rel } = project.skeleton(file);
    if (brief === undefined) {
      const stored = readBrief(project.dir, rel);
      return stored ? { file: rel, brief: stored, stored: true }
        : { file: rel, brief: proposeBrief(sk), stored: false, next: 'Confirm or correct it: call brief again with `brief` (subject, clips, display).' };
    }
    const { brief: clean, problems } = validateBrief(brief, sk);
    if (problems) throw new StudioError('bad-argument', `The brief is not usable: ${problems.join(' ')}`, { problems });
    return { file: rel, brief: writeBrief(project.dir, rel, clean), stored: true };
  },
};
