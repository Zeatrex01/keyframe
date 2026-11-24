// The animation principles as rules a model applies while it writes motion, and the timing of
// common clips. Distilled from the studio's research notes of 2026-11-24 (the 12 principles
// as measurable keyframe rules, game-animation practice for 2D skeletal rigs).
//
// Numbers marked `estimate` are rules of thumb, not measurements: critique_animation reports
// them as warnings only, until they are calibrated on real production exports.
// Frame counts are at 30 fps (double them at 60).
//
// Pure data, isomorphic. start_here serves it; src/understand/critique.js measures against it.

export const FPS_BASIS = 30;

/** One line per principle: the rule, with numbers, in the terms a clip is written in. */
export const WRITING_RULES = Object.freeze([
  { principle: 'pose to pose', rule: 'Key the extremes and contacts on the main bones first, look at frames (see_animation), then add breakdowns at 1/3 or 2/3 of the value, off the time midpoint. Passive parts (tail, hair, cloth) follow; never hand-key them in unison.' },
  { principle: 'timing', rule: 'Vary segment lengths: a fast main move (2-5 frames), a slower preparation, a longer settle. Keys at equal intervals read as a metronome.', estimate: true },
  { principle: 'slow in and slow out', rule: 'Ease where motion really starts or stops, and make it asymmetric: arrive with outCubic/outQuart/outExpo, leave with inQuad/inCubic. Do not put one preset on more than 70% of segments.', estimate: true },
  { principle: 'anticipation', rule: 'Before a big move, a small opposite move of 10-25% of its amplitude, lasting 0.5-1.5x the action for characters and props, 0.2-0.5x for UI and game feedback. Even one frame helps.', estimate: true },
  { principle: 'overshoot and settle', rule: 'A part that stops passes its target and settles: outBack is about 10% overshoot; 1-2 visible oscillations, each under half the previous.', estimate: true },
  { principle: 'overlap and follow-through', rule: 'Parent leads, each child starts, peaks and stops 1-3 frames later, growing toward the tip; never key a whole chain on the same frames.', estimate: true },
  { principle: 'squash and stretch', rule: 'Keep the volume: scaleY = 1/scaleX (within 5%). Stretch 1.1-1.4 on the 1-2 fastest frames, squash 0.7-0.9 for 2-4 frames at impact. Put squash on a leaf bone: a parent with scaleX != scaleY shears its children.', estimate: true },
  { principle: 'arcs', rule: 'Moves curve: give translate x and y different eases (a jump: x linear, y outQuad up and inQuad down) or key the apex; rotation gives arcs for free.' },
  { principle: 'holds', rule: 'Hold a key pose 6-24 frames so it reads, but keep it alive: drift 1-5% of the previous move (0.5-2 degrees) with outSine. More than 12 frames with nothing moving reads frozen.', estimate: true },
  { principle: 'secondary action', rule: 'Secondary motion stays under 40% of the primary amplitude and at least 2 frames out of phase.', estimate: true },
  { principle: 'staging', rule: 'One idea at a time: no two primary actions peak within 6 frames; key poses differ clearly in silhouette.', estimate: true },
  { principle: 'appeal', rule: 'Mirrored limbs never move identically: offset left and right by 1-2 frames or give them different amplitudes.', estimate: true },
  { principle: 'readability', rule: 'Every visible move travels at least 2 screen pixels at the size the game shows it: a point 60 px from its pivot needs about 2 degrees; a 100 px sprite needs a scale change of 0.02. Idle breath: 1-3% scale or 1-2 degrees at hero size, 2-3x that under 120 px.', estimate: true },
  { principle: 'loops', rule: 'On a loop the last key equals the first on every timeline, the key at t = duration is t = 0 (do not end one frame early), and the ease matches across the seam. Loop length is a common multiple of every sub-cycle.' },
  { principle: 'events', rule: 'Put events on the contact frame (hit, footstep, land), not in game code timers.' },
]);

/** Typical clips: duration and beats. Frames at 30 fps. */
export const CLIP_TIMING = Object.freeze([
  { clip: 'idle breath loop', seconds: [1.5, 3], beats: 'neutral, inhale (slower), exhale; chest, neck, head offset 2-3 frames', estimate: true },
  { clip: 'walk cycle', seconds: [0.9, 1.1], beats: 'contact, down, passing, up, twice' },
  { clip: 'run cycle', seconds: [0.5, 0.67], beats: 'contact, down, passing, flight, twice' },
  { clip: 'light attack', seconds: [0.25, 0.5], beats: 'wind-up 1-4 f, strike 1-2 f with 1 f overshoot, recover 6-10 f', estimate: true },
  { clip: 'telegraphed attack', seconds: [0.6, 1.5], beats: 'long readable wind-up 15-30 f, strike 2-3 f, recover 10-20 f', estimate: true },
  { clip: 'hit reaction', seconds: [0.2, 0.4], beats: 'freeze 2-4 f, white flash, decaying shake', estimate: true },
  { clip: 'jump', seconds: [0.6, 1.2], beats: 'crouch 1-3 f, stretch, apex hang, fall stretch, land squash, settle 6-10 f', estimate: true },
  { clip: 'button press / release', seconds: [0.08, 0.25], beats: 'squash 0.9, overshoot 1.05-1.1, back to 1.0' },
  { clip: 'popup in / out', seconds: [0.15, 0.35], beats: 'in: 0 -> 1.1 -> 1.0 with alpha; out faster, no overshoot' },
  { clip: 'coin / item fly', seconds: [0.4, 0.8], beats: 'pop on an arc, ease into the target, land squash, flash, event; stagger 2-4 f' },
  { clip: 'reward chest', seconds: [2, 4], beats: 'drop, land squash, rattle, burst flash, beam, staggered cards fly and flip, glow loop', estimate: true },
]);

/** Thresholds critique_animation measures against (all reported as warnings). */
export const THRESHOLDS = Object.freeze({
  dominantEaseRatio: 0.7,     // one preset on more than this share of eased segments
  unisonBones: 3,             // more than this many bones keyed on identical times
  squashVolume: 0.05,         // |sx * sy - 1| above this on a non-uniform scale key
  readablePixels: 2,          // a move smaller than this on screen does not read
  twinCorrelation: 0.95,      // left and right keyed identically
});
