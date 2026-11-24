# The kit behind the showcase

`npm run examples` rebuilds the five examples in `examples/showcase/`, in the order the Examples
page lists them; `npm run examples -- chest coin-burst` rebuilds only those. Each script draws
its art (or reuses the painted rig already in its folder), writes every clip through the
studio's own tools (`write_animation`, never by editing the JSON), proves the delivery
(`check_skeleton` with nothing fatal, `critique_animation` with no warning) and renders
`preview.png` and one filmstrip per clip into `examples/kit/look/` (not in git) to be looked at.
Node 18 and the standard library only; the build takes about twenty seconds and gives the same
files every time.

| File | What it is |
|---|---|
| `build.js` | runs the example scripts below |
| `mika.js` | Mika: cuts a bendable right arm out of the painted anime rig, then her emotion and wave clips |
| `pip.js` | Pip: keeps one look of the painted human rig, adds a leaf bone for squash, then idle, jump, walk and cheer |
| `chest.js` | the reward chest: art, rig and the `appear` and `glow` clips |
| `play-button.js` | the PLAY button: art, rig, its states on track 0 and the badge on track 1 |
| `coin-burst.js` | the coin burst: eight coins into a counter, sparkles on track 1 |
| `showcase.js` | writes the clips, proves them and writes `brief.json`, `README.md`, the preview and the filmstrips |
| `studio.js` | calls the studio's MCP tools in process, and the 30 fps helpers |
| `rig.js` | pieces (position, pivot, a drawing) to a Spine 4.2 skeleton, an atlas and a page |
| `canvas.js` | a small software rasterizer with the part of the Canvas 2D API the drawings use |
| `atlas.js` | reads an atlas into images, crops and packs regions into a page |
| `style.js` | the shared palette and drawing helpers (glow, gloss, sparkle, shadow) |

The gates are `test/example-<name>.test.js` (one per example) and `test/showcase.test.js`.

## The painted rigs

Mika and Pip start from rigs painted in a headless browser by the older kit, kept here as
CommonJS: `kit.cjs` (pieces to atlas and skeleton), `face.cjs` (the shared face parts),
`anime.cjs` (Mika's art) and `human.cjs` with `human_build.cjs` (Pip's art). They need
Playwright with Chromium, which the studio itself never uses, and write into `pack/` beside
themselves (not in git). Their result is already committed as `mika.json` and `pip.json`, so
`npm run examples` does not need them; `mika.js` and `pip.js` read `pack/` only when that file
is missing.
