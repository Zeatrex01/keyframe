# Keyframe Studio — agent rules

Read `docs/concept.md` first. It is the only scope reference.

## What this repository is

An agent-assisted 2D skeletal animation studio. The owner describes the motion; the studio's
agent (or any MCP client) writes it as animation JSON (the studio's format, compatible with Spine
4.2), the studio's own engine shows it and proves it, and the result is delivered beside the
owner's file. Spine's runtime is an opt-in add-on, never required. The owner should never have to
do the work by hand, and should never have to wait long for it.

## Working rules

- **Keep it plain.** Twenty-six tools are served by default (draw, read, brief, write, effects, check, critique, see, measure, undo, bake, paint weights, converse, learn from a reference). A new
  tool or a new page needs a maintainer decision first; ideas go to `docs/ideas.md` with a date.
- **Every change comes with its gate.** A gate is a `*.test.js` on `node:test`. It must pass,
  and it must fail when the code is deliberately broken, before the commit.
- **English everywhere** (`docs/language-rule.md`): code, docs, tool text and names, whatever
  language the chat is in.
- **The one-way rule is the product.** Nothing writes the owner's source file. Deliveries are
  new files with a backup. If a base changed, the base wins and the result says so.
- **Done means seen.** Visual claims need rendered frames (`see_animation`); file claims need
  the runtime check (`check_skeleton`).
- **No dependencies** without a maintainer decision. Node 18+ standard library only. The approved
  developer tools (ESLint, TypeScript, @types/node; 2026-11-24) are pinned devDependencies and never ship.
