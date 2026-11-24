# Concept

This file is the single reference for scope. A proposal that conflicts with it is wrong until
this file changes, with a date and the reason.

## The sentence (decided 2026-10-28)

**Keyframe Studio is the eyes, the proof and the safe hands for any AI that writes Spine.
The model writes the motion; the studio shows it, proves it against the official runtime and
the Spine CLI, and delivers it without ever touching the owner's source.**

Writing motion is not the product: every general model can write Spine JSON now. The product
is what a model cannot do on its own.

| A model cannot… | …so the studio provides |
|---|---|
| run the Spine runtime or the Spine CLI | validation against the official spine-ts 4.2 runtime, the CLI gate, asset checks, skeleton diff, critique |
| see what it wrote | rendered frames, sampled transforms, a structured description of the motion |
| keep a file safe | the one-way rule, backups, compare-and-swap writes, history and restore |
| do what the Spine editor cannot | constraint baking, skeleton merge, swap-to-skin migration, mechanical weight repair |

## An AI-assisted animation studio, with or without Spine (decided 2026-11-24)

The studio has to make whatever animation is asked for and run on its own: Spine-supported, and
working without Spine. The agent has to know what it animates (a character, an object, an effect)
and be able to draw or make effects when needed, preferably by building on existing open resources.

So the sentence above widens. Spine stays a first-class target, but it becomes an adapter over the
studio's own model: a Keyframe skeleton plays in the studio's own engine and standalone player with
no Spine software and no Spine license, and converts to and from Spine 4.2 JSON. The agent learns
what it animates before it writes, applies the animation principles by default, and gains drawing
and VFX built on existing open-source work. The phases, their order and their gates are in
`docs/roadmap.md`. New tools that serve these phases are covered by this decision; each new
dependency or vendored library is still recorded here first.

Same day, second decision: Spine stays the main target, but its license has to be stated
plainly and its runtime is opt-in. The official spine-ts runtime is therefore not part of the studio any more. It is an optional add-on like ffmpeg: off by
default, enabled in Settings after a plain notice that it needs the user's own Spine license, and
then downloaded from Esoteric Software's package to the user's machine. Without it every tool runs
on the studio's own engine; Spine JSON is still read and written as a data format.

## Plain by default (decided 2026-11-12)

A plain AI-assisted tool: the user does not do the work by hand, and does not wait long for it.
The owner describes the motion; the model writes it; the studio checks it and shows it. The
default wire therefore carries a small set of tools only (twenty-six as of 2026-11-24): draw, read, brief, write, effects, check, critique, see, measure, undo, bake, paint weights, converse, learn from a reference
(2026-11-12: `bake_animation` back on the default wire, for rigs with physics that go to an engine without it; 2026-11-24: `critique_animation` joins it, so every agent measures its motion against the animation principles). The specialist
tools in the last row of the table above (merge, swap-to-skin, weight repair, binary
export and the rest of the shelf) stay in the tree with their gates and are served only when
the server is started with `--all`.

## The one-way rule

The owner's source file is never written. Every delivery is a new file beside the source.
Untouched sections pass through from the base byte for byte; only the requested, validated
patch is applied. If the owner later changes the base in Spine, **the base wins and the studio
says so out loud** — an old patch is never silently imposed.

## Division of labour

- **The studio and the agent:** motion on a finished rig (bone and slot timelines, curves,
  timing), mechanical operations with a single provable answer (bake, merge, swap-to-skin,
  weight clean-up and transfer between existing bones), weight painting (`paint_weights`: a mesh,
  or a flat image turned into a grid mesh, bound to a chain of existing bones with smooth falloff;
  part of the studio's job since 2026-11-12), and every check.
- **The owner, in Spine:** the rig itself (bones and constraints), hand-made mesh topology, deform
  keys, and every "does it look right" call.

## The page

Decided 2026-11-13: the page has three views again. **Projects** lists the folders opened before, opens
a folder by its path, creates an empty project and takes one off the list (the folder is never
deleted). **Settings** shows how to connect an agent (Claude Code, Codex, any MCP client), checks
that one is connected, switches the language and downloads the studio as one zip. The **opening**
plays the studio's mark at every start. Same day, second decision: the page is an installable app (manifest,
service worker, icons), the launcher opens it in its own window (Edge or Chrome `--app`), a second
start reuses the running studio, the opening is on screen from the first paint and writes why if
the page cannot start or the studio is not running, and Projects offers a sample project (a copy
of Mika from `examples/showcase`). Decided 2026-11-24 (a source/result toggle rather than a side-by-side stage): the
tag over the stage flips it between a delivery and the base it was written onto; a new "ready"
from the agent takes the stage back to the result. The open project is kept in the studio's config
file, and an MCP server started without `--project` follows it. Not brought back: network access
and the password screen; the page answers on this machine only.

## Reference intake from a link (decided 2026-11-13)

A reference video comes in two ways: a file the user adds, or a link. Neither is a permanent
feature of the studio; both are optional add-ons.

So the link intake is an optional add-on behind the yt-dlp program, absent by default, the same
way ffmpeg is optional. Without the program the studio works exactly as before: the page's link
field is not shown, and Settings lists yt-dlp under the optional add-ons with how to install it. All it does is save one video into
`reference/`; the reference tools then read it like any file the owner added. No new tool: the
wire stays as it is. The page still answers on this machine only, and the only outbound
request is the download the owner asks for. The owner's browser cookies are never used. An
existing file is never overwritten.

The same day the intake widened beyond YouTube. Animators' showreels
live on Vimeo, ArtStation, Behance and portfolio pages, so the intake is not YouTube-only. Observed on 2026-11-13 (yt-dlp 2026.10.26, see `docs/next-steps.md`): Vimeo works through its player address, ArtStation and Behance answered HTTP 403 and do not work without cookies, so the
boundary is "what the program can read without signing in", not a list of sites. The
boundary, stated once:

- Any public https video page that the yt-dlp program can read (it has an extractor per site and a
  generic one that finds a video embedded in an ordinary page). A YouTube link is still rebuilt from
  its 11-character id; every other link is handed on only as the address the URL parser built
  (`src/core/link.js`).
- Never a local or private address: no numbers as an address (also the integer, hex and octal
  spellings), no `localhost`, no name without a dot, no `.local`, `.localdomain`, `.internal`,
  `.lan`, `.home`, `.corp`, `.test`, `.example`, `.invalid`, `.onion`, `.arpa` (so `.home.arpa`), `.intranet`, `.private`, `.box`, `.svc`, `.cluster`, `.localnet`, no port, no user name or
  password, no http.
  This is a check of the text. It does not follow a public name to where it resolves or redirects,
  so a public name that points at a private address would pass; the studio has no resolver and the
  program is the only thing that makes the request.
- Never cookies, never a login. A site that wants an account is refused plainly (`login-required`)
  and the owner saves the video another way and adds it as a file.
- The first video of a page only. When the page holds more, the result says how many.
- Still only a file saved into `reference/`. The name of a web download is built from what the
  program reports (<extractor>_<id>, reduced to safe characters, plus a short hash of the extractor, id and address so two videos never share a name, also on a case-insensitive disk), never from the link text. A failed run removes only files it made; a file already in the folder is never deleted or taken as the result. The
  file ends as mp4, webm or mov: with ffmpeg present the program rewrites mkv, flv, avi, ts, m4v
  and 3gp to mp4; any other container is removed and refused (`bad-container`).

## Placeholder art (decided 2026-11-24)

Before real drawings exist, the agent draws placeholders as SVG, so the studio needs a place to
draw. So the studio will gain art to start from: the agent draws
simple SVG placeholders, one layer per part, the owner adjusts them in the page, and the studio
turns them into a Spine 4.2 skeleton and atlas. Real art later replaces them layer by layer under
the same slot names. The design (a fourth page view, and how the agent writes the art) is agreed
before it is built: issue #24. The same day: the anime and human-body attempts stay
as examples, and the studio is not published to a package registry.

## Not in this tree

Scene documents and the raw-art flow, the review board, the learning library, variant mixing,
and rig editing (adding bones, rigs from images); binding meshes and grid meshes came back with
`paint_weights` on 2026-11-12. They live in the
earlier, larger studio this tree was narrowed from. Bringing any of them
back is a scope decision recorded here first.

## Done means seen

Nothing is "done" until a gate passes and, for anything visual, the result has been rendered
and looked at.
