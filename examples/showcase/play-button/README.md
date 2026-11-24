# Play button

A game menu Play button with a notification badge, drawn in the kit's chunky outline style in the studio's amber.

Every state a button lives through as a clip, timed for UI: quick, small anticipation, an overshoot sized for a button, every move readable at 160 px wide. The badge plays on track 1 over the idling button on track 0.

Kind: UI. Shown at 160 px wide. Teaches: UI timing, overshoot, readable at real size, tracks.

| Clip | Length | What happens |
|---|---|---|
| `idle` | 2.4 s, loop | a 2% breath with a short hold at the top, the triangle nudges forward once |
| `hover_in` | 0.15 s | grows to 1.05 past a 1.07 peak, a shine sweeps the face, the glow comes up |
| `press` | 0.1 s | squashes to 0.9 as the face sinks into its rim |
| `release` | 0.22 s | springs to 1.08 and settles on 1.0, the face pops back up |
| `disabled` | 0.2 s | swaps to the grey art and dims the label; nothing moves |
| `badge_pop` | 0.3 s, track 1 | the badge pops 0 to 1.15 to 1.0 with a wobble and a ring |
| `badge_pulse` | 2 s, loop, track 1 | a dip, a pulse to 1.14 and a ring, then a rest |

Files: `play-button.json` + `.atlas` + `.png` (the rig, no clips), `play-button_v2.json` (the
delivery with the clips), `brief.json` (what was asked, for the studio and the gates), `preview.png`.
Rebuilt by `examples/kit/play-button.js` (`npm run examples`); every clip was written through the
studio's own tools and passes `check_skeleton` and `critique_animation` with no warnings
(`test/example-play-button.test.js`).
