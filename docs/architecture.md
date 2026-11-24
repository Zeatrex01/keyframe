# Architecture

Decisions that shape every module. Each one names what it replaces in the legacy tree and why.
Changing one is a dated entry here first.

## Layers and the dependency rule

```
src/shared      pure kernel every layer may use: StudioError
src/core        Node-only platform: safe paths, backups, PNG codec, Spine CLI, app paths
src/spine       pure and isomorphic: atlas, check, findings, curves, diff, bake, merge,
                skin migration, weights, binary export
src/engine      pure and isomorphic: the studio's own skeleton model and player engine
                (ADR-11), no Spine code; Spine 4.2 JSON in and out as a data format
src/runtime     the pose API with two backends: the engine (default) and, only when the owner
                turned the Spine add-on on, the official spine-ts 4.2 runtime (ADR-2, ADR-11)
src/understand  read, sample, critique, describe — numbers and sentences about a skeleton
src/render      frames to pixels, headless
src/deliver     the one-way rule: base-preserving export, delivery beside the source, history
src/mcp         the wire and the tools
src/agent       the embedded agent: the owner's agent CLI driven headless from the chat panel,
                one per slot (docs/agents.md)
src/server      the HTTP surface for web/
web/            pages; import src/engine, src/spine and src/shared directly
```

Allowed imports between our layers (anything not listed is forbidden). Every layer may also
import `shared`, which imports nothing:

| Layer | May import |
|---|---|
| `core` | — |
| `spine` | — |
| `engine` | `spine` (curve presets and findings) |
| `runtime` | `spine` (the pure draw-order guard it runs before parsing), `engine` |
| `understand` | `spine`, `engine`, `runtime` |
| `render` | `core`, `spine`, `engine`, `runtime`, `understand` |
| `deliver` | `core`, `spine`, `engine`, `runtime`, `understand` |
| `mcp` | `core`, `spine`, `engine`, `runtime`, `understand`, `render`, `deliver` |
| `agent` | `core`, `mcp` (tool names and the server name) |
| `server` | `core`, `spine`, `engine`, `runtime`, `understand`, `render`, `deliver`, `mcp`, `agent` |

Isomorphic layers (`shared`, `spine`, `engine`, `understand`) never import `node:*`; `runtime` reaches `node:*` only
through a dynamic `import()` on its Node path. `test/architecture.test.js` enforces both rules
from this table.

## How the parts talk

Three processes and one folder. None of them shares memory with another; everything that crosses
a boundary is a file or a request on this machine.

```
            HTTP on 127.0.0.1 only                    files in the project folder
 the page  ─────────────────────────►  page server  ──────────────────────────────┐
 (web/)    ◄── state poll, files ────  (src/server)  reads skeletons, writes       │
                                        │            .keyframe/chat.jsonl          ▼
                                        │ in-process MCP wire        <project>/
                                        └──► src/mcp (a short          *.json, *.atlas, *.png   the owner's source: read only
                                             fixed list of tools)      *_v2.json                deliveries, written beside it
                                                                       .backup/                 every overwrite, kept
 the agent ── stdio JSON-RPC ──► tools/mcp-server.js ──► src/mcp ────► .keyframe/chat.jsonl     the conversation
 (any MCP client)                (follows the open project            .keyframe/agent.state    cursor, last seen, work state
                                  in studio.config.json)              reference/               videos and images to learn from
```

- **The page** (`web/`) plays skeletons on the studio's engine (`web/keyframe-player.js`, the
  official Spine player instead only while the Spine add-on is on), polls `/api/state`, and
  sends the owner's words, references and a restore request. It never writes a skeleton; Draw
  mode sends parts to `draw_rig` (`POST /api/drawing`), which writes only files the studio drew.
- **The page server** (`src/server`) serves `web/`, `locale/`, the isomorphic `src/engine`,
  `src/shared` and `src/spine` modules, and the add-on's player files while it is on; answers the API, and
  reaches tools only through the in-process MCP wire by name (`check_skeleton`, `list_history`,
  `restore_file`).
- **The agent** is any MCP client running `tools/mcp-server.js`. Without `--project` it follows the
  project the page has open (`studio.config.json`, or `KS_CONFIG`). Every write goes through
  `src/deliver`: a new file beside the source, a backup first, a compare-and-swap on the base.
- **The project folder** is the only shared state. Two agents, a restart, or a second page all see
  the same files, so there is no session to lose and no key to leak.

## Invariants

Each one has a gate; a change that breaks one is a decision recorded here first.

| Invariant | Gate |
|---|---|
| The owner's source file is never written; deliveries are new files with a backup | `test/compose.test.js`, `test/tools-files.test.js`, `test/core-backup.test.js` |
| If the base changed, the base wins and the result says so | `test/policy.test.js`, `test/compose.test.js` |
| The engine poses every shipped skeleton as the official runtime does (when the add-on is there to compare); a non-4.2 skeleton is refused by name | `test/engine.test.js`, `test/runtime.test.js` |
| No Spine runtime code in the repository; the add-on is off until the owner accepts the Spine license, installs only the pinned package and removes only its own files | `test/repository.test.js`, `test/spine-addon.test.js`, `test/http.test.js` |
| Layers import only what the table above allows; isomorphic layers never import `node:*` | `test/architecture.test.js` |
| The server listens on 127.0.0.1, refuses other hosts and origins, and sends its security headers | `test/server-hardening.test.js`, `test/http.test.js` |
| No runtime dependency: Node's standard library only (ADR-6); developer tools are pinned devDependencies | `test/architecture.test.js`, `test/release.test.js` |
| Optional programs are optional: absent means a 501 refusal for that feature only | `test/addon-contract.test.js`, `test/addons.test.js` |
| English everywhere; Turkish only in `locale/tr.json` | `test/language.test.js`, `test/i18n.test.js` |
| No personal data, secrets or machine paths in git | `test/privacy.test.js` |
| Every tracked text file follows `.editorconfig` | `test/format.test.js` |
| The page's core flow works in a real browser | `e2e/smoke.e2e.js` (CI) |

## Extension points

| To add | Where | The contract |
|---|---|---|
| An MCP tool | `src/mcp/tools/*.js`, listed in `src/mcp/server.js` | `src/mcp/registry.js`: name, `tier` (`core` is served by default, `advanced` only with `--all`), `writes`, summary, description, `inputSchema`, `run`. A new `core` tool is a maintainer decision (`docs/concept.md`). |
| An optional program | `src/core/addons.js` plus its own `src/core/<program>.js` | `docs/addons.md`: detection never throws, absent is a 501 refusal, Settings shows it, the page hides what it alone enables. |
| A page view or panel | `web/*.js`, a module per concern | Imports resolve, under 450 lines, cached by `web/sw.js` (`test/page-modules.test.js`); text in `locale/*.json`. A new view is a maintainer decision. |
| A page API route | the route table in `src/server/http.js` | Errors are `StudioError` codes mapped to a status in `src/server/respond.js`; `project: true` when it needs an open project. |
| A finding or a check | `src/spine/check.js`, `src/understand/*` | Findings are data (ADR-4); the base-vs-current rule is `src/spine/findings.js` (ADR-5). |
| A language | `locale/<lang>.json` | Every key of `en.json` (`test/i18n.test.js`). |

## Outside `src/`

`tools/` holds the entry points (`studio.js`, `mcp-server.js`, `cli.js`) and developer scripts
(`doctor.js`, `release-notes.js`, `sync-github.js`). `e2e/` is the browser smoke test, run on its
own (`npm run test:e2e`). `types/` declares globals for the type check (`tsconfig.json`). None of
them is imported by `src/`.

## The conversation is files

The page and the agent are two processes that never talk to each other directly. The owner's
words go from the page to `src/server` to `<project>/.keyframe/chat.jsonl`; the agent's MCP
server reads the same file in `wait_for_message` and appends through `reply`
(`src/core/chat.js`). The agent's cursor, last-seen time and work state live beside it in
`agent.state`. So any MCP client can be the agent, two can share a project, and no key or
network is involved. The HTTP server listens on 127.0.0.1, answers only requests addressed to
that host, never writes a skeleton, and reaches tools by name from a short fixed list.

## The embedded agent (2026-11-24)

`src/agent` drives the owner's agent CLI headless from the chat panel (`docs/agents.md`). It sits
beside `mcp`, not inside it: a run is a child process (the CLI) that talks to its own child, the
studio's stdio MCP server for that project, started with `--only` the slot's tools. So the
embedded agent uses exactly the wire an external agent uses, and the conversation stays files:
the run's answer is appended to `.keyframe/chat.jsonl` like any `reply`. The server owns one hub
(`createAgentHub`); the slots are a machine setting in the studio config, the resume ids are per
project in `.keyframe/agent-sessions.json`.

## Learning from a reference is measurement

A model looking at a filmstrip guesses timing; a few percent of squash on a small icon is less
than a pixel. So the reference is measured (`src/understand/track.js`, pure): the crop's
border ring is the ground, every pixel counts by how far it is from that ground, and the size
along an axis is the spread of that coverage about its centre (its second moment), which
follows a scale exactly, to a fraction of a pixel, and survives compression blur. Keys are turning points and hold edges; the ease of a
segment is the preset that best explains the frames inside it, marked `guessed` when there are
too few. The same tracker runs on the studio's own render, so a copy is compared with its
reference channel by channel instead of by eye. Frames come from the machine's ffmpeg
(`src/core/video.js`). The studio's optional programs are ffmpeg, the Spine CLI
(`src/core/spine-cli.js`) and yt-dlp (`src/core/ytdlp.js`, which only saves the video of a YouTube link
or of any public https video page into `reference/`; the link check is `src/core/link.js`); each is looked up on the machine and absent means the feature
says how to install it, nothing else changes. All three are declared in `src/core/addons.js` and follow one contract (`docs/addons.md`). Learned motions are stored
rest-relative per user (`src/core/motions.js`), so they retarget to any rig.

## The page server (2026-11-24)

`src/server` is three files: `http.js` (the server, its guards and one route table), `respond.js`
(the reply shape, the headers every response carries and the error-code to HTTP-status table) and
`state.js` (what the page polls, parsed again only when a file's size or modified time changed).

- **Local only.** It listens on 127.0.0.1, answers only requests whose Host is that address,
  refuses another site's Origin and any non-GET a browser marks `Sec-Fetch-Site: cross-site`.
- **Headers on every response:** a content security policy with no inline script and no other
  origin, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, same-origin opener and resource
  policies. The page's start guard is therefore a file (`web/boot.js`), not an inline script.
- **Status follows the code.** `*-not-found`, `unknown-*`, `no-such-*` are 404; a path out of the
  project is 403; a conflict (busy, exists, stale) is 409; a body over the limit 413; a missing
  optional program 501. An unexpected failure is a plain 500: the stack goes to the log, never to
  the page.
- **Log:** `src/core/log.js`, levelled lines on stderr (`KS_LOG_LEVEL`, `KS_LOG_FORMAT=json`). The
  access line is at `debug`. The MCP server logs the same way, so its stdout stays JSON-RPC.
- **Stop:** `close()` ends idle keep-alive connections and waits for requests in flight; the
  launcher calls it on SIGINT and SIGTERM.

## The page (2026-11-24)

`web/` is plain ES modules, no build step, split by what each part looks after: `store.js`
(the shared state and elements), `ui.js` (API call, DOM builders, language), `chat.js`,
`stage.js`, `reference.js`, `delivery.js`, `sync.js` (state from the server and the poll),
`views.js` (Projects, Settings, the opening), `draw.js` (Draw mode, the drawing board) and
`app.js`, which only wires them and starts.
Rules a test can check without a browser live in DOM-free modules (`i18n.js`, `chat-rules.js`,
`link-text.js`, `stage-pick.js`, `draw-model.js`). `test/page-modules.test.js` checks every import resolves, no
module grows past 450 lines, and the service worker caches every module.

## ADR-1 · ES modules everywhere

**Decision:** every file is an ES module (`"type": "module"`). Node 18+ and every current browser
load the same file; `web/` imports `/src/spine/atlas.js` as is.

**Replaces:** the UMD wrapper on 30+ legacy modules (`(function (root, factory) …)`), globals
like `root.SpineAtlas`, and the rule "browser modules live in `mcp/`, Node modules in `core/`",
which forced `spine_gate.js` to move folders just to be loadable in a page.

## ADR-2 · The official runtime is the only source of pose truth (revised by ADR-11)

**Revised 2026-11-24:** the studio poses on its own engine by default (ADR-11). The official
runtime below is now the `spine` backend of `src/runtime`, loaded only from the Spine add-on, and
the yardstick the engine is measured against.

**Original decision:** `src/runtime` loads the vendored spine-ts 4.2 bundle (`vendor/spine-player-4.2`)
into a Node `vm` context with a texture-free attachment loader. Sampling, world transforms, draw
order, constraints (IK, transform, path, physics) and clipping all come from it.

**Measured:** the 255 KB player bundle loads in a bare `vm` context, exposes 162 exports, parses
the `ident` fixture (6 bones, 3 clips) and poses it: `b_sweep` at t=0 is x=-320, at t=2 s x=0.

**Replaces:** the legacy `inspect.js` re-implementation of bezier, channel and world-transform
math, which skipped every constraint (`sample_animation` had to warn "constraints are NOT
applied"); and the frame bridge, where engine-resolved state required an open studio window
polled through `work/kare_istek.json` / `kare_cevap.json`. Now any agent gets constrained,
engine-exact numbers with no window, and checks cross-validate against the runtime in-process
instead of in a headless browser.

**Guard:** a skeleton whose `skeleton.spine` major.minor is not 4.2 is refused by name, never
parsed by a mismatched runtime.

## ADR-3 · Headless rendering

**Decision:** `src/render` rasterizes frames in Node: world vertices and clipping from the
runtime, texture pages through the `src/core` PNG codec, a small textured-triangle rasterizer
with Spine's blend modes and premultiplied alpha, PNG out. Zero dependencies.

**Replaces:** `see_animation`'s dependency on an open studio window, and `render_frames.js`'s
dependency on playwright plus a Chromium install.

**Measured 2026-10-28:** both fixtures render correctly by eye (the ident additive glow and
light sweep, the nova intro reveal); six 220x160 frames at 2x supersampling take about 250 ms.
`test/render.test.js` pins exact pixels: 1:1 texel mapping, the fill rule, straight vs
premultiplied textures, the four blend equations, two-colour tint, y-up framing, slot colour and
rgba fades, clipping, region/mesh equivalence and determinism. **Not yet done:** a pixel
comparison against frames from the official WebGL player, which needs a browser.

**Fallback:** if a pixel gate against frames
from the official WebGL player shows a difference that matters, rendering moves back to the
browser for that feature and this ADR says so.

## ADR-4 · Findings and refusals are data

**Decision:** pure modules return findings as
`{ level: 'fatal' | 'warn', code, where, message, params }` — `message` is plain English,
`code` + `params` are stable. Localization happens at the UI edge (`locale/*.json` keyed by
`code`). Pure modules never import a text catalog.

**Replaces:** `StudioText.t()` calls inside `spinecheck.js` and friends, which made a skeleton
checker depend on the locale loader and print `[key]` when a page forgot to load it.

Errors that stop an operation are `StudioError` (`src/shared/errors.js`): `code`, `message`,
`details`. The MCP layer turns them into refusals; nothing matches on message text.

## ADR-5 · The base-vs-current rule is one function

**Decision:** `src/spine/findings.js` owns "which fatals are ours": identity is `code@where`,
only `fatal` counts, a finding already present in the base is inherited and never a reason to
refuse. Every write path calls it. (Ported intact from legacy `spine_gate.js`, which collapsed
seven copies of this rule into one.)

## ADR-6 · No dependencies

Node 18+ standard library only. A dependency needs a maintainer decision and an entry here.
(Until 2026-11-24 the spine-ts bundle was vendored; it now comes only through the Spine add-on,
ADR-11, and is not in the repository.)

**2026-11-24:** ESLint, TypeScript and `@types/node` are pinned devDependencies,
for the lint and the type check only. Nothing ships with them: `npm test`, the studio and the MCP
server never load `node_modules`, and the `test` CI job runs without an install.

## ADR-7 · Tests

`node:test`, one `*.test.js` beside each concern under `test/`. Fixtures under `test/fixtures/`
keep a `PROVENANCE.md` line (legacy path at `legacy-final`). A port is not done until its gate
passes and fails on a deliberate break of the module (recorded in `docs/port-log.md`).

## ADR-8 · Models write native Spine 4.2 animation JSON

**Decision:** the delivery input is one clip in Spine's own 4.2 animation format. The studio
validates it (`src/deliver/normalize.js`), holds first keys back to t=0 on value channels,
optionally snaps to a frame grid, composes it onto the base by the precedence policy
(`src/deliver/policy.js`) and proves the result with the static check and the runtime.

Three shorthands are accepted on top of Spine's format and expanded to plain Spine keys before
anything else reads the clip, each one reported in the result: a curve preset name, a curve
shape `{ handles: [x1, y1, x2, y2] }` (2026-11-12), and a follow request on a bone's rotate
(`src/deliver/follow.js`, 2026-11-12). The delivery never contains them.

**Replaces:** the legacy track language (`boneTracks` with `t`, `x`, `rot`, `ease`) and its
compilation through the scene-document machinery (`build_on_base.js`, 826 lines). Every capable
model already writes Spine JSON; a private dialect only added a compiler that could drift.

## ADR-9 · Legacy names live in one module

**Decision:** names that existing projects still carry (`studio/history` and `.yedek` backup
roots, the `referans` folder, the `_kfAgirlik` and `_kfTarif` markers) are defined only in
`src/shared/legacy-names.js`, the single exemption from the language gate. Readers accept them;
writers emit only the English names.

## ADR-10 · Quality gates (2026-11-24)

**Decision:** a pull request is green only when all of these pass in CI (`.github/workflows/test.yml`).
To save Actions minutes, a pull request runs them in one Linux job on Node 22; the platform matrix
and e2e on Windows run by hand and on every release tag:

- `npm run lint`: ESLint with the rules written out in `eslint.config.js` (the recommended set plus
  `no-var`, `prefer-const`, `eqeqeq`, no `eval`).
- `npm run typecheck`: `tsc` with `checkJs` over `src/`, `tools/`, `web/` and `e2e/`. The code stays
  plain JavaScript; JSDoc carries the types, and a wrong JSDoc is a failing build.
- `npm test`, and in the full run on Linux, Windows and macOS with Node.js 18, 20, 22 and 24.
- `npm run test:coverage` (Node 22): at least 97% of lines, 88% of branches and 95% of functions of
  the modules the gates load. Page modules that need a DOM are covered by the e2e test instead.
- `npm run test:e2e`: the core flow in a real headless Chrome, driven over the DevTools Protocol with
  Node's own WebSocket, on Linux (and Windows in the full run).

Formatting is `.editorconfig`, enforced by `test/format.test.js`; there is no formatter, so no
whole-tree reformat ever lands in a diff.

**Replaces:** one CI job that ran `npm test` only, and JSDoc that had drifted from the code
(121 type errors when the check was first run).

## ADR-11 · The studio's own engine; Spine is an opt-in add-on (2026-11-24)

**Decision:** the studio plays animation on its own engine and needs no Spine code or
license. The official Spine runtime is under the Spine Runtimes License, which requires every
user of a product that integrates it to hold a Spine Editor license, so it is an add-on: off by
default, turned on only by the owner in Settings (or `npm run spine-addon -- --accept-license`)
after the notice that it needs their own Spine license.

**Decision:**

- `src/engine` is a clean-room player for the skeleton format: bones with every inherit mode,
  bezier/stepped/linear curves, IK, slots, colours, attachments (region, mesh, clipping, path
  data, point, bounding box), deform, draw order, events, skins. It was written from the public
  format documentation and verified only by output: `test/engine.test.js` poses every shipped
  skeleton on the engine and on the official runtime at seven instants of every clip and requires
  world positions, matrices, attachments, colours and draw order to agree (0.01). Key times are
  float32, as in every Spine runtime, so posing on a key lands on it exactly.
- `src/runtime` keeps one API with two backends. `parseSkeleton` uses the engine unless the file
  needs what the engine does not evaluate yet (transform, path and physics constraints, skin-only
  bones, sequences) and the add-on is on. Without the add-on such a file still poses, and
  `data.limits` names what was left out, so `check_skeleton`, `see_animation` and
  `sample_animation` say so (`notEvaluated`) instead of pretending.
- `src/core/spine-addon.js` installs the add-on: Esoteric Software's own npm package
  (`@esotericsoftware/spine-player` 4.2.119), checked against the pinned sha512 integrity,
  unpacked with the studio's own tar reader into the user's app data with a consent record.
  Turning it off deletes exactly those files. Nothing of it is re-distributed.
- What only the add-on does: the official verdict beside the engine's, baking physics and
  posing transform/path/physics constraints, binary `.skel` import and export (read back by the
  official binary reader). Reading and writing Spine 4.2 JSON never needs it: that is a data
  format.

**Replaces:** the vendored `vendor/spine-player-4.2` bundle and the license exception in
`LICENSE`; the studio is now plain MIT.
