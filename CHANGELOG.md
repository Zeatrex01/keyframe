# Changelog

All notable changes to this project. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow `VERSION`.

## Unreleased

### Added
- Live drawing: `draw_rig` can draw a rig part by part (`merge: true`), and the Draw board shows each part being drawn as it arrives: outlines traced, then fills, with the part's name and the view following it. Replay, a speed menu and an instant mode (also used when the system asks for reduced motion).
- The drawing side, as deep as the animation side (`docs/drawing.md`):
  - `style_guide`: a per-project art direction (palette by role, outline weights, radii, light, grid, type, sizes) with three presets.
  - `draw_rig` draws from UI components (button, icon button, panel, popup, progress, toggle, badge, icon) and parametric shapes in the guide, with labels in a built-in stroke font and a 30-glyph icon family; states (hover, pressed, disabled, on/off) become other looks of one slot; `restyle` redraws a drawing in a changed guide; `as: "artboard"` draws designs that are never rigged.
  - `critique_art`: palette drift, outline weights, alignment, silhouettes at small size, states too alike, contrast; writes a contact sheet.
  - `export_art`: trimmed PNGs per part and state at any scale with pivots, sprite sheets with a JSON map, clean SVG, and clips as PNG sequences and sheets.
- `export_art` kind `web`: an embeddable player for web pages and HTML games (`keyframe-player.js`, one classic script): `KeyframePlayer.create(canvas, ...)` with play, stop, pause, seek, speed, `setLook` for drawn states and `start`/`complete`/`loop`/`event` listeners, and a `<keyframe-player>` element.
- `critique_animation` holds a figure to the minimums of its action (`src/understand/actions.js`): a strike moves the body behind it, winds up, lands fast and holds the hit; a jump rises a quarter of the height after a crouch; a hop falls into the ground instead of floating; a wave clears the head and swings; an idle breathes; a walk bobs. UI parts, effects and props are not judged as a body.
- `critique_art` answers with an image of the drawing: the whole drawing assembled, then every part and state, so an agent sees static art and artboards without a clip. It also checks text: cut off by the part's edge, spilling out of its shape, off the middle, or shrunk to fit.
- `critique_animation` flags a limb that comes apart from the part it hangs from (`limb-separates`): an arm translated off the shoulder, or a pivot in the middle of a limb.
- A `clean` style preset, now the default: no dark outline, only a thin edge a shade darker than each fill (`stroke.color: "tint"`), gentle radii, a soft top light and a light shadow. The thick-outline cartoon look stays as the optional `casual-game` preset.
- The `figure` component draws a waist-up character by default (`build: upper`): a torso that breathes at the waist, a head, eyes as their own part so they blink, hair behind, and tapered arms with hands. The full-body `kid` and `adult` builds are there when a full body is asked for.
- A side-view `figure` (`build: side`) for platformers and side-scrollers: a character in profile facing right, its far arm and leg behind the body a tone darker, every limb in three parts turning at its joint, the body carrying everything from the hips. The Director picks the view from the use: profile for a game character that runs and jumps, waist-up and facing out for dialogue and portraits.
- Clip exports are ready for a game: every clip of a skeleton is framed alike (same size, feet on the same pixel row), the sheet's map gives the ground origin (`meta.origin`, each frame's `pivot`) and whether the clip loops; a loop leaves out its closing copy of the first frame, and `loop: false` marks a one-shot such as a jump.
- The PLAY button, the reward chest and the coin burst examples are redrawn in the clean look: soft gradients and a thin edge a shade darker than each fill instead of a thick dark outline. The examples build judges each clip as its brief's subject (a button is not held to a body's idle).
- Mika waves the way people do: the elbow out to the side and the forearm upright beside her face, instead of folding the arm over her head. `critique_animation` now reads a wave at the face (the hand's tip up to the eyes or higher), not above the top of the head.
- The side-view figure dresses for a fight: `armor` (plate or leather) adds a helmet, a cuirass and a pauldron, bracer and greave on each side, each with the other material as a state, and `weapons` puts a sword, spear, bow or axe in the near fist as one part whose other weapons are its states. One skeleton, swapped outfits and weapons, a stance per weapon.
- `critique_animation` reads a strike in the direction the limb travels at its fastest, so a sword raised overhead to wind up is read as a wind-up, not as the hit.
- A Warrior example (`examples/showcase/warrior`): the side figure in plate armour with a sword, spear, bow and axe in one slot, a stance and an attack per weapon, a punch, a run and a jump, with sprite sheets for every clip; the feet stay planted through every stance and attack.
- A `smooth` curve for cycles: each key is passed at speed (a spline through its neighbours, wrapping a loop's seam) instead of easing to a stop at every pose. `critique_animation` flags a walk or run whose legs halt mid-swing (`stop-start`), a run that never leaves the ground (`no-flight`), and an idle or a cycle leaning the whole clip (`constant-lean`).
- The Warrior stands upright and runs in one flow: contact, down, passing and push-off with a moment in the air, the hips leading and the knees, feet, arms and head trailing.
- `write_animation` `plant` takes `on: "<bone>"`: the planted point travels with that bone (`at` in its units), for a back hand that stays on a spear shaft or the nock of a bow while the weapon moves; the hand keeps its angle to that bone.
- The Warrior holds the spear in both hands (the back hand rides the shaft through the stance and the thrust), and its shot nocks an arrow: the bow brings an `arrow` part and a drawn look (`weapon_drawn`), the drawing hand holds the nock with the elbow back, and the arrow leaves on the release (every other clip hides it).
- The Warrior throws a one-two: `punch` with the near fist and `punch_cross` with the far one, quicker (0.45 and 0.5 s) and chainable from the guard, plus `punch_upper` and `punch_cross_upper`, upper-body layers to play over the run or the jump so a punch no longer stops the player. `critique_animation` leaves the weight of a clip named as a layer (`_upper`, `_layer`, `_overlay`) that keys no core or leg bone to the clip beneath.
- Godot: an imported rig changes outfits and weapons at run time (`set_look`, `set_attachment`, `get_attachments` on the rig's root); every look of every piece is imported, and a clip that keys a slot (each Warrior stance keys its weapon) shows what the clip says.
- The Warrior's armour fits the body: the cuirass follows the torso's outline with no shirt showing at its edges, tassets cover the thighs, and the bracers taper with the forearms.
- The Warrior ships ready for Godot (`examples/showcase/warrior/godot/`): drop `warrior.kfscene` into a project with the add-on, and set the rig's **Look** and **Weapon** in the Inspector or from code.
- Godot hookup polish from a real Godot 4.7 check: the Warrior's run and jump keep whatever weapon the game set (only stances and attacks key it), `weapon = ""` puts the weapon away, `look = ""` brings back pieces that were taken off, the rig indexes its slots once, and the Warrior gains `idle_unarmed`, `idle_axe` and `attack_axe`.
- Planted feet: `write_animation` `plant` keeps a foot (or a hand) on the point it stood on while the body above it moves, for a punch, a lean, a crouch or a landing. The shin and thigh are solved as two-bone IK on the studio's engine and baked to plain rotate keys, so every runtime, a sprite sheet and Godot play it alike; the answer says how far each leg had to stretch and warns when a foot had to lift. `critique_animation` flags a foot that slides along the ground while it stands (`foot-slide`), and judges the rhythm the author wrote, not the solver's keys.
- A weak critique is never passed off as done: `reply` refuses "ready" after a "faulty" critique, and after a "mechanical" one unless `weak` tells the owner plainly what is still weak.
- The prove step is enforced: the studio keeps a ledger of what was written and what proved it (`.keyframe/proof.json`). `reply` refuses work "ready" for a clip that was not checked with `check_skeleton` and critiqued with `critique_animation` after its last write, or a drawing not critiqued with `critique_art`; a Director turn that ends with unproven writes says so in plain words.
- The Draw settings edit the words and colours of a part the AI drew from a component or shapes (a title, a label, a body line, a fill, by palette role or a custom colour); the part is drawn again in the style guide and keeps where the owner put it.
- `export_art` sheets keep clear pixels around every sprite and clip frame (`padding`, default 2), so nothing bleeds when an engine filters the texture.
- Parts reach the page as safe trees (`src/render/svg-safe.js`): only shapes, groups and gradients survive, so nothing in a drawing can run.

### Fixed
- Planted limbs turn the short way between baked keys: a solved angle crossing ±180 no longer spins a limb a full turn.
- Calling an advanced tool (such as `export_godot`) without `--all` now says so and how to turn it on, instead of "Unknown tool".
- One-shot clips play once: a clip named for a jump, an attack, a hit or a reveal no longer loops in the Godot addon or in a sprite sheet's map just because it lands back in its first pose, and a cycle whose length is not on the fps grid (a 0.6 s run at 12 fps) is still found to loop and is cut into frames that cycle exactly.
- The web player no longer grows a canvas that has no CSS size on every frame at a display scale above 1; it keeps the canvas at its laid-out size.
- A text shape takes its `fill` as its colour (it was saved and not drawn), and on the Draw board a popup's title tab or action button edits its own colour instead of the whole panel's.
- Text is set to fit the shape it sits on and centred on its ink; a popup's title ribbon is measured from its title, so "YOU WON 250" is no longer clipped.
- The Draw board never loses the AI's drawing: Undo back to the saved drawing is no longer an unsaved change, a drawing the AI changes while the board holds edits shows a notice (load the AI's version, or keep yours as a copy), and the board's save is refused if the AI drew on the file since it was opened.
- Labels and popup text pick the readable text colour for their fill in every style.
- Pip's jump rises a quarter of the body's height (it read as a hop); Mika's wave clears her head.
- The privacy gate no longer reads image file names such as `ui@3x.json` as e-mail addresses.
- The Draw board shows parts whose SVG has no `xmlns`.
- A drawing the AI makes shows on an open Draw board at once, and the board fits it again once it becomes visible.
- The Draw settings panel has a readable label; every key the page's markup names is now checked against the English catalog.

## 0.0.1-beta - 2026-11-24

The first public release: an open-source, AI-assisted 2D skeletal animation studio. You describe
the motion; your AI (the built-in Director, or any MCP client) writes it as animation JSON
compatible with Spine 4.2; the studio plays it on its own engine, checks it, critiques it against
the animation principles and saves it beside your file, which is never changed.

### Highlights
- Twenty-six self-describing MCP tools any model can use, with the animation principles built in as rules with numbers.
- The studio's own engine: no Spine code and no Spine license needed. The official Spine runtime is an opt-in add-on that states its license.
- The built-in Director: the studio drives your installed Claude Code (Codex and Gemini best effort) from its chat panel, isolated from your other work.
- The subject comes first: the studio proposes what a skeleton is (character, prop, UI, effect) and what each clip is for, and judges the motion by it.
- Drawing and effects: Draw mode and `draw_rig` for placeholder art, an asset library, and `add_effect` for bursts, trails, flashes, glows and shakes.
- Learning from a reference video: measure one element's motion and put it on a bone.
- Keyframe for Godot: a Godot 4 add-on that imports the animation as Godot's own nodes and tracks; a standalone HTML player.
- A new brand and app: Projects, the first run, the studio with key lanes, Draw mode and Settings, in dark and light, English and Turkish.
- Five showcase examples: Mika, Pip, the reward chest, the play button and the coin burst.
- The opening: the brand mark's intro, drawn and animated with the studio's own tools, plays at every start and opens this README.

### Added
- The opening (`examples/opening`) is the brand mark's intro, made with the studio's own tools: `draw_rig` drew the ghosts, the key and the outlined name; `write_animation` and `add_effect` wrote `intro` (1.2 s: the key flies in and leaves its onion skins, lands with a ~10% overshoot and a soft flash, the name rises under it). The splash is always on the dark ground. `docs/brand/intro.gif` and `intro.html` (the standalone player) carry it into the README; `docs/brand/social-preview.png` is the repository's 1280 x 640 card. A gate (`test/opening.test.js`) holds it to the brand.
- Draw mode in the page (the drawing board): a tools rail (select, ellipse, rectangle, pivot, ask the AI), the parts list, a canvas with the bones and the selected part's pivot, and part settings (name, fill, outline, size, position, pivot, what it moves with, order). "Use in the project" builds the rig through `draw_rig`, and the stage shows it.
- The built-in Director shows what it is doing: a live row with its phase (thinking, reading, writing, checking, answering) and tool, the seconds, its answer as it streams, and a Stop button. A stopped turn is marked, and the next turn is told the stopped request is cancelled. The steps bar follows what the run really does.
- The project switcher shows the project's own picture when it has a `preview.png`.
- Reference docs: `docs/tools.md` (every tool, its arguments and an example, written from the definitions by `npm run docs:tools`; a gate keeps it current), `docs/format.md` (every file the studio reads and writes) and `docs/godot.md`.
- The asset library (`assets/library`, Phase 4): bundled 2D packs, each with its license, author and source in `pack.json`, taken only under CC0, MIT or CC BY (credited in NOTICE; a gate checks it). The first pack, "Keyframe basics", has eight props and effect sprites in the studio's style. `draw_rig` takes an item as `svg: "asset:<pack>/<item>"`; `GET /api/assets` lists the packs for the page.
- `draw_rig` (Phase 4, #24): placeholder art drawn as SVG parts (placed, pivoted, parented, back to front) becomes a rig the studio plays at once: a Spine 4.2 skeleton whose setup pose is the picture, its atlas and page, and `<name>.parts.json` to rebuild from. The studio draws the SVG itself (`src/engine/svg.js`: shapes, paths, transforms, gradients, strokes, opacity; it matches Chromium to within 1/255 on average) and names what it does not draw. A redraw keeps the clips already written. `start_here` sends an empty project to it. 26 tools are served by default.
- `add_effect` (Phase 4): bursts, trails, flashes, glows and shakes written as ordinary bones, slots and keys, so the studio, the Godot export and any Spine runtime play them the same and every key stays editable. A core tool; 25 are served by default.
- `measure_reference` reads a reference as animation (`reading`): its beats in the principles' terms (anticipation, main move, peak, overshoot and settle, holds) and `restage`, the `apply_motion` speed and amount that fit it to the clip's seconds in the brief and to the size the subject is shown at (issue #19).
- The brief (`brief`, a default tool): the studio proposes what a skeleton is (character, creature, prop, UI, VFX, scene) from its bones, slots and blend modes, and what each clip is for (idle, loop, action, reaction, transition, reward); the agent confirms it once into `.keyframe/brief.json`, and `critique_animation` then judges each clip by its loop flag, its display size and the subject's preset.
- Keyframe for Godot (`integrations/godot`): a Godot 4 add-on that imports `.kfscene` files as Skeleton2D, Bone2D, Polygon2D and an AnimationPlayer whose clips are Godot's own tracks (bezier tracks keep the authored handles; IK, inherit modes and shear are baked and reported). `export_godot` and `npm run godot` write the scene; `test/godot.test.js` plays it the way Godot does against the engine. A demo project is included.
- A standalone player: `export_player` (and `npm run player -- <skeleton.json>`) writes one HTML file with the engine, the skeleton and its art inside that plays by double-click, with no studio, server or network.
- The embedded agent (`src/agent`, `docs/agents.md`): the chat panel drives the owner's installed agent CLI headless (Claude Code first; Codex CLI and Gemini CLI best effort), so no second terminal is needed. The director slot answers the owner's messages in the conversation and resumes its session per project; extra slots (illustrator, researcher, any role) have their own CLI, tool scope and brief. Each run gets only the studio's MCP tools (the server's new `--only`), the project folder as its working folder and no credentials. Routes: `GET /api/agent`, `PUT /api/agent/slots`, `POST /api/agent/run`, `POST /api/agent/stop`; `/api/state` carries the slots in `agent`.
- Five showcase examples in `examples/showcase`, each with a `brief.json`, a README, a 480 x 360 `preview.png` and its own gate (`test/example-<name>.test.js`): Mika (anime girl: idle, happy, surprised, a wave on a newly cut arm), Pip (full-body kid on IK: idle, jump with a land event, walk, cheer), the reward chest (drop, rattle, open, three cards on their own events, a glow loop), the PLAY button (idle, hover, press, release, disabled, and a badge on track 1) and the coin burst (eight coins into a counter with a `coin_land` event each, sparkles on track 1). Every clip passes `check_skeleton` and `critique_animation` with no warning, and the official runtime poses it as the engine does.
- `npm run examples` rebuilds them with the kit in `examples/kit` (ES modules, standard library only: its own rasterizer, atlas packer and rig builder; clips written through the studio's tools).
- The studio's own engine (`src/engine`): bones with every inherit mode, curves, IK, meshes, deform, clipping, draw order, skins and events, posed exactly as the official Spine runtime poses every shipped skeleton (`test/engine.test.js`). The studio, its tools and the page play on it with no Spine code and no Spine license.
- The Spine add-on (`docs/addons.md`): off by default; turning it on (Settings, or `npm run spine-addon -- --accept-license`) shows that it needs the owner's own Spine license, then downloads Esoteric Software's npm package, checks its pinned integrity and keeps it in the user's app data. It adds the official verdict, transform/path/physics constraints, physics baking and binary `.skel`. Turning it off deletes only its files.
- `check_skeleton`, `scan_project`, `see_animation` and `sample_animation` name what the engine does not evaluate yet (`notEvaluated`) instead of pretending; `check_skeleton` and `scan_project` add the official verdict when the add-on is on.
- Rig conventions: `read_rig` lists what the owner's clips always switch together (a closed lid hides the eye and pupil), `critique_animation` flags a clip that breaks one, and `write_animation` reports it in its answer.
- `write_animation` answers with the clip's `duration` and with `prove`: the check, critique and look calls (with the moments worth looking at) to run before calling a clip done. Rig conventions name the in-between attachments the owner's clips use (a half-closed lid) for a softer switch. Notes that ask for nothing are level `info`.
- The direction of the studio as five phases in `docs/roadmap.md` (decided 2026-11-24): tools
  any AI can use, a native engine with Spine as an opt-in adapter, understanding the subject before
  animating, drawing and VFX, and a brand with a professional app.
- Every tool says when to use it (and when not), carries an example call that passes its own schema
  and names what comes next; `help` returns all of it and the listing carries "Use when". A gate
  checks every example and every argument description.
- Every refusal carries `fix` (how to get past it) and, for argument problems, a call that works.
- `critique_animation` is on the default wire and measures the animation principles: overlap, ease
  variety, squash volume and placement, loop seams, twinning and the readability floor (warnings).
- `start_here` returns what the studio can do and the animation principles as writing rules with
  numbers, plus the timing of common clips (`src/understand/principles.js`).
- `npm run connect` prints the connection lines for Claude Code, Codex, Gemini CLI, Cursor, VS Code,
  Windsurf, Claude Desktop and any MCP client, and `--check` proves the server answers a real MCP
  handshake. `docs/getting-started.md` walks a first session.
- `docs/roadmap.md`: Now, Next and Later by theme, the v1.0 public release criteria, and an issue per
  Now and Next item.
- Quality gates in CI: ESLint, a TypeScript check of the JSDoc (`checkJs`), coverage thresholds and a
  browser smoke test of the core flow (page, server, an MCP agent, the conversation).
- `npm run dev` (restarts on server changes), `npm run doctor`, `npm run check`.
- One contract for optional add-ons (`src/core/addons.js`, `docs/addons.md`); Settings now lists the
  Spine CLI too.
- `docs/development.md` (workflow, conventions, releasing), `docs/addons.md`, and data flow,
  invariants and extension points in `docs/architecture.md`.
- Labels and milestones as files (`.github/labels.json`, `.github/milestones.json`) applied by a
  workflow; a release workflow that publishes the CHANGELOG section of a pushed tag.
- A formatting gate for `.editorconfig`, and gates for the version, the CHANGELOG and the
  no-runtime-dependency rule.
- Settings lists the optional add-ons (ffmpeg, yt-dlp): whether each is installed, what it adds, how to install it.
- A privacy gate: no machine-local config, secret, recording or home-folder path is tracked.
- The MIT license for the studio's own code; the vendored Spine runtime keeps its own license.
- `/api/health` liveness answer; `KS_PORT`, `KS_LOG_LEVEL` and `KS_LOG_FORMAT` settings.
- A levelled log on stderr for the page server and the MCP server.
- `SECURITY.md`, `CONTRIBUTING.md`, issue and pull request templates, Dependabot for actions.
- A gate that every script in the tree parses.

### Security
- The built-in Director never reads the owner's own instructions: Claude Code runs with `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` and a `claudeMdExcludes` lock (no global or folder CLAUDE.md), no user settings, hooks, slash commands or auto-memory. An opt-in gate proves it against the real CLI with a planted codeword (`test/agent-isolation-real.test.js`). Codex and Gemini get the equivalent.

### Changed
- The sample in Projects is now Mika (`examples/showcase/mika`) instead of the cat.
- Retired the cat, dog, bunny, panda and kid heads, the menu icons and the victory sequence with their kit scripts; the anime and human rigs live on as Mika and Pip. The features they covered stay gated on fixtures: `test/fixtures/face` (the face rig and follow baking), `test/fixtures/body` (the IK body) and `test/fixtures/banner` (a painted mesh ribbon).
- The studio is plain MIT: the vendored Spine runtime and the license exception are gone (`NOTICE` explains the add-on). Tool descriptions and the agent instructions describe the studio's own animation JSON (Spine 4.2 compatible), not a Spine-only workflow.
- `export_binary` refuses with `spine-addon-off`, writing nothing, while the add-on is off.
- Without yt-dlp the link field beside the reference is not shown, instead of a disabled field and an install paragraph.
- The personal showreel composition was removed from `examples/kit/reel`; `.gitignore` covers secrets, recordings and project working folders.
- The page starts in English; Turkish is an opt-in language. All documents are English.
- The page server is split into a route table, a response module and a state reader; every
  response carries security headers and a content security policy.
- Error codes map to their HTTP status (404, 403, 409, 413, 501); unexpected failures are a
  plain 500 with the details in the log only.
- The page script is split into modules by what each part looks after.
- On a phone the conversation sits right under the stage.
- CI runs on Linux, Windows and macOS with Node.js 18, 20, 22 and 24.

### Fixed
- After a project switch the stage and the delivery card no longer keep the last project's file; a stage menu lists every skeleton of the project, so a rig drawn in Draw mode can be put on the stage in a project that already has one.
- The chat no longer says "No AI is connected" while the built-in Director is ready, and Settings counts the Director as connected; the slots show only the open project's activity and errors, and a Stop is not shown as an error.
- The first run leads with the built-in Director (with whether Claude Code is installed, and a button to Settings); the MCP lines for other clients come second, folded.
- Draw mode writes numbers with a point in every language (a number field showed the system's decimal comma).
- The installed app's service worker is registered once the studio answers, not while it is still starting.
- A double click to skip the opening no longer opens an example under it on the first run.
- The stage frames each clip on its own (the setup pose and everything the clip draws, sampled 30 times a second), so a small overlay clip is not lost in a big clip's box and an arm at its lowest is not cut off.
- The e2e run always ends: the browser quits through DevTools, every child is freed, and a last guard ends a held process.
- One spelling, "license", everywhere (the add-on flag still accepts the British spelling).
- `see_animation` and `see_reference` say the frame width range (64 to 640) in the short tool listing.
- The opening no longer shrinks while it plays: its state class was `live`, which the chat's live row styles with margins; it is now the splash's own `playing`.
- Windows: the Director starts out of the box when `claude.cmd` runs `claude.exe` (it is started directly; settings and the brief travel as files, so `cmd.exe` never strips a quote).
- Windows: three tests built file paths with `new URL().pathname`; a gate now keeps that pattern out.
- A region quad is drawn as one piece on the canvas, so no seam crosses it.
- The Godot demo parses in Godot 4.7 and moves on from looping clips.
- A delivering reply is the Director's answer; its longer closing words no longer follow it as a second message.
- `critique_animation` counted only bone timelines: a clip that swaps attachments read as 0 s long and "good". It now measures every timeline and answers `unmeasured` when no bone moves.
- JSDoc that disagreed with the code in 32 modules (found by the new type check).
- An agent reply written just before the owner sent a message no longer goes missing from the
  page until a reload.
- The polled state no longer parses every skeleton every second.
- The package zip no longer includes agent client configs, logs or environment files.

### Before the public beta

Development before this release used internal version numbers, up to 0.2.0 ("the narrowed studio:
twenty-two tools on the default wire, the page with Projects, Settings and the opening, reference
learning, and the optional link intake"). That history is in git.
