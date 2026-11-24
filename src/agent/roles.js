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
const NEVER = new Set(['wait_for_message']);
const CORE = TOOLS.filter(t => t.tier === 'core' && !NEVER.has(t.name));

/** Every studio tool a slot may be given by name (the core tools and the shelf, without the wait loop). */
export const KNOWN_TOOLS = Object.freeze(TOOLS.filter(t => !NEVER.has(t.name)).map(t => t.name));

/**
 * The named tool scopes. `studio`: every core tool (read, write, check, see, undo, reply).
 * `read`: the core tools that change nothing, for a slot that looks and advises.
 */
export const TOOL_SCOPES = Object.freeze({
  studio: Object.freeze(CORE.map(t => t.name)),
  read: Object.freeze(CORE.filter(t => !t.writes).map(t => t.name)),
});

const WORKING_ORDER = 'Work only through the keyframe-studio tools: you have no shell and no file tools, and the project folder is your working folder. Call start_here first in a new session; help {tool} gives any tool\'s full contract.';

/** The built-in roles. Any other role name gets the generic brief. */
export const ROLES = Object.freeze({
  director: [
    'You are the Director of this Keyframe Studio project: the owner talks to you in the studio\'s chat panel, and you turn what they describe into finished Spine 2D animation.',
    WORKING_ORDER,
    'Write motion with write_animation (or apply_motion for a measured reference), then prove it before calling it done: check_skeleton for the file, critique_animation and see_animation for the motion.',
    'When a delivery is written and proven, call reply once with work "ready", the delivery file and the animation, so the stage plays exactly that.',
    'Your final answer is posted to the owner automatically: write it in the owner\'s language, one to three short sentences on what changed or the one question you need answered. Do not repeat it through reply.',
    'Never edit the owner\'s source files; every write goes through the tools, which deliver beside the source with a backup.',
  ].join(' '),
  illustrator: [
    'You are the Illustrator slot of this Keyframe Studio project: the Director asks you about art, staging and readability.',
    WORKING_ORDER,
    'Read the rig and the atlas, look at rendered frames (see_animation) and answer with concrete, short notes the Director can act on. You do not write animation.',
  ].join(' '),
  researcher: [
    'You are the Researcher slot of this Keyframe Studio project: the Director asks you to study references and existing clips.',
    WORKING_ORDER,
    'Look at the reference (see_reference) and the clips (read_animation, describe_animation), and answer with the timing and motion in numbers. You do not write animation.',
  ].join(' '),
});

/** The role's default tool scope: the Director writes, every other role reads. */
export const defaultScope = role => (role === 'director' ? 'studio' : 'read');

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
 * @param {'studio'|'read'|string[]} tools
 * @returns {string[]}
 */
export function toolsFor(tools) {
  if (Array.isArray(tools)) return tools.filter(t => KNOWN_TOOLS.includes(t));
  return [...(TOOL_SCOPES[tools] ?? TOOL_SCOPES.read)];
}
