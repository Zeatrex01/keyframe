# Reward chest

A treasure chest on a reward screen, with three reward cards inside.

The reward moment, staged one idea at a time: the chest falls in and lands, rattles twice (the second bigger, so the payoff is earned), bursts open with a flash and a beam, and the cards fly out one after another and flip. A long wind-up, a fast payoff, then a glow that can loop while the player looks.

Kind: Prop. Shown at 360 px wide. Teaches: staging, timing, overshoot and settle, events on the contact frame.

| Clip | Length | What happens |
|---|---|---|
| `appear` | 2.8 s | drop, land squash (land), two rattles growing, the lid bursts with a flash (open), a beam, three cards fly out 3 frames apart on arcs, flip and land (card_1..3) |
| `glow` | 2 s, loop | the open chest after the reveal: rays sway, the beam breathes, the cards float out of phase, sparkles twinkle |

Files: `chest.json` + `.atlas` + `.png` (the rig, no clips), `chest_v2.json` (the
delivery with the clips), `brief.json` (what was asked, for the studio and the gates), `preview.png`.
Rebuilt by `examples/kit/chest.js` (`npm run examples`); every clip was written through the
studio's own tools and passes `check_skeleton` and `critique_animation` with no warnings
(`test/example-chest.test.js`).
