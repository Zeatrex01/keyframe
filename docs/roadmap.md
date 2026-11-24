# Roadmap

Where Keyframe Studio goes next, so it can be installed and used by people other than its author.
Written 2026-11-24. Scope is still `docs/concept.md`: nothing here adds a tool, a page or a
dependency without a maintainer decision, and items that need one are marked.

Each item has an issue. Labels and milestones follow this file: `roadmap/now` is the **v0.3**
milestone, `roadmap/next` the **v1.0 (public release)** milestone, `roadmap/later` stays without
a date. Sizes: **S** about a day, **M** a few days, **L** a week or more (split before starting).

Sources: **NS** `docs/next-steps.md`, **ID** `docs/ideas.md`, **ADR** `docs/architecture.md`,
**AU** the foundation audit of 2026-11-24 (pull request [#8](https://github.com/Zeatrex01/keyframe/pull/8)), **BR** the product brief for this
roadmap. There were no open issues and no TODO comments in the code to pull from.

## Direction: an AI-assisted animation studio in phases (decided 2026-11-24)

The studio makes whatever animation is asked for and runs on its own: Spine-supported, and working
without Spine. Its tools widen and explain themselves, so every AI can use them without trouble.
The animation principles are built in: the agent understands what it animates (a character, an
object, an effect) rather than only extracting motion from footage. It can draw and make effects
when needed, preferably by integrating existing open resources rather than starting from scratch.

The phases run in this order (Phase 5's design work runs alongside the others). Each one ships on its own, with its gates, and ends with a real
session on a Windows PC with a real agent before the next one starts. The items under
Now, Next and Later below still hold; each names the phase it now belongs to.

### Phase 1: tools any AI can use without help

- Every MCP tool explains itself: what it is for, when to use it and when not, every argument with
  its unit, range and default, a worked example, and what to do next. A refusal says how to fix it.
  A gate fails on a tool whose contract is missing any of these.
- `start_here` returns the studio's capabilities, the SEE → PROVE → DELIVER order and the writing
  rules from the animation principles (pose to pose, asymmetric ease, anticipation, overshoot and
  settle, overlap of 1–3 frames per link, squash with volume kept, arcs, moving holds, the 2-pixel
  readability floor, loop seams).
- `critique_animation` checks those principles and reports each as a warning with the numbers it
  measured (estimates stay warnings until calibrated on real production exports).
- Any MCP client connects the same way: Claude Code, Codex, Cursor, Gemini CLI, VS Code, or a
  generic `mcpServers` entry. `npm run connect` prints the lines for this machine and checks that
  the server answers; `docs/getting-started.md` walks a first session end to end ([#11](https://github.com/Zeatrex01/keyframe/issues/11)).
- **The embedded agent (decided 2026-11-24).** The chat panel drives the owner's
  installed agent CLI headless, so nobody needs a second terminal (`docs/agents.md`).
  - *Shipped:* the director slot end to end with Claude Code (the reference adapter): the owner's
    message starts a run, the session resumes per project, tool activity streams into the slot's
    status, the answer lands in the conversation; stop, timeout, a busy slot and an absent CLI
    are handled. Codex CLI and Gemini CLI adapters are best effort behind the same interface.
  - *Shipped:* the slot data model (one agent per slot, a role, a tool scope enforced by the MCP
    server's `--only`, a brief), saved in the studio config; extra slots start
    (`POST /api/agent/run`) and stop like the director.
  - *Next:* the director delegates to an extra slot (an `ask_slot` tool on its wire), so an
    illustrator or a researcher answers the director instead of the owner; Codex and Gemini each
    proven in one real session on Windows.

### Phase 2: a native core; Spine becomes an opt-in adapter

Decided 2026-11-24: Spine stays the main target, but its license is stated plainly and its
runtime is opt-in. The Spine Runtimes
License requires every user of a product that integrates the runtime to hold their own Spine
Editor license, so the official runtime leaves this MIT repository: the native engine is the
default and loads no Spine code; the Spine add-on is off by default, shows that notice in Settings,
and only on the user's consent downloads the official runtime from Esoteric Software's own
package into the user's app data. Reading and writing Spine 4.2 JSON is a data format and stays
available to everyone.


- The studio's own skeleton and animation format (`*.keyframe.json`): bones, slots, region and
  mesh attachments (weighted too), clipping, skins, bone, colour, attachment, draw-order, deform
  and event timelines, curves as presets or normalized handles.
- Its own engine, pure and isomorphic (`src/engine`): pose, world transforms, vertices, clipping.
  No Spine runtime and no Spine license is needed to play a Keyframe file.
- Spine 4.2 JSON is an adapter in both directions. What the engine does not play (transform,
  path and physics constraints) is carried through untouched and reported by name; baking a clip
  (`bake_animation`) makes any Spine rig play exactly.
- A parity gate poses every fixture and example with both the engine and the official runtime and
  fails on any difference above 0.01 units or 0.01 degrees.
- A standalone player: one HTML file with the engine, the skeleton and its images inside, that
  plays by double-click with no studio, no server and no network. The page plays both formats.

### Phase 2b: Godot, the first open-source engine target

Decided 2026-11-24: Godot is the first open-source engine target, because working smoothly with
Godot's own 2D animator sets the project apart. A Godot 4 add-on (MIT,
GDScript, under `integrations/godot/`) imports a `*.keyframe.json` file and builds a scene from
Godot's own 2D animation stack, so the result stays editable in Godot's animator and works with
AnimationTree:

- Bones become `Skeleton2D` / `Bone2D`; region attachments become `Sprite2D`, meshes become
  `Polygon2D` with bone weights; draw order becomes `z_index`.
- Each clip becomes an `Animation` in an `AnimationPlayer` library: bezier tracks for rotation,
  position and scale that keep the authored handles, value tracks for colour (`modulate`), image
  swaps and draw order, method tracks for events, and the clip's loop flag.
- What Godot's stack has no counterpart for is baked into keys and listed on import: IK, inherit
  modes other than normal, physics; shear maps to `skew` approximately; mesh deform keys become
  `polygon` value tracks.
- The Keyframe format is designed with this mapping in mind (bone transforms, draw order, curves,
  events, loop flags). A gate builds the scene description in Node and compares it with the
  engine's poses; the real import is tested in the Godot editor on a Windows PC.

### Phase 3: the agent understands what it animates

- Before writing, the agent classifies the subject (character, creature, prop, UI element, VFX,
  camera or scene) and its intent (idle, action, reaction, transition, reward, loop), and writes a
  brief into the project (`.keyframe/brief.json`): subject, intent, rig template, clip timing from
  the reference table, principle preset, display size.
- The studio offers the classification from the rig and the reference (bone names, hierarchy,
  slot layout, motion measured in a video) and the agent confirms or corrects it; the brief then
  steers `critique_animation`'s thresholds.
- Copying a reference becomes interpretation ([#19](https://github.com/Zeatrex01/keyframe/issues/19)): the measured motion is read as beats and
  principles and re-staged for the subject and its size, with a report in those terms.

### Phase 4: drawing and VFX

- SVG placeholder art and a drawing area in the page ([#24](https://github.com/Zeatrex01/keyframe/issues/24)): the agent draws one layer per part,
  the owner adjusts parts and pivots, one action builds a skeleton in either format.
- VFX: particles, trails, flashes, glows and shakes as data the engine plays and the Spine adapter
  bakes into slots and keys.
- Existing open-source work is integrated before anything is written from scratch: a library or
  asset set is taken only with an MIT-compatible license, vendored with its license and version
  (ADR-6), optional, and with a gate. Each one is a maintainer decision recorded in
  `docs/concept.md`.

### Phase 4b: the drawing side, as deep as the animation side

The studio is two crafts: an art director who draws and a senior animator who moves what was
drawn. The drawing side gets the same steps as the animation side (direction, making, critique,
proof, delivery); `docs/drawing.md` has the details and the boundary.

- Done: a per-project style guide (`style_guide`); parametric shapes and UI components drawn from
  it by name, with labels in a built-in stroke font and an icon family; states (hover, pressed,
  disabled, on/off) as other looks of one part; artboards that are never rigged; `critique_art`
  with a contact sheet; `export_art` (trimmed PNGs with pivots at any scale, sprite sheets with a
  JSON map, clean SVG, clips as PNG sequences); live drawing on the board.
- Next: an Art Director and a Senior Animator as agent roles the Director coordinates; a small
  embeddable web player module with a documented API; a UI pack made with the studio's own tools
  as a showcase.
- Later: boolean operations on shapes, outline fonts, text on paths, a vector editor in the page
  beyond moving and scaling parts.

### Phase 5: a brand, a professional app, fewer and better examples

Decided 2026-11-24: fewer, better examples, a brand, and a simple web interface finished to the
quality of a modern, professional app.

- A brand (name treatment, mark, colours, type) and a design system the page is built on.
- The page restyled as an app: the same three views and the stage, with a professional finish, in
  both themes, keyboard and screen-reader ready ([#17](https://github.com/Zeatrex01/keyframe/issues/17)).
- The examples reduced to a few showcase pieces made to the principles (one character, one prop,
  one UI set, one VFX), each with its brief, its clips and its gate; weaker examples leave the tree.
- The design is produced first (brand, design system, mockups, examples plan, handoff) and applied
  as one change; until then UI changes stay minimal.

## v1.0: the public release

v1.0 is the first version a stranger can be expected to install and use without help. It ships
when every Now and Next item is closed (or moved to Later by a maintainer) and all of this is true:

1. **Install.** Clone or download, then one documented start on Windows, macOS and Linux with only
   Node.js 18+. The studio is not published to a package registry (decided 2026-11-24).
2. **First start.** The app window opens, the opening plays, the sample plays, and Settings lists
   the agent lines and the add-ons. No optional program is needed for any of it ([#10](https://github.com/Zeatrex01/keyframe/issues/10), [#20](https://github.com/Zeatrex01/keyframe/issues/20)).
3. **Connect.** Claude Code and Codex connect with the lines Settings shows, verified in a real
   session, and a getting-started guide covers it end to end ([#11](https://github.com/Zeatrex01/keyframe/issues/11), [#22](https://github.com/Zeatrex01/keyframe/issues/22)).
4. **The core loop works on real art.** Describe → the agent writes → check → see → a delivery
   beside the source, with a backup, on a painted character, not only on code-drawn examples
   ([#15](https://github.com/Zeatrex01/keyframe/issues/15), [#12](https://github.com/Zeatrex01/keyframe/issues/12)).
5. **Proof is trustworthy.** Headless frames match the official WebGL player within a stated
   tolerance ([#16](https://github.com/Zeatrex01/keyframe/issues/16)), and the CI gates of ADR-10 hold, including the browser tests ([#21](https://github.com/Zeatrex01/keyframe/issues/21)).
6. **Usable by everyone.** Keyboard, screen reader and contrast meet WCAG 2.2 AA on the core flow
   ([#17](https://github.com/Zeatrex01/keyframe/issues/17)), and the studio stays within its performance budget on a large project ([#18](https://github.com/Zeatrex01/keyframe/issues/18)).
7. **Safe.** The one-way rule, the local-only server and the privacy gate hold. `SECURITY.md`
   names a working reporting route.
8. **Stable.** From 1.0 on, the MCP tool names and arguments, the delivery format and the project
   folder layout change only in a major version ([`docs/development.md`](development.md), Releasing).

## Now (v0.3)

The foundation a stranger needs before anything else: it runs where they are, it talks to a
real agent, and every example in the tree works.

### Core animation workflow

**Make the example kit scripts run again** · S · [#9](https://github.com/Zeatrex01/keyframe/issues/9) · source: AU
- *Problem:* `examples/kit/*.js` are CommonJS in an ES-module package; every script fails with
  `require is not defined`.
- *Value:* contributors can regenerate the examples and build new ones.
- *Depends on:* nothing. *Good first issue.*
- *Done when:* every kit script starts; the README says how to get Playwright for them only; a
  gate loads every kit module.
- *Status 2026-11-24:* the showcase kit (`examples/kit/*.js`) is ES modules on the standard
  library only and rebuilds every showcase example with `npm run examples`; the browser kit that
  painted Mika and Pip is kept as `examples/kit/*.cjs`.

**Write the reward chest clips** · M · [#12](https://github.com/Zeatrex01/keyframe/issues/12) · source: NS 4, BR
- *Problem:* the chest has art and a rig but no animation, the only unfinished showcase piece.
- *Value:* a complete multi-beat reward example to open, play and learn from.
- *Depends on:* [#9](https://github.com/Zeatrex01/keyframe/issues/9).
- *Done when:* drop, rattle, burst, beam, three cards fly out and flip, then a seamless loop,
  written through the studio's tools; `check_skeleton` passes; frames rendered and looked at; a
  gate pins the clips.
- *Status 2026-11-24:* done in `examples/showcase/chest` (`appear` and `glow`,
  `test/example-chest.test.js`).

### Agent integration

**Connect a real agent and write the first-session guide** · M · [#11](https://github.com/Zeatrex01/keyframe/issues/11) · source: NS 2, BR
- *Problem:* the loop has only run with a scripted test client.
- *Value:* a stranger's first ten minutes work: copy a line, see the dot turn green, get a motion.
- *Depends on:* nothing (better after [#10](https://github.com/Zeatrex01/keyframe/issues/10)).
- *Done when:* Claude Code and Codex each run one full loop on the sample; friction is filed;
  `docs/getting-started.md` exists, written from the real run.

### Asset and reference pipeline

**Finish verifying the link intake on real links** · S · [#13](https://github.com/Zeatrex01/keyframe/issues/13) · source: NS 7 (a, b)
- *Problem:* the over-300 MB path and a real non-mp4 remux are assumptions in the code.
- *Value:* large or unusual videos fail clearly and leave nothing behind.
- *Depends on:* nothing.
- *Done when:* both are observed, the code and a gate match what was seen, and the notes are dated.

### Distribution

**Verify the studio on a clean Windows machine** · M · [#10](https://github.com/Zeatrex01/keyframe/issues/10) · source: NS 1, NS 7 (c), BR
- *Problem:* nobody has double-clicked `Start Studio.cmd`, installed the PWA or run a real download
  on Windows.
- *Value:* most animators are on Windows; a blank first window loses them.
- *Depends on:* [#8](https://github.com/Zeatrex01/keyframe/pull/8) (the e2e test also runs on Windows in CI).
- *Done when:* the launcher, a second start, the PWA and a real download (whole, range, timeout
  with no leftover process) work on Windows 10 and 11.

## Next (v1.0)

What turns a working tool into one strangers can adopt: art to start from, real art, trustworthy
proof, accessible, fast, documented.

### Core animation workflow

**Compare headless frames with the official WebGL player** · M · [#16](https://github.com/Zeatrex01/keyframe/issues/16) · source: ADR-3
- *Problem:* `see_animation`'s rasterizer has never been compared with the official player.
- *Value:* "done means seen" can be trusted for blend modes, clipping and meshes.
- *Depends on:* [#8](https://github.com/Zeatrex01/keyframe/pull/8).
- *Done when:* a CI gate compares fixtures per pixel within a stated tolerance; differences are
  fixed or listed in ADR-3.

### Agent integration

**Copy a reference motion by animation principles, not frame by frame** · M · [#19](https://github.com/Zeatrex01/keyframe/issues/19) · source: ID (2026-11-13), BR (2026-11-24)
- *Problem:* `measure_reference` → `apply_motion` → `compare_reference` already copy a video's
  motion onto a bone, but literally: a squash below a pixel vanishes, compression wobble becomes
  keys, a two-frame anticipation falls between frames, and nothing says why the reference works.
- *Value:* the copy keeps what makes the reference read well (timing, slow in and out,
  anticipation, overshoot and settle, squash with volume kept, arcs, holds) at the rig's size,
  with a short report in those terms.
- *Depends on:* nothing; the tracker and `critique_animation` exist.
- *Done when:* `measure_reference` reports the principles it finds, `apply_motion` adapts and
  lists each adaptation, and `compare_reference` reports the difference per principle; gates on
  synthetic motions with known anticipation, overshoot and squash.

### Asset and reference pipeline

**Placeholder art as SVG, with a drawing board in the page** · L · [#24](https://github.com/Zeatrex01/keyframe/issues/24) · source: BR (2026-11-24)
- *Problem:* a rig needs art before it can move; real art waits for an artist, and the only
  placeholder route today is code in `examples/kit/` that a user can neither see nor edit.
- *Value:* a project can start from a description: the agent draws clean SVG placeholders, one
  layer per part, the owner adjusts them in the page, and the studio makes a Spine 4.2 skeleton
  and atlas from them. Real art later replaces them layer by layer under the same slot names.
- *Depends on:* the design in the issue (a fourth page view and how the agent writes art) agreed
  first.
- *Done when:* the agent draws a 6–10 part character as SVG, the owner moves a part and its pivot
  in the page, one action turns it into a skeleton that `check_skeleton` passes and the stage
  plays; gates for parsing, mapping and the browser flow.

**Bring real artwork and redo the showcase on it** · L · [#15](https://github.com/Zeatrex01/keyframe/issues/15) · source: NS 3, NS 4, BR
- *Problem:* every example is code-drawn; the template, `paint_weights` and the face clips are
  unproven on painted art.
- *Value:* the first thing a stranger sees looks like their own work.
- *Depends on:* [#24](https://github.com/Zeatrex01/keyframe/issues/24) (placeholders first); an art source and a license that allows it in a
  public MIT repository; [#11](https://github.com/Zeatrex01/keyframe/issues/11).
- *Done when:* one painted character goes through the template and the studio, the showcase
  (`examples/showcase`) is re-skinned, the art's license is recorded, and the template is updated.

### UX and accessibility

**Accessibility baseline for the page, checked in CI** · M · [#17](https://github.com/Zeatrex01/keyframe/issues/17) · source: AU, BR
- *Problem:* never audited; no gate stops a regression.
- *Value:* keyboard, screen-reader and low-vision users can use the studio.
- *Depends on:* [#8](https://github.com/Zeatrex01/keyframe/pull/8).
- *Done when:* WCAG 2.2 AA audit fixed or filed; all controls keyboard-operable with names in
  every language; agent messages announced; an e2e check walks the Tab order.

**Extend the e2e test to references, deliveries and restore** · M · [#21](https://github.com/Zeatrex01/keyframe/issues/21) · source: AU
- *Problem:* the page modules that need a DOM are invisible to coverage; only the conversation
  path runs in a browser.
- *Value:* the daily interactions cannot break silently.
- *Depends on:* [#8](https://github.com/Zeatrex01/keyframe/pull/8).
- *Done when:* reference upload and marking, a delivery switching the stage, the source/result
  toggle, history and restore, and Projects run in CI, with browser coverage reported.

### Performance

**Performance budget for large projects and long clips** · M · [#18](https://github.com/Zeatrex01/keyframe/issues/18) · source: AU, ADR-3
- *Problem:* only small fixtures were ever measured; nothing catches a slowdown.
- *Value:* the agent loop stays fast: nobody should wait long for a result.
- *Depends on:* nothing.
- *Done when:* a generated large project is measured, budgets are recorded in the architecture
  doc, and a gate fails when one is exceeded.

### Distribution

**Verify the launcher and app window on macOS, and run e2e there** · S · [#20](https://github.com/Zeatrex01/keyframe/issues/20) · source: AU
- *Problem:* the macOS app window, its fallback and the PWA have not been tried; e2e skips macOS.
- *Value:* Mac users get the same first start.
- *Depends on:* [#8](https://github.com/Zeatrex01/keyframe/pull/8).
- *Done when:* `npm start` works with Chrome, Edge and neither; e2e runs on `macos-latest`; a
  double-click start exists.

**Publish the docs as a site with a getting-started path** · M · [#22](https://github.com/Zeatrex01/keyframe/issues/22) · source: AU, BR
- *Problem:* user guides and maintainer records are mixed in one README and `docs/`.
- *Value:* one address to learn, install and look up any tool.
- *Depends on:* [#11](https://github.com/Zeatrex01/keyframe/issues/11).
- *Done when:* user and maintainer docs are separate; a Pages site builds without a new
  dependency; the tool reference is generated from the registry; links are checked in CI.

## Later (after v1.0)

Not scheduled and no issues yet: each one waits for a maintainer to pick it (`docs/ideas.md`).

| Item | Theme | Size | Source | Note |
|---|---|---|---|---|
| Take a GIF or an image sequence from a page (ArtStation, Behance posts) | reference | M | ID 2026-11-13 | The link intake saves video files only today. |
| Learning from video, part two: find the scenes, sample frames, name each moment from a fixed list | reference | L | ID 2026-11-13 | Adapted, never copied, from the earlier project; the target is the object's own motion. |
| Per-part tracking of multi-part elements (point tracking through occlusion) | reference | L | ID 2026-11-12, NS "Known limits" | Needs a model and a GPU: a dependency decision. |
| Packaged installers (a single executable per platform) | distribution | L | AU, `src/core/app-paths.js` | `resolvePaths({ packaged })` already separates data from the program. |
| Measure more reference recordings for the style study (Royal Match, Tasty Match) | workflow | M | `docs/style-study.md` | Recordings stay out of the repository. |
| Lid art for heads without a separate eye white | workflow | S | NS "Known limits" | Today a full lid hides the eye. |

**Not planned** (`docs/concept.md`, "Not in this tree"): rig editing (adding bones or constraints),
rigs from images, scene documents, the review board, variant mixing. Bringing one back is a scope
decision recorded in the concept first.

## Decisions still open

- **The design of the SVG drawing board** ([#24](https://github.com/Zeatrex01/keyframe/issues/24)): a fourth page view. The agent side is
  decided (2026-11-24): it draws through `draw_rig`.
- **The principle reading for copied motion** ([#19](https://github.com/Zeatrex01/keyframe/issues/19)): confirm the list and the adaptations.
- **The art source and its license** for the public showcase ([#15](https://github.com/Zeatrex01/keyframe/issues/15)).

Decided on 2026-11-24 and not reopened here: the MIT license; the anime and human-body examples
stay in the repository as examples; ESLint, TypeScript and `@types/node` as pinned developer tools; the studio
is not published to npm ([#14](https://github.com/Zeatrex01/keyframe/issues/14) closed); CI runs one Linux job per change and the full matrix only by
hand or on a release tag, to save Actions minutes.
