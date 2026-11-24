// Learning from a reference video: see it, measure one element's motion out of it, keep that
// motion, play it on a rig, and prove the copy against the reference.
//
//   see_reference      frames of the video, to find the beats by eye
//   measure_reference  one element's motion as keys and eases (and into the library)
//   apply_motion       a measured or saved motion onto a bone of the rig, as a delivery
//   compare_reference  reference and result side by side, with the gap in numbers

import fs from 'node:fs';
import path from 'node:path';
import { projectOf } from '../project.js';
import { projectFolders } from '../../core/paths.js';
import { extractFrames, analysisFrames, checkRegion } from '../../core/video.js';
import { readFocus } from '../../core/focus.js';
import { saveMotion, readMotion, listMotions } from '../../core/motions.js';
import { decodePng, encodePng } from '../../render/png.js';
import { renderFrames, filmstrip } from '../../render/frames.js';
import { readAtlas } from '../../understand/atlas.js';
import { trackFrames, motionFrom, compareTracks, findCycles, reconstruct, fitKeys, backgroundOf, measureFrame } from '../../understand/track.js';
import { parseSkeleton, poseSetup } from '../../runtime/index.js';
import { interpretMotion } from '../../understand/interpret.js';
import { readBriefs } from '../../core/brief.js';
import { writeDelivery } from '../../deliver/write.js';
import { StudioError } from '../../shared/errors.js';

const VIDEO = /\.(mp4|webm|mov|gif)$/i;
const STRIP_GROUND = { r: 0.35, g: 0.35, b: 0.38, a: 1 };
const REGION = {
  type: 'object', short: 'part of the picture {x, y, width, height} as 0-1 fractions',
  description: 'The part of the picture to look at, as fractions of the frame from its top-left corner: { x, y, width, height }, each 0-1. Leave a margin of plain ground around the element. Default: what the owner marked in the page, else the whole frame.',
  properties: {
    x: { type: 'number', minimum: 0, maximum: 1, description: 'Left edge, as a fraction of the frame width (0 = left).' },
    y: { type: 'number', minimum: 0, maximum: 1, description: 'Top edge, as a fraction of the frame height (0 = top).' },
    width: { type: 'number', minimum: 0.01, maximum: 1, description: 'Width, as a fraction of the frame width.' },
    height: { type: 'number', minimum: 0.01, maximum: 1, description: 'Height, as a fraction of the frame height.' },
  },
  required: ['x', 'y', 'width', 'height'],
};
const RANGE = {
  file: { type: 'string', short: 'reference video; empty = the owner\'s pick or the only one', description: 'Project-relative video (mp4, webm, mov, gif), normally under reference/. Empty uses what the owner marked in the page, else the only video there.' },
  from: { type: 'number', minimum: 0, short: 'start, seconds', description: 'Start of the range in seconds. Default: the owner\'s mark, else 0.' },
  to: { type: 'number', minimum: 0, short: 'end, seconds', description: 'End of the range in seconds. Default: the owner\'s mark, else the end.' },
  region: REGION,
};

function references(project) {
  return projectFolders(project.dir, 'reference').read
    .flatMap(folder => fs.readdirSync(folder).filter(n => VIDEO.test(n)).map(n => project.rel(path.join(folder, n)))).sort();
}

// The video, range and region to work on: the arguments, then what the owner marked, then the only video.
/** @param {object} project @param {{ file?: string, from?: number, to?: number, region?: object }} where */
function pick(project, { file, from, to, region }) {
  const focus = readFocus(project.dir);
  const available = references(project);
  let rel = file ?? focus?.file;
  if (!rel) {
    if (available.length !== 1) throw new StudioError(available.length ? 'which-reference' : 'no-reference',
      available.length ? 'There are several reference videos; pass one as `file`.' : 'There is no reference video yet. The owner adds one in the page (or copies it into reference/).', { available });
    [rel] = available;
  }
  if (!VIDEO.test(rel)) throw new StudioError('bad-argument', 'A reference video is an mp4, webm, mov or gif file.', { file: rel });
  const abs = project.resolve(rel);
  if (!fs.existsSync(abs)) throw new StudioError('file-not-found', `File not found: ${rel}.`, { file: rel, available });
  const same = focus?.file === rel;
  return { rel, abs, from: from ?? (same ? focus.from : undefined) ?? 0, to: to ?? (same ? focus.to : undefined),
    region: checkRegion(region ?? (same ? focus.region : undefined)), fromOwner: same && (region === undefined || from === undefined) ? focus : null };
}

const png = image => ({ data: Buffer.from(encodePng(image)).toString('base64'), mimeType: 'image/png' });

export const seeReferenceTool = {
  name: 'see_reference',
  tier: 'core',
  writes: false,
  summary: 'A filmstrip PNG of the owner\'s reference video over a time range (and a region), with the time of every frame, to find its beats by eye.',
  description: 'The owner drops a reference video into the project\'s reference/ folder (or the page uploads it there) and may mark a part of the picture and a stretch of time. This returns evenly spaced frames as ONE filmstrip PNG plus the time of each frame. Use it to understand what happens and which element matters; then measure_reference gives that element\'s motion in numbers, so do not time moves by eye. With no arguments it shows what the owner marked, else the whole of the only video. Needs ffmpeg on this machine; refuses with `no-ffmpeg` otherwise.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: { ...RANGE,
      count: { type: 'integer', minimum: 1, maximum: 24, short: 'frames (default 12)', description: 'How many frames, evenly spaced over the range (1-24, default 12).' },
      width: { type: 'integer', minimum: 64, maximum: 640, short: 'frame width px, 64 to 640 (default 240)', description: 'Width of each frame in pixels (64-640, default 240); this sets the token cost.' },
      columns: { type: 'integer', minimum: 1, maximum: 12, short: 'frames per row (default 4)', description: 'Frames per filmstrip row (default 4).' },
    },
  },
  async run({ count = 12, width = 240, columns = 4, ...where }, { session }) {
    const project = projectOf(session);
    const ref = pick(project, where);
    const { frames, times, duration } = await extractFrames(ref.abs, { from: ref.from, to: ref.to, count, width, region: ref.region });
    const images = frames.map(f => decodePng(new Uint8Array(f)));
    return { image: png(filmstrip(images, { columns, gap: 4, background: STRIP_GROUND })),
      meta: { file: ref.rel, duration: +duration.toFixed(3), times, ...(ref.region ? { region: ref.region } : {}), ...(ref.fromOwner ? { markedByOwner: true } : {}),
        frame: { width: images[0].width, height: images[0].height }, columns,
        note: 'Frames run left to right, top to bottom, at the listed times (seconds from the start of the video). For the timing of one element use measure_reference.' } };
  },
};

export const measureReferenceTool = {
  name: 'measure_reference',
  tier: 'core',
  writes: true,
  summary: 'Measures how ONE element moves in the reference video: scale, travel, turn and fade as keys with eases, to a fraction of a pixel. Optionally saves it to the motion library.',
  description: 'Follows one element through every frame of a range and returns `motion`, in the terms an animation is written in: `motion.tracks.scale` (ratio to its rest size), `tracks.translate` (travel of its anchor as a FRACTION OF ITS REST HEIGHT, y up), `tracks.rotate` (degrees, only for a clearly elongated shape), `tracks.alpha` (fade), each as keys { time, x, y | value, ease } with the ease that best explains the frames between two keys (`guessed: true` when a move is too short to tell eases apart). `beats` lists when it moves and when it holds; `fitError` is how far those keys, played back, are from what was measured (0.02 = 2% of the element\'s size); `confidence` drops when the ground around the element is not plain or the crop is too tight. How it sees the element: `region` must frame it with a margin of plain ground, since the border of the crop is taken as the ground; one element per call. `rest` says which state is scale 1: "auto" (where it is most of the time: right for a tap, a loop, a reveal that then holds), "first" or "last". `anchor` is the point whose travel is reported: "bottom" (default: a thing standing on the ground, so a squash does not read as a drop), "center" or "top"; apply the motion to a bone that sits at that point. The filmstrip returned shows the crop at the key times, to check it followed the right thing. When the range holds the same move several times, `repeats` gives the period and where each cycle starts: measure one cycle. `saveAs` stores the motion in the owner\'s library (names are kept lowercase with dashes), for apply_motion on any rig later. Needs ffmpeg. `reading` interprets it instead of copying it: the beats in the principles\' terms (anticipation, main move, overshoot and settle, holds) and `restage`, the apply_motion speed and amount that fit it to the clip\'s seconds in the brief and to the size the subject is shown at.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: { ...RANGE,
      anchor: { type: 'string', enum: ['bottom', 'center', 'top'], short: 'bottom | center | top (default bottom)', description: 'The fixed point of the element whose travel is reported as translate.' },
      rest: { type: 'string', enum: ['auto', 'first', 'last'], short: 'which state is scale 1 (default auto)', description: 'auto: the state held most of the time; first / last: that frame of the range.' },
      saveAs: { type: 'string', short: 'save into the library under this name', description: 'Name to store the measured motion under in the owner\'s motion library.' },
      note: { type: 'string', short: 'one line kept with the saved motion', description: 'What this motion is, in a few words (kept with saveAs).' },
      clip: { type: 'string', short: 'the clip this reference is for', description: 'The clip the motion will become, as named in the brief: `reading.restage` then fits it to that clip\'s seconds and the subject\'s display size.' },
    },
  },
  async run({ anchor = 'bottom', rest = 'auto', saveAs, note, clip, ...where }, { session }) {
    const project = projectOf(session);
    const ref = pick(project, where);
    const got = await analysisFrames(ref.abs, { from: ref.from, to: ref.to, region: ref.region });
    const frames = got.frames.map(f => decodePng(new Uint8Array(f)));
    const track = trackFrames(frames, { fps: got.fps, anchor, rest });
    if (!track.samples.length) throw new StudioError('nothing-tracked', track.note ?? 'Nothing stands out from the ground in this region.', { region: ref.region });
    const motion = motionFrom(track);
    const cycles = findCycles(track);
    const source = { file: ref.rel, from: +got.from.toFixed(3), to: +got.to.toFixed(3), ...(ref.region ? { region: ref.region } : {}), fps: got.fps, restPixels: track.rest };
    const moved = Object.keys(motion.tracks).length > 0;
    const saved = saveAs && moved ? saveMotion(saveAs, motion, { note, source }) : null;
    // The crop at the key times: the check that the right thing was followed.
    const keyTimes = [...new Set(Object.values(motion.tracks).flat().map(k => k.time))].sort((a, b) => a - b);
    const shown = (keyTimes.length ? keyTimes : [0, motion.duration]).slice(0, 12);
    const strip = filmstrip(shown.map(t => frames[Math.min(frames.length - 1, Math.round(t * got.fps))]), { columns: Math.min(6, shown.length), gap: 4, background: STRIP_GROUND });
    return { image: png(strip),
      meta: { ...source, frames: frames.length, ...(ref.fromOwner ? { markedByOwner: true } : {}), confidence: track.confidence, ...(track.note ? { warning: track.note } : {}),
        ...(cycles && cycles.repeats > 1 ? { repeats: { ...cycles, starts: cycles.starts.map(t => +(got.from + t).toFixed(3)),
          hint: `The same move repeats every ${cycles.period} s. Measure ONE cycle: from ${+(got.from + cycles.starts[0]).toFixed(3)} to ${+(got.from + cycles.starts[0] + cycles.period).toFixed(3)} with rest:"first".` } } : {}),
        motion, reading: interpretMotion(motion, { brief: briefFor(project.dir, clip), clip }), shownAt: shown, ...(saved ? { saved } : {}),
        next: !moved ? 'Nothing moved in this range. Check the range and the region with see_reference.'
          : track.confidence < 0.5 ? 'Do not use this yet: fix the region first (see `warning`), then measure again.'
            : 'apply_motion { motion: <this `motion` or the saved name>, bone, animation } writes it onto the rig; compare_reference { animation, bone } then proves the copy.' } };
  },
};

// The brief that plans `clip` (or the project's only brief), for re-staging a reference.
function briefFor(dir, clip) {
  const briefs = Object.values(readBriefs(dir));
  return briefs.find(b => b.clips?.some(c => c.name === clip)) ?? (briefs.length === 1 ? briefs[0] : null);
}

// A copy of the skeleton in which only the art carried by `bone` (and its children) is visible,
// in setup and in `animation`. The way to look at, or measure, one element of a rig.
function isolate(sk, animation, bone) {
  const out = structuredClone(sk);
  const bones = new Map((out.bones ?? []).map(b => [b.name, b]));
  const under = name => { for (let b = bones.get(name); b; b = bones.get(b.parent)) if (b.name === bone) return true; return false; };
  out.animations = { ...(out.animations ?? {}) };
  if (!out.animations[animation]) out.animations[animation] = {};
  const clip = out.animations[animation] = structuredClone(out.animations[animation]);
  for (const slot of out.slots ?? []) {
    if (under(slot.bone)) continue;
    slot.color = `${(slot.color ?? 'ffffffff').slice(0, 6)}00`;
    if (clip.slots) delete clip.slots[slot.name];
  }
  return out;
}

const GROUND = { r: 0.09, g: 0.08, b: 0.12, a: 1 };

// What the eye sees of the art under a bone at rest, in rig units, and where the bone sits in
// it. Measured from a render, so transparent padding in the images does not count.
async function visibleBox(sk, atlas, pages, bone) {
  const REST = '__rest_pose__', SIZE = 320;
  const alone = isolate(sk, REST, bone);
  const { frames, viewport, scale } = await renderFrames({ json: alone, atlasText: atlas.text, pages, animation: REST, times: [0], width: SIZE, height: SIZE, margin: 0.12, background: GROUND });
  if (!viewport) return null;
  const image = frames[0].image;
  const seen = measureFrame(image, backgroundOf([image]), 18);
  if (!seen) return null;
  const cx = viewport.x + viewport.width / 2, cy = viewport.y + viewport.height / 2;
  const worldX = px => cx + (px - SIZE / 2) / scale, worldY = py => cy - (py - SIZE / 2) / scale;
  const pose = await poseSetup(await parseSkeleton(sk));
  const at = pose.bones.find(b => b.name === bone);
  return { left: worldX(seen.x0), right: worldX(seen.x1), top: worldY(seen.y0), bottom: worldY(seen.y1), height: +((seen.y1 - seen.y0) / scale).toFixed(2), boneX: at.worldX, boneY: at.worldY };
}

const hex = v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');

/**
 * A motion as a Spine clip fragment for one bone (and the fade for one slot). Pure.
 * `pivot` is where the bone sits relative to the motion's anchor, as fractions of the element's
 * height ({ x, y }, y up). A scale about the bone moves the anchor by pivot * (scale - 1); the
 * travel written here takes that back out, so the element behaves as measured wherever its bone is.
 */
export function clipFromMotion(motion, { bone, slot, height, at = 0, speed = 1, amount = 1, pivot = { x: 0, y: 0 } }) {
  const time = t => +(at + t / speed).toFixed(4);
  // a fitted curve goes out as its shape (four normalized handles); otherwise the preset by name
  const curve = key => (key.curve ? { curve: { handles: key.curve } } : key.ease && key.ease !== 'linear' ? { curve: key.ease } : {});
  const timelines = {};
  const { scale, translate, rotate, alpha } = motion.tracks ?? {};
  if (scale) timelines.scale = scale.map(k => ({ time: time(k.time), x: +(1 + (k.x - 1) * amount).toFixed(4), y: +(1 + (k.y - 1) * amount).toFixed(4), ...curve(k) }));
  const offPivot = scale && (Math.abs(pivot.x) > 0.02 || Math.abs(pivot.y) > 0.02);
  // Off the anchor, the travel the bone needs is a new curve (measured travel plus what the
  // scale would otherwise drag along): play the motion back, correct every sample, key it again.
  const travel = !offPivot ? translate : fitKeys(reconstruct(motion, motion.fps ?? 30).map(s => ({ time: s.time, tx: s.tx + pivot.x * (s.sx - 1), ty: s.ty + pivot.y * (s.sy - 1) })), ['tx', 'ty'], 0.012, motion.fps ?? 30);
  if (travel) timelines.translate = travel.map(k => ({ time: time(k.time), x: +(k.x * height * amount).toFixed(2), y: +(k.y * height * amount).toFixed(2), ...curve(k) }));
  if (rotate) timelines.rotate = rotate.map(k => ({ time: time(k.time), value: +(k.value * amount).toFixed(2), ...curve(k) }));
  const clip = { bones: { [bone]: timelines } };
  if (alpha && slot) clip.slots = { [slot]: { rgba: alpha.map(k => ({ time: time(k.time), color: `ffffff${hex(k.value)}`, ...curve(k) })) } };
  return clip;
}

export const applyMotionTool = {
  name: 'apply_motion',
  tier: 'core',
  writes: true,
  summary: 'Plays a measured or saved motion on a bone of the rig and writes the delivery; with no motion it lists the library of learned motions.',
  description: 'Turns a motion (the `motion` object measure_reference returned, or the name of one saved in the library) into keys on `bone` and writes them through the same proven path as write_animation: the base is never written. Scale keys go on as measured; travel is multiplied by the element\'s VISIBLE height in rig units (measured from a render of the art under the bone, so transparent padding does not count; `height` overrides it); a fade goes to `slot` when one is named. The bone may sit anywhere in its art: when it is not at the motion\'s anchor, the travel is adjusted so the element still squashes and lands as measured, and the result says so. `amount` scales how far everything departs from rest (1 = as measured, 0.6 = gentler, 1.3 = punchier); `speed` plays it faster or slower; `at` places it later in the clip. Other bones and timelines of the same animation are kept, so several motions can be laid on different bones of one clip, one call each. Called with no `motion`, it writes nothing and returns the library: name, duration, channels and note of every learned motion.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      motion: { short: 'library name, or the motion object from measure_reference', description: 'A saved motion\'s name, or the `motion` object measure_reference returned. Omit to list the library.' },
      animation: { type: 'string', description: 'Name of the animation to write into.' },
      bone: { type: 'string', description: 'The bone that carries the element; it should sit at the motion\'s anchor.' },
      slot: { type: 'string', short: 'slot that takes the fade', description: 'Slot to key the measured fade on (optional).' },
      height: { type: 'number', minimum: 0.001, short: 'element height in rig units', description: 'Height of the element in rig units, the scale for travel. Default: measured from the art under the bone.' },
      amount: { type: 'number', minimum: 0, maximum: 4, short: 'how strongly (default 1)', description: 'Multiplier on every departure from rest (0-4, default 1).' },
      speed: { type: 'number', minimum: 0.1, maximum: 10, short: 'playback speed (default 1)', description: 'Faster (>1) or slower (<1) than measured.' },
      at: { type: 'number', minimum: 0, short: 'start time in the clip (default 0)', description: 'Seconds into the animation where the motion starts.' },
      from: { type: 'string', short: 'base skeleton; empty = the folder base', description: 'Project-relative base skeleton; empty picks the folder\'s base. Never written.' },
      into: { type: 'string', short: 'delivery file; empty = <base>_v2.json', description: 'Project-relative delivery file; empty means <base>_v2.json.' },
      replace: { type: 'boolean', short: 'rebuild this clip from the base first', description: 'Default false: other timelines of this animation are kept.' },
    },
  },
  async run({ motion, animation, bone, slot, height, amount = 1, speed = 1, at = 0, from, into, replace = false }, { session }) {
    const project = projectOf(session);
    if (motion === undefined) return { library: listMotions(), next: 'Pass one of these names as `motion`, with `animation` and `bone`.' };
    if (!animation || !bone) throw new StudioError('bad-arguments', 'apply_motion needs `animation` and `bone` (and a `motion`).');
    const record = typeof motion === 'string' ? readMotion(motion) : motion;
    if (!record?.tracks || !Object.keys(record.tracks).length) throw new StudioError('empty-motion', 'This motion has no tracks: nothing moved when it was measured.');
    const { sk } = project.skeleton(from);
    if (!(sk.bones ?? []).some(b => b.name === bone)) throw new StudioError('unknown-bone', `No bone named "${bone}".`, { bone, available: (sk.bones ?? []).map(b => b.name) });
    if (slot && !(sk.slots ?? []).some(s => s.name === slot)) throw new StudioError('unknown-slot', `No slot named "${slot}".`, { slot, available: (sk.slots ?? []).map(s => s.name) });
    // What is visible under the bone, and where the bone sits in it: the scale for travel, and
    // the correction when the bone is not at the motion's anchor.
    const { abs } = project.skeleton(from);
    const atlas = project.atlasFor(abs);
    let box = null;
    if (atlas) { try { box = await visibleBox(sk, atlas, project.pagesFor(atlas, (await readAtlas(atlas.text)).pages.map(p => p.name)), bone); } catch { box = null; } }
    const used = height ?? box?.height;
    if (!used) throw new StudioError('no-height', `The visible height of the art under "${bone}" could not be measured (no atlas, or nothing is drawn there at rest). Pass \`height\` in rig units.`, { bone });
    const anchor = record.anchor ?? 'bottom';
    const anchorY = box ? (anchor === 'top' ? box.top : anchor === 'center' ? (box.top + box.bottom) / 2 : box.bottom) : null;
    const pivot = box ? { x: +((box.boneX - (box.left + box.right) / 2) / box.height).toFixed(3), y: +((box.boneY - anchorY) / box.height).toFixed(3) } : { x: 0, y: 0 };
    const clip = clipFromMotion(record, { bone, slot, height: used, at, speed, amount, pivot });
    const written = await writeDelivery({ projectDir: project.dir, from, into, name: animation, animation: clip, replace });
    return { file: written.file, animation, bone, ...(slot ? { slot } : {}), motion: record.name ?? '(inline)', duration: +(at + record.duration / speed).toFixed(4),
      channels: Object.keys(clip.bones[bone]), height: used, heightFrom: height ? 'argument' : 'the visible art under the bone', amount, speed,
      anchor, bonePivot: pivot, ...(Math.abs(pivot.x) > 0.02 || Math.abs(pivot.y) > 0.02 ? { corrected: `The bone does not sit at the motion's ${anchor}; the travel was adjusted so the element still moves as measured.` } : {}),
      ...(record.tracks.alpha && !slot ? { note: 'The motion also fades; name a `slot` to carry it.' } : {}), warnings: written.warnings ?? [],
      next: `compare_reference { animation: "${animation}", bone: "${bone}", anchor: "${anchor}" } shows the reference and this element side by side with the gap in numbers.` };
  },
};

export const compareReferenceTool = {
  name: 'compare_reference',
  tier: 'core',
  writes: false,
  summary: 'Proves a copy: the reference and the animation side by side at the same instants, plus how far their measured motion is apart, channel by channel.',
  description: 'Takes the same range and region of the reference that was measured, renders `animation` of the delivery at the same instants (starting at `at` seconds into the animation), and measures BOTH the same way. Returns one PNG (top row: the reference; bottom row: the rig) and, for scale, travel, turn and fade, the largest and the typical (rms) gap between them, as fractions of the element\'s size, with the time of the largest gap. `lagFrames` says the result is early (negative) or late (positive) by that many frames when shifting would fit better. `verdict` is "matches" when every gap is small (size and travel: rms under 0.03 and max under 0.08; fade: 0.08 and 0.2; turn: 3 and 8 degrees), else "differs" with the channels to fix. The art need not look alike; it is the motion that is compared. Pass `bone` to show and measure only the element the motion was applied to; without it the whole skeleton is compared. Needs ffmpeg.',
  inputSchema: {
    type: 'object', required: ['animation'], additionalProperties: false,
    properties: { ...RANGE,
      skeleton: { type: 'string', short: 'delivery to check; empty = the folder\'s delivery or base', description: 'Project-relative skeleton whose animation is compared.' },
      animation: { type: 'string', description: 'Animation to compare with the reference.' },
      bone: { type: 'string', short: 'compare only the art under this bone', description: 'Show and measure only the art carried by this bone and its children (the element the motion was applied to). Without it the whole skeleton is compared.' },
      at: { type: 'number', minimum: 0, short: 'start time in the animation (default 0)', description: 'Seconds into the animation that correspond to the start of the reference range.' },
      anchor: { type: 'string', enum: ['bottom', 'center', 'top'], short: 'as in measure_reference (default bottom)', description: 'The anchor used when the motion was measured.' },
      rest: { type: 'string', enum: ['auto', 'first', 'last'], short: 'as in measure_reference (default auto)', description: 'The rest state used when the motion was measured.' },
      columns: { type: 'integer', minimum: 2, maximum: 10, short: 'instants shown (default 6)', description: 'How many instants the picture shows (2-10, default 6).' },
    },
  },
  async run({ skeleton, animation, bone, at = 0, anchor = 'bottom', rest = 'auto', columns = 6, ...where }, { session }) {
    const project = projectOf(session);
    const ref = pick(project, where);
    let file = skeleton;
    if (!file) { const all = project.list(); file = (all.find(s => /_v\d+\.json$/i.test(s.file)) ?? all[0])?.file; }
    const { sk, rel, abs } = project.skeleton(file);
    if (!sk.animations?.[animation]) throw new StudioError('unknown-animation', `No animation named "${animation}" in ${rel}.`, { animation, available: Object.keys(sk.animations ?? {}) });
    const atlas = project.atlasFor(abs);
    if (!atlas) throw new StudioError('no-atlas', `${rel} has no paired .atlas beside it, so there is nothing to draw with.`, { file: rel });
    const pages = project.pagesFor(atlas, (await readAtlas(atlas.text)).pages.map(p => p.name));

    const got = await analysisFrames(ref.abs, { from: ref.from, to: ref.to, region: ref.region });
    const refFrames = got.frames.map(f => decodePng(new Uint8Array(f)));
    const times = refFrames.map((_, i) => +(at + i / got.fps).toFixed(4));
    const { width, height } = refFrames[0];
    if (bone && !(sk.bones ?? []).some(b => b.name === bone)) throw new StudioError('unknown-bone', `No bone named "${bone}".`, { bone, available: (sk.bones ?? []).map(b => b.name) });
    const { frames: own } = await renderFrames({ json: bone ? isolate(sk, animation, bone) : sk, atlasText: atlas.text, pages, animation, times, width, height, margin: 0.22, background: GROUND });
    const ownFrames = own.map(f => f.image);
    const a = trackFrames(refFrames, { fps: got.fps, anchor, rest });
    const b = trackFrames(ownFrames, { fps: got.fps, anchor, rest });
    if (!a.samples.length || !b.samples.length) throw new StudioError('nothing-tracked', 'One side shows nothing that stands out from its ground; check the region and the animation.', { reference: a.samples.length, result: b.samples.length });
    const cmp = compareTracks(a, b);
    // When, per channel, the two are furthest apart.
    const field = { scaleX: 'sx', scaleY: 'sy', translateX: 'tx', translateY: 'ty', rotate: 'rot', alpha: 'alpha' };
    const turning = a.rotates && b.rotates;
    const channels = {};
    for (const [name, gap] of Object.entries(cmp.channels)) {
      if (name === 'rotate' && !turning) continue;
      let worst = 0, when = 0;
      for (let i = 0; i < cmp.frames; i++) { const d = Math.abs(a.samples[i][field[name]] - b.samples[i][field[name]]); if (d > worst) { worst = d; when = a.samples[i].time; } }
      channels[name] = { ...gap, worstAt: when, reference: a.samples[Math.round(when * got.fps)]?.[field[name]], result: b.samples[Math.round(when * got.fps)]?.[field[name]] };
    }
    // Size and travel are measured finely; brightness is a rough reading, so it gets more room.
    const LIMIT = { rotate: [3, 8], alpha: [0.08, 0.2] };
    const off = Object.entries(channels).filter(([name, g]) => { const [rms, max] = LIMIT[name] ?? [0.03, 0.08]; return g.rms > rms || g.max > max; }).map(([name]) => name);
    const n = Math.min(columns, refFrames.length);
    const picks = Array.from({ length: n }, (_, i) => Math.round(i * (refFrames.length - 1) / (n - 1)));
    const strip = filmstrip([...picks.map(i => refFrames[i]), ...picks.map(i => ownFrames[i])], { columns: n, gap: 4, background: STRIP_GROUND });
    return { image: png(strip),
      meta: { reference: ref.rel, range: [+got.from.toFixed(3), +got.to.toFixed(3)], skeleton: rel, animation, ...(bone ? { bone } : {}), at, fps: got.fps, frames: cmp.frames,
        verdict: off.length ? 'differs' : 'matches', ...(off.length ? { fix: off } : {}), lagFrames: cmp.lagFrames, channels,
        confidence: { reference: a.confidence, result: b.confidence }, shownAt: picks.map(i => +(i / got.fps).toFixed(3)),
        note: 'Top row: the reference. Bottom row: the rig at the same instants. Gaps are fractions of the element\'s size (rotate in degrees).' } };
  },
};
