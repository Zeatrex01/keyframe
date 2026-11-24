# Development

How to work on Keyframe Studio: set up, run, check, propose and release. The scope is
`docs/concept.md`; the structure is `docs/architecture.md`.

## Set up

Node.js 18 or newer. Node.js 22 or newer for the coverage thresholds and the e2e test.

```bash
git clone https://github.com/Zeatrex01/keyframe.git
cd keyframe
npm ci            # developer tools only: ESLint, TypeScript, @types/node
npm run doctor    # what this machine has: Node, the tools, a browser for e2e, the add-ons
```

The studio itself needs no install: `npm test` and `npm start` work on a fresh clone without
`npm ci`. The developer tools are pinned devDependencies and never ship (ADR-6).

## Run

| Command | What it does |
|---|---|
| `npm run dev` | The page at http://127.0.0.1:8731/, restarted when a server module changes (`node --watch`). Page files are read from disk on every request: reload the browser. |
| `npm start` | The page in its own app window, as a user starts it. |
| `npm run mcp` | The MCP server on stdio, following the project open in the page. |
| `node tools/cli.js list` | Every tool, callable from the shell without an agent. |

Use your own data folder while developing so your real projects stay out of it:
`KS_CONFIG=/tmp/ks/studio.config.json npm run dev`. `KS_LOG_LEVEL=debug` logs every request.

## Check

| Command | Gate | CI |
|---|---|---|
| `npm test` | every `*.test.js` on `node:test` (about ten seconds) | Linux, Node 22; full matrix by hand |
| `npm run lint` | ESLint, `eslint.config.js` | yes |
| `npm run typecheck` | `tsc` with `checkJs`, `tsconfig.json`; JSDoc carries the types | yes |
| `npm run test:coverage` | the tests with coverage: 97% lines, 88% branches, 95% functions | yes |
| `npm run test:e2e` | `e2e/smoke.e2e.js`: page, server, an MCP agent and the conversation in headless Chrome | Linux; Windows by hand |
| `npm run check` | lint, type check and tests together; run it before you push | |

**CI is frugal on purpose** (Actions minutes are limited). A pull request or a push to `main` runs
one Linux job on Node 22: lint, type check, every gate with coverage, and the e2e test. Changes
that touch only Markdown or `docs/` run nothing. The full matrix (Linux, Windows and macOS with
Node.js 18, 20, 22 and 24, and e2e on Windows) runs by hand from Actions → test → Run workflow,
and always before a release. Run it by hand when a change touches paths, processes or the
launcher, which differ by platform.

Run one test file with `node --test test/http.test.js`. The e2e test finds Chrome, Chromium or
Edge on its own; `KS_E2E_BROWSER=/path/to/chrome` picks one. Without a browser it is skipped
locally and fails in CI.

Every change comes with its gate: a test that passes, and that you have seen fail with the code
deliberately broken. Say how you broke it in the pull request.

Formatting is `.editorconfig` (two spaces, LF, a final newline, no trailing spaces), checked by
`test/format.test.js`. Point your editor at `.editorconfig`; there is no formatter to run.

## Branches, commits and pull requests

- Branch from `main`: `fix/<what>`, `feat/<what>`, `docs/<what>`, `chore/<what>`.
- One change per pull request, small enough to review in one sitting. Foundation, features and
  docs go in separate pull requests.
- Commit messages say what changes for the person using the studio, in the imperative, in English,
  with a first line under 72 characters. Explain why in the body when it is not obvious.
- Fill in the pull request template: what changes, the gate, what you saw.
- `main` only moves through reviewed pull requests with every CI job green. The maintainer merges.
- A new MCP tool, page, view, add-on or dependency is a maintainer decision first: open an issue
  labelled `needs maintainer decision`, or add the idea to `docs/ideas.md` with a date.

## Issues and the roadmap

Labels and milestones live in `.github/labels.json` and `.github/milestones.json`; the repo-sync
workflow applies them (`tools/sync-github.js`, which never deletes) when the files change on
`main`; after labelling new issues, run it by hand (Actions → repo-sync → Run workflow). Every issue gets one type
(`bug`, `feature`, `documentation`, `security`), one `area/*`, and a `size/*` once it is
understood. A `roadmap/now`, `roadmap/next` or `roadmap/later` label puts it in the matching
milestone on the next sync. `docs/roadmap.md` is the plan in words and links each item to its issue.

## Releasing

Versions follow [semantic versioning](https://semver.org/). Before 1.0, a minor version may change
behaviour; from 1.0 on, a breaking change to the MCP tools, the delivery format or the page's
files is a major version.

1. Move the `## Unreleased` notes in `CHANGELOG.md` under `## X.Y.Z - YYYY-MM-DD` and start a new,
   empty `## Unreleased` above it.
2. Set the version in `VERSION` and `package.json` (`test/release.test.js` checks they match and
   that the version has notes).
3. On a machine with Godot 4.2+, check the Godot add-on and its demo (see
   [godot.md](godot.md#how-it-is-checked)): `godot --headless --path integrations/godot --import`
   must print no error. CI has no Godot.
4. Open a pull request "Release X.Y.Z"; merge it when CI is green.
5. Tag the merge commit and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
6. The release workflow runs the full matrix and publishes a GitHub release whose notes are that
   version's CHANGELOG section (`tools/release-notes.js`).
