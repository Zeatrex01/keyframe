# Tools

<!-- Written by `npm run docs:tools` from the tool definitions; do not edit by hand. -->

The studio serves 29 tools to any MCP client by default; 12 more are on the shelf and served with
`--all` (or `"all": true` in the connection). Any tool's full contract is also one `help { tool }` call away.
Every refusal carries `fix` (how to get past it) and, for argument problems, an `example` call that works.

| Tool | Tier | What it does |
|---|---|---|
| [`help`](#help) | core | The full contract of one tool, or the index of all tools by tier. |
| [`start_here`](#start_here) | core | What this project holds and the SEE -> WRITE -> PROVE -> DELIVER order with exact tool names and the next call. |
| [`wait_for_message`](#wait_for_message) | core | Waits for what the owner types in the studio page and returns it; call it again whenever it returns nothing. |
| [`reply`](#reply) | core | Says one short thing to the owner in the studio page and sets the work state shown there (writing, checking, ready). |
| [`see_reference`](#see_reference) | core | A filmstrip PNG of the owner's reference video over a time range (and a region), with the time of every frame, to find its beats by eye. |
| [`measure_reference`](#measure_reference) | core | Measures how ONE element moves in the reference video: scale, travel, turn and fade as keys with eases, to a fraction of a pixel. Optionally saves it to the motion library. |
| [`apply_motion`](#apply_motion) | core | Plays a measured or saved motion on a bone of the rig and writes the delivery; with no motion it lists the library of learned motions. |
| [`compare_reference`](#compare_reference) | core | Proves a copy: the reference and the animation side by side at the same instants, plus how far their measured motion is apart, channel by channel. |
| [`scan_project`](#scan_project) | core | Lists the skeletons in the project: counts, Spine version, atlas and pages, delivery or base, and whether each plays. |
| [`brief`](#brief) | core | What the skeleton is (character, creature, prop, UI, VFX, scene) and what each clip is for; the studio proposes, you confirm. |
| [`read_rig`](#read_rig) | core | The rig: bone tree with setup and world transforms, slots and draw order, skins and attachments, constraints, animation summary. |
| [`read_animation`](#read_animation) | core | One animation as measurements: channels per bone and slot, ranges, key spacing, frame grid, draw-order changes; keys on request. |
| [`sample_animation`](#sample_animation) | core | Exact poses at chosen times: local, applied (after constraints) and world transforms; slot and draw-order changes. |
| [`describe_animation`](#describe_animation) | core | The clip in sentences: who moves when, how far, which way; fades, holds, overshoots, loop check, setup-pose pops. |
| [`critique_animation`](#critique_animation) | core | Measures a clip against the animation principles: ease, anticipation, overshoot, overlap, squash volume, holds, loop seam, readability; a verdict with numbers and fixes. |
| [`check_skeleton`](#check_skeleton) | core | Audits a skeleton: what a player or editor rejects (fatal) or plays wrong (warn), plus whether the studio's engine plays it. |
| [`see_animation`](#see_animation) | core | A filmstrip PNG of the animation at chosen times, rendered headlessly without a browser. |
| [`write_animation`](#write_animation) | core | Writes one animation (animation JSON, Spine 4.2 compatible) onto the base and saves a proven delivery beside it; the base is never written. |
| [`delete_animation`](#delete_animation) | core | Deletes named animations from a delivery file, all or nothing; owner files are refused. |
| [`set_curves`](#set_curves) | core | Applies an easing preset (or raw handles) to the segments of an animation; key values and times never move. |
| [`add_effect`](#add_effect) | core | Adds an effect to a clip (burst, trail, flash, glow, shake) as ordinary bones, slots and keys every player shows the same. |
| [`style_guide`](#style_guide) | core | The project's art direction: palette by role, stroke weights, corner radii, light, grid, type and sizes. Read it, start it from a preset, or change it. |
| [`draw_rig`](#draw_rig) | core | Draws placeholder art as SVG parts and builds the rig from it: a skeleton, an atlas and a page image the studio plays at once. |
| [`critique_art`](#critique_art) | core | The art director's check of a drawing against the style guide: palette drift, outline weights, alignment, silhouettes at small size, states too alike, contrast. Writes a contact sheet to look at. |
| [`export_art`](#export_art) | core | Exports a drawing for engines and the web: trimmed transparent PNGs per part and state at chosen scales with pivots, a sprite sheet with a JSON map, clean SVG, and a clip as a PNG sequence and sheet. |
| [`bake_animation`](#bake_animation) | core | Bakes constraint results (physics, IK, transform, path) or curves into plain linear bone keys, verified by replay on the runtime. |
| [`paint_weights`](#paint_weights) | core | Binds a mesh (or a flat image turned into a grid mesh) to a chain of bones with smooth weights, so the part bends instead of moving rigidly. |
| [`list_history`](#list_history) | core | The backups the studio keeps of a file it wrote, newest first. |
| [`restore_file`](#restore_file) | core | Brings back an earlier version of a file the studio wrote; the current one is backed up first. |
| [`critique_rig`](#critique_rig) | advanced | Is the rig built well: unused bones, pivots sitting at the centre of their art, constraints with no effect. |
| [`migrate_swap_to_skin`](#migrate_swap_to_skin) | advanced | Without groups: suggests clip families that differ only in attachments. With groups: folds each family into one clip plus named skins. |
| [`merge_animation`](#merge_animation) | advanced | Copies an animation from another skeleton into this one, with the bones, slots and art it needs; conflicts retargeted or renamed. |
| [`edit_weights`](#edit_weights) | advanced | Mechanical weight repair on an existing weighted mesh: clean crumbs, renormalize, transfer, add or remove an existing bone's influence. |
| [`read_weights`](#read_weights) | advanced | Which bones carry each weighted mesh and how much; flags drifted sums, crumbs, out-of-range bones and too many influences. |
| [`diff_skeletons`](#diff_skeletons) | advanced | What differs between two skeletons: bones, slots, skins, attachments, constraints and animations, by name. |
| [`read_atlas`](#read_atlas) | advanced | Pages and region geometry of a .atlas, read by the official parser. |
| [`check_assets`](#check_assets) | advanced | Does every image the skeleton uses resolve: atlas regions present, page images on disk. |
| [`spine_info`](#spine_info) | advanced | Asks the installed Spine command line about a .spine, .json or .skel file; refuses without a licensed Spine. |
| [`export_binary`](#export_binary) | advanced | Writes a Spine binary .skel of a skeleton, verified by the official binary reader; needs the Spine add-on. |
| [`export_player`](#export_player) | advanced | Writes one HTML file that plays a skeleton by double-click, with no studio, server or network. |
| [`export_godot`](#export_godot) | advanced | Writes <file>.kfscene for Godot 4: the Keyframe add-on imports it as Skeleton2D, Polygon2D and AnimationPlayer nodes. |

## help

*core, read only.* The full contract of one tool, or the index of all tools by tier.

**Use when:** You need the full contract of a tool (every argument, its unit and default) before calling it, or the list of every tool.

tools/list carries short summaries to keep every session cheap. `help` with a tool name returns that tool's full description, when to use it (and when not), one example call that works, the tools that usually come next, and its complete input schema; with no argument it returns the index of every tool grouped by tier (core is the SEE -> WRITE -> PROVE path; the advanced shelf is listed only when the server was started with --all).

| Argument | Type | Meaning |
|---|---|---|
| `tool` | string | Name of the tool to explain; leave empty for the index. |

Example:

```json
{
 "tool": "write_animation"
}
```

**Next:** `start_here`

## start_here

*core, read only.* What this project holds and the SEE -> WRITE -> PROVE -> DELIVER order with exact tool names and the next call.

**Use when:** First call of every session, and again after the project folder changes.

Call at session start and after the folder changes. Returns the skeletons in the project (owner bases and studio deliveries, with their animations), what the studio can do, the order of work with the tools for each step and why, the rules that matter most, the animation principles as writing rules with numbers and the timing of common clips, one working write call for this rig, and the single recommended next call.

Example:

```json
{}
```

**Next:** `scan_project`, `read_rig`, `wait_for_message`

## wait_for_message

*core, writes files.* Waits for what the owner types in the studio page and returns it; call it again whenever it returns nothing.

**Use when:** The owner works in the studio page: call it to receive what they typed, and again after every reply.

**Not when:** You are driven from a terminal or chat and nobody uses the studio page.

The owner describes the motion they want, and what to change, in the studio page. This call blocks until they send something (or `timeoutSec` passes) and returns their unread messages, oldest first. While you are waiting the page shows the agent as connected. The working loop: wait_for_message -> reply {work:"writing"} with one short line -> do the work with the other tools -> reply {work:"checking"} while you check and look -> reply {work:"ready", file, animation} saying in one or two sentences what changed -> wait_for_message again. An empty `messages` means nobody wrote yet: call it again. Keep replies short; the owner judges the motion on the stage, not the text.

| Argument | Type | Meaning |
|---|---|---|
| `timeoutSec` | number (≥ 1, ≤ 300) | How long to wait before returning nothing (1-300, default 50). Keep it under your client's tool timeout. |
| `name` | string | How the page names you, e.g. "Claude" or "Codex". |

Example:

```json
{
 "timeoutSec": 50,
 "name": "Claude"
}
```

**Next:** `reply`

## reply

*core, writes files.* Says one short thing to the owner in the studio page and sets the work state shown there (writing, checking, ready).

**Use when:** Tell the owner in the studio page what you are doing or what is ready; set work to writing, checking or ready.

Appends your message to the conversation in the studio page. `work` drives the three-step indicator the owner watches: "writing" when you start, "checking" while you check and look at frames, "ready" when the delivery is written and proven; with "ready" pass the delivery `file` and the `animation` so the page loads and plays exactly that. "idle" clears the indicator (use it for a plain answer or a question). One or two sentences: what you did or what you need; numbers only when they help the owner decide.

| Argument | Type | Meaning |
|---|---|---|
| `text` (required) | string | What to tell the owner, in their language. One or two sentences. |
| `work` | `idle` \\| `writing` \\| `checking` \\| `ready` | The work state the page shows. Default: unchanged. |
| `file` | string | Project-relative delivery file the page should show (with work:"ready"). |
| `animation` | string | Animation the page should play (with work:"ready"). |

Example:

```json
{
 "text": "The chest now drops, squashes on landing and settles. Ready to play.",
 "work": "ready",
 "file": "chest_v2.json",
 "animation": "drop"
}
```

**Next:** `wait_for_message`

## see_reference

*core, read only.* A filmstrip PNG of the owner's reference video over a time range (and a region), with the time of every frame, to find its beats by eye.

**Use when:** There is a reference video in reference/ and you need to see what happens in it before measuring.

**Not when:** You need timing in numbers: use measure_reference.

The owner drops a reference video into the project's reference/ folder (or the page uploads it there) and may mark a part of the picture and a stretch of time. This returns evenly spaced frames as ONE filmstrip PNG plus the time of each frame. Use it to understand what happens and which element matters; then measure_reference gives that element's motion in numbers, so do not time moves by eye. With no arguments it shows what the owner marked, else the whole of the only video. Needs ffmpeg on this machine; refuses with `no-ffmpeg` otherwise.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative video (mp4, webm, mov, gif), normally under reference/. Empty uses what the owner marked in the page, else the only video there. |
| `from` | number (≥ 0) | Start of the range in seconds. Default: the owner's mark, else 0. |
| `to` | number (≥ 0) | End of the range in seconds. Default: the owner's mark, else the end. |
| `region` | object | The part of the picture to look at, as fractions of the frame from its top-left corner: { x, y, width, height }, each 0-1. Leave a margin of plain ground around the element. Default: what the owner marked in the page, else the whole frame. |
| `count` | integer (≥ 1, ≤ 24) | How many frames, evenly spaced over the range (1-24, default 12). |
| `width` | integer (≥ 64, ≤ 640) | Width of each frame in pixels (64-640, default 240); this sets the token cost. |
| `columns` | integer (≥ 1, ≤ 12) | Frames per filmstrip row (default 4). |

Example:

```json
{
 "from": 0,
 "to": 1.5,
 "count": 12
}
```

**Next:** `measure_reference`

## measure_reference

*core, writes files.* Measures how ONE element moves in the reference video: scale, travel, turn and fade as keys with eases, to a fraction of a pixel. Optionally saves it to the motion library.

**Use when:** You want one element's motion from a reference video as keys and eases instead of guessing by eye.

Follows one element through every frame of a range and returns `motion`, in the terms an animation is written in: `motion.tracks.scale` (ratio to its rest size), `tracks.translate` (travel of its anchor as a FRACTION OF ITS REST HEIGHT, y up), `tracks.rotate` (degrees, only for a clearly elongated shape), `tracks.alpha` (fade), each as keys { time, x, y | value, ease } with the ease that best explains the frames between two keys (`guessed: true` when a move is too short to tell eases apart). `beats` lists when it moves and when it holds; `fitError` is how far those keys, played back, are from what was measured (0.02 = 2% of the element's size); `confidence` drops when the ground around the element is not plain or the crop is too tight. How it sees the element: `region` must frame it with a margin of plain ground, since the border of the crop is taken as the ground; one element per call. `rest` says which state is scale 1: "auto" (where it is most of the time: right for a tap, a loop, a reveal that then holds), "first" or "last". `anchor` is the point whose travel is reported: "bottom" (default: a thing standing on the ground, so a squash does not read as a drop), "center" or "top"; apply the motion to a bone that sits at that point. The filmstrip returned shows the crop at the key times, to check it followed the right thing. When the range holds the same move several times, `repeats` gives the period and where each cycle starts: measure one cycle. `saveAs` stores the motion in the owner's library (names are kept lowercase with dashes), for apply_motion on any rig later. Needs ffmpeg. `reading` interprets it instead of copying it: the beats in the principles' terms (anticipation, main move, overshoot and settle, holds) and `restage`, the apply_motion speed and amount that fit it to the clip's seconds in the brief and to the size the subject is shown at.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative video (mp4, webm, mov, gif), normally under reference/. Empty uses what the owner marked in the page, else the only video there. |
| `from` | number (≥ 0) | Start of the range in seconds. Default: the owner's mark, else 0. |
| `to` | number (≥ 0) | End of the range in seconds. Default: the owner's mark, else the end. |
| `region` | object | The part of the picture to look at, as fractions of the frame from its top-left corner: { x, y, width, height }, each 0-1. Leave a margin of plain ground around the element. Default: what the owner marked in the page, else the whole frame. |
| `anchor` | `bottom` \\| `center` \\| `top` | The fixed point of the element whose travel is reported as translate. |
| `rest` | `auto` \\| `first` \\| `last` | auto: the state held most of the time; first / last: that frame of the range. |
| `saveAs` | string | Name to store the measured motion under in the owner's motion library. |
| `note` | string | What this motion is, in a few words (kept with saveAs). |
| `clip` | string | The clip the motion will become, as named in the brief: `reading.restage` then fits it to that clip's seconds and the subject's display size. |

Example:

```json
{
 "from": 0.2,
 "to": 1.1,
 "region": {
  "x": 0.3,
  "y": 0.4,
  "width": 0.4,
  "height": 0.5
 },
 "anchor": "bottom",
 "saveAs": "coin_pop"
}
```

**Next:** `apply_motion`

## apply_motion

*core, writes files.* Plays a measured or saved motion on a bone of the rig and writes the delivery; with no motion it lists the library of learned motions.

**Use when:** You have a measured or saved motion and want it on a bone of the rig, or you want to list the motion library.

Turns a motion (the `motion` object measure_reference returned, or the name of one saved in the library) into keys on `bone` and writes them through the same proven path as write_animation: the base is never written. Scale keys go on as measured; travel is multiplied by the element's VISIBLE height in rig units (measured from a render of the art under the bone, so transparent padding does not count; `height` overrides it); a fade goes to `slot` when one is named. The bone may sit anywhere in its art: when it is not at the motion's anchor, the travel is adjusted so the element still squashes and lands as measured, and the result says so. `amount` scales how far everything departs from rest (1 = as measured, 0.6 = gentler, 1.3 = punchier); `speed` plays it faster or slower; `at` places it later in the clip. Other bones and timelines of the same animation are kept, so several motions can be laid on different bones of one clip, one call each. Called with no `motion`, it writes nothing and returns the library: name, duration, channels and note of every learned motion.

| Argument | Type | Meaning |
|---|---|---|
| `motion` | any | A saved motion's name, or the `motion` object measure_reference returned. Omit to list the library. |
| `animation` | string | Name of the animation to write into. |
| `bone` | string | The bone that carries the element; it should sit at the motion's anchor. |
| `slot` | string | Slot to key the measured fade on (optional). |
| `height` | number (≥ 0.001) | Height of the element in rig units, the scale for travel. Default: measured from the art under the bone. |
| `amount` | number (≥ 0, ≤ 4) | Multiplier on every departure from rest (0-4, default 1). |
| `speed` | number (≥ 0.1, ≤ 10) | Faster (>1) or slower (<1) than measured. |
| `at` | number (≥ 0) | Seconds into the animation where the motion starts. |
| `from` | string | Project-relative base skeleton; empty picks the folder's base. Never written. |
| `into` | string | Project-relative delivery file; empty means <base>_v2.json. |
| `replace` | boolean | Default false: other timelines of this animation are kept. |

Example:

```json
{
 "motion": "coin_pop",
 "animation": "pop",
 "bone": "coin",
 "amount": 1.1
}
```

**Next:** `compare_reference`, `see_animation`

## compare_reference

*core, read only.* Proves a copy: the reference and the animation side by side at the same instants, plus how far their measured motion is apart, channel by channel.

**Use when:** After apply_motion or a hand-written copy: prove how close the clip is to the reference, channel by channel.

Takes the same range and region of the reference that was measured, renders `animation` of the delivery at the same instants (starting at `at` seconds into the animation), and measures BOTH the same way. Returns one PNG (top row: the reference; bottom row: the rig) and, for scale, travel, turn and fade, the largest and the typical (rms) gap between them, as fractions of the element's size, with the time of the largest gap. `lagFrames` says the result is early (negative) or late (positive) by that many frames when shifting would fit better. `verdict` is "matches" when every gap is small (size and travel: rms under 0.03 and max under 0.08; fade: 0.08 and 0.2; turn: 3 and 8 degrees), else "differs" with the channels to fix. The art need not look alike; it is the motion that is compared. Pass `bone` to show and measure only the element the motion was applied to; without it the whole skeleton is compared. Needs ffmpeg.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative video (mp4, webm, mov, gif), normally under reference/. Empty uses what the owner marked in the page, else the only video there. |
| `from` | number (≥ 0) | Start of the range in seconds. Default: the owner's mark, else 0. |
| `to` | number (≥ 0) | End of the range in seconds. Default: the owner's mark, else the end. |
| `region` | object | The part of the picture to look at, as fractions of the frame from its top-left corner: { x, y, width, height }, each 0-1. Leave a margin of plain ground around the element. Default: what the owner marked in the page, else the whole frame. |
| `skeleton` | string | Project-relative skeleton whose animation is compared. |
| `animation` (required) | string | Animation to compare with the reference. |
| `bone` | string | Show and measure only the art carried by this bone and its children (the element the motion was applied to). Without it the whole skeleton is compared. |
| `at` | number (≥ 0) | Seconds into the animation that correspond to the start of the reference range. |
| `anchor` | `bottom` \\| `center` \\| `top` | The anchor used when the motion was measured. |
| `rest` | `auto` \\| `first` \\| `last` | The rest state used when the motion was measured. |
| `columns` | integer (≥ 2, ≤ 10) | How many instants the picture shows (2-10, default 6). |

Example:

```json
{
 "animation": "pop",
 "from": 0.2,
 "to": 1.1
}
```

**Next:** `apply_motion`, `write_animation`

## scan_project

*core, read only.* Lists the skeletons in the project: counts, Spine version, atlas and pages, delivery or base, and whether each plays.

**Use when:** You need to know which skeletons are in the folder, which is the owner's base and which are deliveries.

Lists every skeleton JSON in the project folder (Keyframe files and Spine 4.2 exports) (two levels deep): bone, slot, skin and animation counts, the exported Spine version, whether a paired .atlas sits beside it and whether its page images exist, whether the file is a studio delivery (and of which base) or an owner file, the static check summary, whether the studio's engine plays it (and what it does not evaluate yet), and, with the Spine add-on on, whether the official Spine runtime opens it. Call it first in a new project: it answers "what do I have here".

Example:

```json
{}
```

**Next:** `read_rig`, `check_skeleton`

## brief

*core, writes files.* What the skeleton is (character, creature, prop, UI, VFX, scene) and what each clip is for; the studio proposes, you confirm.

**Use when:** Before writing motion on a skeleton for the first time: confirm what it is (character, creature, prop, UI, VFX, scene), what each clip is for and how big it is shown.

**Not when:** The brief is stored and nothing about the subject changed.

Before writing motion, know the subject. Without `brief` it answers the stored brief of the skeleton, or the studio's proposal: the subject classified from bone and slot names, hierarchy and blend modes (character, creature, prop, ui, vfx, scene), with confidence and evidence; each clip's intent (idle, loop, action, reaction, transition, reward) and whether it loops; the display size and pixels per skeleton unit; the timing of typical clips for the subject. Confirm or correct it by passing `brief` (subject, clips [{ name, intent, seconds, loop }], display { height }, note): it is stored in .keyframe/brief.json, and critique_animation then judges each clip as its brief says (loop seam, readability at the display size, checks that do not apply to the subject). Clips not written yet may be listed: they are the plan.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton JSON. |
| `brief` | object | subject (one of the subjects), clips: [{ name, intent, seconds, loop }], display: { height in px }, note. Omit to read. |

Example:

```json
{
 "brief": {
  "subject": "prop",
  "clips": [
   {
    "name": "open",
    "intent": "reward",
    "seconds": 1.2
   }
  ],
  "display": {
   "height": 200
  }
 }
}
```

**Next:** `read_rig`, `write_animation`

## read_rig

*core, read only.* The rig: bone tree with setup and world transforms, slots and draw order, skins and attachments, constraints, animation summary.

**Use when:** Before writing any motion: learn bone names, parents, orientation, slots, skins and constraints.

Reads the structure of a skeleton: the bone tree (setup transform, and the world transform of the setup pose as the player computes it, constraints applied), slots in draw order with their setup attachment and colour, skins and attachment types, constraints with their settings and defaults, mesh weight summaries, and a one-line summary per animation. Call it before writing motion: bone names, parents and orientation decide what a rotate or translate key will do. Reading only.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton JSON; empty picks the folder's base (pass the delivery to read what you wrote). |
| `skin` | string | Skin active for the setup pose; empty uses the default. |

Example:

```json
{
 "file": "hero.json"
}
```

**Next:** `write_animation`, `read_animation`

## read_animation

*core, read only.* One animation as measurements: channels per bone and slot, ranges, key spacing, frame grid, draw-order changes; keys on request.

**Use when:** You need the authored keys of an existing clip, measured (ranges, spacing, frame grid), or the keys themselves.

**Not when:** You want the pose the engine produces at a time: use sample_animation.

Reads one animation's authored keys and measures them: per bone and channel the range and amplitude, key count and spacing, off-grid keys at the given fps; slot channels; constraint timelines; draw-order keys resolved by the runtime (who moved how many steps against setup). `detail` adds the keys themselves (compressed; `raw` for Spine's own form, including full bezier numbers); narrow with `bones` when asking for detail. Reading only.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton JSON; empty picks the folder's base (pass the delivery to read what you wrote). |
| `animation` (required) | string | Animation name. |
| `detail` | boolean | Also return the keys (compressed). |
| `raw` | boolean | With detail: keys in Spine's raw form. |
| `bones` | string[] | Only these bones in the bones section. |
| `fullDrawOrder` | boolean | Also return the full resolved slot order at each draw-order key (long). |
| `fps` | number (≥ 1, ≤ 240) | Frame rate the off-grid key count is measured against (default 30). |

Example:

```json
{
 "animation": "idle",
 "detail": true,
 "bones": [
  "head"
 ]
}
```

**Next:** `describe_animation`, `write_animation`

## sample_animation

*core, read only.* Exact poses at chosen times: local, applied (after constraints) and world transforms; slot and draw-order changes.

**Use when:** You need exact positions or rotations at given times, after constraints, for example to check a contact or a pose.

Samples one animation at the given times on the studio's engine and returns, per moving bone, the keyed local transform, the applied transform after constraints (IK on the engine; transform, path and physics with the Spine add-on on, which then simulates physics forward on a fixed 1/60 grid; without it `notEvaluated` names what was left out), and the world transform; per slot, attachment and colour where they differ from setup; and the draw order against setup (`steps` > 0 = drawn later, in front). Answers "where is the hand at 1.2 s", "was the motion actually written", "is the box behind the car". Default times: 0, a quarter, half, three quarters, end. Bones default to those that move. Reading only.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton JSON; empty picks the folder's base (pass the delivery to read what you wrote). |
| `animation` (required) | string | Animation name. |
| `times` | number[] | Instants in seconds. |
| `bones` | string[] | Bones to return; empty returns every bone that moves. |
| `skin` | string | Skin active while sampling. |
| `fullDrawOrder` | boolean | Also return the full slot order at each time. |

Example:

```json
{
 "animation": "jump",
 "times": [
  0,
  0.3,
  0.6
 ]
}
```

**Next:** `see_animation`

## describe_animation

*core, read only.* The clip in sentences: who moves when, how far, which way; fades, holds, overshoots, loop check, setup-pose pops.

**Use when:** You want a clip in sentences (who moves when, how far, eases, holds, loop seam) to check it says what was asked.

Describes an animation the way an animator would after one look, computed from the keys: per bone or slot "rises 15 units (eased) over 0.5-1.2 s with a 20% overshoot", "fades in over 0-1.3 s", "breathes 1 -> 1.05 -> 1"; staggered entrances; holds long enough to read; whether the loop is seamless; and setup-pose pops (a timeline whose first key sits after t=0 with a value the setup pose does not have, so the runtime snaps there), flagged as visible or masked. Every sentence carries its numbers; the structure behind the paragraph is returned too, with the critique verdict for orientation. Directions follow Spine: +x right, +y up, +rotation counter-clockwise. Without `animation`, a summary per animation.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton JSON; empty picks the folder's base (pass the delivery to read what you wrote). |
| `animation` | string | Animation name; empty gives a summary for every animation. |

Example:

```json
{
 "file": "hero_v2.json",
 "animation": "jump"
}
```

**Next:** `critique_animation`, `see_animation`

## critique_animation

*core, read only.* Measures a clip against the animation principles: ease, anticipation, overshoot, overlap, squash volume, holds, loop seam, readability; a verdict with numbers and fixes.

**Use when:** After writing a clip: measure whether the motion follows the animation principles (ease, anticipation, overlap, squash volume, holds, loop seam, readability).

check_skeleton asks "will Spine open it"; this asks "is the motion dead". It measures the authored keys: curve profile (all linear = constant speed), key count and spacing, anticipation and overshoot around the main move, holds long enough to read, scale reaching zero, sudden turns, and the animation principles: overlap (bones keyed on the same frames), one ease shape everywhere, squash or stretch that changes volume or sits on a bone with children, a loop that pops at its seam, left and right moving identically, and moves too small to see on screen. Principle findings name their `principle` and say `estimate: true` when the threshold is a rule of thumb. It also flags a clip that breaks the rig's own conventions (a closed lid shown without hiding the eye, when the owner's clips always hide it). It returns a verdict (good, mechanical, faulty, or unmeasured when no bone moves: then look at the frames), the measures and warn findings, each with a suggested fix. Mechanical motion asked for on purpose (a conveyor, a clock hand) is fine: say so and move on. When the skeleton has a brief (the brief tool), its loop flag, display size and subject preset are used unless you pass loop or pixelsPerUnit.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton JSON; empty picks the folder's base (pass the delivery to read what you wrote). |
| `animation` (required) | string | Animation name. |
| `loop` | boolean | Whether the clip loops, for the seam check; default guessed from the name (idle, loop, cycle, walk, run, breath, spin, float). |
| `pixelsPerUnit` | number (≥ 0.01, ≤ 100) | Screen pixels per skeleton unit at the size the game shows it, for the readability floor (default 1). |

Example:

```json
{
 "file": "hero_v2.json",
 "animation": "jump"
}
```

**Next:** `set_curves`, `write_animation`

## check_skeleton

*core, read only.* Audits a skeleton: what a player or editor rejects (fatal) or plays wrong (warn), plus whether the studio's engine plays it.

**Use when:** Prove a file opens and plays: after every write, and on any file you were handed.

Audits any skeleton JSON in the project (the studio's animation JSON, which is Spine 4.2 compatible). Returns findings as { level, code, where, message, params }: `fatal` means a player cannot read the file (the studio's engine, the Spine editor or a Spine runtime), `warn` means it plays but probably not as intended (a bezier handle written as a fraction, a sampled deform over budget, an animation section the format ignores). `runtime` says whether the studio's engine plays it and names anything it does not evaluate yet; with the Spine add-on on, `runtime.official` adds the official Spine runtime's verdict. Path attachments get the path repair scan. Answers "will this open", "is the file I was handed broken", "is the file I produced sound".

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton JSON; empty picks the folder's base skeleton. |

Example:

```json
{
 "file": "hero_v2.json"
}
```

**Next:** `see_animation`

## see_animation

*core, read only.* A filmstrip PNG of the animation at chosen times, rendered headlessly without a browser.

**Use when:** Look at what you wrote: a filmstrip of rendered frames. Done means seen.

Renders frames of one animation and returns ONE filmstrip PNG as the tool result, so you look at what you wrote. The studio's engine poses the skeleton (curves, IK, meshes, clipping, draw order; with the Spine add-on on, a rig with physics or transform/path constraints is posed by the official runtime) and a headless rasterizer draws it with the blend modes; no studio window or browser is involved. Frames are framed on the union of everything drawn across the requested times (so motion stays comparable between frames) unless `viewport` is given. Cost is roughly width x height / 750 tokens per frame; the default six 240 px frames cost a few hundred tokens and answer "who is in front, is the size right, how does the ease read" faster than numbers. Use sample_animation when you need exact values.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton JSON; empty picks the folder's base skeleton. |
| `animation` | string | Animation name; empty renders the first one. |
| `times` | number[] | Instants in seconds; empty takes six evenly spaced times from 0 to the end. |
| `width` | integer (≥ 64, ≤ 640) | Width of each frame in pixels (64-640, default 240). This sets the token cost. |
| `aspect` | number (≥ 0.2, ≤ 5) | Frame aspect ratio width / height (0.2-5, default 1.5). |
| `margin` | number (≥ 0, ≤ 0.4) | Fraction of the frame kept free around the subject (0-0.4, default 0.08). |
| `columns` | integer (≥ 1, ≤ 12) | Frames per filmstrip row (1-12, default 3). |
| `skin` | string | Skin to show; empty uses the skeleton default. |
| `viewport` | object | Fixed world-space box to frame instead of the automatic union of everything drawn. |

Example:

```json
{
 "file": "hero_v2.json",
 "animation": "jump",
 "width": 240,
 "columns": 3
}
```

**Next:** `critique_animation`, `reply`

## write_animation

*core, writes files.* Writes one animation (animation JSON, Spine 4.2 compatible) onto the base and saves a proven delivery beside it; the base is never written.

**Use when:** Write or replace one clip. The base is never touched; the result is a new delivery file beside it.

**Not when:** You only want to change eases of existing keys: use set_curves.

The write path. `clip` is ONE animation in the studio's animation JSON (the same shape as Spine 4.2's), exactly as it appears under "animations" in a skeleton file: { bones: { <bone>: { rotate: [{ time, value, curve }], translate: [{ time, x, y, curve }], scale, shear, ... } }, slots: { <slot>: { rgba, rgb, alpha, attachment, ... } }, ik, transform, path, physics, attachments (deform), drawOrder, events }. Values: translate and rotate are OFFSETS from the setup pose, scale is a multiplier, time in seconds. `curve` may be "stepped", "linear", a bezier array (cx in SECONDS), or a preset name: linear, in/out/inOut + Sine, Quad, Cubic, Quart, Expo or Back (e.g. "outCubic", "inOutSine", "outBack" for an overshoot), or the aliases "easeIn", "easeOut", "easeInOut", "overshoot" (expanded to the exact bezier for that key pair). A curve may also be a shape of your own: { handles: [x1, y1, x2, y2] }, fractions of the segment's time and value. FOLLOW-THROUGH: instead of keys, a bone's rotate may be { follow: <bone>, of: "rotate" | "translate.x" | "translate.y", frequency, damping, amount }: it trails that bone's keys in this clip through a damped spring (lags, swings past, settles) and is baked to rotate keys; use it for hair, tails, ears, ribbons. frequency is swings per second (2 to 3 loose, 4 to 6 stiff), damping 0.05 to 2 (1 = no overshoot), amount scales the swing. The result lists them under `followed`. The studio validates the clip, holds each value channel's first key back to t=0 so a reveal does not leak the setup pose (reported), composes it onto the base: the clip you write wins, other clips and channels already in the delivery are kept, the owner's own clips stay as they are. It refuses, writing nothing, if the result fails a check the base passes or the player refuses it (the studio's engine; with the Spine add-on on, the official runtime too). The delivery lands as <base>_v2.json (or `into`) beside the base with its atlas; the previous delivery is backed up. The answer lists, under `prove`, the calls to run before calling it done (check_skeleton, critique_animation, see_animation), and under `conventions` any rig convention the clip breaks (a closed lid without the eye hidden).

| Argument | Type | Meaning |
|---|---|---|
| `animation` (required) | string | Name of the animation to write (used exactly as given). |
| `clip` (required) | object | One animation in animation JSON, Spine 4.2 compatible (the object that sits under "animations" -> name in a skeleton file). |
| `from` | string | Project-relative base skeleton; empty picks the folder's base. Never written. |
| `into` | string | Project-relative delivery file in the base's folder; empty means <base>_v2.json. Only studio deliveries are ever overwritten. |
| `replace` | boolean | Default false: timelines you do not write this call keep what earlier calls wrote; a timeline you do write replaces that timeline whole. true rebuilds this clip from the base before applying yours. |
| `fps` | number (≥ 1, ≤ 240) | Snap every key time to this frame grid and report the moved keys; empty keeps times as written. |
| `holdFromStart` | boolean | Default true. false keeps value channels showing the setup pose until their first key. |

Example:

```json
{
 "animation": "hop",
 "clip": {
  "bones": {
   "body": {
    "translate": [
     {
      "time": 0,
      "x": 0,
      "y": 0,
      "curve": "inQuad"
     },
     {
      "time": 0.1,
      "x": 0,
      "y": -6,
      "curve": "outCubic"
     },
     {
      "time": 0.35,
      "x": 0,
      "y": 40,
      "curve": "inQuad"
     },
     {
      "time": 0.6,
      "x": 0,
      "y": 0
     }
    ],
    "scale": [
     {
      "time": 0,
      "x": 1,
      "y": 1
     },
     {
      "time": 0.1,
      "x": 1.1,
      "y": 0.9,
      "curve": "outQuad"
     },
     {
      "time": 0.2,
      "x": 0.92,
      "y": 1.08
     },
     {
      "time": 0.6,
      "x": 1.1,
      "y": 0.9,
      "curve": "outBack"
     },
     {
      "time": 0.75,
      "x": 1,
      "y": 1
     }
    ]
   }
  }
 },
 "fps": 30
}
```

**Next:** `check_skeleton`, `see_animation`, `critique_animation`

## delete_animation

*core, writes files.* Deletes named animations from a delivery file, all or nothing; owner files are refused.

**Use when:** Remove clips from a studio delivery (never from the owner's base).

Removes the named animations from a studio delivery file in place; everything else (bones, slots, skins, constraints, other animations) is untouched. Owner files are refused: the base is never written. All or nothing: if any name is missing, nothing is deleted and the available names are returned. Names are identity: no trimming. The delivery is backed up first.

| Argument | Type | Meaning |
|---|---|---|
| `file` (required) | string | Project-relative delivery file. |
| `animations` (required) | string[] | Animation names to delete. |

Example:

```json
{
 "file": "hero_v2.json",
 "animations": [
  "example_rise"
 ]
}
```

**Next:** `scan_project`

## set_curves

*core, writes files.* Applies an easing preset (or raw handles) to the segments of an animation; key values and times never move.

**Use when:** Change the easing of existing keys without moving them, for example to give a landing an outBack settle.

Re-eases existing keys: every selected segment gets the preset's exact Spine bezier for its own key pair (cx in seconds), "linear" removes the curve, "stepped" holds. Key values and times never move; attachment, draw order and inherit channels are skipped and reported. Presets: linear, inSine, inQuad, inCubic, inQuart, inExpo, outSine, outQuad, outCubic, outQuart, outExpo, inOutSine, inOutQuad, inOutCubic, inOutQuart, inOutExpo, inBack, outBack, inOutBack; or raw normalized handles [x1, y1, x2, y2] with x1 and x2 in 0..1. Filter by bones, slots, channels and a time range (segments whose first key lies in [from, to]). Writes through the delivery model: a delivery is updated in place with a backup; a base becomes a new delivery.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton (a delivery is updated in place; a base becomes a new delivery). |
| `into` | string | Only when `file` is a base: the new delivery file; default <base>_v2.json. |
| `animation` (required) | string | Animation to re-ease. |
| `preset` (required) | any | A preset name, "linear", "stepped", or four numbers [x1, y1, x2, y2]. |
| `bones` | string[] | Only these bones; empty = all. |
| `slots` | string[] | Only these slots; empty = all. |
| `channels` | string[] | Only these channels (rotate, translate, scale, alpha, rgba, ...); empty = all that carry curves. |
| `from` | number (≥ 0) | Only segments whose first key is at or after this time. |
| `to` | number (≥ 0) | Only segments whose first key is at or before this time. |

Example:

```json
{
 "file": "hero_v2.json",
 "animation": "jump",
 "preset": "outCubic",
 "bones": [
  "body"
 ],
 "channels": [
  "translate"
 ]
}
```

**Next:** `see_animation`, `critique_animation`

## add_effect

*core, writes files.* Adds an effect to a clip (burst, trail, flash, glow, shake) as ordinary bones, slots and keys every player shows the same.

**Use when:** The clip needs an effect: coins or sparks flying out (burst), a motion trail, a hit flash, a pulsing glow, a camera or object shake.

**Not when:** The effect needs new art: draw it first with draw_rig, then reuse it here.

Effects as data, not a particle engine: what it writes is plain skeleton JSON, so the studio, the Godot export and any Spine runtime play it identically and every key stays editable. Kinds: burst, trail, flash, glow, shake.
- burst: `count` copies of `sprite` fly out from its bone (or `bone`) at `at` s, `duration` per particle; aim and feel in `tune`. Coins from a chest, sparks from a hit, confetti.
- trail: `count` ghosts of `sprite` follow its bone, fading (`tune.delay`, `tune.strength`). The bone must already move in the clip.
- flash: an additive copy of `sprite` lights up at `at` for `duration` (`tune.color`, `tune.strength`): a hit flash, a reward pop.
- glow: the same copy pulsing (`tune.cycles`, `tune.period`).
- shake: `bone` jitters around its place, decaying over `duration` (`tune.amplitude`, `tune.frequency`). Shake a bone that does not already travel in the clip (a parent made for it).
Effects reuse existing art (nothing is drawn). Writes through the delivery model like every other write; then look at it with see_animation.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton (a delivery is updated in place; a base becomes a new delivery). |
| `into` | string | Only when `file` is a base: the new delivery file; default <base>_v2.json. |
| `kind` (required) | `burst` \\| `trail` \\| `flash` \\| `glow` \\| `shake` | The effect. |
| `animation` (required) | string | The clip it is written into (created when it does not exist). |
| `sprite` | object | The art the effect reuses: a slot and one of its attachments (default the slot's setup attachment). |
| `bone` | string | For shake: the bone that jitters. For burst: the bone the particles start from (default the sprite's bone). |
| `at` | number (≥ 0) | When the effect starts, in seconds. |
| `duration` | number (≥ 0.01, ≤ 30) | Length of a flash or shake, or of each burst particle. |
| `count` | number (≥ 1, ≤ 64) | Burst particles (1-64) or trail ghosts (1-12). |
| `tune` | object | Per-kind settings, all optional. Burst: name (bones are fx_<name>), direction (deg, 0 right, 90 up; default 90), spread (deg 0-360; default 360), distance (units; default 140), gravity (0..1, default 0.35), spin (deg, default 240), scale [start, end] (default [1, 0.3]), stagger (s, default 0.02), x and y (start offset, default 0), additive, seed (default 1). Trail: delay (s between ghosts, default 0.04), strength (0..1 first ghost opacity, default 0.5), additive (default true). Flash and glow light up `sprite` itself. Flash: color (rrggbb, default ffffff), strength (0..1, default 1). Glow: color, strength (default 0.6), period (s, default 1.2), cycles (default 2). Shake: amplitude (units, default 8), frequency (Hz, default 24). |

Example:

```json
{
 "kind": "burst",
 "animation": "open",
 "sprite": {
  "slot": "coin"
 },
 "at": 0.4,
 "count": 12,
 "tune": {
  "direction": 90,
  "spread": 70
 }
}
```

**Next:** `see_animation`, `critique_animation`

## style_guide

*core, writes files.* The project's art direction: palette by role, stroke weights, corner radii, light, grid, type and sizes. Read it, start it from a preset, or change it.

**Use when:** Before drawing anything for a project, and whenever its look changes: fix the palette by role, outline weights, corner radii, light, type and sizes every drawn part follows.

**Not when:** The owner brought their own art: their look is in their files, not in a guide.

The art-direction step before drawing. The guide lives in <project>/keyframe.style.json and every part drawn with `shapes` or a `component` in draw_rig follows it by name: fill "primary", sw "bold", r "md". With no arguments it returns the guide (or the default preset while the project has none). `preset` starts the guide from one of: casual-game (Chunky, friendly game UI: thick dark outline, pill and soft corners, light from the top, a glossy shine.) flat-web (Clean web UI: no outline, small radii, flat fills with a soft shadow, sentence case.) dark-sci (Sci-fi HUD: sharp corners, thin bright lines on dark panels, glow instead of shadow.) `set` changes parts of it: { palette: { primary: "#4cc461", ... }, stroke: { thin, regular, bold, color }, radius: { sm, md, lg, pill }, light: { from: top | top-left | top-right, shade 0-1, shine 0-1, shadow units, shadowAlpha 0-1 }, grid, type: { size: { sm, md, lg }, weight: bold | regular, case: upper | none, outline }, sizes: { button: [w, h], icon, ... }, note }. Palette roles are your own words too (brand, gold). After a change, draw_rig { name, restyle: true } redraws a drawing with it. The answer warns when a label colour cannot be read on its fill.

| Argument | Type | Meaning |
|---|---|---|
| `preset` | `casual-game` \\| `flat-web` \\| `dark-sci` | Start the guide (or start it again) from a preset. |
| `set` | object | The settings to change; the rest stays. |
| `name` | string | A name for the guide (the art direction of this project). |

Example:

```json
{
 "preset": "casual-game",
 "set": {
  "palette": {
   "primary": "#4cc461"
  }
 }
}
```

**Next:** `draw_rig`

## draw_rig

*core, writes files.* Draws placeholder art as SVG parts and builds the rig from it: a skeleton, an atlas and a page image the studio plays at once.

**Use when:** There is no art yet, or a part is missing: draw the parts (components, shapes in the style guide, or SVG) and get a rig the studio plays at once, or an artboard that is never rigged.

**Not when:** The owner has art: work on their skeleton instead; never redraw a file the studio did not draw.

Starts a project from a description: draw each part (head, body, arm_l, lid, coin) as one small SVG, place it (`at`), say where it turns (`pivot`) and what carries it (`parent`). The studio draws the SVGs into an atlas page and writes <folder>/<name>.json (a Spine 4.2 skeleton whose setup pose is the finished picture), <name>.atlas, <name>.png and <name>.parts.json (the parts, which the drawing board in the page edits and rebuilds from). Parts are listed back to front.
SVG that is drawn: rect, circle, ellipse, line, polyline, polygon, path (all commands), g with transform, fill and stroke (colours, linear and radial gradients), opacity, stroke-linecap. Not drawn (and named in `skipped`): text, filters, masks, clip paths, images, <use>. Prefer `shapes` and `component` over raw SVG: they cost a tenth of the tokens and follow the project's style guide (style_guide) by name, with labels in the built-in stroke font and icons from the family (30 glyphs: star, heart, coin, gem, check, close, plus, minus, play, pause, home, lock, gear, sound, mute, music, back, next, info, question, trophy, shield, bolt, clock, cart, user, menu, refresh, key, flag). `restyle: true` with no parts redraws every part drawn from shapes or a component with the current guide. Keep one part per moving piece. Ready-made props and effect sprites (coin, star, spark, heart, gem, cloud, leaf, drop) come from the bundled asset library as `svg: "asset:keyframe-basics/coin"`.
With `merge: true` the parts are added to the drawing of the same name (a part with an existing name replaces it in place, a new one goes in front) and the rest is kept: draw a figure one part or a few parts per call, back to front, and the page shows each part being drawn as it arrives (every call is shown live on the drawing board). Drawing again under the same name without `merge` replaces the whole drawing and keeps the clips already written (keys on a part that no longer exists are dropped and listed); every file is backed up first. A name whose files the studio did not draw is refused. Then animate it with write_animation and look at it with see_animation.

| Argument | Type | Meaning |
|---|---|---|
| `name` (required) | string | The rig name: the files are <name>.json, .atlas, .png and .parts.json. |
| `parts` | object[] | The parts, back to front (a component counts once and may give several). |
| `folder` | string | Project-relative folder for the files; created when missing. Default the project root. |
| `resolution` | number (≥ 0.25, ≤ 8) | Atlas pixels per rig unit. Default 2 (crisp at twice the rig size). |
| `as` | `rig` \\| `artboard` | rig (default): a skeleton to animate. artboard: a design that is never rigged (an icon set, a logo, a UI sheet): writes <name>.svg and <name>.png with the parts, no skeleton. A drawing keeps its kind when drawn again. |
| `restyle` | boolean | Redraw every part of the drawing that was drawn from shapes or a component with the current style guide (no parts needed). Parts given as SVG stay as they are. |
| `merge` | boolean | Add these parts to the drawing of the same name (same name replaces in place, a new name goes in front) and keep the others. Default false: the parts are the whole drawing. |

Example:

```json
{
 "name": "menu",
 "folder": "ui",
 "parts": [
  {
   "name": "play",
   "component": {
    "component": "button",
    "label": "PLAY",
    "icon": "play"
   },
   "at": [
    0,
    0
   ]
  },
  {
   "name": "coin",
   "box": [
    64,
    64
   ],
   "shapes": [
    {
     "circle": [
      32,
      32,
      28
     ],
     "fill": "reward",
     "shine": true
    }
   ],
   "at": [
    160,
    0
   ],
   "states": [
    "hover",
    "pressed"
   ]
  }
 ]
}
```

**Next:** `critique_art`, `brief`, `write_animation`

## critique_art

*core, writes files.* The art director's check of a drawing against the style guide: palette drift, outline weights, alignment, silhouettes at small size, states too alike, contrast. Writes a contact sheet to look at.

**Use when:** After every draw_rig, before animating or exporting: check the drawing against the style guide and look at its contact sheet.

**Not when:** The motion is in question, not the drawing: that is critique_animation.

Run after every draw_rig, before animating or exporting: the PROVE step of drawing. It measures the parts of a drawing (<name>.parts.json) against the project's style guide: colours outside the palette and its tones (palette), outline weights off thin/regular/bold after the part's scale (stroke), parts that almost line up and corners off the grid (align), parts that blur away at 24 px (silhouette), hover/pressed/disabled looks too close to the normal one (states), parts that melt into the surface colour (contrast). Each finding names the part, the number measured and the fix. It also draws every part and state side by side on the surface colour, named underneath, into <project>/.keyframe/art/<name>-sheet.png: look at it (an image you can open) before calling the drawing done.

| Argument | Type | Meaning |
|---|---|---|
| `file` (required) | string | The drawing: the <name>.parts.json draw_rig wrote. |

Example:

```json
{
 "file": "ui/buttons.parts.json"
}
```

**Next:** `draw_rig`, `write_animation`, `export_art`

## export_art

*core, writes files.* Exports a drawing for engines and the web: trimmed transparent PNGs per part and state at chosen scales with pivots, a sprite sheet with a JSON map, clean SVG, and a clip as a PNG sequence and sheet.

**Use when:** The drawing (or one of its clips) is needed outside the studio: PNGs at 1x/2x/3x for an engine, a sprite sheet with its map, clean SVG for the web, a clip as frames.

**Not when:** The animation goes to an engine with a skeletal runtime: deliver the skeleton itself (write_animation) instead of frames.

Writes new files into <folder>/<name>-export/ (never touches the drawing or the owner's files; a second export replaces the folder's files): `parts` png@<s>x/<part>.png, each part and each state at scale s (pixels per rig unit), transparent and trimmed, with parts.json listing for each its trim offset, source size and pivot in pixels so an engine places and turns it like the rig; `sheet` <name>@<s>x.png and .json, all of them packed into one sprite sheet with a frame map in the common JSON-hash layout (frame, spriteSourceSize, sourceSize, pivot) that game engines and web libraries read; `svg` svg/<part>.svg and <name>.svg, clean SVG with a <g id> per part for web pages and design tools; `clip` (with `animation`) clip-<anim>/frame_0000.png... and clip-<anim>@sheet.png/.json at `fps`, for engines without a skeletal runtime. Kinds: parts, sheet, svg, clip; default parts, sheet and svg. Scales default [1, 2]; `pixels` instead sets the longest side of the whole drawing.

| Argument | Type | Meaning |
|---|---|---|
| `file` (required) | string | The drawing: the <name>.parts.json draw_rig wrote. |
| `kinds` | string[] | What to export; default parts, sheet and svg. |
| `scales` | number[] | Pixels per rig unit, one export each (1x, 2x, 3x). Default [1, 2]. |
| `pixels` | number (≥ 8, ≤ 8192) | Instead of scales: the longest side of the whole drawing in pixels. |
| `animation` | string | The animation to export as frames (kind clip). Read from the latest delivery (<name>_v2.json) when there is one. |
| `fps` | number (≥ 1, ≤ 60) | Frames per second of the clip export; default 24. |
| `size` | number (≥ 16, ≤ 2048) | Square frame size of the clip export in pixels; default 256. |

Example:

```json
{
 "file": "ui/buttons.parts.json",
 "scales": [
  1,
  2,
  3
 ]
}
```

**Next:** `critique_art`

## bake_animation

*core, writes files.* Bakes constraint results (physics, IK, transform, path) or curves into plain linear bone keys, verified by replay on the runtime.

**Use when:** The target engine lacks physics or constraints, or a clip must play identically everywhere: record what the constraints do as plain keys.

Drives the animation (on the studio's engine; a rig with physics, transform or path constraints needs the Spine add-on, and the tool says so) and writes the pose the constraints actually produce as ordinary bone keys, so the engine stops evaluating them every frame. `what`: "physics" (default; physics simulated forward on a fixed 1/60 grid and its blocks dropped), "curves" (bezier interpolation resampled into dense linear keys), "all" (both, plus ik/transform/path). `remove` chooses separately which constraint blocks leave the file; `keepLive` names bones left exactly as the base has them. The result checks itself: the delivered file is replayed on the runtime without the removed constraints and world positions are compared (tolerance 0.5). A physics bake is a recording of one deterministic playthrough: exact for decorative motion, a loss for physics that reacts to gameplay; the report says so.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton (a delivery is updated in place; a base becomes a new delivery). |
| `into` | string | Only when `file` is a base: the new delivery file; default <base>_v2.json. |
| `animations` | string[] | Animations to bake; empty bakes every animation. |
| `what` | `physics` \\| `curves` \\| `all` | What is baked away (default physics). |
| `remove` | string[] | Constraint kinds whose blocks leave the file; default follows `what`. |
| `fps` | number (≥ 1, ≤ 60) | Key rate, snapped to a divisor of 60 so samples land on simulation steps (default 30). |
| `physicsStep` | integer (≥ 1, ≤ 8) | Physics-driven bones keep one key in every N samples; first and last are always kept (default 1). |
| `keepLive` | string[] | Bones not baked, left exactly as the base has them. |
| `skin` | string | Skin active while measuring; empty uses the default. |

Example:

```json
{
 "file": "hero.json",
 "what": "physics"
}
```

**Next:** `check_skeleton`, `see_animation`

## paint_weights

*core, writes files.* Binds a mesh (or a flat image turned into a grid mesh) to a chain of bones with smooth weights, so the part bends instead of moving rigidly.

**Use when:** A part should bend instead of moving rigidly (tail, ribbon, cloth): bind its image to a chain of existing bones.

Weight painting. Give the attachment (`slot`, `attachment`, and `skin` when the name exists in several skins) and `bones`: the bones it should bend with, usually a chain from the root of the part to its tip (a tail, an arm, a torso, a ribbon). A flat image (region) needs `grid: [columns, rows]` first: it becomes a mesh with the same picture and vertices that can bend; put more cells along the direction of the bend (for a horizontal ribbon [12, 2], for a hanging tail [2, 10]). Each vertex is weighted by its distance to every listed bone, then the weights are smoothed over the mesh so the bend spreads over a band. `falloff` 0.5 (soft, wide blend) to 8 (sharp, short blend), default 2.5; `smooth` passes, default 3; `maxInfluences` bones per vertex, 1 to 4, default 3. The setup pose does not move: every vertex keeps its place, measured and refused otherwise. The result reports which bone carries how much and how many vertices blend. Then animate the bones (write_animation; a chain bends well with follow requests) and look at it with see_animation. Refused: a mesh with deform keys (they would no longer match), linked meshes, bones that do not exist. The base is never written; a later write_animation carries the painted mesh over unless the owner changed that attachment in the base.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton (a delivery is updated in place; a base becomes a new delivery). |
| `into` | string | Only when `file` is a base: the new delivery file; default <base>_v2.json. |
| `skin` | string | The skin holding the attachment; needed only when several skins have it. |
| `slot` (required) | string | Slot of the attachment. |
| `attachment` (required) | string | Attachment name (its key in the skin). |
| `bones` (required) | string[] | The bones the part bends with, usually a chain from its root to its tip. |
| `grid` | integer[] | For a region only: turn it into a grid mesh of [columns, rows] cells first. |
| `falloff` | number (≥ 0.5, ≤ 8) | How sharply a bone's weight drops with distance: 0.5 soft and wide, 8 sharp and short. |
| `smooth` | integer (≥ 0, ≤ 20) | Passes that even the weights over the mesh's edges. |
| `maxInfluences` | integer (≥ 1, ≤ 4) | Most bones one vertex follows; mobile GPUs skin up to 4. |

Example:

```json
{
 "slot": "tail",
 "attachment": "tail",
 "bones": [
  "tail1",
  "tail2",
  "tail3"
 ],
 "grid": [
  2,
  10
 ]
}
```

**Next:** `write_animation`, `see_animation`

## list_history

*core, read only.* The backups the studio keeps of a file it wrote, newest first.

**Use when:** Find an earlier version of a file the studio wrote, to restore it.

Lists the backups of a file the studio has written (deliveries, atlases beside them): stamp, size and time, newest first. restore_file brings one back. Owner files the studio never wrote have no history.

| Argument | Type | Meaning |
|---|---|---|
| `file` (required) | string | Project-relative file. |

Example:

```json
{
 "file": "hero_v2.json"
}
```

**Next:** `restore_file`

## restore_file

*core, writes files.* Brings back an earlier version of a file the studio wrote; the current one is backed up first.

**Use when:** Undo: bring back a backup listed by list_history (the current version is backed up first).

Restores one backup (a stamp from list_history) over a file the studio wrote. The current version is backed up first, so a restore is itself undoable. Files the studio never wrote have no history and are refused.

| Argument | Type | Meaning |
|---|---|---|
| `file` (required) | string | Project-relative file. |
| `backup` (required) | string | Backup stamp from list_history. |

Example:

```json
{
 "file": "hero_v2.json",
 "backup": "20261124-101500-000"
}
```

**Next:** `check_skeleton`

## critique_rig

*advanced, read only.* Is the rig built well: unused bones, pivots sitting at the centre of their art, constraints with no effect.

**Use when:** Before animating an unfamiliar rig: find unused bones, pivots at the centre of their art and constraints with no effect.

The file opens, but is the rig built to animate? It flags bones nothing uses, bones whose pivot sits at the centre of the art they carry (rotating spins the art in place instead of hinging, the chest-lid case), and constraints whose mixes leave them with no effect, each with its severity and why. World positions come from the setup pose. The rig belongs to the owner: report, do not change it.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton JSON; empty picks the folder's base (pass the delivery to read what you wrote). |

Example:

```json
{
 "file": "hero.json"
}
```

**Next:** `read_rig`

## migrate_swap_to_skin

*advanced, writes files.* Without groups: suggests clip families that differ only in attachments. With groups: folds each family into one clip plus named skins.

**Use when:** Several clips repeat the same motion once per colour or material and should become one clip with skins.

For clips that repeat the same motion once per colour or material (Bronze_Chest, Gold_Chest, Silver_Chest): without `groups` the tool only suggests families (clips identical once attachment timelines are stripped) and writes nothing. With `groups` it folds each group into the base clip plus one named skin per variant, creating no new art: skins only re-point existing images. A group that fails any check is skipped whole and the reason reported. The result is proven: every original clip, sampled under its new skin, matches the surviving clip on the runtime, and the file has no new fatal finding.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton (a delivery is updated in place; a base becomes a new delivery). |
| `into` | string | Only when `file` is a base: the new delivery file; default <base>_v2.json. |
| `groups` | object[] | Explicit families: base is the clip that already shows the setup look; each variant becomes a skin. |
| `allowMotionDrift` | boolean | Fold a variant whose motion differs from the base (the lost motion is named). Default false. |
| `overwriteSkins` | boolean | Replace an existing skin of the same name (never the default skin). Default false. |

Example:

```json
{}
```

**Next:** `check_skeleton`

## merge_animation

*advanced, writes files.* Copies an animation from another skeleton into this one, with the bones, slots and art it needs; conflicts retargeted or renamed.

**Use when:** Bring a clip from another skeleton into this one, with the bones, slots and art it needs.

Merging two skeletons is something the Spine editor cannot do (CLI import appends a second skeleton; Import Data drops animations). This brings one animation from `source` into the target skeleton together with the bones, slots, attachments, constraints and events it depends on. Names that already exist are `retarget`ed onto the target's own parts (default) or `rename`d with a prefix. The merged file is proven on the runtime: the animation poses shared bones and slots exactly as in its source. Without `animation`, lists the source's animations and what each depends on, writing nothing.

| Argument | Type | Meaning |
|---|---|---|
| `source` (required) | string | Project-relative skeleton that owns the animation. |
| `animation` | string | Animation to merge; empty lists the source animations and their dependencies. |
| `file` | string | Project-relative skeleton that receives the animation (a delivery is updated in place; a base becomes a new delivery). |
| `into` | string | Only when `file` is a base: the new delivery file; default <base>_v2.json. |
| `onConflict` | `retarget` \\| `rename` | Existing names: retarget onto the target's parts (default) or rename with the prefix. |
| `prefix` | string | Prefix for renamed parts (default merged_). |
| `as` | string | Name the merged animation gets in the target; default its source name. |

Example:

```json
{
 "source": "effects.json"
}
```

**Next:** `check_skeleton`, `see_animation`

## edit_weights

*advanced, writes files.* Mechanical weight repair on an existing weighted mesh: clean crumbs, renormalize, transfer, add or remove an existing bone's influence.

**Use when:** Repair the weights of an already weighted mesh: clean crumbs, renormalize, move influence between existing bones.

Repairs the weights of a mesh that is already weighted, mechanically and provably; it never paints and never changes topology. Operations: "clean" drops influences under `threshold` and renormalizes; "normalize" makes every vertex sum to 1; "transfer" moves `ratio` of `from`'s weight to `to` (both existing bones), keeping the setup pose; "add_influence" gives `bone` a `weight` share; "remove_influence" removes `bone` and renormalizes. Guaranteed: uvs, triangles, hull and edges byte-identical; vertex count unchanged; every vertex keeps an influence and sums to 1; bones only from the current rig; a mesh with a deform timeline is refused outright; any violation writes nothing. The repair is stamped with the base mesh signature, so it survives later animation writes until the owner edits that mesh in Spine (then the base wins, and the write says so).

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton (a delivery is updated in place; a base becomes a new delivery). |
| `into` | string | Only when `file` is a base: the new delivery file; default <base>_v2.json. |
| `op` (required) | `clean` \\| `normalize` \\| `transfer` \\| `add_influence` \\| `remove_influence` | The repair to apply. |
| `slot` | string | Slot of the mesh; needed when several meshes exist. |
| `attachment` | string | Attachment name of the mesh; needed when several meshes exist. |
| `threshold` | number (≥ 0, ≤ 0.5) | clean: influences below this weight are dropped (default 0.01). |
| `from` | string | transfer: the bone giving weight. |
| `to` | string | transfer: the bone receiving weight. |
| `ratio` | number (≥ 0, ≤ 1) | transfer: fraction of from's weight moved (default 1). |
| `bone` | string | add_influence / remove_influence: the bone. |
| `weight` | number (≥ 0, ≤ 1) | add_influence: the share given to the bone (default 0.1). |

Example:

```json
{
 "op": "clean",
 "slot": "cape",
 "attachment": "cape",
 "threshold": 0.02
}
```

**Next:** `read_weights`, `see_animation`

## read_weights

*advanced, read only.* Which bones carry each weighted mesh and how much; flags drifted sums, crumbs, out-of-range bones and too many influences.

**Use when:** Find out which bones carry a weighted mesh and whether its weights are healthy.

Reports every weighted mesh (or one, by slot and attachment): influences per bone, vertices per bone count, sum drift, sub-threshold crumbs, bone indices out of range, and vertices with more influences than mobile GPUs skin (4). Findings use the check shape. Reading only.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton. |
| `slot` | string | Only this slot. |
| `attachment` | string | Only this attachment. |
| `raw` | boolean | Also return per-vertex influences (long). |

Example:

```json
{
 "slot": "cape",
 "attachment": "cape"
}
```

**Next:** `edit_weights`

## diff_skeletons

*advanced, read only.* What differs between two skeletons: bones, slots, skins, attachments, constraints and animations, by name.

**Use when:** Compare two versions of a skeleton, for example a delivery against its base or a new export against the old one.

Compares two skeleton JSON files structurally: added, removed and changed bones (with the setup fields that changed), slots, skins and attachments, constraints, events and animations. Answers "did my delivery leave the rig untouched", "what did the owner change in the new export". Reading only.

| Argument | Type | Meaning |
|---|---|---|
| `before` (required) | string | Project-relative skeleton (the older or the base). |
| `after` (required) | string | Project-relative skeleton (the newer or the delivery). |

Example:

```json
{
 "before": "hero.json",
 "after": "hero_v2.json"
}
```

**Next:** `check_skeleton`

## read_atlas

*advanced, read only.* Pages and region geometry of a .atlas, read by the official parser.

**Use when:** You need the page and region geometry of an atlas.

Reads a texture .atlas (the libGDX/Spine text format) with the studio's atlas reader: every page (name, size, premultiplied alpha, filters) and every region (page, packed x/y, size before rotation, rotation degrees, trim offsets, original size). Give `atlas` directly, or a skeleton to read the atlas paired beside it.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton JSON; empty picks the folder's base. |
| `atlas` | string | Project-relative .atlas path instead of the one beside the skeleton. |

Example:

```json
{
 "file": "hero.json"
}
```

**Next:** `check_assets`

## check_assets

*advanced, read only.* Does every image the skeleton uses resolve: atlas regions present, page images on disk.

**Use when:** A skeleton opens but shows white boxes or missing art: check every region and page image resolves.

Checks that the art a skeleton needs is really there: every region and mesh attachment (by its path, or name) must exist as a region in the paired atlas, and every page image the atlas names must exist beside it. A skeleton that passes check_skeleton can still open as white boxes when this fails. Reading only.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton JSON; empty picks the folder's base. |

Example:

```json
{
 "file": "hero.json"
}
```

**Next:** `read_atlas`

## spine_info

*advanced, read only.* Asks the installed Spine command line about a .spine, .json or .skel file; refuses without a licensed Spine.

**Use when:** Ask a licensed Spine install what it says about a file (only when Spine is installed).

**Not when:** Spine is not installed: check_skeleton answers without it.

Runs the installed Spine command line in info mode (`Spine -i <file>`) and returns what the real editor says, verbatim (its format is undocumented, so nothing is parsed), with the license holder line hidden. This is "will the real Spine open it"; check_skeleton answers without Spine. Needs a licensed install: set SPINE_CLI to the executable, or spineCli in studio.config.json. Without it the tool refuses and runs nothing.

| Argument | Type | Meaning |
|---|---|---|
| `file` (required) | string | Project-relative .spine, .json or .skel file. |

Example:

```json
{
 "file": "hero.json"
}
```

**Next:** `check_skeleton`

## export_binary

*advanced, writes files.* Writes a Spine binary .skel of a skeleton, verified by the official binary reader; needs the Spine add-on.

**Use when:** The game wants a binary .skel instead of JSON.

Writes the Spine 4.2 binary form of a skeleton JSON (smaller and faster to load in a game). The output is read back with the official Spine binary reader before it is kept, so this tool needs the Spine add-on and refuses (spine-addon-off) without it, writing nothing. Default target is <file>.skel beside the JSON; an existing .skel is overwritten only when it belongs to a studio delivery (and is backed up), never the owner's own export.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton JSON. |
| `into` | string | Project-relative .skel target; default beside the JSON. |
| `nonessential` | boolean | Keep nonessential editor data (bone colours, icons, ...). Default true. |

Example:

```json
{
 "file": "hero_v2.json"
}
```

## export_player

*advanced, writes files.* Writes one HTML file that plays a skeleton by double-click, with no studio, server or network.

**Use when:** The owner wants to show or send the animation to someone who has no studio: one HTML file that plays by double-click.

Writes a standalone player: one HTML file with the studio's engine, the skeleton and its atlas pages inside, that plays in any browser opened from disk (clip menu, play/pause, loop, speed). Use it to show or send an animation to someone without the studio. Default target is <file>.player.html beside the skeleton; an existing player is replaced with a backup, any other file is never overwritten.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton JSON (Spine 4.2 or Keyframe). |
| `into` | string | Project-relative .html target; default <file>.player.html beside the skeleton. |
| `animation` | string | The clip the player starts with; default the first. |

Example:

```json
{
 "file": "hero_v2.json"
}
```

## export_godot

*advanced, writes files.* Writes <file>.kfscene for Godot 4: the Keyframe add-on imports it as Skeleton2D, Polygon2D and AnimationPlayer nodes.

**Use when:** The animation goes into a Godot 4 game: Godot imports the .kfscene with the Keyframe add-on as its own nodes and tracks.

Writes the Godot scene description of a skeleton beside it (<file>.kfscene). In a Godot 4 project with the Keyframe add-on (integrations/godot), copy the .kfscene with its atlas pages and Godot imports it as a scene: Skeleton2D and Bone2D, a Polygon2D per attachment, and an AnimationPlayer whose clips are Godot's own tracks (keyed bone channels keep their bezier handles; IK, inherit modes and shear are baked into keys at `fps`). The answer lists what was baked and what Godot cannot show (clipping, tint black). An existing .kfscene is replaced with a backup.

| Argument | Type | Meaning |
|---|---|---|
| `file` | string | Project-relative skeleton JSON (Spine 4.2 or Keyframe). |
| `fps` | number | Frames per second for baked keys (constraints, colour, draw order, deform). Default 30. |

Example:

```json
{
 "file": "hero_v2.json"
}
```
