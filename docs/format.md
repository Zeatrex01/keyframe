# File formats

Everything Keyframe Studio reads and writes is plain JSON or plain text, written to be read by
people and by models. This page lists each file, who writes it, and where its exact definition
lives in the code.

| File | What it is | Written by | Defined in |
|---|---|---|---|
| `<name>.json` | A skeleton and its animations, Spine 4.2 JSON | the owner (Spine, or `draw_rig`), deliveries by the studio | [Spine's JSON format](https://esotericsoftware.com/spine-json-format) |
| `<name>.keyframe.json` | The same, in the Keyframe format | the owner or an agent | `src/engine/keyframe-format.js` |
| `<name>.atlas` + pages | Where each attachment's image sits on the page PNGs (libGDX text atlas) | Spine's packer, `draw_rig` | `src/engine/atlas.js` |
| `<name>_v2.json` | A delivery: the base plus the clips the studio wrote, with `_kfDelivery` | the studio only | `src/deliver/compose.js` |
| `<name>.parts.json` | The SVG parts a placeholder rig is drawn from | `draw_rig` | `src/render/svg-rig.js` |
| `.keyframe/brief.json` | What each skeleton is and what each clip is for | `brief` | `src/understand/subject.js` |
| `<name>.kfscene` | A skeleton as Godot builds it | `export_godot` | `src/engine/godot.js` |
| `assets/library/<pack>/pack.json` | One asset pack, its license and items | contributors | `src/core/asset-library.js` |

## Skeleton JSON (Spine 4.2 compatible)

The studio's engine reads and writes the Spine 4.2 JSON format: bones (with every inherit mode),
slots, skins, region, mesh, weighted mesh, clipping, path and point attachments, IK, transform,
path and physics constraints, events, and every 4.2 timeline. `check_skeleton` says what a player
or editor would reject, and names anything the engine does not evaluate (`notEvaluated`) instead
of pretending. The file keeps working in the Spine editor and in every Spine runtime; using those
is subject to Esoteric Software's license (see [addons.md](addons.md)).

The one-way rule: the owner's file (the base) is never written. Every write lands in a delivery
beside it (`<name>_v2.json` by default), with a backup in `.backup/`. When the base
changes, the delivery is rebuilt on it and the base wins.

## The Keyframe format

A friendlier spelling of the same data, for people and models that do not know Spine's packing
rules: one value per key and channel, curves as preset names (`outCubic`) or four handles, draw
order as the full list of slots.

```json
{ "format": "keyframe", "version": 1, "name": "cat", "fps": 30,
  "bones": [{ "name": "root" }, { "name": "head", "parent": "root", "y": 120, "length": 40 }],
  "slots": [{ "name": "head", "bone": "head", "attachment": "head" }],
  "skins": { "default": { "head": { "head": { "type": "region", "width": 80, "height": 90 } } } },
  "animations": { "nod": {
    "bones": { "head": { "rotate": [{ "time": 0, "value": 0, "curve": "outCubic" }, { "time": 0.3, "value": -12 }] } } } } }
```

Values mean what they mean in Spine: rotate, x, y and shear are offsets from the setup pose,
scale multiplies it, time is in seconds. What the format does not model rides along under
`spine` untouched, so Spine → Keyframe → Spine gives back a file that plays the same
(`test/keyframe-format.test.js`).

## Parts (`<name>.parts.json`)

```json
{ "format": "keyframe-parts", "version": 1, "name": "pal", "resolution": 2,
  "parts": [
    { "name": "body", "svg": "<svg viewBox=\"0 0 100 120\">...</svg>", "at": [0, 60], "pivot": [0, 0], "parent": null, "size": [100, 120] },
    { "name": "head", "svg": "<svg viewBox=\"0 0 90 90\">...</svg>", "at": [0, 150], "pivot": [0, 115], "parent": "body", "size": [90, 90] } ] }
```

Parts are listed back to front. `at` is the centre of the art and `pivot` the bone, both in rig
units with y up; `size` defaults to the SVG's viewBox. `resolution` is atlas pixels per unit.
`draw_rig` rebuilds the skeleton, atlas and page from this file and keeps clips already written.
The SVG subset it draws: rect, circle, ellipse, line, polyline, polygon, path, groups with
transforms, solid and gradient fills, strokes, opacity. Anything else is named in `skipped`.

## Brief (`.keyframe/brief.json`)

Keyed by the skeleton's project-relative path:

```json
{ "chest.json": { "subject": "prop", "display": { "height": 200, "pixelsPerUnit": 1 },
  "clips": [{ "name": "open", "intent": "reward", "seconds": 1.2, "loop": false }],
  "preset": { "skip": [] }, "confirmed": true } }
```

`subject` is one of character, creature, prop, ui, vfx, scene; `intent` one of idle, loop,
action, reaction, transition, reward. `critique_animation` judges a clip at the display size and
skips the checks that do not apply to the subject.

## kfscene (Godot)

`{ "format": "keyframe-godot", "version": 1, name, fps, pages, bones, slots, animations, report }`:
bones with their rest transform in Godot's coordinates (y down, radians), slots with their
attachments as polygons with UVs in page pixels (and weights when skinned), and clips as tracks
the add-on turns into Godot tracks one to one. `report` lists what was baked, approximated or
skipped. See [godot.md](godot.md).

## Asset pack (`pack.json`)

```json
{ "id": "keyframe-basics", "title": "Keyframe basics", "license": "MIT",
  "author": "The Keyframe Studio contributors", "source": "https://github.com/Zeatrex01/keyframe",
  "items": [{ "id": "coin", "file": "coin.svg", "tags": ["reward", "prop", "burst"] }] }
```

A pack is accepted only under CC0-1.0, MIT, CC-BY-3.0 or CC-BY-4.0, and a pack whose license asks
for credit is credited in `NOTICE` (a gate checks both). Items are reached as
`asset:<pack>/<item>`.
