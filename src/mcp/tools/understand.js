// Seeing in numbers and sentences: read_rig, read_animation, sample_animation,
// describe_animation, critique_animation, critique_rig.

import { projectOf } from '../project.js';
import { readRigOnRuntime, readAnimationOnRuntime, drawOrderChanges } from '../../understand/read.js';
import { describeAnimation } from '../../understand/describe.js';
import { critiqueAnimation } from '../../understand/critique.js';
import { readBrief } from '../../core/brief.js';
import { DELIVERY_MARKER } from '../../deliver/compose.js';
import { critiqueOptions } from '../../understand/subject.js';
import { critiqueRig } from '../../understand/rig-critique.js';
import { parseSkeleton, sampleAnimation, poseSetup, limitsNote } from '../../runtime/index.js';
import { StudioError } from '../../shared/errors.js';

const FILE = { type: 'string', short: 'skeleton; empty = the folder base', description: 'Project-relative skeleton JSON; empty picks the folder\'s base (pass the delivery to read what you wrote).' };
const ANIMATION = { type: 'string', description: 'Animation name.' };

function requireAnimation(sk, rel, name) {
  const names = Object.keys(sk.animations ?? {});
  if (!names.includes(name)) throw new StudioError('unknown-animation', `No animation named "${name}" in ${rel}.`, { animation: name, available: names });
}

export const readRigTool = {
  name: 'read_rig',
  tier: 'core',
  writes: false,
  summary: 'The rig: bone tree with setup and world transforms, slots and draw order, skins and attachments, constraints, animation summary.',
  description: 'Reads the structure of a skeleton: the bone tree (setup transform, and the world transform of the setup pose as the player computes it, constraints applied), slots in draw order with their setup attachment and colour, skins and attachment types, constraints with their settings and defaults, mesh weight summaries, and a one-line summary per animation. Call it before writing motion: bone names, parents and orientation decide what a rotate or translate key will do. Reading only.',
  inputSchema: { type: 'object', additionalProperties: false, properties: { file: FILE, skin: { type: 'string', short: 'skin for the setup pose', description: 'Skin active for the setup pose; empty uses the default.' } } },
  async run({ file, skin }, { session }) {
    const { sk, rel, autoChosen } = projectOf(session).skeleton(file);
    return { file: rel, ...(autoChosen ? { autoChosen } : {}), ...(await readRigOnRuntime(sk, { skin })) };
  },
};

export const readAnimationTool = {
  name: 'read_animation',
  tier: 'core',
  writes: false,
  summary: 'One animation as measurements: channels per bone and slot, ranges, key spacing, frame grid, draw-order changes; keys on request.',
  description: 'Reads one animation\'s authored keys and measures them: per bone and channel the range and amplitude, key count and spacing, off-grid keys at the given fps; slot channels; constraint timelines; draw-order keys resolved by the runtime (who moved how many steps against setup). `detail` adds the keys themselves (compressed; `raw` for Spine\'s own form, including full bezier numbers); narrow with `bones` when asking for detail. Reading only.',
  inputSchema: {
    type: 'object', required: ['animation'], additionalProperties: false,
    properties: {
      file: FILE, animation: ANIMATION,
      detail: { type: 'boolean', short: 'include the keys', description: 'Also return the keys (compressed).' },
      raw: { type: 'boolean', short: 'keys in Spine form', description: 'With detail: keys in Spine\'s raw form.' },
      bones: { type: 'array', items: { type: 'string' }, short: 'only these bones', description: 'Only these bones in the bones section.' },
      fullDrawOrder: { type: 'boolean', short: 'full order per draw-order key', description: 'Also return the full resolved slot order at each draw-order key (long).' },
      fps: { type: 'number', minimum: 1, maximum: 240, short: 'frame grid for the off-grid count (default 30)', description: 'Frame rate the off-grid key count is measured against (default 30).' },
    },
  },
  async run({ file, animation, ...options }, { session }) {
    const { sk, rel } = projectOf(session).skeleton(file);
    requireAnimation(sk, rel, animation);
    return { file: rel, ...(await readAnimationOnRuntime(sk, animation, options)) };
  },
};

const round = v => Math.round(v * 10000) / 10000;
const transform = b => ({ x: round(b.x), y: round(b.y), rotation: round(b.rotation), scaleX: round(b.scaleX), scaleY: round(b.scaleY),
  ...(b.shearX || b.shearY ? { shearX: round(b.shearX), shearY: round(b.shearY) } : {}) });
const sameNumbers = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const sampleAnimationTool = {
  name: 'sample_animation',
  tier: 'core',
  writes: false,
  summary: 'Exact poses at chosen times: local, applied (after constraints) and world transforms; slot and draw-order changes.',
  description: 'Samples one animation at the given times on the studio\'s engine and returns, per moving bone, the keyed local transform, the applied transform after constraints (IK, transform and physics on the engine, physics simulated forward on a fixed 1/60 grid; path constraints only with the Spine add-on on, and without it `notEvaluated` names what was left out), and the world transform; per slot, attachment and colour where they differ from setup; and the draw order against setup (`steps` > 0 = drawn later, in front). Answers "where is the hand at 1.2 s", "was the motion actually written", "is the box behind the car". Default times: 0, a quarter, half, three quarters, end. Bones default to those that move. Reading only.',
  inputSchema: {
    type: 'object', required: ['animation'], additionalProperties: false,
    properties: {
      file: FILE, animation: ANIMATION,
      times: { type: 'array', items: { type: 'number', minimum: 0 }, short: 'seconds; empty = 0, 1/4, 1/2, 3/4, end', description: 'Instants in seconds.' },
      bones: { type: 'array', items: { type: 'string' }, short: 'only these bones; empty = the moving ones', description: 'Bones to return; empty returns every bone that moves.' },
      skin: { type: 'string', short: 'skin', description: 'Skin active while sampling.' },
      fullDrawOrder: { type: 'boolean', short: 'full order per time', description: 'Also return the full slot order at each time.' },
    },
  },
  async run({ file, animation, times, bones, skin, fullDrawOrder = false }, { session }) {
    const { sk, rel } = projectOf(session).skeleton(file);
    requireAnimation(sk, rel, animation);
    const data = await parseSkeleton(sk);
    const duration = data.findAnimation(animation).duration;
    const instants = times?.length ? times : [0, 0.25, 0.5, 0.75, 1].map(f => round(duration * f));
    const samples = await sampleAnimation(data, animation, instants, { skin });
    // Everything is compared with the setup pose, not with t=0: t=0 is already the clip.
    const setup = await poseSetup(data, { skin });
    const setupSlot = new Map(setup.slots.map(slot => [slot.name, slot]));
    const keyed = new Set(Object.keys(sk.animations[animation].bones ?? {}));
    const differs = (b, base) => !sameNumbers(transform(b.applied), transform(base.applied))
      || !sameNumbers([round(b.worldX), round(b.worldY), round(b.worldRotation)], [round(base.worldX), round(base.worldY), round(base.worldRotation)]);
    const wanted = new Set(bones?.length ? bones
      : setup.bones.filter((base, i) => keyed.has(base.name) || samples.some(s => differs(s.bones[i], base))).map(b => b.name));
    const slotChanged = slot => {
      const base = setupSlot.get(slot.name);
      return slot.attachment !== base?.attachment || !sameNumbers(slot.color, base?.color);
    };
    const limits = limitsNote(data);
    return {
      file: rel, animation, duration: round(duration), ...(limits ? { notEvaluated: limits } : {}),
      samples: samples.map(s => {
        const changes = drawOrderChanges(setup.drawOrder, s.drawOrder);
        return {
          time: s.time,
          bones: Object.fromEntries(s.bones.filter(b => wanted.has(b.name)).map(b => [b.name, {
            local: transform(b), applied: transform(b.applied),
            world: { x: round(b.worldX), y: round(b.worldY), rotation: round(b.worldRotation), scaleX: round(b.worldScaleX), scaleY: round(b.worldScaleY) },
          }])),
          slots: Object.fromEntries(s.slots.filter(slotChanged).map(slot => [slot.name,
            { attachment: slot.attachment, color: Object.fromEntries(Object.entries(slot.color).map(([k, v]) => [k, round(v)])) }])),
          ...(changes.length ? { drawOrderChanges: changes } : {}),
          ...(fullDrawOrder ? { drawOrder: s.drawOrder } : {}),
        };
      }),
    };
  },
};

export const describeAnimationTool = {
  name: 'describe_animation',
  tier: 'core',
  writes: false,
  summary: 'The clip in sentences: who moves when, how far, which way; fades, holds, overshoots, loop check, setup-pose pops.',
  description: 'Describes an animation the way an animator would after one look, computed from the keys: per bone or slot "rises 15 units (eased) over 0.5-1.2 s with a 20% overshoot", "fades in over 0-1.3 s", "breathes 1 -> 1.05 -> 1"; staggered entrances; holds long enough to read; whether the loop is seamless; and setup-pose pops (a timeline whose first key sits after t=0 with a value the setup pose does not have, so the runtime snaps there), flagged as visible or masked. Every sentence carries its numbers; the structure behind the paragraph is returned too, with the critique verdict for orientation. Directions follow Spine: +x right, +y up, +rotation counter-clockwise. Without `animation`, a summary per animation.',
  inputSchema: { type: 'object', additionalProperties: false, properties: { file: FILE, animation: { type: 'string', short: 'empty = every animation', description: 'Animation name; empty gives a summary for every animation.' } } },
  run({ file, animation }, { session }) {
    const { sk, rel } = projectOf(session).skeleton(file);
    const names = Object.keys(sk.animations ?? {});
    if (!names.length) throw new StudioError('no-animation', `${rel} has no animations.`, { file: rel });
    const one = name => {
      const brief = describeAnimation(sk, name);
      let quality = null;
      try { const c = critiqueAnimation(sk, name); quality = { verdict: c.verdict, findings: c.findings.map(f => f.code) }; } catch { /* orientation only */ }
      return { ...brief, quality };
    };
    if (animation) { requireAnimation(sk, rel, animation); return { file: rel, ...one(animation) }; }
    return { file: rel, animations: names.map(name => { const b = one(name); return { animation: name, duration: b.duration, loop: b.loop, summary: b.summary, quality: b.quality }; }) };
  },
};

export const critiqueAnimationTool = {
  name: 'critique_animation',
  tier: 'core',
  writes: false,
  summary: 'Measures a clip against the animation principles: ease, anticipation, overshoot, overlap, squash volume, holds, loop seam, readability; a verdict with numbers and fixes.',
  description: 'check_skeleton asks "will Spine open it"; this asks "is the motion dead". It measures the authored keys: curve profile (all linear = constant speed), key count and spacing, anticipation and overshoot around the main move, holds long enough to read, scale reaching zero, sudden turns, and the animation principles: overlap (bones keyed on the same frames), one ease shape everywhere, squash or stretch that changes volume or sits on a bone with children, a loop that pops at its seam, left and right moving identically, and moves too small to see on screen. Principle findings name their `principle` and say `estimate: true` when the threshold is a rule of thumb. For a figure (not a UI part, an effect or a prop) it holds the clip to the minimums of its action, named from the clip: a strike moves the body behind it, winds up, lands in a few frames and holds the hit; a jump rises a quarter of the height after a crouch; a hop falls into the ground instead of floating; a wave raises the hand above the head and swings it; an idle breathes; a walk bobs. It flags a limb that comes apart from the part it hangs from (limb-separates: a translated arm, or a pivot in the middle of a limb). It also flags a clip that breaks the rig\'s own conventions (a closed lid shown without hiding the eye, when the owner\'s clips always hide it). It returns a verdict (good, mechanical, faulty, or unmeasured when no bone moves: then look at the frames), the measures and warn findings, each with a suggested fix. Mechanical motion asked for on purpose (a conveyor, a clock hand) is fine: say so and move on. When the skeleton has a brief (the brief tool), its loop flag, display size and subject preset are used unless you pass loop or pixelsPerUnit.',
  inputSchema: { type: 'object', required: ['animation'], additionalProperties: false, properties: {
    file: FILE, animation: ANIMATION,
    loop: { type: 'boolean', short: 'is it a loop (default: from the name)', description: 'Whether the clip loops, for the seam check; default guessed from the name (idle, loop, cycle, walk, run, breath, spin, float).' },
    pixelsPerUnit: { type: 'number', minimum: 0.01, maximum: 100, short: 'screen px per skeleton unit (default 1)', description: 'Screen pixels per skeleton unit at the size the game shows it, for the readability floor (default 1).' },
  } },
  run({ file, animation, loop, pixelsPerUnit }, { session }) {
    const project = projectOf(session);
    const { sk, rel } = project.skeleton(file);
    requireAnimation(sk, rel, animation);
    // The clip's brief (loop, display size, checks that do not apply to the subject); explicit arguments win.
    const brief = readBrief(project.dir, rel) ?? readBrief(project.dir, sk[DELIVERY_MARKER]?.base ?? '');
    const fromBrief = critiqueOptions(brief, animation);
    const options = { ...fromBrief, ...(loop !== undefined ? { loop } : {}), ...(pixelsPerUnit !== undefined ? { pixelsPerUnit } : {}) };
    return { file: rel, ...(brief ? { brief: { subject: brief.subject, display: brief.display } } : {}), ...critiqueAnimation(sk, animation, options) };
  },
};

export const critiqueRigTool = {
  name: 'critique_rig',
  tier: 'advanced',
  writes: false,
  summary: 'Is the rig built well: unused bones, pivots sitting at the centre of their art, constraints with no effect.',
  description: 'The file opens, but is the rig built to animate? It flags bones nothing uses, bones whose pivot sits at the centre of the art they carry (rotating spins the art in place instead of hinging, the chest-lid case), and constraints whose mixes leave them with no effect, each with its severity and why. World positions come from the setup pose. The rig belongs to the owner: report, do not change it.',
  inputSchema: { type: 'object', additionalProperties: false, properties: { file: FILE } },
  async run({ file }, { session }) {
    const { sk, rel } = projectOf(session).skeleton(file);
    return { file: rel, ...(await critiqueRig(sk)) };
  },
};
