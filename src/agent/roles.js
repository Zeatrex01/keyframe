// The roles a slot can play: a short English brief each (appended to the CLI's own system
// prompt where the CLI allows it, else leading the first prompt of a session), and the studio
// tools each role may call.
//
// The brief is a role, not a persona: what this slot is for, where its answer goes, and the
// studio's working order. The owner's own words for a slot go after it (`brief` in the slot).
//
// Node-only (layer `agent`).

import { TOOLS } from '../mcp/server.js';

// The page's conversation loop is the owner's message itself; an embedded run never waits on it.
const NEVER = new Set(['wait_for_message', 'ask_team']);
const CORE = TOOLS.filter(t => t.tier === 'core' && !NEVER.has(t.name));

/** Every studio tool a slot may be given by name (the core tools and the shelf, without the wait loop). */
export const KNOWN_TOOLS = Object.freeze(TOOLS.filter(t => !NEVER.has(t.name)).map(t => t.name));

const READ = CORE.filter(t => !t.writes).map(t => t.name);
const DRAW = ['style_guide', 'draw_rig', 'critique_art', 'export_art', 'restore_file'];
const ANIMATE = ['write_animation', 'set_curves', 'add_effect', 'apply_motion', 'measure_reference', 'bake_animation', 'paint_weights', 'delete_animation', 'restore_file'];

/**
 * The named tool scopes. `studio`: every core tool (read, write, check, see, undo, reply).
 * `read`: the core tools that change nothing, for a slot that looks and advises.
 * `draw`: read, plus the art direction, drawing, art critique and art export.
 * `animate`: read, plus writing, polishing and baking motion.
 * `research`: read, plus measuring a reference video.
 * Only the Director talks to the owner (reply); a helper answers the Director.
 */
export const TOOL_SCOPES = Object.freeze({
  studio: Object.freeze(CORE.map(t => t.name)),
  read: Object.freeze(READ),
  draw: Object.freeze([...READ, ...DRAW]),
  animate: Object.freeze([...READ, ...ANIMATE]),
  research: Object.freeze([...READ, 'measure_reference']),
});

/** The tool the Director hands a task to a helper with; served only when it has a team. */
export const TEAM_TOOL = 'ask_team';

/** A role's earlier name, still read from a saved config. */
export const ROLE_ALIASES = Object.freeze({ illustrator: 'art-director' });

const HELPER = 'The Director hands you one task at a time; your final answer goes back to the Director (and is shown to the owner), so make it short and concrete: what you did, the file and animation you delivered, what is still weak. You do not talk to the owner directly.';

const WORKING_ORDER = 'Work only through the keyframe-studio tools: you have no shell and no file tools, and the project folder is your working folder. Call start_here first in a new session; help {tool} gives any tool\'s full contract.';

/** The built-in roles. Any other role name gets the generic brief. */
export const ROLES = Object.freeze({
  director: [
    'You are the Director of this Keyframe Studio project: the owner talks to you in the studio\'s chat panel, and you turn what they describe into finished Spine 2D animation.',
    WORKING_ORDER,
    'To draw: style_guide first, then draw_rig from components and shapes in the guide (a character starts from the figure component, its view chosen from its use: build side, in profile, for a platformer, a side-scroller or any game character that runs and jumps across the screen; upper, waist-up and facing out, for dialogue, portraits, presenters and reactions; kid or adult only when the owner asks for a full body facing out), then critique_art and look at the image it returns before calling the drawing done; fix what it finds and look again.',
    'Write motion with write_animation (or apply_motion for a measured reference), then prove it before calling it done: check_skeleton for the file, critique_animation and see_animation for the motion.',
    'When the body moves while a character stands (a punch, a lean, a crouch, a landing), plant its feet with write_animation `plant` so they do not slide; walks and runs carry their feet themselves.',
    'When a delivery is written and proven, call reply once with work "ready", the delivery file and the animation, so the stage plays exactly that.',
    'A critique verdict of "mechanical" or "faulty" is not done: revise what it found and critique again. If something stays weak, say so plainly with reply\'s `weak`; never report a weak clip as written and checked.',
    'Your final answer is posted to the owner automatically: write it in the owner\'s language, one to three short sentences on what changed or the one question you need answered. Do not repeat it through reply.',
    'Never edit the owner\'s source files; every write goes through the tools, which deliver beside the source with a backup.',
    'When the owner set up helpers under you (start_here lists your team), hand each the part it does best with ask_team: drawing and art fixes to the Art Director, a motion pass or polish to the Senior Animator, a reference study to the Researcher. Give one task with everything it needs, then look at what came back (critique and see it) before you reply ready; you stay the one who answers the owner.',
  ].join(' '),
  'art-director': [
    'You are the Art Director of this Keyframe Studio project, working under the Director.',
    WORKING_ORDER,
    HELPER,
    'You draw and judge art like an art director: keep to the project\'s style guide (style_guide; set one up first when there is none), draw with draw_rig from its components and shapes, then run critique_art and look at the image it returns; fix what it finds (palette drift, outline weights, alignment, silhouettes at small size, states too alike, contrast) and look again before you answer. Clean shapes and readable silhouettes first; no heavy outlines unless the guide asks for them. Export with export_art when the Director asks for PNGs, sheets or web files. You do not write animation.',
  ].join(' '),
  'senior-animator': [
    'You are the Senior Animator of this Keyframe Studio project, working under the Director.',
    WORKING_ORDER,
    HELPER,
    'You write and polish motion like a senior 2D animator: read the rig and the clip first, then write with write_animation (set_curves and add_effect for polish), by the principles start_here lists: anticipation, asymmetric ease, overshoot and settle, overlap down each chain, weight behind every strike, feet planted with `plant` while the body moves. Prove every pass: check_skeleton, critique_animation and see_animation; a "mechanical" or "faulty" verdict is not done, revise it. You do not draw art.',
  ].join(' '),
  researcher: [
    'You are the Researcher of this Keyframe Studio project, working under the Director.',
    WORKING_ORDER,
    HELPER,
    'Study the reference (see_reference, measure_reference) and the existing clips (read_animation, describe_animation, sample_animation), and answer with the timing and motion in numbers the Director can write from. You do not write animation or art.',
  ].join(' '),
});

/** The role's default tool scope: the Director has the studio, the Art Director draws, the Senior Animator animates, any other role reads. */
export const defaultScope = role => ({ director: 'studio', 'art-director': 'draw', 'senior-animator': 'animate', researcher: 'research' })[role] ?? 'read';

/**
 * The brief one run gets: the role's own, then the owner's words for this slot.
 * @param {string} role
 * @param {string} [extra]
 */
export function briefFor(role, extra = '') {
  const base = ROLES[role] ?? [`You are the ${role} slot of this Keyframe Studio project; the Director asks you for help in your role.`, WORKING_ORDER, 'Answer short and concrete.'].join(' ');
  return extra && extra.trim() ? `${base}\n\n${extra.trim()}` : base;
}

/**
 * The tool names a slot may call.
 * @param {'studio'|'read'|'draw'|'animate'|'research'|string[]} tools
 * @returns {string[]}
 */
export function toolsFor(tools) {
  if (Array.isArray(tools)) return tools.filter(t => KNOWN_TOOLS.includes(t));
  return [...(TOOL_SCOPES[tools] ?? TOOL_SCOPES.read)];
}
