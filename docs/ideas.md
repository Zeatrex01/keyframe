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

## 2026-11-27: open-source sources for effects and pixel art

Surveyed for the effect side and for pixel-art output. Licenses as stated by each project; each
one is still a maintainer decision before anything is taken (rule 5, `docs/concept.md`).

| Source | License | What it would give the studio |
|---|---|---|
| Kenney Particle Pack and Smoke Particles (kenney.nl) | CC0 | Effect art the studio lacks: `add_effect` only reuses the rig's own art. Soft dots, sparks, flares, smoke puffs and magic shapes as an asset-library pack, usable by bursts, trails and flipbooks. |
| `pixijs-userland/particle-emitter` | MIT | A proven emitter description to learn from: spawn shapes, lifetime, and behaviours that move alpha, scale, colour, speed and rotation along value/time keys. A model for an `emit` effect kind that the engine simulates with a seed, Godot gets as `CPUParticles2D`, and Spine gets baked into slots and keys. |
| `gdquest-demos/godot-visual-effects` | code MIT, art CC-BY 4.0 | Recipes for 2D game effects in Godot (hit sparks, slashes, explosions, trails, shockwaves, flash shaders): how a hit is layered and timed. Learn the recipes; do not copy the art. |
| Effekseer | MIT (sample data CC0) | A full effect editor and runtime, mostly 3D and C++. Too heavy to integrate; useful only as a reference for effect timing. |
| `sedthh/pyxelate`, `thinknathan/node-simple-pixelate` | MIT, CC0 | How to turn smooth art into pixel art: downsample along edges, fix a palette, dither. A model for a `pixel` export of drawings and clips (low resolution, no anti-aliasing, a fixed palette, optional one-pixel outline). |
| RotSprite (Xenowhirl's algorithm; the Rust crate is AGPL, so only the published algorithm) | algorithm | Rotating pixel-art parts on bones without jagged edges (scale up, rotate, scale down). Needed when the art itself is pixel art. |
| Aseprite file format (`docs/ase-file-specs.md` in the Aseprite repository; parsers `ase-parser`, `node-ase` are MIT) | public spec | Import `.aseprite` files: layers become parts, frames and tags become flipbook clips. A parser fits in the standard library (Node's zlib inflates the cels). |
| Pixelorama (MIT, Godot), Piskel (Apache-2.0) | MIT, Apache-2.0 | Pixel editors to learn from (palettes, onion skin, export options). Nothing to integrate. |
| Lospec palettes | data terms unclear | Do not bundle the palette database; let a project name its palette as hex colours. |

The 0.2 engine already plays what these need: flipbooks (sequences), additive blending and layers,
in the players and in Godot.

## 2026-11-27: simple low-poly 3D models from drawn views

Sprite stacks carry a top-down game only so far. The next path for real 3D assets: very simple
meshes whose painted texture holds the detail, as in early 3D console games (PS1/PS2 era), and
also flat-colour low-poly kits. The agent draws the object as flat views in the studio; the
studio turns them into a textured low-poly model that Godot imports, and that the existing
model-to-stack baker can still turn into a stack.

Proposed shape (not built; a first working draft exists outside the repo):

- No new tool: `export_art` gains kind `model`. The drawing's parts are named after the views:
  `front`, `back`, `left`, `right`, `top`, `bottom`; front (or back), one side and top (or bottom)
  are enough, the rest are mirrored (the bottom darkened).
- Conventions: +Y up, +Z is the front (glTF and Godot's model front), +X the object's left.
  Front: facing the nose. Left: standing at its left, nose to your left. Right: nose to your right.
  Top: from above, nose up. Bottom: from below, nose up.
- Three shapes: `box` (six quads, one view each: crates, cabinets, building blocks), `round`
  (turned around the up axis, 8 sides by default, outline from the front and side views: barrels,
  posts, bottles), `hull` (lofted along the length, cross-sections where the side and top outlines
  change, each cut to the front outline: cars, boats, sofas).
- Every triangle takes the view it faces most (box projection). One texture atlas of the views at
  one texel density, clear pixels filled with the nearest colour so no edge shows the background.
- Output: `model/<name>.glb` (texture inside, nearest or linear sampler, optional unlit material),
  the texture PNG, a four-turn preview rendered by the studio, `model/model.json`.
- Settings: shape, texture (px on the longest side, default 128), filter (nearest), meters per
  rig unit (0.01, so views are drawn in centimetres), sides, levels, segments, smooth angle, lit.
- Gate: views mirrored when missing; every triangle faces outward; the .glb parses back with
  valid accessors; a side face samples the side drawing; Godot 4.7 imports it headless.

What to learn from (read 2026-11-27, from summaries; check licenses before taking anything):

| What | Where | What it teaches |
|---|---|---|
| PSX look in Godot | `MenacingMecha/godot-psx-style-demo` (MIT) | Very low-poly, smooth shading, extra edge loops only where the texture warps, low-res textures without filtering or mipmaps, vertex colours for faked light, posterised colours, low internal resolution, fog. |
| Texture and triangle budgets | Polycount "Retro 3D art FAQ", itch.io 32-bit jam threads | PS1 textures usually 128x128 (256 max), PS2 128 to 256 (512 rare); PS1 characters about 250-750 triangles; PS2 hero characters a few thousand. |
| Low-poly modelling with pixel textures | `JannisX11/blockbench` (GPL-3.0, models are the user's own) | Cuboids with per-face UVs and pixel-art textures; a model of the per-view mapping. |
| Tile-based low poly | Crocotile 3D (paid) | Building simple geometry from tiles of one texture sheet; orthographic placement. |
| Flat-colour low-poly kits | Kenney (CC0), Quaternius (CC0) | One small palette texture or flat material colours per part; silhouettes carry the shape. |
| Hand-painted diffuse-only textures | 80.lv, Polycount, Sketchfab spotlights | Light and shade painted into the texture, the engine shading kept flat or unlit so it is not doubled; geometry only where it changes the outline. |

Order when it is picked up: the export kind with its gate, a workflow page (docs) for drawing
views, then one car and one prop drawn in the studio and checked in Godot 4.7 as 3D and as a stack.
