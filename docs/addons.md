# Optional add-ons

The studio works fully with nothing but Node.js. An add-on is a program someone may already have
(ffmpeg, yt-dlp, the Spine editor's command line) that unlocks one feature when it is there. Every
add-on follows the same contract, so a new one is one entry in `src/core/addons.js` plus its own
module, and never a special case in the server or the page.

| Add-on | Variable | Unlocks | Without it |
|---|---|---|---|
| ffmpeg | `FFMPEG` | Reading reference videos: filmstrip, measuring a move, comparing with the result, cutting part of a downloaded video | The reference tools refuse with `no-ffmpeg` (501); images still work |
| yt-dlp | `YT_DLP` | Saving a video from a link into `reference/` | The link field is not shown; `fetch-reference` refuses with `no-yt-dlp` |
| Spine CLI | `SPINE_CLI` | `spine_info`: asks the real editor whether a file opens | `spine_info` refuses with `no-spine-cli`; every other check runs on the studio's engine |

Agent CLIs (Claude Code, Codex CLI, Gemini CLI) follow the same contract (detection never throws,
an environment variable is final, absent is `no-agent-cli`, 501, the studio never installs one)
but are listed by `GET /api/agent` with the slots they can fill, not here: see `docs/agents.md`.

## The Spine add-on

The official Spine runtime is a different kind of add-on: the studio does not find it on the
machine, the owner turns it on. It is under the Spine Runtimes License (every user needs their own
Spine Editor license), so it is off by default and never in the repository.

- **On:** Settings, Add-ons, Spine runtime: the owner reads the license notice, ticks that they
  hold a Spine license and accepts its terms, and enables it. From a terminal:
  `npm run spine-addon -- --accept-license`. An agent never accepts the license for the owner.
- **What happens:** `src/core/spine-addon.js` downloads Esoteric Software's own npm package
  (`@esotericsoftware/spine-player` 4.2.119), checks it against the pinned sha512 integrity, and
  keeps `spine-player.min.js`, `spine-player.min.css`, the license and a consent record in the
  user's app data (`<app data>/Keyframe Studio/addons/spine-runtime-4.2.119`, or the folder in
  `KS_SPINE_RUNTIME`). It is found on every use, so no restart is needed.
- **Unlocks:** the official runtime's verdict beside the engine's in `check_skeleton` and
  `scan_project`; posing and baking path constraints (IK, transform and physics constraints run on the studio's engine); binary `.skel`
  export and import; the official player on the page.
- **Without it:** everything else works on the studio's engine. A file that uses something the
  engine does not evaluate yet still plays, and the answer names what was left out
  (`notEvaluated`). A feature that needs the runtime refuses with `spine-addon-off` (501).
- **Off:** Settings, or `npm run spine-addon -- --off`, deletes exactly those files.

This is the one exception to rule 5 below: the studio downloads it, only on the owner's explicit
consent, only the pinned package, and only from its publisher.

## The contract

1. **Detection never throws and never prompts.** `locate(env)` answers a path or a command, or
   `null`. The add-on's environment variable is checked first. `detectAddons()` treats a locator
   that throws as absent, so a broken install can never stop the studio.
2. **Absent is a normal state.** Everything that does not need the program works exactly as
   before. The feature that needs it throws a `StudioError` with the add-on's `missingCode`
   (`no-<program>`), which the server answers with 501 and the page explains in words, with the
   install line.
3. **Settings shows it.** `addonStatus()` gives each add-on's name, whether it is here, and the
   install line for the platform; the page adds what it unlocks from `settings.addon.<id>` in
   every `locale/*.json`.
4. **The page hides, it does not nag.** An input that only the add-on makes useful (the link
   field) is not shown without it, instead of being shown disabled with an install paragraph.
5. **The studio never installs, downloads or updates an add-on**, and never uses the owner's
   cookies or credentials with one.
6. **Detection happens once at start.** A program installed later needs a restart; Settings says so.

## Adding one

1. Write `src/core/<program>.js` with `locate<Program>(env)` (see `locateFfmpeg` in
   `src/core/video.js`) and the feature's code, which throws `StudioError('no-<program>', …)` when
   called without the program.
2. Add an entry to `ADDONS` in `src/core/addons.js`: `id`, `name`, `env`, `missingCode`, `locate`,
   and an `install` line for `win32`, `darwin` and `other`.
3. Map the code to 501 in `src/server/respond.js`.
4. Add `settings.addon.<id>` to every `locale/*.json`.
5. Hide any page input that only the add-on enables (`web/reference.js` does this for yt-dlp).
6. `npm test`: `test/addon-contract.test.js` checks every step above for every add-on.

A new add-on is still a feature, so it needs the maintainer's decision first (`docs/concept.md`).
