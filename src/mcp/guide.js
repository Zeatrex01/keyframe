// The usage guide every tool carries: when to call it, when not to, one call that works, and
// what usually comes next. (Phase 1 of docs/roadmap.md: tools any AI can use without help.)
//
// Descriptions say WHAT a tool does; a model new to the studio also needs WHEN. These four
// fields are kept in one table so they read as one voice and can be compared side by side;
// `withGuide` attaches them to the definitions and the registry refuses a tool without them.
// test/tool-contracts.test.js checks every example against its tool's inputSchema and every
// `next` against the tool list, so an example can never teach a call the wire would refuse.

/** name -> { when, notWhen?, example, next } */
export const GUIDE = Object.freeze({
  help: {
    when: 'You need the full contract of a tool (every argument, its unit and default) before calling it, or the list of every tool.',
    example: { tool: 'write_animation' },
    next: ['start_here'],
  },
  start_here: {
    when: 'First call of every session, and again after the project folder changes.',
    example: {},
    next: ['scan_project', 'read_rig', 'wait_for_message'],
  },
  wait_for_message: {
    when: 'The owner works in the studio page: call it to receive what they typed, and again after every reply.',
    notWhen: 'You are driven from a terminal or chat and nobody uses the studio page.',
    example: { timeoutSec: 50, name: 'Claude' },
    next: ['reply'],
  },
  reply: {
    when: 'Tell the owner in the studio page what you are doing or what is ready; set work to writing, checking or ready.',
    example: { text: 'The chest now drops, squashes on landing and settles. Ready to play.', work: 'ready', file: 'chest_v2.json', animation: 'drop' },
    next: ['wait_for_message'],
  },
  see_reference: {
    when: 'There is a reference video in reference/ and you need to see what happens in it before measuring.',
    notWhen: 'You need timing in numbers: use measure_reference.',
    example: { from: 0, to: 1.5, count: 12 },
    next: ['measure_reference'],
  },
  measure_reference: {
    when: 'You want one element\'s motion from a reference video as keys and eases instead of guessing by eye.',
    example: { from: 0.2, to: 1.1, region: { x: 0.3, y: 0.4, width: 0.4, height: 0.5 }, anchor: 'bottom', saveAs: 'coin_pop' },
    next: ['apply_motion'],
  },
  apply_motion: {
    when: 'You have a measured or saved motion and want it on a bone of the rig, or you want to list the motion library.',
    example: { motion: 'coin_pop', animation: 'pop', bone: 'coin', amount: 1.1 },
    next: ['compare_reference', 'see_animation'],
  },
  compare_reference: {
    when: 'After apply_motion or a hand-written copy: prove how close the clip is to the reference, channel by channel.',
    example: { animation: 'pop', from: 0.2, to: 1.1 },
    next: ['apply_motion', 'write_animation'],
  },
  scan_project: {
    when: 'You need to know which skeletons are in the folder, which is the owner\'s base and which are deliveries.',
    example: {},
    next: ['read_rig', 'check_skeleton'],
  },
  add_effect: {
    when: 'The clip needs an effect: coins or sparks flying out (burst), a motion trail, a hit flash, a pulsing glow, a camera or object shake.',
    notWhen: 'The effect needs new art: draw it first with draw_rig, then reuse it here.',
    example: { kind: 'burst', animation: 'open', sprite: { slot: 'coin' }, at: 0.4, count: 12, tune: { direction: 90, spread: 70 } },
    next: ['see_animation', 'critique_animation'],
  },
  draw_rig: {
    when: 'There is no art yet, or a part is missing: draw the parts (components, shapes in the style guide, or SVG) and get a rig the studio plays at once, or an artboard that is never rigged.',
    notWhen: 'The owner has art: work on their skeleton instead; never redraw a file the studio did not draw.',
    example: { name: 'menu', folder: 'ui', parts: [{ name: 'play', component: { component: 'button', label: 'PLAY', icon: 'play' }, at: [0, 0] }, { name: 'coin', box: [64, 64], shapes: [{ circle: [32, 32, 28], fill: 'reward', shine: true }], at: [160, 0], states: ['hover', 'pressed'] }] },
    next: ['critique_art', 'brief', 'write_animation'],
  },
  style_guide: {
    when: 'Before drawing anything for a project, and whenever its look changes: fix the palette by role, outline weights, corner radii, light, type and sizes every drawn part follows.',
    notWhen: 'The owner brought their own art: their look is in their files, not in a guide.',
    example: { preset: 'casual-game', set: { palette: { primary: '#4cc461' } } },
    next: ['draw_rig'],
  },
  critique_art: {
    when: 'After every draw_rig, before animating or exporting: check the drawing against the style guide and look at its contact sheet.',
    notWhen: 'The motion is in question, not the drawing: that is critique_animation.',
    example: { file: 'ui/buttons.parts.json' },
    next: ['draw_rig', 'write_animation', 'export_art'],
  },
  export_art: {
    when: 'The drawing (or one of its clips) is needed outside the studio: PNGs at 1x/2x/3x for an engine, a sprite sheet with its map, clean SVG for the web, a clip as frames.',
    notWhen: 'The animation goes to an engine with a skeletal runtime: deliver the skeleton itself (write_animation) instead of frames.',
    example: { file: 'ui/buttons.parts.json', scales: [1, 2, 3] },
    next: ['critique_art'],
  },
  brief: {
    when: 'Before writing motion on a skeleton for the first time: confirm what it is (character, creature, prop, UI, VFX, scene), what each clip is for and how big it is shown.',
    notWhen: 'The brief is stored and nothing about the subject changed.',
    example: { brief: { subject: 'prop', clips: [{ name: 'open', intent: 'reward', seconds: 1.2 }], display: { height: 200 } } },
    next: ['read_rig', 'write_animation'],
  },
  read_rig: {
    when: 'Before writing any motion: learn bone names, parents, orientation, slots, skins and constraints.',
    example: { file: 'hero.json' },
    next: ['write_animation', 'read_animation'],
  },
  read_animation: {
    when: 'You need the authored keys of an existing clip, measured (ranges, spacing, frame grid), or the keys themselves.',
    notWhen: 'You want the pose the engine produces at a time: use sample_animation.',
    example: { animation: 'idle', detail: true, bones: ['head'] },
    next: ['describe_animation', 'write_animation'],
  },
  sample_animation: {
    when: 'You need exact positions or rotations at given times, after constraints, for example to check a contact or a pose.',
    example: { animation: 'jump', times: [0, 0.3, 0.6] },
    next: ['see_animation'],
  },
  describe_animation: {
    when: 'You want a clip in sentences (who moves when, how far, eases, holds, loop seam) to check it says what was asked.',
    example: { file: 'hero_v2.json', animation: 'jump' },
    next: ['critique_animation', 'see_animation'],
  },
  critique_animation: {
    when: 'After writing a clip: measure whether the motion follows the animation principles (ease, anticipation, overlap, squash volume, holds, loop seam, readability).',
    example: { file: 'hero_v2.json', animation: 'jump' },
    next: ['set_curves', 'write_animation'],
  },
  critique_rig: {
    when: 'Before animating an unfamiliar rig: find unused bones, pivots at the centre of their art and constraints with no effect.',
    example: { file: 'hero.json' },
    next: ['read_rig'],
  },
  check_skeleton: {
    when: 'Prove a file opens and plays: after every write, and on any file you were handed.',
    example: { file: 'hero_v2.json' },
    next: ['see_animation'],
  },
  see_animation: {
    when: 'Look at what you wrote: a filmstrip of rendered frames. Done means seen.',
    example: { file: 'hero_v2.json', animation: 'jump', width: 240, columns: 3 },
    next: ['critique_animation', 'reply'],
  },
  write_animation: {
    when: 'Write or replace one clip. The base is never touched; the result is a new delivery file beside it.',
    notWhen: 'You only want to change eases of existing keys: use set_curves.',
    example: {
      animation: 'hop',
      clip: { bones: { body: {
        translate: [{ time: 0, x: 0, y: 0, curve: 'inQuad' }, { time: 0.1, x: 0, y: -6, curve: 'outCubic' }, { time: 0.35, x: 0, y: 40, curve: 'inQuad' }, { time: 0.6, x: 0, y: 0 }],
        scale: [{ time: 0, x: 1, y: 1 }, { time: 0.1, x: 1.1, y: 0.9, curve: 'outQuad' }, { time: 0.2, x: 0.92, y: 1.08 }, { time: 0.6, x: 1.1, y: 0.9, curve: 'outBack' }, { time: 0.75, x: 1, y: 1 }],
      } } },
      fps: 30,
    },
    next: ['check_skeleton', 'see_animation', 'critique_animation'],
  },
  delete_animation: {
    when: 'Remove clips from a studio delivery (never from the owner\'s base).',
    example: { file: 'hero_v2.json', animations: ['example_rise'] },
    next: ['scan_project'],
  },
  set_curves: {
    when: 'Change the easing of existing keys without moving them, for example to give a landing an outBack settle.',
    example: { file: 'hero_v2.json', animation: 'jump', preset: 'outCubic', bones: ['body'], channels: ['translate'] },
    next: ['see_animation', 'critique_animation'],
  },
  bake_animation: {
    when: 'The target engine lacks physics or constraints, or a clip must play identically everywhere: record what the constraints do as plain keys.',
    example: { file: 'hero.json', what: 'physics' },
    next: ['check_skeleton', 'see_animation'],
  },
  paint_weights: {
    when: 'A part should bend instead of moving rigidly (tail, ribbon, cloth): bind its image to a chain of existing bones.',
    example: { slot: 'tail', attachment: 'tail', bones: ['tail1', 'tail2', 'tail3'], grid: [2, 10] },
    next: ['write_animation', 'see_animation'],
  },
  migrate_swap_to_skin: {
    when: 'Several clips repeat the same motion once per colour or material and should become one clip with skins.',
    example: {},
    next: ['check_skeleton'],
  },
  merge_animation: {
    when: 'Bring a clip from another skeleton into this one, with the bones, slots and art it needs.',
    example: { source: 'effects.json' },
    next: ['check_skeleton', 'see_animation'],
  },
  edit_weights: {
    when: 'Repair the weights of an already weighted mesh: clean crumbs, renormalize, move influence between existing bones.',
    example: { op: 'clean', slot: 'cape', attachment: 'cape', threshold: 0.02 },
    next: ['read_weights', 'see_animation'],
  },
  read_weights: {
    when: 'Find out which bones carry a weighted mesh and whether its weights are healthy.',
    example: { slot: 'cape', attachment: 'cape' },
    next: ['edit_weights'],
  },
  diff_skeletons: {
    when: 'Compare two versions of a skeleton, for example a delivery against its base or a new export against the old one.',
    example: { before: 'hero.json', after: 'hero_v2.json' },
    next: ['check_skeleton'],
  },
  read_atlas: {
    when: 'You need the page and region geometry of an atlas.',
    example: { file: 'hero.json' },
    next: ['check_assets'],
  },
  check_assets: {
    when: 'A skeleton opens but shows white boxes or missing art: check every region and page image resolves.',
    example: { file: 'hero.json' },
    next: ['read_atlas'],
  },
  list_history: {
    when: 'Find an earlier version of a file the studio wrote, to restore it.',
    example: { file: 'hero_v2.json' },
    next: ['restore_file'],
  },
  spine_info: {
    when: 'Ask a licensed Spine install what it says about a file (only when Spine is installed).',
    notWhen: 'Spine is not installed: check_skeleton answers without it.',
    example: { file: 'hero.json' },
    next: ['check_skeleton'],
  },
  restore_file: {
    when: 'Undo: bring back a backup listed by list_history (the current version is backed up first).',
    example: { file: 'hero_v2.json', backup: '20261124-101500-000' },
    next: ['check_skeleton'],
  },
  export_binary: {
    when: 'The game wants a binary .skel instead of JSON.',
    example: { file: 'hero_v2.json' },
    next: [],
  },
  export_godot: {
    when: 'The animation goes into a Godot 4 game: Godot imports the .kfscene with the Keyframe add-on as its own nodes and tracks.',
    example: { file: 'hero_v2.json' },
    next: [],
  },
  export_player: {
    when: 'The owner wants to show or send the animation to someone who has no studio: one HTML file that plays by double-click.',
    example: { file: 'hero_v2.json' },
    next: [],
  },
});

/** A tool definition with its guide fields attached (a tool missing from GUIDE stays as it is). */
export function withGuide(tool) {
  const guide = GUIDE[tool.name];
  return guide ? { ...tool, ...guide } : tool;
}
