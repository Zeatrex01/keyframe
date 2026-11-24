// start_here — the project's state and the order of work, with exact tool names.

import fs from 'node:fs';
import { projectOf } from '../project.js';
import { DELIVERY_MARKER } from '../../deliver/compose.js';
import { WRITING_RULES, CLIP_TIMING, FPS_BASIS } from '../../understand/principles.js';

const DRAW = { step: 'DRAW', why: 'There is no art yet. Set the art direction first (style_guide: palette by role, outline weights, radii, light), draw the parts with draw_rig from components and shapes in that guide (one part per moving piece, back to front, each with its pivot; states as other looks), check them with critique_art and look at its sheet, then follow the steps below on the rig it writes.',
  tools: ['style_guide', 'draw_rig', 'critique_art'] };
const STEPS = [
  { step: 'SEE', why: 'Know the subject, the rig and what already moves before writing anything. Confirm the brief once (what the skeleton is, what each clip is for, the display size): critique_animation judges by it. Read an existing clip that does something similar (describe_animation) and the rig\'s `conventions` from read_rig: they show how THIS rig does a blink or an expression (which slots switch together).',
    tools: ['scan_project', 'brief', 'read_rig', 'read_animation', 'describe_animation', 'see_animation', 'see_reference'] },
  { step: 'WRITE', why: 'One clip in animation JSON (Spine 4.2 compatible); effects (bursts, trails, flashes, glows, shakes) with add_effect. The base is never written, the delivery lands beside it.',
    tools: ['write_animation', 'set_curves', 'add_effect'] },
  { step: 'PROVE', why: '"Done" is a claim about the file. After EVERY write: check_skeleton on the delivery, critique_animation on the clip, and see_animation at the moments that matter. write_animation answers with these calls under `prove`.',
    tools: ['see_animation', 'describe_animation', 'critique_animation', 'sample_animation', 'check_skeleton'] },
  { step: 'DELIVER', why: 'The delivery file is what the owner opens in Spine; history keeps every earlier version. For an engine without physics, bake_animation records what the rig\'s constraints do as plain keys.',
    tools: ['list_history', 'restore_file', 'delete_animation', 'bake_animation'] },
];

const CONVERSATION = {
  why: 'The owner describes what they want in the studio page and watches the result there.',
  loop: ['wait_for_message', 'reply {work:"writing"}', '...write and prove...', 'reply {work:"ready", file, animation}', 'wait_for_message'],
};

const REFERENCE = {
  why: 'A reference video is measured, not guessed: one element at a time.',
  loop: ['see_reference', 'measure_reference {region, from, to, saveAs}', 'apply_motion {motion, bone, animation}', 'compare_reference {animation}', 'adjust amount / speed or the keys, compare again'],
};

const RULES = [
  'Never edit a skeleton .json with a generic file tool; every write goes through write_animation or another writing tool here.',
  'Values in a clip are Spine\'s: translate and rotate are offsets from the setup pose, scale multiplies, time is in seconds, bezier cx is in seconds (or use a preset name such as "easeOut", or a shape of your own as { "handles": [x1, y1, x2, y2] }, fractions of the segment\'s time and value).',
  'If read_rig lists physics constraints, the owner already built that sway in Spine: move the parent and leave the physics bones unkeyed (a write that keys them says so under onPhysicsBones). For a rig without them, write the trailing bone as a follow request.',
  'Write motion by the animation principles below by default (ease, anticipation, overshoot, overlap, volume-kept squash, holds); mechanical motion only when the owner asks for it.',
  'Before writing a clip, read a similar clip the owner made (describe_animation) and follow the rig\'s conventions (read_rig `conventions`): when the owner\'s clips show a closed lid they also hide the eye and pupil, so a new blink must too.',
  'After every write, run the calls listed under `prove` in its answer (check_skeleton, critique_animation, see_animation) before saying it is finished. Never call a clip done on critique verdict "unmeasured" without looking at its frames.',
];

// What any connected agent can do here, in one place (the full list: help).
const CAPABILITIES = [
  'read a rig and its clips in numbers and sentences (read_rig, read_animation, describe_animation)',
  'write one clip at a time in animation JSON (Spine 4.2 compatible), delivered beside the owner\'s file with a backup (write_animation, set_curves)',
  'see rendered frames without a browser (see_animation) and exact poses at any time (sample_animation)',
  'check a file opens and plays (check_skeleton) and measure motion against the animation principles (critique_animation)',
  'measure a reference video and copy one element\'s motion onto a bone (see_reference, measure_reference, apply_motion, compare_reference)',
  'bend parts with painted weights (paint_weights), bake constraints into plain keys (bake_animation), undo (list_history, restore_file)',
  'talk with the owner in the studio page (wait_for_message, reply)',
];

// One complete write call for THIS rig, so the format is learned from a working example.
function exampleFor(project, base) {
  if (!base) return {};
  let sk;
  try { sk = JSON.parse(fs.readFileSync(project.resolve(base.file), 'utf8')); } catch { return {}; }
  const bone = (sk.bones ?? []).find(b => b.parent)?.name;
  const slot = (sk.slots ?? []).find(s => s.attachment)?.name;
  if (!bone) return {};
  const clip = { bones: { [bone]: { translate: [{ time: 0, x: 0, y: -12, curve: 'outBack' }, { time: 0.4, x: 0, y: 0 }] } } };
  if (slot) clip.slots = { [slot]: { rgba: [{ time: 0, color: 'ffffff00', curve: 'outCubic' }, { time: 0.3, color: 'ffffffff' }] } };
  return { example: {
    tool: 'write_animation',
    args: { animation: 'example_rise', from: base.file, clip },
    note: 'A working call for this rig: the bone rises 12 units into place with an overshoot while the slot fades in. Offsets are from the setup pose; colour is RRGGBBAA; `curve` on a key shapes the segment to the next key.',
  } };
}

export default {
  name: 'start_here',
  tier: 'core',
  writes: false,
  summary: 'What this project holds and the SEE -> WRITE -> PROVE -> DELIVER order with exact tool names and the next call.',
  description: 'Call at session start and after the folder changes. Returns the skeletons in the project (owner bases and studio deliveries, with their animations), what the studio can do, the order of work with the tools for each step and why, the rules that matter most, the animation principles as writing rules with numbers and the timing of common clips, one working write call for this rig, and the single recommended next call.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  run(args, { session }) {
    const project = projectOf(session);
    const skeletons = project.list().map(({ file }) => {
      try {
        const sk = JSON.parse(fs.readFileSync(project.resolve(file), 'utf8'));
        return { file, role: sk[DELIVERY_MARKER] ? 'delivery' : 'base', ...(sk[DELIVERY_MARKER]?.base ? { deliveryOf: sk[DELIVERY_MARKER].base } : {}),
          bones: sk.bones?.length ?? 0, animations: Object.keys(sk.animations ?? {}) };
      } catch { return null; }
    }).filter(Boolean);
    const bases = skeletons.filter(s => s.role === 'base');
    const deliveries = skeletons.filter(s => s.role === 'delivery');
    const references = (() => { try { return fs.readdirSync(`${project.dir}/reference`).filter(n => /\.(mp4|webm|mov|gif)$/i.test(n)); } catch { return []; } })();
    let next;
    if (!bases.length) next = { tool: 'draw_rig', why: 'No skeleton here yet. If the owner has a rig, they put it into this folder (a Keyframe file, or a Spine 4.2 JSON export with its atlas); otherwise draw placeholder art from their description with draw_rig.' };
    else if (bases.length > 1 && !deliveries.length) next = { tool: 'scan_project', why: `Several skeletons (${bases.map(b => b.file).join(', ')}); see which one is the rig to animate and pass it as \`file\` / \`from\`.` };
    else if (references.length && !deliveries.length) next = { tool: 'see_reference', why: `There is a reference video (${references.join(', ')}): look at it, then measure_reference the element that matters instead of timing it by eye.` };
    else if (deliveries.length) next = { tool: 'describe_animation', args: { file: deliveries[0].file }, why: 'A delivery exists: read what it already says before adding to it.' };
    else next = { tool: 'read_rig', args: { file: bases[0].file }, why: 'Learn the bone names, parents and orientation before writing motion.' };
    return { project: project.dir, skeletons, capabilities: CAPABILITIES, steps: bases.length ? STEPS : [DRAW, ...STEPS], conversation: CONVERSATION, reference: { ...REFERENCE, videos: references }, rules: RULES,
      principles: { fpsBasis: FPS_BASIS, note: 'Rules marked estimate are rules of thumb: follow them by default, break them on purpose.', rules: WRITING_RULES, clipTiming: CLIP_TIMING },
      ...exampleFor(project, bases[0]), next };
  },
};
