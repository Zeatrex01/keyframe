# Opening

The Keyframe Studio opening: the brand mark and its name, drawn and animated with the studio's
own tools (`draw_rig`, `write_animation`, `add_effect`) and proven with `check_skeleton`,
`critique_animation` and `see_animation`. The page plays it once at every start; with reduced
motion it shows the still mark instead.

- `mark.json`, `mark.atlas`, `mark.png` — the rig drawn by `draw_rig`: the two violet onion-skin
  ghosts, the amber key and the outlined name ("Keyframe", "Studio"). The setup pose is the
  finished lockup.
- `mark.parts.json` — the parts the rig was drawn from; open the project in Draw mode to edit them.
- `mark_v2.json`, `mark_v2.atlas` — the delivery with `intro` (1.2 s): the key flies in from the
  left and leaves its ghosts behind it as it slows in, lands with a ~10% overshoot and a soft
  flash, and settles by 0.9 s; "Keyframe" and then "Studio" rise in under it. The page plays it
  at every start.
- `reveal` (2.8 s), in the same file, for the README and the launch: the key hops in like a ball
  and leaves an onion skin of itself on each spot it takes off from (the two ghosts of the mark),
  crouches, makes a big hop with a lean, lands with a squash and a flash, the ghosts recoil, and
  the name rises under it.

Both are built through the studio by `node examples/kit/opening.js` (write_animation, add_effect,
check_skeleton, critique_animation).

See it: `node tools/cli.js see_animation --project examples/opening --args '{"file":"mark_v2.json","animation":"reveal"}' --out reveal.png`
