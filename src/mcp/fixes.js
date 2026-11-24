// What to do about a refusal. Every error a tool returns carries `fix`: one sentence that tells
// the caller how to get past it, so a model that has never seen the studio does not stall on a
// bare code. (Phase 1 of docs/roadmap.md.)
//
// Specific codes first, then families by the shape of the code. The details of the error are
// read, so a list of what exists (`available`) is pointed at instead of guessed.

const SPECIFIC = {
  'bad-arguments': 'Call help with this tool\'s name for the full argument contract; `example` below is a call that works.',
  'bad-argument': 'Check the value against the tool\'s contract (help {tool}); `example` below is a call that works.',
  'foreign-folder': 'Open a project in the studio page (Projects) or start the server with --project <folder>, then call start_here.',
  'unknown-tool': 'Call help with no arguments for the list of tools.',
  'runtime-version': 'Re-export the skeleton from Spine 4.2 as JSON, or convert it with the studio, then try again.',
  'runtime-parse': 'Call check_skeleton on the file: its findings name the part the parser rejects.',
  'runtime-guard': 'Call check_skeleton on the file: the draw-order findings name the keys to fix.',
  'spine-license-required': 'The owner turns the Spine add-on on in Settings after accepting the Spine Runtimes License (their own Spine license); an agent never accepts it for them.',
  'spine-addon-off': 'Ask the owner to enable the Spine add-on in Settings (it needs their own Spine license), or use the tools that run on the studio\'s own engine.',
  'no-ffmpeg': 'ffmpeg is an optional program: install it (Settings lists how) or ask the owner to, then call again.',
  'no-yt-dlp': 'yt-dlp is an optional program: install it (Settings lists how), or save the video into reference/ by hand.',
  'no-spine-cli': 'The Spine command line is optional: use check_skeleton instead, or set SPINE_CLI to a licensed Spine install.',
  'no-agent-cli': 'The agent CLI for this slot is not installed: install it (Settings lists how) and sign in once in a terminal, or choose another agent for the slot.',
  'agent-off': 'The slot has no agent: choose Claude Code, Codex CLI or Gemini CLI for it in Settings.',
  'agent-busy': 'The slot is still working: wait for its answer, or stop it first.',
  'unknown-asset': 'Use a reference from `available`, written asset:<pack>/<item>.',
  'not-ours': 'draw_rig only redraws files it drew (a <name>.parts.json sits beside them): choose another `name` or `folder`.',
  'check-failed': 'The findings name what the check rejects in the drawing: fix those parts and call again.',
  'bad-parts': 'Fix the parts the message lists (unique names, an existing parent, one SVG with a viewBox each) and call again.',
  'bad-style': 'Fix the settings the message lists: palette colours as #rrggbb, weights and radii as numbers, light amounts from 0 to 1; style_guide with no arguments shows the guide as it is.',
  'no-drawing': 'Give the <name>.parts.json file draw_rig wrote (scan_project lists the project\'s files), or draw it first with draw_rig.',
  'bad-svg': 'Give every part one complete SVG document with a viewBox, e.g. <svg viewBox="0 0 100 100">...</svg>.',
  'base-protected': 'The owner\'s file is never written: write into a delivery (leave `into` empty for <base>_v2.json, or name a new file).',
  'base-is-delivery': 'Pass the owner\'s base as `from` (scan_project shows which file is the base).',
  'delivery-refused': 'Read the findings in details: they name what the write would break. Fix the clip and write again.',
  'busy': 'Another write is running on this file: wait a moment and call again.',
  'changed-during-write': 'The file changed while writing: read it again (scan_project, read_rig) and repeat the call.',
  'setup-moved': 'The owner changed the base: the base wins. Read it again (read_rig) and write the clip onto the new version.',
  'ambiguous-skeleton': 'Several skeletons are in the folder: pass `file` (scan_project lists them).',
  'no-skeleton': 'There is no skeleton in this folder yet: export the rig as Spine 4.2 JSON (or a Keyframe file) into it, then call start_here.',
  'attachment-ambiguous': 'The attachment name exists in several skins: pass `skin` (read_rig lists the skins).',
  'missing-bone-world': 'A bone has no world transform in the setup pose: check_skeleton names it; check the rig in Spine.',
  'internal-error': 'This is a studio bug, not your input: report the message to the owner and try another way.',
};

/** @type {Array<[RegExp, string]>} */
const FAMILIES = [
  [/^unknown-|^no-such-|-not-found$/, 'Use one of the names in details.available, or list what exists first (scan_project, read_rig).'],
  [/^bad-|-malformed$/, 'Call help with this tool\'s name for the expected shape; `example` below is a call that works.'],
  [/^png-|^atlas-|^missing-page$|^no-atlas$/, 'The art beside the skeleton is missing or unreadable: run check_skeleton and check that the .atlas and its page images sit next to the JSON.'],
  [/^stale-|-exists$|^name-taken$|^target-/, 'Something with that name already exists or changed: read the current state again and pick a new name or `replace: true`.'],
  [/^mesh-|^bone-|^zero-weight|^last-influence/, 'The mesh or bones do not fit this operation: read_rig shows the attachment types and bone names to use.'],
];

/**
 * @param {string} code
 * @param {object} [details]
 * @returns {string}
 */
export function fixFor(code, details = {}) {
  if (Object.hasOwn(SPECIFIC, code)) return SPECIFIC[code];
  for (const [pattern, fix] of FAMILIES) if (pattern.test(code)) return fix;
  if (Array.isArray(details?.available)) return 'Use one of the names in details.available.';
  return 'Read the message: it names what was refused. help with this tool\'s name gives its full contract.';
}
