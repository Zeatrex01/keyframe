# Contributing

Thank you for helping. Keyframe Studio is deliberately small: read
[`docs/concept.md`](docs/concept.md) (scope) and [`docs/architecture.md`](docs/architecture.md)
(layers and decisions) before you start.

## Set up

Node.js 18 or newer (22 or newer for coverage and the e2e test). There is no build step.

```bash
git clone https://github.com/Zeatrex01/keyframe.git
cd keyframe
npm ci            # developer tools only (ESLint, TypeScript); the studio needs none
npm run doctor    # what this machine has
npm run dev       # the page at http://127.0.0.1:8731/, restarted on server changes
npm run check     # lint, type check and every gate, before you push
```

[`docs/development.md`](docs/development.md) has every command, the branch and commit
conventions, how issues and the roadmap are kept, and the release steps.

Optional programs, for the features that use them: `ffmpeg` (reference videos), `yt-dlp`
(video links), the Spine editor's CLI (the CLI gate).

## The rules

- **Every change comes with its gate.** A `*.test.js` on `node:test` that passes, and that you
  have seen fail with the code deliberately broken.
- **No dependencies.** The Node.js standard library only (ADR-6). No Spine runtime code enters the
  repository: the optional Spine add-on downloads it on the owner's consent (ADR-11). ESLint and
  TypeScript are pinned developer tools and never ship.
- **English everywhere** in code, pages, tests and docs ([`docs/language-rule.md`](docs/language-rule.md)).
  The page's text lives in `locale/en.json`; a new key goes into every catalog.
- **The one-way rule.** Nothing writes the owner's source file. Deliveries are new files with a
  backup.
- **Layers.** `test/architecture.test.js` enforces which `src/` layer may import which.
- **Scope.** A new MCP tool, a new page or view, or a change to what the studio is for is a
  maintainer decision first: open an issue, or add the idea to `docs/ideas.md` with a date.
- **Done means seen.** For anything visual, render it (`see_animation`) or screenshot the page;
  for anything a file goes through, run `check_skeleton`.

## Pull requests

Keep one change per pull request, fill in the template, and make sure `npm run check` passes on
your machine. CI runs lint, the type check, every gate with coverage and the browser smoke test in
one Linux job; the maintainer runs the full Linux, Windows and macOS matrix by hand when a change
needs it, and every release runs it.

An optional program (like ffmpeg) follows the add-on contract in [`docs/addons.md`](docs/addons.md).

## Logs

The studio logs to stderr. `KS_LOG_LEVEL=debug` adds a line per request; `KS_LOG_FORMAT=json`
writes one JSON object per line.
