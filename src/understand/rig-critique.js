// The rig doctor: the file is valid, but is the rig BUILT well? Ported from legacy rigcritique.js.
//
// When an artist applied a technique incompletely (a bone
// weighted to the wrong place, a bone that does nothing), the studio should say so and
// explain WHY: what works, and which connection is better.
//
// `check` answers "will Spine open this file"; the weight report answers "which bone
// carries this mesh, how much". Neither judges the BUILD. The owner's chest proved the
// gap: a flawless file with readable weights, yet the lid could not open, because both
// lid bones sat at the CENTRE of the lid art. Rotating them spins the art in place and
// detaches it from the box, which is the "lid comes apart" note the owner had written
// weeks before. It was found by trial and error; it should be a measurement.
//
// Scope, deliberately narrow: three DESIGN judgements no other check makes. Weight
// statistics and weight repair live elsewhere.
//
// Never edits. The rig belongs to the artist. Diagnosing is not editing: "this bone
// drives nothing" costs the reader nothing and saves an hour. So every finding is level
// `warn` (advice never blocks a write); how much it matters is `params.severity`
// ('high' | 'medium' | 'low').
//
// Honesty rule: a centred pivot is CORRECT on a wheel and WRONG on a lid, and this module
// cannot know intent. Findings that depend on intent say so instead of pretending
// certainty: a confident wrong diagnosis is worse than none.
//
// World positions come from the official runtime's setup pose (ADR-2). Legacy derived
// them by hand (its own `worldOf`), which ignored shear and composed a non-uniform parent
// scale with a rotated child wrongly. Attachment points are bone-local; they are carried
// to world with the runtime's bone matrix (world = [a b; c d] * local + world position).

import { finding } from '../spine/findings.js';
import { skinsOf } from '../spine/check.js';
import { parseSkeleton, poseSetup } from '../runtime/index.js';
import { StudioError } from '../shared/errors.js';

// "+ 0" turns -0 (from rounding a tiny negative) into 0, so measures read and compare as written.
const round1 = v => Math.round(v * 10) / 10 + 0;
const isNumber = v => typeof v === 'number' && Number.isFinite(v);

/** A bone this close to the art centre, as a fraction of the half-size on each axis, is "at the centre". */
export const PIVOT_THRESHOLD = 0.22;

export const ADVICE_NOTE = 'This is a list of SUGGESTIONS, not errors: the studio never touches the rig '
  + '(it belongs to its owner) and no finding here blocks a write. Every finding carries its measurement, '
  + 'so when you disagree you can see the reason and ignore it. File validity is the skeleton check; weight '
  + 'statistics are the weight report. This looks only at how the rig is BUILT.';

const toWorld = (bone, lx, ly) => ({
  x: bone.matrix.a * lx + bone.matrix.b * ly + bone.worldX,
  y: bone.matrix.c * lx + bone.matrix.d * ly + bone.worldY,
});

// Bone indices of a weighted vertex array, [n, (bone, x, y, weight) x n, ...]; null when
// the array is not in that shape (an unweighted array, or a malformed one).
function weightedGroups(attachment) {
  const v = attachment?.vertices, uvs = attachment?.uvs;
  const count = Array.isArray(uvs) ? uvs.length : 2 * (attachment?.vertexCount ?? 0);
  if (!Array.isArray(v) || !v.length || v.length <= count) return null;
  const groups = [];
  for (let i = 0; i < v.length;) {
    const n = v[i++];
    if (!isNumber(n) || n <= 0 || i + n * 4 > v.length) return null;
    const group = [];
    for (let j = 0; j < n; j++, i += 4) group.push({ bone: v[i], x: v[i + 1], y: v[i + 2], weight: v[i + 3] });
    groups.push(group);
  }
  return groups;
}

// World points of an attachment and the bones that drive it. `points` is null when the
// shape has no drawable geometry here (path, bounding box, clipping, point, linked mesh);
// `driven` still lists the bones a weighted vertex array binds, because those bones are
// in use. Legacy returned nothing for a weighted path, so a bone that only shapes a path
// was reported as driving nothing.
function geometry(attachment, slotBone, boneOf, boneNames) {
  const type = attachment.type ?? 'region';
  if (type === 'region') {
    const B = boneOf(slotBone);
    const hw = (attachment.width ?? 0) / 2 * (attachment.scaleX ?? 1);
    const hh = (attachment.height ?? 0) / 2 * (attachment.scaleY ?? 1);
    const r = (attachment.rotation ?? 0) * Math.PI / 180;
    const ox = attachment.x ?? 0, oy = attachment.y ?? 0;
    const points = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([sx, sy]) =>
      toWorld(B, ox + sx * Math.cos(r) - sy * Math.sin(r), oy + sx * Math.sin(r) + sy * Math.cos(r)));
    return { points, driven: new Set([slotBone]), weighted: false };
  }
  const groups = weightedGroups(attachment);
  if (groups) {
    const driven = new Set();
    for (const group of groups) for (const e of group) if (boneNames[e.bone]) driven.add(boneNames[e.bone]);
    if (type !== 'mesh' || groups.some(g => g.some(e => !boneNames[e.bone]))) return { points: null, driven, weighted: true };
    const points = groups.map(group => group.reduce((p, e) => {
      const w = toWorld(boneOf(boneNames[e.bone]), e.x, e.y);
      return { x: p.x + w.x * e.weight, y: p.y + w.y * e.weight };
    }, { x: 0, y: 0 }));
    return { points, driven, weighted: true };
  }
  if (type !== 'mesh') return null;
  const v = attachment.vertices;
  if (!Array.isArray(v) || !v.length || v.length !== attachment.uvs?.length) return null;
  const B = boneOf(slotBone);
  const points = [];
  for (let i = 0; i + 1 < v.length; i += 2) points.push(toWorld(B, v[i], v[i + 1]));
  return { points, driven: new Set([slotBone]), weighted: false };
}

const boxOf = points => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
};

// The mix values of each constraint kind, with the format's defaults filled in (an omitted mix
// is 1; mixY follows mixX and mixScaleY follows mixScaleX when left out). Legacy read only the
// mixes written in the JSON, so a transform constraint that wrote `mixRotate: 0` and left the
// others at their default of 1 was called inert.
const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const MIXES = {
  ik: c => ({ mix: num(c.mix, 1) }),
  transform: c => {
    const mixX = num(c.mixX, 1), mixScaleX = num(c.mixScaleX, 1);
    return { mixRotate: num(c.mixRotate, 1), mixX, mixY: num(c.mixY, mixX), mixScaleX, mixScaleY: num(c.mixScaleY, mixScaleX), mixShearY: num(c.mixShearY, 1) };
  },
  path: c => { const mixX = num(c.mixX, 1); return { mixRotate: num(c.mixRotate, 1), mixX, mixY: num(c.mixY, mixX) }; },
  physics: c => ({ mix: num(c.mix, 1) }),
};

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

/**
 * Diagnose how a rig is built.
 *
 * Async because the setup pose comes from the official runtime. A caller that already
 * parsed the skeleton (for example with its atlas) passes `data`, and one that already
 * posed it passes `setup` (a `poseSetup` snapshot of the SAME skeleton); otherwise both
 * are made here.
 *
 * @param {object} sk parsed skeleton JSON (never modified)
 * @param {{ data?: object, setup?: object, pivotThreshold?: number }} [options]
 */
export async function critiqueRig(sk, { data, setup, pivotThreshold = PIVOT_THRESHOLD } = {}) {
  if (!sk || !Array.isArray(sk.bones) || !sk.bones.length) {
    throw new StudioError('bad-argument', 'The skeleton has no bones.');
  }
  data ??= await parseSkeleton(sk);
  setup ??= await poseSetup(data);
  const posed = new Map((setup?.bones ?? []).map(b => [b.name, b]));
  if (sk.bones.some(b => !posed.has(b.name)) || posed.size !== sk.bones.length) {
    throw new StudioError('bad-argument', 'The setup pose does not belong to this skeleton.',
      { bones: sk.bones.length, posed: posed.size });
  }
  const boneOf = name => posed.get(name);
  const boneNames = sk.bones.map(b => b.name);

  const findings = [];
  const add = (severity, code, where, what, why, fix, measure) =>
    findings.push(finding('warn', code, where, what, { severity, why, fix, measure: measure ?? {} }));

  const boneByName = new Map(sk.bones.map(b => [b.name, b]));
  const children = {};
  for (const b of sk.bones) if (b.parent) (children[b.parent] ??= []).push(b.name);

  const slotBones = new Set((sk.slots ?? []).map(s => s.bone).filter(Boolean));
  const constraintBones = new Set();
  for (const kind of ['ik', 'transform', 'path', 'physics']) {
    for (const c of sk[kind] ?? []) {
      for (const bone of c.bones ?? []) constraintBones.add(bone);
      if (c.bone) constraintBones.add(c.bone);
      // A path constraint targets a SLOT, not a bone. Legacy added it to the bone set, so
      // an idle bone sharing the slot's name went unreported.
      if (c.target && kind !== 'path') constraintBones.add(c.target);
    }
  }
  const animatedBones = new Set();
  for (const animation of Object.values(sk.animations ?? {})) {
    for (const bone of Object.keys(animation?.bones ?? {})) animatedBones.add(bone);
  }

  const slotByName = new Map((sk.slots ?? []).map(s => [s.name, s]));
  const artBones = new Set();
  const art = [];
  for (const skin of skinsOf(sk)) {
    for (const [slotName, attachments] of Object.entries(skin?.attachments ?? {})) {
      const slot = slotByName.get(slotName);
      if (!slot) continue;
      for (const [name, attachment] of Object.entries(attachments ?? {})) {
        if (!attachment || typeof attachment !== 'object') continue;
        const g = geometry(attachment, slot.bone, boneOf, boneNames);
        if (!g) continue;
        for (const bone of g.driven) artBones.add(bone);
        if (g.points?.length) art.push({ slot: slotName, name, ...g });
      }
    }
  }

  // 1) A BONE THAT MOVES NOTHING. The most common beginner slip: animating it changes
  // nothing on screen, and key data alone cannot reveal it. The write succeeds while the
  // result is invisible.
  for (const b of sk.bones) {
    if (!b.parent) continue; // the root is structural
    if (slotBones.has(b.name) || artBones.has(b.name) || constraintBones.has(b.name) || children[b.name]?.length) continue;
    const keyed = animatedBones.has(b.name);
    add(keyed ? 'high' : 'medium', 'bone-unused', `bones/${b.name}`,
      keyed ? 'This bone is keyed in an animation but moves NOTHING.' : 'This bone moves nothing.',
      'It has no slot, no mesh vertex is weighted to it, no constraint uses it and it has no child bones. '
      + 'Spine opens the file without complaint; on screen nothing changes.',
      keyed
        ? 'Either bind art to this bone (move the slot onto it or weight mesh vertices to it), or write the motion '
          + 'on the bone that actually carries the art: the current keys are wasted.'
        : 'Bind art to it if you will use it; delete it if you will not.',
      { keyed });
  }

  // 2) PIVOT AT THE CENTRE OF THE ART (the chest lid). Measured on the owner's chest: the
  // lid bone at world (16.4, 72.7), the lid art centre at y = 75.7: dead centre, so
  // rotation spins instead of hinging.
  for (const g of art) {
    if (g.weighted) continue; // weighted art has no single pivot
    const slot = slotByName.get(g.slot);
    const bone = boneByName.get(slot.bone);
    if (!bone?.parent) continue;
    const box = boxOf(g.points);
    if (!(box.w > 1) || !(box.h > 1)) continue;
    const B = boneOf(slot.bone);
    const dx = Math.abs(B.worldX - box.cx) / (box.w / 2);
    const dy = Math.abs(B.worldY - box.cy) / (box.h / 2);
    if (dx > pivotThreshold || dy > pivotThreshold) continue; // already off-centre: fine
    // ONLY when something actually rotates the bone. Measured on a real 26-bone scene:
    // without this guard the doctor emitted 12 findings for background, shadow and screen
    // planes, every one correct by design, because Spine centres a bone on its art when
    // it builds a rig from a PSD. Advice that fires on the normal case is advice nobody
    // reads, so a centred pivot on a bone nothing rotates is not reported at all.
    const rotated = Object.values(sk.animations ?? {}).some(a => a?.bones?.[slot.bone]?.rotate);
    if (!rotated) continue;
    add('high', 'pivot-centered', `bones/${slot.bone}`,
      `The pivot of bone "${slot.bone}" sits at the exact CENTRE of the art it moves.`,
      `The bone is at world (${round1(B.worldX)}, ${round1(B.worldY)}), the art centre at (${round1(box.cx)}, ${round1(box.cy)}): `
      + `${Math.round(dx * 100)}% off horizontally, ${Math.round(dy * 100)}% vertically. Rotating such a bone does not `
      + 'swing the part from a hinge: it spins around its own centre and looks detached from the body. This bone is '
      + 'ALREADY rotated in an animation, so the defect should be visible on screen now.',
      'If this is a HINGED part (a lid, a door, an arm), move the bone origin to the EDGE of the part that faces the hinge: '
      + 'in Spine select the bone and move it; the art stays where it is. If it is a part that turns around itself '
      + '(a wheel, a coin, a gear), the current setup is CORRECT: ignore this note.',
      {
        boneWorld: { x: round1(B.worldX), y: round1(B.worldY) },
        artCentre: { x: round1(box.cx), y: round1(box.cy) },
        artBox: { w: round1(box.w), h: round1(box.h) },
        suggestedEdges: {
          bottom: { x: round1(box.cx), y: round1(box.y0) }, top: { x: round1(box.cx), y: round1(box.y1) },
          left: { x: round1(box.x0), y: round1(box.cy) }, right: { x: round1(box.x1), y: round1(box.cy) },
        },
      });
  }

  // 3) A CONSTRAINT WITH NO EFFECT.
  for (const [kind, mixesOf] of Object.entries(MIXES)) {
    for (const c of sk[kind] ?? []) {
      const mix = mixesOf(c);
      if (Object.values(mix).some(v => Math.abs(v) > 0.001)) continue;
      // A constraint that an animation opens on purpose is normal: say nothing.
      const openedBy = Object.values(sk.animations ?? {}).some(a => a?.[kind]?.[c.name]);
      if (openedBy) continue;
      add('medium', 'constraint-no-effect', `${kind}/${c.name}`,
        'The constraint is set up, but its mix is 0 and no animation opens it.',
        'With mix 0 the constraint is computed but its result is never applied to the bones: move the target and '
        + 'the chain does not move. The rig looks built and does not work.',
        'Raise the mix in the setup pose, or open it with a mix timeline in an animation.',
        { mix });
    }
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.params.severity] - SEVERITY_ORDER[b.params.severity]);
  const count = severity => findings.filter(f => f.params.severity === severity).length;
  const verdict = count('high') ? 'attention' : findings.length ? 'minor-notes' : 'clean';
  return {
    verdict,
    summary: verdict === 'clean'
      ? 'No visible gap in how the rig is built.'
      : `${count('high')} high, ${count('medium')} medium, ${count('low')} low findings.`,
    counts: { bones: sk.bones.length, slots: (sk.slots ?? []).length, attachments: art.length },
    findings,
    note: ADVICE_NOTE,
  };
}
