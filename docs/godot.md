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

