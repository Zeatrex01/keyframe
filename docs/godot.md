# Godot

Keyframe Studio delivers to Godot 4 as Godot's own nodes: `Skeleton2D` and `Bone2D` for the
bones, a `Polygon2D` per attachment and an `AnimationPlayer` whose clips are ordinary Godot
tracks. Nothing at runtime depends on Keyframe Studio or on Spine; the add-on only imports.

## In five steps

1. Copy `integrations/godot/addons/keyframe/` into your Godot 4.2+ project as `res://addons/keyframe/`.
2. Project → Project Settings → Plugins: enable **Keyframe**.
3. Export the skeleton: ask the agent for `export_godot` (served with `--all`), or run
   `npm run godot -- path/to/hero.json --out path/to/your-godot-project/hero`. This writes
   `hero.kfscene` and copies the atlas page beside it.
4. Godot imports `hero.kfscene` as a scene. Drag it into a scene, or
   `load("res://hero/hero.kfscene").instantiate()`.
5. Play a clip with `$Hero/AnimationPlayer.play("idle")`; events arrive on the root's
   `keyframe_event(event_name, int_value, float_value, string_value)` signal.

The demo project opens `integrations/godot/` as a Godot project: press Play to watch Mika, the
showcase character, run through her clips (space or a click for the next one).

## What carries over, and what is baked

Bone rotate, translate and scale keys stay bezier tracks with the authored handles, so they stay
editable in Godot's animator and blend in an `AnimationTree`. Godot's 2D stack has no counterpart
for IK, inherit modes other than normal, or shear under rotation: the bones those move are baked
into keys at the export rate (`--fps`, default 30). Clipping and tint black are not imported. The
import names everything it baked or left out, and keeps that list on the root as the
`keyframe_report` metadata.

The full mapping table is in [`integrations/godot/README.md`](../integrations/godot/README.md);
the `.kfscene` file itself is described in [format.md](format.md#kfscene-godot).

## How it is checked

`test/godot.test.js` plays every shipped skeleton's scene description the way Godot 4 evaluates
it (Node2D transforms from rotation, scale and skew; bezier tracks solved exactly; Polygon2D
skinning against bone rests) and compares bones, attachments, colours and draw order with the
studio's engine. The GDScript itself is checked with Godot before a release, on a machine with
Godot 4.2+ installed:

```bash
# parse every script and import the demo; any error is printed and the exit code is non-zero
godot --headless --path integrations/godot --import
godot --headless --path integrations/godot --quit-after 120   # runs the demo for ~2 s
```

Then open `integrations/godot` in the editor and press Play once.

## Outfits and weapons

A dressable rig (the side figure with `armor` and `weapons`, as in `examples/showcase/warrior`)
arrives with every look of every piece. Swap them at run time with the rig's `set_look(look)`,
`set_attachment(slot, attachment)` and `get_attachments(slot)`; the add-on's README shows the calls.


## Upper-body layers

Clips whose names end in `_upper` (the Warrior's `punch_upper` and `punch_cross_upper`) key only
the arms and the head. `rig.play_layer("punch_upper")` plays one on a second AnimationPlayer over
the clip that is running, so the character punches while its legs keep running; when the layer
ends, the arms go back to the clip underneath. The layer copies the AnimationPlayer's process mode
(a game that advances it by hand advances `LayerPlayer` the same way), not its speed.

A layer can ease in and out instead of cutting: `rig.play_layer("wave", 0.2, 0.3)` blends in from
what the clip beneath shows over 0.2 s and, for a clip that plays once, back out over its last
0.3 s. A looping layer (a carry pose, a wave that repeats) plays until `rig.stop_layer(0.3)`, which
blends it back into the clip beneath and stops it (`stop_layer()` uses `blend_time`, `stop_layer(0)`
cuts). The layer blends from and into its own copy of the clip beneath, on the layer's tracks only
and without events, kept in time with the AnimationPlayer.

## Crossfades, physics and flipbooks

`rig.crossfade("run", 0.2)` changes clips with Godot's own blend between them, so a character goes
from idle to run without a pop (`blend_time` on the rig is the default when no time is given).
Asked for the clip that is already playing (a second jab), it starts it again with the same blend,
through a twin of the clip named `<clip>__again`, instead of snapping to its first frame.

Clips are made to blend the way they do in the runtimes. Every clip keys every bone, colour, draw
order and flipbook that any clip animates: what a clip leaves alone holds its rest value there
(Godot otherwise leaves an unkeyed property where the clip before put it, so a hand bent by a palm
strike would stay bent). These tracks are marked as fills, and `play_layer` plays a clip without
them, so the legs stay with the clip beneath. Which attachment a slot shows is left to the game
where a clip does not key it (the weapon stays through the run). Each bone's rotation track
starts within half a turn of its rest angle, so two clips that hold one pose never spin a limb the
long way round in a crossfade. A page whose atlas filter is Nearest (pixel art) draws with
`texture_filter` nearest.

Physics constraints (hair, tails, capes) and transform constraints have no Skeleton2D counterpart,
so the export plays them on the studio's engine and bakes the result into the bones' tracks; a
clip that loops is recorded on its second lap, so the swing at its end runs on into its start. The
report lists each one.

Baked physics only knows the clips. With `export_godot` `physics: "live"` the physics bones are not
baked: the scene carries each constraint's numbers and the rig runs the engine's own spring every
frame, after both AnimationPlayers have posed it, so a scarf or a ponytail also trails the game
moving the character (a run across the level, a jump). The springs feel the rig node's motion in
its own axes, a flipped rig included. `rig.reset_physics()` puts them at rest (after a teleport),
`rig.live_physics = false` turns them off, and a game that advances its AnimationPlayer by hand
calls `rig.step_physics(delta)` after it. Physics keys in clips (a gust of wind) are not played
live; the report says so. Transform and IK constraints stay baked. A flipbook (a sequence attachment: fire, smoke, frame-by-frame eyes) is one
Polygon2D whose `uv` (and `polygon`, and `texture` when its frames are on several pages) switches
frame by frame on nearest tracks.

## Sprite stacks

A drawing with height bands (`stack` on its parts, [drawing.md](drawing.md#sprite-stacks)) exports
as a strip of slices. The add-on's `KeyframeStack` node draws it: set `map` to the exported
`stack@2x.json` (its PNG sits beside it) and turn the node with its `rotation`, like any Node2D.
It draws in rig units, so a 2x export under a Camera2D with zoom 2 is one slice per screen pixel.
The pile always rises up the screen, also under a turning camera (a Camera2D with
`ignore_rotation` off that follows a car's heading), and with `sort_on_screen` (on by default) the
node keeps its `z_index` at its screen row so piles overlap right; keep the ground at `z_index` -1
or below. `spacing` makes the pile taller or flatter, `tint` colours it.

## The runtime API in one place

| On the rig's root | Does |
|---|---|
| `look` (Inspector or code) | dresses every piece that has that look; `""` is the look it was drawn in |
| `weapon` | what the `weapon` slot shows; `""` puts it away |
| `set_look(look)`, `set_attachment(slot, attachment)`, `get_attachments(slot)` | the same, piece by piece |
| `play_layer(clip, seconds, fade_out)` | plays an upper-body clip over the running one, easing in over `seconds` and, once through, out over its last `fade_out`; `false` for an unknown clip |
| `stop_layer(seconds)` | eases the layer back into the clip beneath and stops it (a looping layer ends here); `false` when no layer plays |
| `live_physics`, `reset_physics()`, `step_physics(delta)` | live springs of a scene exported with `physics: "live"`: on or off, at rest again, stepped by hand |
| `crossfade(clip, seconds)`, `blend_time` | plays a clip blending from the one before; `false` for an unknown clip |
| `keyframe_event` (signal) | the clip's events, with their int, float and string values |
