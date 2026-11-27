# Keyframe for Godot

(The short guide is [docs/godot.md](../../docs/godot.md).)

A Godot 4 add-on (MIT, GDScript, no native code) that imports animation made in Keyframe Studio
as Godot's own 2D animation nodes, so it stays editable in Godot's animator and works with
`AnimationTree`.

## Install

1. Copy `addons/keyframe/` into your Godot 4.2+ project (`res://addons/keyframe/`).
2. Project → Project Settings → Plugins: enable **Keyframe**.
3. In Keyframe Studio, write the scene description beside your skeleton: ask the agent to run
   `export_godot`, or run `npm run godot -- path/to/hero.json --out path/to/your-godot-project/hero`.
   That writes `hero.kfscene` and copies the atlas pages beside it.
4. Godot imports `hero.kfscene` as a scene. Drag it into a scene, or `load("res://hero/hero.kfscene").instantiate()`.

The demo project in this folder shows it: open `integrations/godot/` in Godot and press Play
(space or a click plays the next clip).

## What it builds

| Keyframe | Godot |
|---|---|
| Bones | `Skeleton2D` with a `Bone2D` per bone; the setup pose is each bone's `rest` |
| Slots | a `Node2D` per slot (`<slot> (slot)`): `modulate` is the slot colour, `z_index` the draw order |
| Region and mesh attachments | a `Polygon2D` per attachment, textured from the atlas page, shown when it is the slot's attachment |
| Weighted meshes | a skinned `Polygon2D` (bone weights, the skeleton set), beside the skeleton |
| Additive and multiply blending, premultiplied pages | a `CanvasItemMaterial` |
| Clips | an `Animation` each in the `AnimationPlayer`'s library, plus `RESET` with the rest values; each clip also holds at rest what other clips move and it does not (fill tracks, left out by `play_layer`) |
| Bone rotate, translate, scale keys | bezier tracks (`rotation`, `position:x`, ...) with the authored handles |
| Attachment keys | `visible` tracks on the attachments (nearest) |
| Colour keys | `modulate` tracks, sampled at the export rate |
| Draw order keys | `z_index` tracks (nearest) |
| Mesh deform | `polygon` tracks, sampled |
| Events | a method track; connect to the root's `keyframe_event(event_name, int_value, float_value, string_value)` signal |
| A clip whose last pose is its first | `loop_mode` linear |

### The quickest path: the Warrior

1. Copy `addons/keyframe/` into your project and enable the plugin.
2. Copy `examples/showcase/warrior/godot/` (`warrior.kfscene` and `warrior.png`) into the project.
3. Drag `warrior.kfscene` into a scene. Play a clip with `$warrior/AnimationPlayer.play("run")`;
   set **Look** to `leather` in the Inspector (or `$warrior.look = "leather"`) to change its armour.

### Dressing a rig at run time

A rig drawn with other looks of its parts (armour in plate and leather, several weapons in one
slot) keeps them all as `Polygon2D` nodes, one shown per slot. The root swaps them:

```gdscript
var rig = $warrior
rig.look = "leather"                        # every piece with a leather look wears it (also in the Inspector)
rig.look = ""                               # back to the look it was drawn in, pieces taken off included
rig.weapon = "weapon_spear"                 # "" puts the weapon away
rig.set_attachment("helmet", "")            # take one piece off
rig.get_attachments("weapon")               # weapon, weapon_spear, weapon_bow, weapon_axe, weapon_drawn
```

A clip that keys a slot shows what the clip says while it plays: each stance and attack of the
Warrior keys its own weapon (`idle_spear` puts the spear in the hand, `idle_unarmed` and `punch`
put it away), while `run` and `jump` leave it alone, so they keep the weapon the game set.
`shoot_bow` switches to the drawn bow (`weapon_drawn`) and shows the `arrow` slot from the nock to
the release; spawn your own arrow on the release. Every other clip hides the arrow.

Godot's 2D stack has no counterpart for IK constraints, inherit modes other than normal or shear
under rotation, so the bones they move are baked into position, rotation, scale and skew keys at
the export rate (`--fps`, default 30). Clipping attachments and tint-black are not imported. The
import prints what was baked and what was left out, and keeps it on the root as the
`keyframe_report` metadata.

Godot evaluates a bezier exactly, while Spine runtimes walk it in ten straight steps; a steep
overshoot can differ by about a percent between keys. Baked keys are exact on their frames.

### Punching while running: an upper-body layer

The Warrior's unarmed one-two is `punch` (the near fist) and `punch_cross` (the far fist), each from
the guard back to it, so a game chains them. Standing, they plant the feet. To punch without
stopping, play `punch_upper` or `punch_cross_upper` over `run` or `jump`: these key only the arms
and the head, so a second player on the same rig takes the arms while the first keeps the legs
running (`play_layer` on the rig's root).

```gdscript
$warrior.play_layer("punch_upper")             # the jab, while the AnimationPlayer keeps "run" going
$warrior.play_layer("punch_cross_upper")       # the next press: the cross
```

`play_layer` plays the clip on a second AnimationPlayer it adds beside the first, so the layer's
tracks win while it plays. When the layer ends, the arms go back to the clip underneath.
The layer copies the AnimationPlayer's process mode when it starts, not its speed (a run sped up
to the character's pace does not speed up the punch): if your game runs
the AnimationPlayer in manual mode and calls `advance()` itself, advance `$warrior/LayerPlayer`
the same way, also while a layer eases off (the fades count the layer's own clock).

A layer can ease in and out instead of cutting, and a looping one plays until it is stopped:

```gdscript
$hero.play_layer("wave", 0.2, 0.3)             # blends in over 0.2 s, back out over its last 0.3 s
$hero.play_layer("carry", 0.25)                # a looping pose over the walk...
$hero.stop_layer(0.3)                          # ...eased back into the walk, then stopped
```

To change clips without a pop, `crossfade` blends from the clip that was playing:

```gdscript
$warrior.crossfade("run", 0.2)                 # idle melts into run over a fifth of a second
$warrior.crossfade("jab", 0.08)                # while "jab" plays: a second jab blends in from the first
```

Hair, tails and capes driven by physics constraints arrive baked into the bones' tracks (Skeleton2D
has no physics of its own), recorded from the studio's engine; a looping clip is recorded on its
second lap, so the swing runs on across the loop. Exported with `physics: "live"`, they are not
baked: the rig runs the engine's spring every frame instead, after the AnimationPlayers, so a scarf
also trails the game moving the character. `reset_physics()` after a teleport, `live_physics = false`
to turn it off, `step_physics(delta)` after advancing an AnimationPlayer in manual mode. Flipbooks (fire, smoke, frame-by-frame eyes) swap
their texture coordinates frame by frame.

## How it is checked

`test/godot.test.js` in the Keyframe Studio repository plays every shipped skeleton's scene
description the way Godot 4 does (Node2D transforms from rotation, scale and skew; bezier tracks
solved on time; Polygon2D skinning against bone rests) and compares bones, attachments, colours
and draw order with the studio's engine.

## License

MIT, see `addons/keyframe/LICENSE`. The add-on contains no Spine code and needs no Spine license.
