# Fixture provenance

Animation and attachment names inside fixtures are data and keep their original spelling;
tests read them from the data instead of writing them as literals.

| Fixture | Notes |
|---|---|
| `ident/` | generated placeholder logo ident: 6 bones, 3 clips (a seamless loop, a reveal, a specular sweep), Spine 4.2.43 |
| `nova/` | generated placeholder title card (orb, title, bar, tag), one reveal clip |
| `merge/sample_intro.json` | anonymised production export: 26 bones, 1 clip, path constraint; carries a known `path-vc3` defect (skins/default/slot14/img02), so the official parser refuses it; also read by `test/diff.test.js` |
| `binary/sample_intro.json` | the same export, one 3n+1 path (vertexCount 61); also read by `test/path-fix.test.js` |
| `read/` | `sample_intro.json` (refused by the runtime, used for the reader fallback) and `weighted_sample.json` |
| `weights/weighted_sample.json` | Spine 4.2.43; 4 bones, one 20-vertex weighted mesh with a crumb influence under 0.01, one unweighted mesh, clip `base_take` |
| `face/cat_v2.json` | the retired cat example's delivery (kit-drawn, Spine 4.2.43): the shared face rig, every emotion clip and `notice` with ears and whiskers baked from follow requests; read by `test/face-notice.test.js`, `test/face-eyes.test.js` and `test/template.test.js` |
| `body/human_v2.json` | the retired human example's delivery (kit-drawn, Spine 4.2.43): four IK limbs, four skins, stand, walk, wave, cheer and jump; read by `test/body-ik.test.js`, `test/face-eyes.test.js` and `test/template.test.js` |
| `banner/` | the retired LEVEL UP banner (kit-drawn, Spine 4.2.43): `banner.json` with the flat ribbon picture and `banner_v2.json` with it painted onto five bones by `paint_weights` and a `wave` clip; read by `test/painted-ribbon.test.js` |
| `core/logo.png` | the Keyframe Studio mark, 128 x 68; PNG case |
| `core/VERSION` | a non-PNG file; not-png case |
| `agent/claude-stream.jsonl` | a real `claude -p --output-format stream-json --verbose` run against the studio's MCP server on `ident/` (Claude Code 2.1, 2026-11-24), trimmed: hook lines and most partial-message lines dropped, the tool result shortened, paths replaced by `/work/ident` |
| `agent/claude-error.jsonl`, `agent/codex-stream.jsonl`, `agent/codex-legacy-stream.jsonl`, `agent/gemini-stream.jsonl` | hand-written in each CLI's documented stream shape (best-effort adapters) |
| `agent/fake-claude.js` | stands in for the Claude Code CLI in the agent gates (`KS_AGENT_CLAUDE`) |
