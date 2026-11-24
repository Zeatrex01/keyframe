// edit_weights / read_weights — mechanical weight repair and the weight report.

import { projectOf } from '../project.js';
import { writeTransform } from '../../deliver/transform.js';
import { repairWeights, applyRepair, OPERATIONS } from '../../spine/weight-repair.js';
import { weightReport } from '../../spine/weights.js';
import { paintWeights, applyPaint } from '../../spine/paint.js';
import { parseSkeleton, poseSetup } from '../../runtime/index.js';

export const editWeights = {
  name: 'edit_weights',
  tier: 'advanced',
  writes: true,
  summary: 'Mechanical weight repair on an existing weighted mesh: clean crumbs, renormalize, transfer, add or remove an existing bone\'s influence.',
  description: 'Repairs the weights of a mesh that is already weighted, mechanically and provably; it never paints and never changes topology. Operations: "clean" drops influences under `threshold` and renormalizes; "normalize" makes every vertex sum to 1; "transfer" moves `ratio` of `from`\'s weight to `to` (both existing bones), keeping the setup pose; "add_influence" gives `bone` a `weight` share; "remove_influence" removes `bone` and renormalizes. Guaranteed: uvs, triangles, hull and edges byte-identical; vertex count unchanged; every vertex keeps an influence and sums to 1; bones only from the current rig; a mesh with a deform timeline is refused outright; any violation writes nothing. The repair is stamped with the base mesh signature, so it survives later animation writes until the owner edits that mesh in Spine (then the base wins, and the write says so).',
  inputSchema: {
    type: 'object', required: ['op'], additionalProperties: false,
    properties: {
      file: { type: 'string', short: 'skeleton; empty = the folder base', description: 'Project-relative skeleton (a delivery is updated in place; a base becomes a new delivery).' },
      into: { type: 'string', short: 'new delivery name (base source only)', description: 'Only when `file` is a base: the new delivery file; default <base>_v2.json.' },
      op: { type: 'string', enum: [...OPERATIONS], description: 'The repair to apply.' },
      slot: { type: 'string', short: 'mesh slot', description: 'Slot of the mesh; needed when several meshes exist.' },
      attachment: { type: 'string', short: 'mesh attachment', description: 'Attachment name of the mesh; needed when several meshes exist.' },
      threshold: { type: 'number', minimum: 0, maximum: 0.5, short: 'clean: drop below (default 0.01)', description: 'clean: influences below this weight are dropped (default 0.01).' },
      from: { type: 'string', short: 'transfer: from bone', description: 'transfer: the bone giving weight.' },
      to: { type: 'string', short: 'transfer: to bone', description: 'transfer: the bone receiving weight.' },
      ratio: { type: 'number', minimum: 0, maximum: 1, short: 'transfer: share moved (default 1)', description: 'transfer: fraction of from\'s weight moved (default 1).' },
      bone: { type: 'string', short: 'add/remove: bone', description: 'add_influence / remove_influence: the bone.' },
      weight: { type: 'number', minimum: 0, maximum: 1, short: 'add: share (default 0.1)', description: 'add_influence: the share given to the bone (default 0.1).' },
    },
  },
  run({ file, into, ...request }, { session }) {
    return writeTransform({ projectDir: projectOf(session).dir, file, into, transform: async (sk, { baseline, baseName }) => {
      const setupBones = (await poseSetup(await parseSkeleton(sk))).bones;
      const result = repairWeights(sk, /** @type {any} */ (request), { setupBones });
      const skeleton = applyRepair(sk, result, { baseSkeleton: baseline, baseName, time: new Date().toISOString() });
      const { vertices, ...report } = result;
      return { skeleton, report };
    } });
  },
};

export const paintWeightsTool = {
  name: 'paint_weights',
  tier: 'core',
  writes: true,
  summary: 'Binds a mesh (or a flat image turned into a grid mesh) to a chain of bones with smooth weights, so the part bends instead of moving rigidly.',
  description: 'Weight painting. Give the attachment (`slot`, `attachment`, and `skin` when the name exists in several skins) and `bones`: the bones it should bend with, usually a chain from the root of the part to its tip (a tail, an arm, a torso, a ribbon). A flat image (region) needs `grid: [columns, rows]` first: it becomes a mesh with the same picture and vertices that can bend; put more cells along the direction of the bend (for a horizontal ribbon [12, 2], for a hanging tail [2, 10]). Each vertex is weighted by its distance to every listed bone, then the weights are smoothed over the mesh so the bend spreads over a band. `falloff` 0.5 (soft, wide blend) to 8 (sharp, short blend), default 2.5; `smooth` passes, default 3; `maxInfluences` bones per vertex, 1 to 4, default 3. The setup pose does not move: every vertex keeps its place, measured and refused otherwise. The result reports which bone carries how much and how many vertices blend. Then animate the bones (write_animation; a chain bends well with follow requests) and look at it with see_animation. Refused: a mesh with deform keys (they would no longer match), linked meshes, bones that do not exist. The base is never written; a later write_animation carries the painted mesh over unless the owner changed that attachment in the base.',
  inputSchema: {
    type: 'object', required: ['slot', 'attachment', 'bones'], additionalProperties: false,
    properties: {
      file: { type: 'string', short: 'skeleton; empty = the folder base', description: 'Project-relative skeleton (a delivery is updated in place; a base becomes a new delivery).' },
      into: { type: 'string', short: 'new delivery name (base source only)', description: 'Only when `file` is a base: the new delivery file; default <base>_v2.json.' },
      skin: { type: 'string', short: 'skin, when the name is in several', description: 'The skin holding the attachment; needed only when several skins have it.' },
      slot: { type: 'string', description: 'Slot of the attachment.' },
      attachment: { type: 'string', description: 'Attachment name (its key in the skin).' },
      bones: { type: 'array', items: { type: 'string' }, minItems: 1, short: 'bones it bends with', description: 'The bones the part bends with, usually a chain from its root to its tip.' },
      grid: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 40 }, minItems: 2, maxItems: 2, short: '[columns, rows] for a flat image', description: 'For a region only: turn it into a grid mesh of [columns, rows] cells first.' },
      falloff: { type: 'number', minimum: 0.5, maximum: 8, short: 'blend sharpness (default 2.5)', description: 'How sharply a bone\'s weight drops with distance: 0.5 soft and wide, 8 sharp and short.' },
      smooth: { type: 'integer', minimum: 0, maximum: 20, short: 'smoothing passes (default 3)', description: 'Passes that even the weights over the mesh\'s edges.' },
      maxInfluences: { type: 'integer', minimum: 1, maximum: 4, short: 'bones per vertex (default 3)', description: 'Most bones one vertex follows; mobile GPUs skin up to 4.' },
    },
  },
  run({ file, into, ...request }, { session }) {
    return writeTransform({ projectDir: projectOf(session).dir, file, into, transform: async (sk, { baseline, baseName }) => {
      const setupBones = (await poseSetup(await parseSkeleton(sk))).bones;
      const result = paintWeights(sk, request, { setupBones });
      return { skeleton: applyPaint(sk, result, { baseSkeleton: baseline, baseName, time: new Date().toISOString() }), report: result.report };
    } });
  },
};

export const readWeights = {
  name: 'read_weights',
  tier: 'advanced',
  writes: false,
  summary: 'Which bones carry each weighted mesh and how much; flags drifted sums, crumbs, out-of-range bones and too many influences.',
  description: 'Reports every weighted mesh (or one, by slot and attachment): influences per bone, vertices per bone count, sum drift, sub-threshold crumbs, bone indices out of range, and vertices with more influences than mobile GPUs skin (4). Findings use the check shape. Reading only.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      file: { type: 'string', short: 'skeleton; empty = the folder base', description: 'Project-relative skeleton.' },
      slot: { type: 'string', short: 'mesh slot', description: 'Only this slot.' },
      attachment: { type: 'string', short: 'mesh attachment', description: 'Only this attachment.' },
      raw: { type: 'boolean', short: 'include per-vertex influences', description: 'Also return per-vertex influences (long).' },
    },
  },
  run({ file, slot, attachment, raw = false }, { session }) {
    const { sk, rel } = projectOf(session).skeleton(file);
    return { file: rel, ...weightReport(sk, { slot, attachment, detail: raw }) };
  },
};
