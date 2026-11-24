// Audits a Spine 4.2 skeleton JSON for what the runtime or the editor rejects, and for
// what plays silently wrong. Ported from legacy spinecheck.js; every rule there came from
// a real defect, and each is pinned in test/check.test.js, cross-checked against the
// official parser in-process.
//
// Two jobs:
//   1. Input: if the file a team member handed over is already broken, say so before
//      anything touches it. The one-way export copies the base verbatim, so a defect in
//      the base would travel with every delivery.
//   2. Output: a delivered file is not "done" before it passes the same audit.
//
// Pure: takes a parsed JSON object, returns findings (src/spine/findings.js).

import { finding } from './findings.js';
import { weightedGroupsExact, weightedVerticesValid } from './vertices.js';
import { drawOrderOffsetProblems } from './draw-order.js';

const ANIMATION_KEYS = new Set(['bones', 'slots', 'ik', 'transform', 'path', 'physics',
  'attachments', 'drawOrder', 'events']);

// Measured on a production rig: an 805 KB sampled deform played within 0.23/255 pixels of a
// ~70 KB two-key curve. 128 KB per animation sits above a lean export's whole deform but
// catches a 386 KB sampled preview. Advisory only.
export const DEFORM_BUDGET_BYTES = 128 * 1024;

const jsonBytes = value => new TextEncoder().encode(JSON.stringify(value)).length;

// Pre-4.x exports carry skins as an object keyed by name.
export const skinsOf = sk => Array.isArray(sk.skins) ? sk.skins
  : Object.entries(sk.skins ?? {}).map(([name, attachments]) => ({ name, attachments }));

/**
 * @param {object} sk parsed skeleton JSON
 * @returns {ReturnType<typeof finding>[]}
 */
export function checkSkeleton(sk) {
  const out = [];
  const add = (level, code, where, message, params) => out.push(finding(level, code, where, message, params));

  if (!sk || typeof sk !== 'object' || Array.isArray(sk)) {
    add('fatal', 'not-json', '-', 'This is not a Spine skeleton JSON object.');
    return out;
  }
  if (!Array.isArray(sk.bones) || !sk.bones.length) add('fatal', 'no-bones', 'bones', 'The skeleton has no bones.');

  // ── version ──
  const version = sk.skeleton?.spine ?? '';
  const majorMinor = String(version).split('.').slice(0, 2).join('.');
  const is4x = String(version).split('.')[0] === '4';
  if (!version) add('warn', 'no-version', 'skeleton.spine', 'The Spine version is not written in the file.');
  else if (majorMinor !== '4.2') {
    add('warn', 'version-mismatch', 'skeleton.spine',
      `Exported for Spine ${version}; the studio and its runtime are 4.2, so behaviour is not guaranteed.`, { version });
  }

  // spine-ts accepts a missing hash, but spine-csharp's SkeletonJson indexes ["hash"] and
  // throws KeyNotFoundException. Unity is a shipping engine, so its reader counts.
  if (!sk.skeleton || !Object.prototype.hasOwnProperty.call(sk.skeleton, 'hash')) {
    add('fatal', 'no-hash', 'skeleton.hash',
      'skeleton.hash is missing: spine-ts loads the file, but the Unity runtime (spine-csharp) throws on it. Re-export from Spine, or add a hash.');
  }

  // ── bone tree: a parent must exist and come first ──
  const boneNames = new Set();
  for (const b of sk.bones ?? []) {
    if (!b?.name) { add('fatal', 'bone-noname', 'bones', 'A bone has no name.'); continue; }
    if (boneNames.has(b.name)) add('fatal', 'bone-dup', `bones/${b.name}`, `Bone name "${b.name}" is used twice.`, { bone: b.name });
    if (b.parent && !boneNames.has(b.parent)) {
      add('fatal', 'bone-order', `bones/${b.name}`,
        `Parent "${b.parent}" is defined after this bone, or not at all; Spine requires parents first.`,
        { bone: b.name, parent: b.parent });
    }
    boneNames.add(b.name);
  }

  // ── skins and slots ──
  const skins = skinsOf(sk);
  // Two skins[] entries sharing a name: nothing below reads the array by position, so the
  // union in skinAttachments would hide it. Legacy skin_migrate once pushed a duplicate,
  // this check said nothing, and the editor refused the file.
  const skinNames = new Set();
  for (const skin of skins) {
    if (!skin?.name) { add('fatal', 'skin-noname', 'skins', 'A skin has no name.'); continue; }
    if (skinNames.has(skin.name)) add('fatal', 'skin-dup', `skins/${skin.name}`, `Skin name "${skin.name}" is used twice.`, { skin: skin.name });
    skinNames.add(skin.name);
  }
  const skinAttachments = {}; // slot -> attachment names across all skins
  for (const skin of skins) {
    for (const [slot, set] of Object.entries(skin?.attachments ?? {})) {
      skinAttachments[slot] ??= new Set();
      for (const name of Object.keys(set ?? {})) skinAttachments[slot].add(name);
    }
  }
  const hasAttachment = (slot, name) => !!skinAttachments[slot]?.has(name);

  const slotNames = new Set();
  for (const s of sk.slots ?? []) {
    if (!s?.name) { add('fatal', 'slot-noname', 'slots', 'A slot has no name.'); continue; }
    if (slotNames.has(s.name)) add('fatal', 'slot-dup', `slots/${s.name}`, `Slot name "${s.name}" is used twice.`, { slot: s.name });
    slotNames.add(s.name);
    if (!boneNames.has(s.bone)) {
      add('fatal', 'slot-bone', `slots/${s.name}`, `The slot's bone "${s.bone}" does not exist.`, { slot: s.name, bone: s.bone });
    }
    if (s.attachment && !hasAttachment(s.name, s.attachment)) {
      add('fatal', 'slot-attachment', `slots/${s.name}`,
        `The setup attachment "${s.attachment}" is not defined in any skin.`, { slot: s.name, attachment: s.attachment });
    }
  }

  // ── attachments ──
  for (const skin of skins) {
    for (const [slot, set] of Object.entries(skin?.attachments ?? {})) {
      if (!slotNames.has(slot)) {
        add('fatal', 'skin-slot', `skins/${skin.name}/${slot}`, `The skin defines slot "${slot}", which the skeleton does not have.`,
          { skin: skin.name, slot });
      }
      for (const [name, a] of Object.entries(set ?? {})) {
        const where = `skins/${skin.name}/${slot}/${name}`;
        const type = a?.type ?? 'region';
        if (type === 'path') checkPath(a, where, add);
        else if (type === 'mesh') checkMesh(a, where, add, (sk.bones ?? []).length);
        else if (type === 'linkedmesh' && a.parent && skinAttachments[slot] && !skinAttachments[slot].has(a.parent)) {
          add('warn', 'linkedmesh-parent', where, `The linked mesh's parent "${a.parent}" is not in this slot.`, { parent: a.parent });
        }
      }
    }
  }

  // ── constraints ──
  for (const kind of ['ik', 'transform', 'path', 'physics']) {
    for (const c of sk[kind] ?? []) {
      const where = `${kind}/${c?.name}`;
      for (const bone of c?.bones ?? []) {
        if (!boneNames.has(bone)) add('fatal', 'c-bone', where, `Constraint bone "${bone}" does not exist.`, { constraint: c?.name, bone });
      }
      if (c?.bone && !boneNames.has(c.bone)) {
        add('fatal', 'c-bone', where, `Constraint bone "${c.bone}" does not exist.`, { constraint: c.name, bone: c.bone });
      }
      if (c?.target) {
        const exists = kind === 'path' ? slotNames.has(c.target) : boneNames.has(c.target);
        if (!exists) {
          add('fatal', 'c-target', where,
            `Constraint target "${c.target}" does not exist${kind === 'path' ? ' (a path constraint targets a slot)' : ''}.`,
            { constraint: c.name, target: c.target });
        }
      }
    }
  }

  // ── animations ──
  const namesOf = kind => new Set((sk[kind] ?? []).map(c => c.name));
  const constraintNames = { ik: namesOf('ik'), transform: namesOf('transform'), path: namesOf('path'), physics: namesOf('physics') };
  let curveRuleSkipped = false;
  for (const [animation, a] of Object.entries(sk.animations ?? {})) {
    const where = `animations/${animation}`;
    if (majorMinor === '4.2') checkAnimation42(animation, a, where, add);

    for (const bone of Object.keys(a?.bones ?? {})) {
      if (!boneNames.has(bone)) add('fatal', 'anim-bone', where, `The animation keys bone "${bone}", which does not exist.`, { animation, bone });
    }
    for (const [slot, timelines] of Object.entries(a?.slots ?? {})) {
      if (!slotNames.has(slot)) { add('fatal', 'anim-slot', where, `The animation keys slot "${slot}", which does not exist.`, { animation, slot }); continue; }
      for (const key of timelines?.attachment ?? []) {
        if (key?.name && !hasAttachment(slot, key.name)) {
          add('fatal', 'anim-attachment', where,
            `An attachment timeline shows "${slot}/${key.name}", which no skin defines.`, { animation, slot, attachment: key.name });
        }
      }
    }
    for (const [kind, names] of Object.entries(constraintNames)) {
      for (const name of Object.keys(a?.[kind] ?? {})) {
        if (!names.has(name)) {
          add('fatal', 'anim-constraint', where, `A ${kind} timeline drives constraint "${name}", which does not exist.`,
            { animation, kind, constraint: name });
        }
      }
    }
    for (const skinTimelines of Object.values(a?.attachments ?? {})) {
      for (const [slot, attachments] of Object.entries(skinTimelines ?? {})) {
        if (!slotNames.has(slot)) { add('fatal', 'anim-deform-slot', where, `A deform timeline targets slot "${slot}", which does not exist.`, { animation, slot }); continue; }
        for (const attachment of Object.keys(attachments ?? {})) {
          if (!hasAttachment(slot, attachment)) {
            add('fatal', 'anim-deform-att', where, `A deform timeline targets "${slot}/${attachment}", which no skin defines.`,
              { animation, slot, attachment });
          }
        }
      }
    }
    for (const key of a?.events ?? []) {
      if (key?.name && !sk.events?.[key.name]) {
        add('fatal', 'anim-event', where, `The animation fires event "${key.name}", which is not defined.`, { animation, event: key.name });
      }
    }
    // Unknown slots are named here; the offsets the runtime cannot survive (unsorted, which
    // makes the parser run out of memory; out of range or colliding, which crash every pose)
    // come from the shared guard in draw-order.js, the same one the runtime host runs.
    const slotOrder = (sk.slots ?? []).map(s => s?.name);
    (a?.drawOrder ?? []).forEach((key, k) => {
      for (const offset of key?.offsets ?? []) {
        if (!slotNames.has(offset.slot)) {
          add('fatal', 'anim-draworder', where, `A draw order key moves slot "${offset.slot}", which does not exist.`,
            { animation, slot: offset.slot });
        }
      }
      for (const problem of drawOrderOffsetProblems(slotOrder, key?.offsets)) {
        if (problem.code === 'draw-order-unknown-slot') continue;
        add('fatal', problem.code, `${where}/drawOrder/${k}`, problem.message, { animation, slot: problem.slot, key: k });
      }
    });

    // Curve array length is a 4.x rule: one bezier per property (4 numbers each). In 3.8
    // a key had a single 4-number bezier whatever it animated. A valid 3.8 export must not
    // be stamped fatal, and the skipped rule is said once.
    if (!is4x) {
      const hasCurves = Object.values(a?.bones ?? {}).some(timelines =>
        Object.values(timelines ?? {}).some(keys => (keys ?? []).some(k => Array.isArray(k?.curve))));
      if (hasCurves && !curveRuleSkipped) {
        curveRuleSkipped = true;
        add('warn', 'curve-ver', where,
          `Curve lengths were not checked: the rule belongs to the 4.x format and this file is ${version || '(no version)'}. Open it in Spine to verify.`,
          { version: version || null });
      }
      continue;
    }
    for (const [bone, timelines] of Object.entries(a?.bones ?? {})) {
      const need = { rotate: 4, translate: 8, scale: 8, shear: 8, translatex: 4, translatey: 4, scalex: 4, scaley: 4, shearx: 4, sheary: 4 };
      for (const [timeline, length] of Object.entries(need)) checkCurveLength(timelines?.[timeline], length, `${bone}.${timeline}`, where, animation, add);
    }
  }
  return out;
}

function checkPath(a, where, add) {
  const count = a.vertexCount;
  if (!Number.isInteger(count) || count <= 0) {
    add('fatal', 'path-vc', where, `Path vertexCount is invalid: ${count}.`, { vertexCount: count ?? null });
  } else if (count % 3 !== 0) {
    add('fatal', 'path-vc3', where,
      `Path vertexCount ${count} must be a multiple of 3. The runtime divides it by 3 and fails to open the file ("Invalid array length"), and the editor cannot read its own re-export. Redraw the path in Spine and export again.`,
      { vertexCount: count });
  }
  const lengths = Array.isArray(a.lengths) ? a.lengths.length : 0;
  if (Number.isInteger(count) && count % 3 === 0 && lengths !== count / 3) {
    add('fatal', 'path-lengths', where, `Path has ${lengths} lengths but vertexCount / 3 = ${count / 3}.`, { lengths, expected: count / 3 });
  }
  // Unweighted: exactly vertexCount * 2 numbers. Weighted: vertexCount groups of
  // [count, (bone, x, y, weight) * count]. (The legacy rule could never fire: its
  // "weighted" test was true for every short array. This one parses the groups.)
  if (Array.isArray(a.vertices) && Number.isInteger(count) && count > 0 && a.vertices.length !== count * 2
      && !weightedGroupsExact(a.vertices, count)) {
    add('fatal', 'path-verts', where,
      `Path vertices hold neither ${count * 2} numbers (unweighted) nor ${count} weighted groups.`,
      { vertexCount: count, length: a.vertices.length });
  }
}


function checkMesh(a, where, add, boneCount) {
  const uvs = Array.isArray(a.uvs) ? a.uvs.length : 0;
  const triangles = Array.isArray(a.triangles) ? a.triangles : [];
  if (!uvs) add('fatal', 'mesh-uvs', where, 'The mesh has no uvs.');
  if (uvs % 2) add('fatal', 'mesh-uvs-odd', where, 'The mesh has an odd number of uvs (they are x, y pairs).');
  const vertexCount = uvs / 2;
  const bad = triangles.find(i => !Number.isInteger(i) || i < 0 || i >= vertexCount);
  if (bad !== undefined) add('fatal', 'mesh-tri', where, `A triangle index is out of range: ${bad}.`, { index: bad, vertexCount });
  if (triangles.length % 3) add('fatal', 'mesh-tri3', where, 'The triangle list length is not a multiple of 3.');
  if (Array.isArray(a.vertices) && a.vertices.length !== uvs && !weightedVerticesValid(a.vertices, boneCount)) {
    add('fatal', 'mesh-weights', where, 'The weighted mesh vertices are malformed (a bone index or an influence count is out of range).');
  }
}


function checkAnimation42(animation, a, where, add) {
  for (const key of Object.keys(a ?? {})) {
    if (!ANIMATION_KEYS.has(key)) {
      add('warn', 'anim-unknown', `${where}/${key}`,
        `Animation "${animation}" has a "${key}" section the 4.2 runtime ignores (in 4.2, deform lives under "attachments").`,
        { animation, key });
    }
  }
  let deformFloats = 0;
  let deformBytes = 0;
  // Walk keyed channels. Property p of a key occupies curve[p*4 .. p*4+3]: cx1, cy1, cx2,
  // cy2. Every property is inspected (slot colour, constraints, deform included); cy is a
  // value, not a time.
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      if (path[path.length - 1] === 'deform') {
        deformBytes += jsonBytes(node);
        for (const key of node) for (const value of key?.vertices ?? []) if (typeof value === 'number') deformFloats++;
      }
      for (let i = 0; i + 1 < node.length; i++) {
        const key = node[i];
        const next = node[i + 1];
        if (!key || !next || !Array.isArray(key.curve)) continue;
        const t0 = key.time ?? 0;
        const t1 = next.time ?? 0;
        for (let p = 0; p + 3 < key.curve.length; p += 4) {
          for (const handle of [p, p + 2]) {
            const cx = key.curve[handle];
            if (cx < t0 || cx > t1) {
              const owner = path.slice(0, -1).join('/');
              const channel = path[path.length - 1];
              add('warn', 'curve-time', `${where}/${path.join('/')}/${t0}`,
                `Animation "${animation}", ${owner} ${channel}: the bezier handle cx=${cx} (property ${p / 4 + 1}) lies outside its key pair [${t0}, ${t1}]. In 4.x, cx is a time in seconds, not a 0..1 fraction.`,
                { animation, owner, channel, time: t0, end: t1, cx, property: p / 4 + 1 });
            }
          }
        }
      }
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) walk(value, path.concat(key));
    }
  };
  for (const key of ANIMATION_KEYS) if (key !== 'events' && key !== 'drawOrder') walk(a?.[key], [key]);
  if (deformBytes > DEFORM_BUDGET_BYTES) {
    const deformKB = (deformBytes / 1024).toFixed(1);
    const animationKB = (jsonBytes(a) / 1024).toFixed(1);
    const budgetKB = DEFORM_BUDGET_BYTES / 1024;
    add('warn', 'deform-budget', where,
      `Animation "${animation}" carries ${deformFloats} deform floats: ${deformKB} KB of its ${animationKB} KB, over the ${budgetKB} KB budget. Sampled deform is usually replaceable by a few keys and a curve.`,
      { animation, count: deformFloats, deformKB, animationKB, budgetKB });
  }
}

function checkCurveLength(keys, need, label, where, animation, add) {
  for (const k of keys ?? []) {
    if (!Array.isArray(k?.curve)) continue;
    if (k.curve.length !== need) {
      add('fatal', 'curve-len', where,
        `${label} curve has ${k.curve.length} numbers; it needs ${need} (t=${k.time ?? 0}).`,
        { animation, timeline: label, length: k.curve.length, expected: need, time: k.time ?? 0 });
    }
  }
}
