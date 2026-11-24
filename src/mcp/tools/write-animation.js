// write_animation — the one write path for motion: native Spine JSON in, a proven delivery out.

import { projectOf } from '../project.js';
import fs from 'node:fs';
import { writeDelivery } from '../../deliver/write.js';
import { conventionFindings } from '../../understand/conventions.js';
import { clipDuration } from '../../understand/critique.js';

const round3 = v => Math.round(v * 1000) / 1000;

/**
 * Up to six instants worth looking at: the start, the moments something switches or a key lands
 * (spread over the clip), and the end. Never past the end, so a look is never asked for nothing.
 */
export function lookTimes(clip, duration) {
  const keyed = new Set([0, round3(duration)]);
  const visit = node => {
    if (Array.isArray(node)) { for (const k of node) if (k && typeof k === 'object' && typeof k.time === 'number' && k.time <= duration) keyed.add(round3(k.time)); return; }
    if (node && typeof node === 'object') for (const v of Object.values(node)) visit(v);
  };
  visit(clip);
  const all = [...keyed].sort((a, b) => a - b);
  if (all.length <= 6) return all;
  return [0, 1, 2, 3, 4, 5].map(i => all[Math.round(i * (all.length - 1) / 5)]);
}

/**
 * What a write answers with besides the delivery: the rig conventions the clip breaks, and the
 * calls that prove it, ready to run. An agent that skips straight to "done" is told, in the
 * write's own answer, what it has not looked at yet.
 */
export function proveCalls(file, animation, times) {
  return [
    { tool: 'check_skeleton', arguments: { file }, why: 'the delivery opens and plays' },
    { tool: 'critique_animation', arguments: { file, animation }, why: 'the motion against the animation principles and the rig\'s conventions' },
    { tool: 'see_animation', arguments: { file, animation, ...(times ? { times } : {}) }, why: 'look at the frames before calling it done (the start, the moments keys land, the end)' },
  ];
}

export default {
  name: 'write_animation',
  tier: 'core',
  writes: true,
  summary: 'Writes one animation (animation JSON, Spine 4.2 compatible) onto the base and saves a proven delivery beside it; the base is never written.',
  description: 'The write path. `clip` is ONE animation in the studio\'s animation JSON (the same shape as Spine 4.2\'s), exactly as it appears under "animations" in a skeleton file: { bones: { <bone>: { rotate: [{ time, value, curve }], translate: [{ time, x, y, curve }], scale, shear, ... } }, slots: { <slot>: { rgba, rgb, alpha, attachment, ... } }, ik, transform, path, physics, attachments (deform), drawOrder, events }. Values: translate and rotate are OFFSETS from the setup pose, scale is a multiplier, time in seconds. `curve` may be "stepped", "linear", a bezier array (cx in SECONDS), or a preset name: linear, in/out/inOut + Sine, Quad, Cubic, Quart, Expo or Back (e.g. "outCubic", "inOutSine", "outBack" for an overshoot), or the aliases "easeIn", "easeOut", "easeInOut", "overshoot" (expanded to the exact bezier for that key pair). "smooth" passes through each key at speed instead of stopping there (its speed set by the keys either side; a loop whose last key repeats the first flows through the seam): use it on cycles such as runs, walks and swings, where an ease on every key makes each limb halt at every pose. A curve may also be a shape of your own: { handles: [x1, y1, x2, y2] }, fractions of the segment\'s time and value. FOLLOW-THROUGH: instead of keys, a bone\'s rotate may be { follow: <bone>, of: "rotate" | "translate.x" | "translate.y", frequency, damping, amount }: it trails that bone\'s keys in this clip through a damped spring (lags, swings past, settles) and is baked to rotate keys; use it for hair, tails, ears, ribbons. frequency is swings per second (2 to 3 loose, 4 to 6 stiff), damping 0.05 to 2 (1 = no overshoot), amount scales the swing. The result lists them under `followed`. The studio validates the clip, holds each value channel\'s first key back to t=0 so a reveal does not leak the setup pose (reported), composes it onto the base: the clip you write wins, other clips and channels already in the delivery are kept, the owner\'s own clips stay as they are. It refuses, writing nothing, if the result fails a check the base passes or the player refuses it (the studio\'s engine; with the Spine add-on on, the official runtime too). The delivery lands as <base>_v2.json (or `into`) beside the base with its atlas; the previous delivery is backed up. The answer lists, under `prove`, the calls to run before calling it done (check_skeleton, critique_animation, see_animation), and under `conventions` any rig convention the clip breaks (a closed lid without the eye hidden).',
  inputSchema: {
    type: 'object', required: ['animation', 'clip'], additionalProperties: false,
    properties: {
      animation: { type: 'string', description: 'Name of the animation to write (used exactly as given).' },
      clip: { type: 'object', short: 'one animation (animation JSON)', description: 'One animation in animation JSON, Spine 4.2 compatible (the object that sits under "animations" -> name in a skeleton file).' },
      from: { type: 'string', short: 'base skeleton; empty = the folder base', description: 'Project-relative base skeleton; empty picks the folder\'s base. Never written.' },
      into: { type: 'string', short: 'delivery file; empty = <base>_v2.json', description: 'Project-relative delivery file in the base\'s folder; empty means <base>_v2.json. Only studio deliveries are ever overwritten.' },
      replace: { type: 'boolean', short: 'rebuild this clip from the base', description: 'Default false: timelines you do not write this call keep what earlier calls wrote; a timeline you do write replaces that timeline whole. true rebuilds this clip from the base before applying yours.' },
      fps: { type: 'number', minimum: 1, maximum: 240, short: 'snap key times to this frame rate', description: 'Snap every key time to this frame grid and report the moved keys; empty keeps times as written.' },
      holdFromStart: { type: 'boolean', short: 'hold first keys back to t=0 (default true)', description: 'Default true. false keeps value channels showing the setup pose until their first key.' },
      plant: { type: 'array', short: 'feet that stay where they stand', items: { anyOf: [{ type: 'string' }, { type: 'object' }] },
        description: 'Feet (or hands) that stay planted while the body moves: "footFront", or { bone, from, to, at: [x, y] }. The two bones above each (shin and thigh) are turned frame by frame so its joint stays where it stood at `from` (or at `at`), and baked to rotate keys; the foot keeps its angle. Use it for a punch, a lean, a crouch, a landing: anything where the body moves and the feet must not slide. The answer lists them under `planted` with how far each leg had to stretch (reach 1 = straight).' },
    },
  },
  async run({ animation, clip, from, into, replace = false, fps, holdFromStart = true, plant }, { session }) {
    const project = projectOf(session);
    const result = await writeDelivery({ projectDir: project.dir, from, into, name: animation, animation: clip, replace, fps, holdFromStart, plant });
    let conventions = [], duration = null, times;
    try {
      const delivered = JSON.parse(fs.readFileSync(project.resolve(result.file), 'utf8'));
      conventions = conventionFindings(delivered, animation).map(({ severity, message, fix }) => ({ severity, message, fix }));
      const written = delivered.animations?.[animation];
      duration = round3(clipDuration(written ?? {}));
      times = lookTimes(written ?? {}, duration);
    } catch { /* the delivery was proven on write; a failed re-read only drops these hints */ }
    return { ...result, ...(duration !== null ? { duration } : {}), ...(conventions.length ? { conventions } : {}),
      prove: { required: true, note: `Not done yet: run these calls and look at what they say before telling the owner it is finished.${duration !== null ? ` The clip lasts ${duration} s; times past that show nothing new.` : ''}`, calls: proveCalls(result.file, animation, times) } };
  },
};
