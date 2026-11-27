# Ideas

Ideas wait here, dated, until a maintainer decides. Nothing in this file is built.

## 2026-11-12: repositories and techniques worth learning from

Found by search and read from summaries, not yet from the code itself. Licenses and current
state must be checked in each repository before anything is taken from it.

| What | Where | What it would teach this studio |
|---|---|---|
| Spine 4.2 physics constraints | `EsotericSoftware/spine-runtimes`, the Spineboy example | Hanging parts (hair, tails, ribbons) move by a physics constraint on a prepared bone, not by keys. The rig's author prepares the constraint in Spine; a clip then only moves the parent. This is the right answer to "the tail swings as one stiff piece". |
| Curve fitting (Schneider's algorithm) | `volkerp/fitCurves`, `robertjoosten/maya-keyframe-reduction`, Graphics Gems | Turning dense samples into a few bezier keys with a stated maximum error. `measure_reference` today picks turning points and tries preset eases; a real fit would give the reference's own curve and a number for how close it is. |
| Point tracking through occlusion | `facebookresearch/co-tracker` | Following many points of one object across frames. The pixel tracker reads a multi-part element as one shape; per-part tracks would fix that. Needs a model and a GPU, so it is a dependency decision. |
| Springs for follow-through | Ryan Juckett's damped springs, Allen Chou's numeric springing, `charmbracelet/harmonica` | A child that follows its parent late is a damped spring with two numbers (frequency, damping). Baked to keys it gives overlap without physics in the rig; today every lag is a hand-written phase offset. |
| Parameter-driven mesh puppets | `Inochi2D/inochi2d`, Live2D-style tools | How anime portraits are really animated: one painted illustration cut into layers, each a mesh deformed by parameters (head angle, eye open, mouth form). It explains why code-drawn rigid pieces could not reach that look. |
| Rig from one drawing | `facebookresearch/AnimatedDrawings` | Detect the figure, place joints, retarget motion capture onto it. A model for "the drawing comes in, the rig is placed on it". |

Smallest useful steps, in the order they would pay off:

1. ~~Curve fitting in `measure_reference`~~ Built 2026-11-12 (`fitHandles` in `src/understand/track.js`): a move no preset explains gets its own four handles by least squares and they go into the written clip; a preset move keeps its name.
2. ~~A spring helper for follow-through~~ Built 2026-11-12 (`src/deliver/follow.js`): a bone's rotate may be written as `{ follow, of, frequency, damping, amount }` and is baked to keys.
3. ~~Physics constraints~~ `read_rig` already listed them with their settings; built 2026-11-12: `start_here` says to leave those bones unkeyed, and a write that keys a channel physics drives reports it under `onPhysicsBones`.

- ~~2026-11-13: page inputs for a time range (from / to) next to the link field.~~ Built 2026-11-23: two fields under the link that read seconds or m:ss; both empty saves the whole video. The page stops a range it cannot cut; the server still checks every range.

- 2026-11-13: take a GIF or an image sequence from a page (ArtStation and Behance posts often carry GIFs, which the program does not fetch). Deferred; the link intake saves video files only.

## 2026-11-13: Learning from video, part two: rules set before any design

- The target is the object's own animation, not particles or effects.
- Showreels are the first source, because an isolated element is easier to capture there than in in-game footage.
- An earlier video-analysis project's method is adapted, never copied, because the studio exists for pure 2D animation.

Proposal, not yet decided:

- Take from the earlier project only "find the scenes, sample frames, name each moment from a fixed list".
- Keep the measuring in the studio's own tracker.
- Make what is learned reach the model when it writes an animation. Today nothing measured reaches `write_animation`.

## 2026-11-27: gaps found while making a fighting-game demo with the studio

Found by building a rhythm fighting demo on the studio's own rigs (the game is not part of the
repository). Not yet built:

- Expression sets: no way to declare a face set (brows, eyes, mouth together) for a rig and swap it
  as one, the way a skin swaps a look. Today each face part is keyed by hand in every clip.
- Draw order for raw-SVG pieces: a piece added to `draw_rig` as raw SVG cannot say where it sits
  in the draw order (in front of the arm, behind the torso); it lands where it is listed.
- Keyable squash and "hide the whole rig": no single channel squashes a whole character on impact
  or hides it (a knock-out flash, a teleport); today every slot is keyed one by one.
- `critique_art` false positives on small face parts: small eyes, brows and mouths are flagged as
  too thin or too small for the target size although they read well at it.
- (Fixed in 638da00: one-shot clips no longer loop in Godot.)
