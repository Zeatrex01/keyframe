// The rig and animation readers: one import for the tools (read_rig, read_animation,
// sample_animation) and for critique/describe. Ported from the reading half of legacy
// inspect.js; the sampling half is the runtime (src/runtime, ADR-2).

export { readRig, readRigOnRuntime, attachmentsIndex, meshWeights, CONSTRAINT_SETTINGS, CONSTRAINT_DEFAULTS } from './read-rig.js';
export { readAnimation, readAnimationOnRuntime, drawOrderKeyTimes } from './read-animation.js';
export {
  walkSections, channelsOf, animationDuration, frameGridReport, measureChannel, compressKeys,
  drawOrderChanges, drawOrderOffsetProblems, drawOrderHazards, runtimeRefusal,
  DEFAULT_GRID_FPS, GRID_TOLERANCE_FRAMES, ROUNDING_EPSILON_FRAMES,
} from './read-timelines.js';
