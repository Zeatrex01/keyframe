# Low-poly models from drawn views

The look of early 3D games: a very simple mesh, and a painted texture that holds all the detail.
The agent draws the object flat from its sides in the studio, and `export_art` kind `model` turns
the views into a textured low-poly model (`.glb`) that Godot, Blender, Unity and three.js import
as it is. The same file goes through a model-to-stack baker when a top-down game needs a sprite
stack instead.

## Draw the views

One drawing (`draw_rig`, `as: "artboard"`), one part per view, named after the side it shows.
Draw at one unit per centimetre (the default `meters: 0.01`): a car's side view is about 420 x 145.

| Part | Seen from | Orientation |
|---|---|---|
| `front` | facing the nose | the object's left is on your right |
| `back` | facing the tail | the object's right is on your right |
| `left` | its left side | the nose points to your left |
| `right` | its right side | the nose points to your right |
| `top` | above | the nose up, its right side on your right |
| `bottom` | below | the nose up, its left side on your right |

`front`, one side and `top` are enough. A missing back, side or bottom is the opposite view
mirrored, and the bottom is darkened. Draw the back when it differs (tail lights, a plate).

Rules that make the model read well:

- **Fill the box.** Each view is stretched over its face of the object's box: width from the front,
  length from the side, height from both. Draw views edge to edge and at the same height.
- **The outline is the shape.** The hull and round shapes take their shape from the filled
  outline of the views (the visual hull). Everything inside the outline is paint only.
- **Paint the light in.** Hand-painted textures carry their own light: lighter towards the top,
  darker underneath, a highlight line along an edge, dark seams for panels. Keep the engine light
  soft, or set `lit: false` so the painted light is all there is.
- **Big shapes, few colours.** Details smaller than a texel at the chosen `texture` size disappear.
  Early consoles used 64 to 256 px textures; 128 per object is a good start, 256 for a hero.

## Pick a shape

| Shape | Use for | Triangles |
|---|---|---|
| `box` | crates, cabinets, building blocks, signs | 12 |
| `round` | barrels, posts, bottles, trunks, lamps | `sides` x stations x 2 (8 sides: about 150) |
| `hull` | cars, boats, sofas, bodies seen from the side | about 100 to 250 |

`hull` is lofted along the length (+Z): cross-sections stand where the side and top outlines
change, and each is cut to the front outline at `levels` heights. `round` turns around the up axis
with `sides` faces; its outline comes from the front and the side views. Every triangle shows the
view it faces most, so a side wall shows the side drawing and a roof the top drawing.

## Export

```json
{ "file": "taxi.parts.json", "kinds": ["model"],
  "model": { "shape": "hull", "texture": 256, "filter": "nearest", "segments": 14, "levels": 5 } }
```

Writes `<name>-export/model/`: `<name>.glb` (+Y up, +Z the front, texture inside),
`<name>_texture.png`, `<name>_preview.png` (four turns, returned to look at) and `model.json`.
`filter: nearest` keeps texels crisp (the retro look); `linear` smooths them. `smooth` is the angle
under which faces share normals (40 degrees by default, 0 for flat facets).

## Check it

- Look at the preview the export returns before calling it done.
- Godot 4.7: drop the `.glb` into the project; it imports as a scene with one mesh and its
  material (nearest filtering kept from the file).
- A sprite stack from the model: bake the `.glb` with a model-to-stack baker into the studio's
  stack format (`stack@2x.png` and `.json`), played by the Godot add-on's `KeyframeStack`.

## Learned from

Budgets and habits of early 3D console art (textures of 128 to 256 px, a few hundred triangles a
prop), the PSX look recreated in Godot (`MenacingMecha/godot-psx-style-demo`, MIT), per-face UVs
on cuboids (Blockbench), flat-colour low-poly kits (Kenney, Quaternius, CC0), and hand-painted
diffuse-only texturing. Sources and what each teaches: `docs/ideas.md`, 2026-11-27.
