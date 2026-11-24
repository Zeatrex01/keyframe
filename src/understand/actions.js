// What a senior animator checks first for each kind of action: the minimums below which a clip is
// valid but does not read as what it is called. A punch with no weight behind it, a jump that only
// hops, a hop that floats into the ground, a wave that never rises to the face, an idle that
// does not breathe.
//
// The action comes from the clip's name (punch, jump, hop, wave, walk, idle...) or from the brief.
// Body parts come from bone names (hips, body, torso, chest: the core; hand, wrist, fist; head).
// Everything is measured on the posed skeleton in world space, against the rig's own height, so
// the numbers hold for any size. Pure and isomorphic.

import { compileSkeleton, sample } from '../engine/index.js';

const CORE = /(^|[_\-. ])?(hips?|pelvis|body|torso|waist|spine|chest|trunk|belly)($|[_\-. \dLR])/i;
const HAND = /hand|wrist|fist|palm|paw/i;
const ARM = /arm|elbow|shoulder/i;
const HEAD = /^head$|(^|[_\-. ])head($|[_\-. ])/i;
const LEG = /leg|thigh|shin|knee|foot|feet|toe/i;
const FPS = 60;

export const ACTIONS = Object.freeze({
  strike: /punch|strike|attack|slash|kick|\bhit(?! ?react)|jab|swing|smash/,
  jump: /jump|leap/,
  hop: /\bhop|bounc/,
  wave: /wave|hello|greet|bye/,
  locomotion: /walk|run|jog|march|sneak/,
  idle: /idle|breath|stand|wait/,
});

/** The kind of action a clip is, from its name (or the brief's word for it); null when none applies. */
export function actionOf(name, hint) {
  const text = `${hint ?? ''} ${String(name ?? '')}`.toLowerCase().replace(/[_\-.]+/g, ' ');
  for (const [kind, re] of Object.entries(ACTIONS)) if (re.test(text)) return kind;
  return null;
}

const range = values => (values.length ? Math.max(...values) - Math.min(...values) : 0);
const r2 = v => Math.round(v * 100) / 100;

/**
 * The action minimums of one clip.
 * @param {object} sk  skeleton JSON
 * @param {string} name  the clip
 * @param {{ action?: string }} [options]  the action, when the name does not say it
 * @returns {Array<{ severity: 'weak' | 'look', code: string, message: string, measure: object, fix: string, principle: string }>}
 */
export function actionFindings(sk, name, { action } = {}) {
  const kind = action && ACTIONS[action] ? action : actionOf(name, action);
  const clip = sk?.animations?.[name];
  if (!kind || !clip) return [];
  let model;
  try { model = compileSkeleton(sk); } catch { return []; }
  const anim = model.animations.get(name);
  if (!anim || !(anim.duration > 0)) return [];
  const names = sk.bones.map(b => b.name);
  const core = names.filter(n => CORE.test(n));
  const hands = names.filter(n => HAND.test(n));
  const arms = names.filter(n => ARM.test(n) && !HAND.test(n));
  const head = names.find(n => HEAD.test(n));
  const legs = names.filter(n => LEG.test(n));
  const isFigure = core.length > 0 && (hands.length + arms.length + legs.length) > 0;

  const count = Math.max(2, Math.min(600, Math.round(anim.duration * FPS) + 1));
  const times = Array.from({ length: count }, (_, i) => Math.min(anim.duration, i / FPS));
  const frames = sample(model, name, times);
  const setup = sample(model, name, [0])[0];
  const at = (frame, bone) => frame.bones.find(b => b.name === bone);
  const ys = setup.bones.map(b => b.worldY), xs = setup.bones.map(b => b.worldX);
  const H = Math.max(1, Number(sk.skeleton?.height) > 0 ? Number(sk.skeleton.height) : range(ys) || range(xs));
  const track = bone => frames.map(f => at(f, bone)).filter(Boolean);
  const out = [];
  const add = (severity, code, message, measure, fix, principle) => out.push({ severity, code, message, measure, fix, principle });
  // The body's lead bone: the first core bone (closest to the root) carries the weight.
  const lead = core[0] ?? names.find(n => n !== 'root' && sk.bones.find(b => b.name === n)?.parent === 'root') ?? names[0];
  const leadTrack = track(lead);
  const leadY = leadTrack.map(b => b.worldY), leadX = leadTrack.map(b => b.worldX), leadRot = leadTrack.map(b => b.worldRotation);

  if (kind === 'strike' && isFigure) {
    const shift = Math.max(range(leadX), range(leadY)) / H, turn = range(leadRot);
    if (shift < 0.04 && turn < 8) add('weak', 'no-weight-shift', `"${name}" is a strike, but the body behind it barely moves (${r2(shift * 100)}% of the height, ${r2(turn)} degrees): it is an arm move, not a blow.`,
      { shift: r2(shift), turnDegrees: r2(turn), lead }, `Drive it from the core: shift ${lead} toward the target by 5-10% of the height and turn it 10-25 degrees into the strike, then let the arm follow 1-3 frames later.`, 'weight and follow-through');
    // The striking limb: the hand that travels fastest.
    const limb = (hands.length ? hands : arms).map(b => ({ b, t: track(b) })).map(({ b, t }) => {
      let best = 0, at = 0;
      for (let i = 1; i < t.length; i++) { const v = Math.hypot(t[i].worldX - t[i - 1].worldX, t[i].worldY - t[i - 1].worldY); if (v > best) { best = v; at = i; } }
      return { b, t, best, at };
    }).sort((p, q) => q.best - p.best)[0];
    if (limb && limb.best > 0) {
      const t = limb.t, peak = limb.at;
      // The strike's direction: from the rest pose to the farthest point the limb reaches.
      const far = t.reduce((m, b, i) => (Math.hypot(b.worldX - t[0].worldX, b.worldY - t[0].worldY) > Math.hypot(t[m].worldX - t[0].worldX, t[m].worldY - t[0].worldY) ? i : m), 0);
      const dir = [t[far].worldX - t[0].worldX, t[far].worldY - t[0].worldY];
      const len = Math.hypot(...dir) || 1;
      const along = i => ((t[i].worldX - t[0].worldX) * dir[0] + (t[i].worldY - t[0].worldY) * dir[1]) / len;
      const reach = Math.max(...t.map((_, i) => along(i)));
      const back = -Math.min(...t.slice(0, peak).map((_, i) => along(i)));
      if (reach > 0 && back < reach * 0.05) add('look', 'no-wind-up', `${limb.b} strikes without pulling back first (${r2(back / Math.max(reach, 1e-6) * 100)}% of the reach).`,
        { limb: limb.b, windUp: r2(back), reach: r2(reach) }, 'Pull the limb (and the shoulder) back 10-25% of the strike before it, over 2-4 frames, so the blow reads.', 'anticipation');
      // How long the main travel takes: from the wind-up extreme to 90% of the reach.
      let start = 0, end = t.length - 1;
      for (let i = 0; i <= peak; i++) if (along(i) <= along(start)) start = i;
      for (let i = peak; i < t.length; i++) if (along(i) >= reach * 0.9) { end = i; break; }
      const travel = (end - start) / FPS;
      if (travel > 0.18) add('look', 'slow-strike', `the strike itself takes ${r2(travel)} s: a blow lands in 2-6 frames (0.05-0.15 s).`,
        { seconds: r2(travel) }, 'Make the travel from the wind-up to the hit 2-6 frames, and spend the time on the wind-up and the recovery instead.', 'timing');
      const after = t.slice(end).map((_, i) => along(end + i));
      const holds = after.filter(v => Math.abs(v - reach) <= reach * 0.06).length;
      if (holds < 3) add('look', 'no-impact', 'the strike does not stop at the hit: no frames held at full reach, so there is no impact.',
        { framesAtReach: holds }, 'Hold the extended pose 2-4 frames (or overshoot 5-10% and settle) and key an event there, then recover.', 'timing');
    }
  }

  if (kind === 'jump' || kind === 'hop') {
    const base = leadY[0];
    const rise = Math.max(...leadY) - base;
    // The crouch can sit on any core bone (the hips dip while the body bone carries the jump).
    const apex = Math.max(1, leadY.indexOf(Math.max(...leadY)));
    const dip = Math.max(0, ...(core.length ? core : [lead]).map(b => { const y = track(b).map(x => x.worldY); return y[0] - Math.min(...y.slice(0, apex)); }));
    if (kind === 'jump' && rise / H < 0.25) add('weak', 'low-jump', `the jump rises ${r2(rise / H * 100)}% of the body's height: it reads as a hop.`,
      { rise: r2(rise), height: r2(H) }, `Lift ${lead} at least a quarter of the height (half for a big jump), and stretch on the way up.`, 'exaggeration');
    if (kind === 'jump' && isFigure && dip / H < 0.03) add('look', 'no-crouch', 'nothing crouches before the take-off.',
      { crouch: r2(dip / H) }, 'Crouch 5-10% of the height over 3-6 frames before leaving the ground.', 'anticipation');
    // Floating: a body in the air falls faster and faster; if it slows into the ground, it floats.
    const v = leadY.map((y, i) => (i ? y - leadY[i - 1] : 0));
    const landings = [];
    for (let i = 2; i < leadY.length; i++) {
      // A landing: the end of a descent (going down, then not).
      if (v[i - 1] < 0 && v[i] >= 0 && base - leadY[i - 1] < rise * 0.25) {
        let s = i - 1;
        while (s > 0 && v[s] < 0) s--;
        const fall = v.slice(s + 1, i).map(Math.abs);
        if (fall.length >= 4) {
          const last = fall.slice(-Math.max(1, Math.round(fall.length * 0.2)));
          const mean = fall.reduce((a, b) => a + b, 0) / fall.length;
          landings.push((last.reduce((a, b) => a + b, 0) / last.length) / Math.max(mean, 1e-9));
        }
      }
    }
    if (rise / H > 0.02 && landings.length && landings.every(k => k < 0.9)) add('weak', 'floaty-landing', `the body slows down as it reaches the ground (${landings.map(k => `${Math.round(k * 100)}%`).join(', ')} of its mean fall speed in the last frames): it floats instead of falling.`,
      { landingSpeed: landings.map(r2) }, 'Fall with an ease-in (inQuad or inCubic: fastest at the ground), rise with an ease-out (slowest at the apex). Never the same ease on the way up and down; squash on the contact frame.', 'slow in and slow out');
  }

  if (kind === 'wave' && hands.length && head) {
    const headBone = sk.bones.find(b => b.name === head);
    // A wave is read at the face: the hand (its tip, not its wrist) rises to the eyes or higher, out
    // to the side, where the face does not hide it. Below the eyes it reads as a salute.
    const eyes = Math.max(...track(head).map(b => b.worldY)) + Math.max(Number(headBone?.length) || 0, H * 0.08) * 0.5;
    const lengthOf = h => Number(sk.bones.find(b => b.name === h)?.length) || 0;
    const best = hands.map(h => ({ h, y: Math.max(...track(h).map(b => b.worldY + lengthOf(h) * Math.sin(b.worldRotation * Math.PI / 180))), rot: track(h).map(b => b.worldRotation) })).sort((a, b) => b.y - a.y)[0];
    if (best.y < eyes) add('weak', 'low-wave', `${best.h} never rises to the face (its tip peaks ${r2((eyes - best.y) / H * 100)}% of the height below the eyes): it reads as a salute.`,
      { hand: best.h, below: r2(eyes - best.y) }, 'Raise the upper arm 100-160 degrees, out to the side, so the hand is up beside the face or above it, then swing the forearm and hand.', 'staging');
    const forearm = arms.length ? arms.map(a => track(a).map(b => b.worldRotation)) : [best.rot];
    const swings = forearm.map(r => { let turns = 0, dir = 0; for (let i = 1; i < r.length; i++) { const d = Math.sign(r[i] - r[i - 1]); if (d && dir && d !== dir) turns++; if (d) dir = d; } return { turns, amp: range(r) }; });
    if (!swings.some(s => s.turns >= 2 && s.amp >= 12)) add('look', 'no-wave-swing', 'the hand does not swing back and forth: a wave is at least two swings of 15-30 degrees.',
      { swings }, 'Key two or three swings of the forearm and hand, the hand 1-2 frames behind the forearm.', 'overlap and follow-through');
  }

  if (kind === 'idle' && isFigure) {
    const moved = core.map(b => { const t = track(b); return Math.max(range(t.map(x => x.worldY)), range(t.map(x => x.worldX))) / H + range(t.map(x => x.worldScaleY)) + range(t.map(x => x.worldRotation)) / 100; });
    if (Math.max(...moved, 0) < 0.004) add('weak', 'no-breath', 'the body does not breathe: nothing in the core moves in the idle.',
      { core }, 'Breathe from the chest: scale or lift it 1-3% over 1.5-3 s, the neck and head following 2-3 frames later.', 'secondary action');
  }

  if (kind === 'locomotion' && isFigure) {
    // The bob can sit on any core bone: the one that rises and falls the most.
    const ys = (core.length ? core : [lead]).map(b => track(b).map(x => x.worldY)).sort((a, b) => range(b) - range(a))[0];
    let extremes = 0;
    for (let i = 1; i + 1 < ys.length; i++) if ((ys[i] - ys[i - 1]) * (ys[i + 1] - ys[i]) < 0) extremes++;
    if (range(ys) / H < 0.01 || extremes < 3) add('look', 'no-bob', 'the body does not rise and fall with the steps.',
      { bob: r2(range(ys) / H), extremes }, 'Drop the hips on each contact and rise on each passing pose: two bobs per cycle, 2-4% of the height.', 'weight');
  }
  return out;
}

const FOOT = /foot|feet|toe/i;

/**
 * Feet that slide: a foot on the ground (at its lowest, give or take 2% of the height) that moves
 * along it while it stands there. Walks and runs in place move their feet along the ground on
 * purpose and are not judged.
 * @param {object} sk  skeleton JSON
 * @param {string} name  the clip
 * @param {{ action?: string }} [options]
 * @returns {Array<{ foot: string, slide: number, from: number, to: number }>}  slide in units
 */
export function footSlides(sk, name, { action } = {}) {
  if ((action && ACTIONS[action] ? action : actionOf(name, action)) === 'locomotion') return [];
  let model;
  try { model = compileSkeleton(sk); } catch { return []; }
  const anim = model.animations.get(name);
  if (!anim || !(anim.duration > 0)) return [];
  const feet = sk.bones.map(b => b.name).filter(n => FOOT.test(n) && !/target|ik/i.test(n));
  if (!feet.length) return [];
  const count = Math.max(2, Math.min(600, Math.round(anim.duration * FPS) + 1));
  const times = Array.from({ length: count }, (_, i) => Math.min(anim.duration, i / FPS));
  const frames = sample(model, name, times);
  const setup = sample(model, name, [0])[0];
  const H = Math.max(1, Number(sk.skeleton?.height) > 0 ? Number(sk.skeleton.height) : range(setup.bones.map(b => b.worldY)));
  const out = [];
  for (const foot of feet) {
    const track = frames.map(f => f.bones.find(b => b.name === foot)).filter(Boolean);
    if (track.length < 3) continue;
    const ground = Math.min(...track.map(b => b.worldY)), tol = Math.max(1.5, H * 0.02);
    let worst = null;
    for (let i = 0; i < track.length;) {
      if (track[i].worldY > ground + tol) { i++; continue; }
      let j = i;
      while (j + 1 < track.length && track[j + 1].worldY <= ground + tol) j++;
      const xs = track.slice(i, j + 1).map(b => b.worldX), slide = range(xs);
      if (j - i >= 2 && (!worst || slide > worst.slide)) worst = { foot, slide: r2(slide), from: r2(times[i]), to: r2(times[j]) };
      i = j + 1;
    }
    if (worst && worst.slide > Math.max(2, H * 0.03)) out.push(worst);
  }
  return out;
}
