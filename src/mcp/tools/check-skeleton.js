// check_skeleton — will this file open in Spine, and does it play as written.

import { projectOf } from '../project.js';
import { checkSkeleton } from '../../spine/check.js';
import { fatalsOf, summary } from '../../spine/findings.js';
import { scanPaths } from '../../spine/path-fix.js';
import { parseSkeleton, officialVerdict, limitsNote } from '../../runtime/index.js';

export default {
  name: 'check_skeleton',
  tier: 'core',
  writes: false,
  summary: 'Audits a skeleton: what a player or editor rejects (fatal) or plays wrong (warn), plus whether the studio\'s engine plays it.',
  description: 'Audits any skeleton JSON in the project (the studio\'s animation JSON, which is Spine 4.2 compatible). Returns findings as { level, code, where, message, params }: `fatal` means a player cannot read the file (the studio\'s engine, the Spine editor or a Spine runtime), `warn` means it plays but probably not as intended (a bezier handle written as a fraction, a sampled deform over budget, an animation section the format ignores). `runtime` says whether the studio\'s engine plays it and names anything it does not evaluate yet; with the Spine add-on on, `runtime.official` adds the official Spine runtime\'s verdict. Path attachments get the path repair scan. Answers "will this open", "is the file I was handed broken", "is the file I produced sound".',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: { file: { type: 'string', short: 'skeleton; empty = the folder base', description: 'Project-relative skeleton JSON; empty picks the folder\'s base skeleton.' } },
  },
  async run({ file }, { session }) {
    const { sk, rel, autoChosen } = projectOf(session).skeleton(file);
    // check.js already owns the fatal path rules; the path repair adds its advisory findings.
    const findings = [...checkSkeleton(sk), ...scanPaths(sk).findings.filter(f => f.level === 'warn')];
    // The studio's engine plays it (the verdict that counts); the official runtime's verdict is
    // added when the Spine add-on is on.
    /** @type {Record<string, any>} */
    let runtime = { opens: true, engine: 'keyframe' };
    try {
      const data = await parseSkeleton(sk, { backend: 'keyframe' });
      const note = limitsNote(data);
      if (note) runtime = { ...runtime, notEvaluated: data.limits, note };
    } catch (err) { runtime = { opens: false, engine: 'keyframe', code: err.code, message: err.message }; }
    const official = await officialVerdict(sk);
    runtime.official = official.available ? { opens: official.opens, ...(official.opens ? {} : { code: official.code, message: official.message }) }
      : 'not checked: the Spine add-on is off';
    return { file: rel, ...(autoChosen ? { autoChosen } : {}), summary: summary(findings), fatal: fatalsOf(findings).length, findings, runtime };
  },
};
