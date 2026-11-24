# Drawing

The studio is two crafts in one: an **art director** who fixes the look and draws, and a **senior
animator** who moves what was drawn. This page is the drawing side. Animation is in
[`concept.md`](concept.md) and [`lessons.md`](lessons.md).

The path mirrors the animation path: **direct, draw, critique, look, deliver**.

| Step | Tool | What it does |
|---|---|---|
| Direct | `style_guide` | One guide per project (`keyframe.style.json`): palette by role, outline weights, corner radii, light, spacing grid, type, standard sizes. |
| Draw | `draw_rig` | Parts from components, shapes or SVG, placed and pivoted. A rig to animate, or an artboard that is never rigged. Shown live on the Draw board. |
| Critique | `critique_art` | Measures the drawing against the guide and writes a contact sheet. |
| Look | the contact sheet, the Draw board | Done means seen: look at the sheet before calling a drawing done. |
| Deliver | `export_art`, `write_animation` | PNGs, sprite sheets, SVG and clip frames for engines and the web; the skeleton for anything that animates. |

## The style guide

Start from a preset and change what the project needs:

```json
{ "preset": "clean", "set": { "palette": { "primary": "#4cc461", "brand": "#ff7a00" }, "radius": { "md": 14 } } }
```

Presets: `clean`, the default (no dark outline, only a thin edge a shade darker than each fill
(`stroke.color: "tint"`), gentle radii, a soft top light and a light shadow, plain capitals without an outline),
`casual-game` (an optional cartoon look: thick dark outline, pill corners, glossy shine), `flat-web` (no outline,
small radii, soft shadow, sentence case), `dark-sci` (sharp corners, thin bright lines on dark
panels). Roles are words: `primary`, `secondary`, `accent`, `danger`, `reward`, `surface`,
`surfaceAlt`, `panel`, `ink` (outlines), `text`, `textDark`, `muted`, and any of your own.

A colour is written by role: `"primary"`, `"primary-20"` (20% darker), `"primary+20"` (20%
lighter), `"primary~"` (greyed), or `"#rrggbb"`. A weight is `thin`, `regular`, `bold` or a
number; a radius `sm`, `md`, `lg`, `pill` or a number. After a change,
`draw_rig { name, restyle: true }` redraws a drawing in the new guide.

## Drawing parts

A part is drawn one of three ways, cheapest first:

1. **A component**: `{ name: "play", component: { component: "button", label: "PLAY", icon: "play" }, at: [0, 0] }`.
   Components: `button`, `iconButton`, `panel`, `popup`, `progress`, `toggle`, `badge`, `icon`,
   `figure`. Each is split into the parts an animator needs (a progress bar is a track, a fill that
   grows from its left edge, and a frame; a popup is a backdrop, a panel, a title, an action button
   and a close button). A `figure` is the character a drawing starts from, every part
   turning at its joint with round caps that overlap there. The default `build: upper` is waist-up,
   for gestures, talking and reactions: `body` (the torso and neck, turning and breathing at the
   waist), `head`, `eyes` (a part of their own, so they blink), `hairBack`, and each arm as upper,
   lower and hand. `build: kid | adult` is a full body standing, with legs, for when the owner asks
   for one (`h`, `skin`, `shirt`, `pants`, `hair`, `shoes`, `sleeves: long`, and `prefix` for a
   second figure in one drawing).
2. **Shapes**: `{ name: "coin", box: [64, 64], shapes: [{ circle: [32, 32, 28], fill: "reward", shine: true }], at: [0, 0] }`.
   Shapes: `rect`, `circle`, `ellipse`, `poly`, `path`, `line`, `star`, `text` (the built-in
   stroke font) and `icon` (the icon family). Paint: `fill`, `stroke`, `sw`, `r`, `shade` (top-lit
   gradient), `shine`, `shadow`, `opacity`, `grad: [top, bottom]`.
3. **SVG**: `{ name: "leaf", svg: "<svg viewBox=...>...</svg>", at: [0, 0] }`, or a library item
   `asset:<pack>/<item>`. Use it for organic shapes the primitives do not reach.

**States** are other looks of one part: attachments `<part>_<state>` of its slot, so a clip can
switch to the drawn pressed look. With shapes, `states: ["hover", "pressed", "disabled"]` derives
them (lighter; darker and pressed down by the shadow depth; greyed). Buttons have them built in.

**Cost.** A component or a few shapes cost a few dozen tokens; the same part as SVG costs
hundreds to thousands. `test/art.test.js` holds a whole UI set (eight components, nineteen parts,
eleven states) to 1,200 characters of arguments, at least fifty times smaller than its SVG.

**Labels** use the studio's own stroke font: capitals, digits, common punctuation and the Turkish
capitals; lower case is set as small capitals. Text is drawn as paths, so it looks the same in the
studio, an engine and a browser, with no font file. Text is set to fit the shape it sits on (the
last filled shape under it, else the part): a label too long for its button is set smaller, never
cut off, and centred text is centred on its ink. `fit: false` keeps the size asked for.

**Edits by hand.** On the Draw board, the settings of a part drawn from a component or from
shapes show its words and colours: change a title, a label, a body line or a fill (a palette role,
or a custom colour) and the part is drawn again in the guide, where the owner put it. A part of a
component edits the whole component. A part drawn as plain SVG keeps the plain-shape settings.

## Artboards

`draw_rig { as: "artboard" }` draws a design that is never rigged (an icon set, a logo, a UI sheet,
an illustration) with the same guide, critique and export. It writes `<name>.svg`, `<name>.png`
and `<name>.parts.json`, and no skeleton. A drawing keeps its kind when it is drawn again.

## The art critique

`critique_art { file: "<name>.parts.json" }` checks:

- **palette**: colours outside the guide's roles and their tones;
- **stroke**: outline weights off `thin` / `regular` / `bold` after the part's scale;
- **align**: parts that almost line up (a few units off), corners off the grid on artboards;
- **silhouette**: parts solid at full size that fall apart at 24 px across;
- **states**: hover, pressed or disabled looks that change too little of the part to be seen;
- **contrast**: parts with no outline that melt into the surface colour;
- **text**: text cut off by the part's edge, spilling out of its shape, off the middle of it, or set
  much smaller than asked to fit.

It answers with an image to look at: the whole drawing assembled, then every part and state side
by side, named (also saved as `.keyframe/art/<name>-sheet.png`). This is how a drawing with no clip
is seen. Parts of one component, and a part and what carries it, are laid
out together on purpose and are not compared for alignment.

## Export

`export_art` writes new files into `<name>-export/` beside the drawing:

| Kind | Files | For |
|---|---|---|
| `parts` | `png@<s>x/<part>.png` per part and state, trimmed, transparent; `parts.json` with trim offset, source size and pivot in pixels | engines placing parts themselves |
| `sheet` | `<name>@<s>x.png` and `.json` (frame, spriteSourceSize, sourceSize, pivot) | engines and web libraries that read sprite sheets |
| `svg` | `svg/<part>.svg`, `<name>.svg` with a `<g id>` per part | web pages and design tools |
| `clip` | `clip-<anim>/frame_0000.png...` and `clip-<anim>@sheet.png/.json` with fps | engines without a skeletal runtime |

Scales are pixels per rig unit (`[1, 2, 3]`), or `pixels` sets the longest side. Everything is
rasterised by the studio's own renderer, with no browser and no dependency.

## The boundary

In 0.0.1: everything above, and the live Draw board (each part traced as the AI draws it, with
replay, speed and an instant mode; the owner moves, scales, re-pivots and re-parents parts).

Not in 0.0.1, on the roadmap: boolean operations on shapes, outline fonts and font files, text on
a path, masks and filters, a full vector editor in the page, painting raster textures. The drawing
side makes clean, consistent game and web assets; it is not a replacement for a full illustration
program, and an owner's own art always wins over placeholder art.
