# Next steps

> **2026-11-24:** the plan now lives in [`docs/roadmap.md`](roadmap.md), with one issue per item.
> This file stays as the working log behind it: what was observed, when, and with which versions.

Written 2026-11-13. The plan from here: art comes from outside
(an artist or an image tool, in the soft, painted look of current mobile games), and the studio
rigs and animates it. Code-drawn art stays as examples and test material only.

## Where things stand

- Everything is on `main` (merged 2026-11-24).
- (2026-11-13) 716 tests passed (`npm test`) and 22 tools were served by default; the current state is in the README and the CHANGELOG.
- The page is an app: `Start Studio.cmd` (or `node tools/studio.js --open`) opens Projects, Settings
  (MCP lines for Claude Code and Codex) and the opening. Not yet tried on Windows.
- Optional add-on built; run live on 2026-11-13 (YouTube whole and ranged, one generic page, Vimeo through its player address; ArtStation and Behance refused, see item 7): a video link (YouTube, or any public https video page) saved into `reference/` through yt-dlp
  (page field, `node tools/fetch-reference.js <link>`); absent by default, no new tool.
- New this week: curve fitting from video, follow-through as a request (`follow`), `paint_weights`,
  `bake_animation` back on the default list, the character template (`docs/character-template.md`,
  `examples/template/`), eye masks on every face.

## To do, in order

1. **Try the app on Windows.** Double-click `Start Studio.cmd`. If the window is ever blank, the
   reason is written on the opening screen: report that sentence in an issue.
2. **Connect a real agent.** Settings shows the lines; the dot in the top bar turns green when
   the agent calls `start_here`. This has only been tried with a test client.
3. **Bring real art.** Follow `docs/character-template.md`: layers named like the slots, parts that
   bend drawn as one picture with a bone chain, export Spine 4.2 JSON with its atlas. Then in the
   studio: `paint_weights` for bending parts, the face clips, `follow` for hair and cloth.
4. **Redo the showcase on that art.** Since 2026-11-24 the showcase is five examples in
   `examples/showcase`, each with a brief, a preview and its own gate, rebuilt by
   `npm run examples`: Mika (anime girl: emotions and a wave), Pip (full-body kid on IK: idle,
   jump, walk, cheer), the reward chest (drop, rattle, open, three cards, glow loop), the PLAY
   button (UI states and a badge on track 1) and the coin burst (eight coins into a counter, an
   event per landing). The cat, dog, bunny, panda and kid heads, the menu icons and the victory
   sequence were retired; their checks run on fixtures in `test/fixtures` (`face`, `body`,
   `banner`).
5. **Video material.** `examples/kit/look/` holds the filmstrips `npm run examples` renders (not
   in git). No personal reel is kept in the repository.
6. **Decided 2026-11-24:** the license is MIT; the anime and human-body attempts stay as examples (Mika and Pip).

7. **Finish verifying the link intake on real links** (YouTube and a generic page are done).
   Observed 2026-11-13 with yt-dlp 2026.10.26. Vimeo: the watch page asks for a signed-in account; the player address needs none, so the studio rewrites a pasted vimeo.com link to it. Two videos were read and one (36 s, 60 fps) was downloaded this way; one older video was refused as "DRM protected" on every format. ArtStation and Behance pages both answered HTTP 403 (bot protection) to the program and do not work without cookies, which the studio never uses.
   Still open: (a) a whole video over 300M: exit code and which stream carries the message (the code assumes exit 0, no file, nothing on stderr); (b) a real remux of a non-mp4 container; (c) that a timed-out run leaves no yt-dlp or ffmpeg process on Windows.

## The reference for quality

`docs/style-study.md`: one Match Villains recording read frame by frame (timings of clears, falls, the
blast and the level-complete sequence), the principles under them, how the studio does each, and the
flow for a case-quality piece. Royal Match and Tasty Match still need recordings to be measured.

## Known limits

- `paint_weights` is a mechanical first pass: organic bends may need touching up in Spine. It
  does not add bones.
- A full lid is a line and hides the eye; a head whose art has no separate eye white needs its
  own lid art.
- Video learning reads one rigid element at a time; multi-part elements are measured as one.
- Clips were judged on rendered frames and numbers, rarely watched in motion by the model that
  wrote them. Watch each one before it ships.
