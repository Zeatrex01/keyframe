// Assembles the MCP server: the session, the tool set, the wire.
//
// The server is started for one project (`--project <folder>`). Writing tools are refused
// unless that folder exists; reading tools work anywhere.

import { buildRegistry } from './registry.js';
import { configureSpineRuntime } from '../runtime/index.js';
import { locateSpineRuntime } from '../core/spine-addon.js';
import { withGuide } from './guide.js';
import { createWire } from './wire.js';
import help from './tools/help.js';
import scanProject from './tools/scan-project.js';
import checkSkeleton from './tools/check-skeleton.js';
import seeAnimation from './tools/see-animation.js';
import writeAnimation from './tools/write-animation.js';
import deleteAnimation from './tools/delete-animation.js';
import setCurves from './tools/set-curves.js';
import bakeAnimation from './tools/bake-animation.js';
import migrateSwapToSkin from './tools/migrate-swap-to-skin.js';
import mergeAnimation from './tools/merge-animation.js';
import { editWeights, readWeights, paintWeightsTool } from './tools/edit-weights.js';
import { diffSkeletonsTool, readAtlasTool, checkAssetsTool, listHistoryTool, spineInfoTool } from './tools/inspect-files.js';
import { restoreFileTool, exportBinaryTool, exportPlayerTool, exportGodotTool } from './tools/file-writes.js';
import { readRigTool, readAnimationTool, sampleAnimationTool, describeAnimationTool, critiqueAnimationTool, critiqueRigTool } from './tools/understand.js';
import startHere from './tools/start-here.js';
import briefTool from './tools/brief.js';
import addEffectTool from './tools/add-effect.js';
import drawRigTool from './tools/draw-rig.js';
import styleGuideTool from './tools/style-guide.js';
import { critiqueArtTool, exportArtTool } from './tools/art.js';
import { waitForMessageTool, replyTool } from './tools/chat.js';
import { askTeamTool } from './tools/team.js';
import { seeReferenceTool, measureReferenceTool, applyMotionTool, compareReferenceTool } from './tools/reference.js';

export const SERVER_NAME = 'keyframe-studio';

export const INSTRUCTIONS = [
  'Keyframe Studio: the eyes, the proof and the safe hands for writing 2D skeletal animation.',
  'You write the motion as animation JSON (the studio\'s format, compatible with Spine 4.2); the studio shows it, proves it on its own engine (and on the official Spine runtime when the owner turned the Spine add-on on), and delivers it beside the owner\'s file without ever overwriting the source.',
  'Rules, in order:',
  '(1) Never edit a skeleton .json with a generic file tool. Every write goes through this server\'s tools; a direct edit skips validation, the one-way base protection and the backup.',
  '(2) Call start_here first: it returns this project\'s state and the SEE -> PROVE -> DELIVER order with exact tool names.',
  '(3) The tool list is short on purpose; help {tool} returns any tool\'s full contract.',
  '(4) When the owner works in the studio page, their requests arrive through wait_for_message and your answers go back through reply: loop on them.',
  '(5) When there is a reference video, do not time it by eye: measure_reference gives the motion in numbers, apply_motion writes it, compare_reference proves the copy.',
  '(5b) Know the subject before writing: brief proposes what the skeleton is and what each clip is for; confirm or correct it once, and critique_animation judges by it.',
  '(6) Write by the animation principles start_here lists (asymmetric ease, anticipation, overshoot and settle, overlap of 1-3 frames per link, squash with volume kept, holds that stay alive), unless the owner asks for mechanical motion.',
  '(7) "Done" is a claim about the file: after a write, look at what you produced (see_animation, describe_animation, critique_animation, check_skeleton) before saying it is finished.',
  '(8) A refused call says how to fix it (`fix`) and, for argument problems, carries a call that works (`example`).',
].join(' ');

/** Every tool this build carries. Only the `core` tier is served unless the server is started with `all`. */
export const TOOLS = [help, startHere, waitForMessageTool, replyTool, seeReferenceTool, measureReferenceTool, applyMotionTool, compareReferenceTool, scanProject, briefTool, readRigTool, readAnimationTool, sampleAnimationTool, describeAnimationTool,
  critiqueAnimationTool, critiqueRigTool, checkSkeleton, seeAnimation, writeAnimation, deleteAnimation,
  setCurves, addEffectTool, styleGuideTool, drawRigTool, critiqueArtTool, exportArtTool, bakeAnimation, paintWeightsTool, migrateSwapToSkin, mergeAnimation, editWeights, readWeights,
  diffSkeletonsTool, readAtlasTool, checkAssetsTool, listHistoryTool, spineInfoTool, restoreFileTool, exportBinaryTool, exportPlayerTool, exportGodotTool, askTeamTool].map(withGuide);

/**
 * @param {object} options
 * @param {{ dir: string|null, writable(): boolean }} options.session
 * @param {(message: object) => void} options.write
 * @param {string} options.version
 * @param {object[]} [options.tools]
 * @param {boolean} [options.fullDescriptions]
 * @param {boolean} [options.all]  also serve the `advanced` shelf (off by default since 2026-11-12)
 * @param {(record: object) => void} [options.onRefusal]  told about every refused call (the log)
 */
export function createServer({ session, write, version, tools = TOOLS, fullDescriptions = false, all = false, onRefusal }) {
  // The official runtime only when the owner turned the Spine add-on on (asked again on each use).
  configureSpineRuntime({ locate: () => locateSpineRuntime(process.env) });
  const registry = buildRegistry(all ? tools : tools.filter(t => t.tier === 'core'));
  const shelved = all ? [] : tools.filter(t => t.tier !== 'core').map(t => t.name);
  const wire = createWire({ registry, session, write, instructions: INSTRUCTIONS,
    serverInfo: { name: SERVER_NAME, version }, fullDescriptions, onRefusal, shelved });
  return { registry, wire };
}
