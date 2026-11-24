// What a skeleton is and what each clip is for: the classification an agent confirms before it
// writes motion, and the preset that then tunes critique_animation to the subject.
//
// The studio proposes from evidence it can read (bone and slot names, hierarchy depth, blend
// modes, clip names); the agent confirms or corrects it in the brief (.keyframe/brief.json).
// Pure and isomorphic.

import { CLIP_TIMING } from './principles.js';

export const SUBJECTS = Object.freeze(['character', 'creature', 'prop', 'ui', 'vfx', 'scene']);
export const INTENTS = Object.freeze(['idle', 'loop', 'action', 'reaction', 'transition', 'reward']);

const WORDS = {
  character: /\b(head|torso|chest|hips?|pelvis|arm|forearm|leg|thigh|shin|hand|foot|feet|neck|eye|brow|mouth|spine|shoulder|hair|face)\b/,
  creature: /\b(tail|wing|paw|ear|fin|snout|whiskers?|beak|claw|horn|muzzle)\b/,
  prop: /\b(lid|door|box|chest|sword|flag|wheel|lever|crate|gem|key|lock|bottle|lamp|sign|coin)\b/,
  ui: /\b(button|btn|icon|panel|label|badge|bar|frame|popup|menu|ui|tab|card|title|banner|progress|slider|toggle)\b/,
  vfx: /\b(spark|sparkle|glow|flash|particle|burst|star|ray|beam|smoke|trail|shine|fx|confetti|halo|ring|dust|shard)\b/,
  scene: /\b(camera|cam|bg|background|layer|parallax|sky|ground|cloud|fore(ground)?|mid(ground)?)\b/,
};

/** Names split into words: "armL_upper" -> "arm l upper". */
const words = name => String(name).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.\d]+/g, ' ').toLowerCase();

function depthOf(bones) {
  const parent = new Map(bones.map(b => [b.name, b.parent]));
  let max = 0;
  for (const b of bones) { let d = 0, p = b.parent; while (p && d < 64) { d++; p = parent.get(p); } max = Math.max(max, d); }
  return max;
}

/**
 * The studio's proposal of what a skeleton is.
 * @param {object} sk  skeleton JSON
 * @returns {{ subject: string, confidence: number, evidence: string[], scores: Record<string, number> }}
 */
export function classifySubject(sk) {
  const bones = sk?.bones ?? [];
  const names = [...bones.map(b => b.name), ...(sk?.slots ?? []).map(s => s.name)];
  const scores = Object.fromEntries(SUBJECTS.map(s => [s, 0]));
  const evidence = Object.fromEntries(SUBJECTS.map(s => [s, new Set()]));
  for (const name of names) {
    const text = ` ${words(name)} `;
    for (const subject of SUBJECTS) {
      const m = text.match(WORDS[subject]);
      if (m) { scores[subject] += 1; evidence[subject].add(m[1]); }
    }
  }
  const depth = depthOf(bones);
  const additive = (sk?.slots ?? []).filter(s => s.blend === 'additive').length;
  // Distinct body words weigh more than repeats, and a body needs a hierarchy to be one.
  scores.character = evidence.character.size * 2 + (depth >= 3 ? 2 : 0) - (depth < 2 ? 3 : 0);
  scores.creature = evidence.creature.size * 2 + (evidence.character.size >= 2 ? evidence.character.size : 0) - (evidence.character.has('hand') ? 2 : 0);
  scores.vfx += additive * 2 + (depth <= 2 && bones.length > 6 ? 1 : 0);
  scores.ui += evidence.ui.size;
  scores.prop += evidence.prop.size + (bones.length <= 8 ? 1 : 0);
  scores.scene += evidence.scene.size;
  const ranked = SUBJECTS.slice().sort((a, b) => scores[b] - scores[a]);
  const [first, second] = ranked;
  const total = Math.max(1, scores[first] + Math.max(0, scores[second]));
  const subject = scores[first] > 0 ? first : 'prop';
  return {
    subject,
    confidence: scores[first] > 0 ? Math.round(Math.max(0, scores[first]) / total * 100) / 100 : 0,
    evidence: [...evidence[subject]].slice(0, 8).concat(subject === 'vfx' && additive ? [`${additive} additive slots`] : [], depth ? [`hierarchy depth ${depth}`] : []),
    scores,
  };
}

/** @type {Array<[string, RegExp]>} */
const INTENT_WORDS = [
  ['idle', /idle|breath|stand|wait|rest/],
  ['loop', /loop|cycle|walk|run|spin|float|swim|fly|sway|wave|blink/],
  ['reward', /win|reward|victory|collect|burst|celebrat|open|unlock|level ?up/],
  ['transition', /(^|_|-|\b)(in|out|intro|outro|show|hide|appear|disappear|enter|exit)($|_|-|\b)|_in$|_out$/],
  ['reaction', /hit|hurt|react|surprise|angry|sad|happy|laugh|cry|shock|notice|scared|blush/],
  ['action', /attack|jump|press|tap|click|throw|shoot|kick|punch|swing|cast|dash/],
];

/** A clip's intent from its name; null when nothing matches. */
export function intentOf(clipName) {
  const name = words(clipName).trim();
  for (const [intent, re] of INTENT_WORDS) if (re.test(name)) return intent;
  return null;
}

/** Default looping by intent. */
export const LOOPS = Object.freeze({ idle: true, loop: true, action: false, reaction: false, transition: false, reward: false });

/**
 * How critique_animation reads a subject: the display height it is judged at and the checks that
 * do not apply to it (twinning on a symmetric UI badge is a design, not a fault).
 */
export const PRESETS = Object.freeze({
  character: { displayHeight: 360, skip: [], timing: ['idle breath loop', 'walk cycle', 'light attack', 'hit reaction', 'jump'] },
  creature: { displayHeight: 300, skip: [], timing: ['idle breath loop', 'run cycle', 'hit reaction', 'jump'] },
  prop: { displayHeight: 200, skip: ['twinning'], timing: ['reward chest', 'coin / item fly'] },
  ui: { displayHeight: 120, skip: ['twinning', 'no-overlap', 'no-anticipation'], timing: ['button press / release', 'popup in / out'] },
  vfx: { displayHeight: 160, skip: ['twinning', 'squash-volume', 'squash-on-parent', 'no-overlap', 'no-anticipation', 'no-hold'], timing: ['coin / item fly'] },
  scene: { displayHeight: 720, skip: ['twinning', 'squash-volume', 'no-anticipation'], timing: [] },
});

/** Height of the setup pose's bone positions, a stand-in for the art's size (skeleton units). */
export function skeletonHeight(sk) {
  const h = Number(sk?.skeleton?.height);
  return Number.isFinite(h) && h > 0 ? h : null;
}

/**
 * A proposed brief: subject, each clip's intent, timing and loop, the preset, the display size.
 * @param {object} sk @param {{ displayHeight?: number }} [options]
 */
export function proposeBrief(sk, { displayHeight } = {}) {
  const guess = classifySubject(sk);
  const preset = PRESETS[guess.subject];
  const height = displayHeight ?? preset.displayHeight;
  const units = skeletonHeight(sk);
  const clips = Object.keys(sk?.animations ?? {}).map(name => {
    const intent = intentOf(name);
    return { name, intent, loop: intent ? LOOPS[intent] : false };
  });
  return {
    subject: guess.subject, confidence: guess.confidence, evidence: guess.evidence,
    display: { height, pixelsPerUnit: units ? Math.round(height / units * 1000) / 1000 : 1 },
    clips,
    preset: { skip: preset.skip },
    timing: CLIP_TIMING.filter(c => preset.timing.includes(c.clip)),
    confirmed: false,
  };
}

/**
 * The options critique_animation takes from a brief for one clip.
 * @param {any} brief @param {string} clip
 */
export function critiqueOptions(brief, clip) {
  if (!brief || typeof brief !== 'object') return {};
  const entry = (brief.clips ?? []).find(c => c.name === clip);
  const preset = PRESETS[brief.subject];
  return {
    ...(typeof entry?.loop === 'boolean' ? { loop: entry.loop } : {}),
    ...(typeof brief.subject === 'string' ? { subject: brief.subject } : {}),
    ...(brief.display?.pixelsPerUnit > 0 ? { pixelsPerUnit: brief.display.pixelsPerUnit } : {}),
    skip: [...new Set([...(preset?.skip ?? []), ...(Array.isArray(brief.preset?.skip) ? brief.preset.skip : [])])],
  };
}

/** Check a brief an agent writes; returns the cleaned brief or a list of problems. */
export function validateBrief(input, sk) {
  const problems = [];
  if (!input || typeof input !== 'object') return { problems: ['A brief is an object.'] };
  if (!SUBJECTS.includes(input.subject)) problems.push(`subject must be one of ${SUBJECTS.join(', ')}.`);
  const clipNames = new Set(Object.keys(sk?.animations ?? {}));
  const clips = Array.isArray(input.clips) ? input.clips : [];
  for (const c of clips) {
    if (typeof c?.name !== 'string' || !c.name) { problems.push('Every clip in a brief has a name.'); continue; }
    if (c.intent !== undefined && c.intent !== null && !INTENTS.includes(c.intent)) problems.push(`${c.name}: intent must be one of ${INTENTS.join(', ')}.`);
    if (c.seconds !== undefined && !(c.seconds > 0 && c.seconds <= 600)) problems.push(`${c.name}: seconds must be between 0 and 600.`);
    if (c.loop !== undefined && typeof c.loop !== 'boolean') problems.push(`${c.name}: loop is true or false.`);
  }
  const height = input.display?.height;
  if (height !== undefined && !(height >= 8 && height <= 8192)) problems.push('display.height is the size the art is shown at, 8 to 8192 px.');
  if (problems.length) return { problems };
  const units = skeletonHeight(sk);
  const displayHeight = height ?? PRESETS[input.subject].displayHeight;
  return {
    brief: {
      subject: input.subject,
      ...(typeof input.note === 'string' ? { note: input.note.slice(0, 500) } : {}),
      display: { height: displayHeight, pixelsPerUnit: input.display?.pixelsPerUnit > 0 ? input.display.pixelsPerUnit : (units ? Math.round(displayHeight / units * 1000) / 1000 : 1) },
      clips: clips.map(c => ({ name: c.name, intent: c.intent ?? intentOf(c.name), ...(c.seconds ? { seconds: c.seconds } : {}),
        loop: typeof c.loop === 'boolean' ? c.loop : (LOOPS[c.intent ?? intentOf(c.name)] ?? false), planned: !clipNames.has(c.name) })),
      preset: { skip: Array.isArray(input.preset?.skip) ? input.preset.skip.filter(s => typeof s === 'string') : [] },
      confirmed: true,
    },
  };
}
