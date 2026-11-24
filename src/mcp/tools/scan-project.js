// scan_project — what skeletons this project holds, and whether each will open.

import fs from 'node:fs';
import path from 'node:path';
import { projectOf } from '../project.js';
import { checkSkeleton } from '../../spine/check.js';
import { fatalsOf, summary } from '../../spine/findings.js';
import { parseSkeleton, officialVerdict } from '../../runtime/index.js';
import { DELIVERY_MARKER } from '../../deliver/compose.js';
import { readAtlas } from '../../understand/atlas.js';

export default {
  name: 'scan_project',
  tier: 'core',
  writes: false,
  summary: 'Lists the skeletons in the project: counts, Spine version, atlas and pages, delivery or base, and whether each plays.',
  description: 'Lists every skeleton JSON in the project folder (Keyframe files and Spine 4.2 exports) (two levels deep): bone, slot, skin and animation counts, the exported Spine version, whether a paired .atlas sits beside it and whether its page images exist, whether the file is a studio delivery (and of which base) or an owner file, the static check summary, whether the studio\'s engine plays it (and what it does not evaluate yet), and, with the Spine add-on on, whether the official Spine runtime opens it. Call it first in a new project: it answers "what do I have here".',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  async run(args, { session }) {
    const project = projectOf(session);
    const skeletons = [];
    for (const { file } of project.list()) {
      const abs = project.resolve(file);
      let sk;
      try { sk = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { continue; }
      const atlas = project.atlasFor(abs);
      let pages = [];
      if (atlas) { try { pages = (await readAtlas(atlas.text)).pages.map(p => p.name); } catch { pages = []; } }
      const missingPages = pages.filter(p => !fs.existsSync(path.join(path.dirname(abs), p)));
      const findings = checkSkeleton(sk);
      let opens = true;
      let runtimeError = null;
      let notEvaluated = [];
      try { notEvaluated = (await parseSkeleton(sk, { backend: 'keyframe' })).limits; } catch (err) { opens = false; runtimeError = err.message; }
      const official = await officialVerdict(sk);
      skeletons.push({
        file,
        role: sk[DELIVERY_MARKER] ? 'delivery' : 'base',
        ...(sk[DELIVERY_MARKER]?.base ? { deliveryOf: sk[DELIVERY_MARKER].base } : {}),
        spine: sk.skeleton?.spine ?? null,
        bones: sk.bones?.length ?? 0, slots: sk.slots?.length ?? 0,
        skins: Array.isArray(sk.skins) ? sk.skins.length : Object.keys(sk.skins ?? {}).length,
        animations: Object.keys(sk.animations ?? {}),
        atlas: atlas ? atlas.rel : null, pages, ...(missingPages.length ? { missingPages } : {}),
        check: summary(findings), fatals: fatalsOf(findings).map(f => f.code),
        opensInRuntime: opens, ...(runtimeError ? { runtimeError } : {}), ...(notEvaluated.length ? { notEvaluated } : {}),
        ...(official.available ? { official: official.opens ? { opens: true } : { opens: false, message: official.message } } : {}),
      });
    }
    return { project: session.dir, skeletons, ...(skeletons.length ? {} : { note: 'No skeleton found. Put a Keyframe file or a Spine 4.2 JSON export into this folder.' }) };
  },
};
