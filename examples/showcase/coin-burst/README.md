# Coin burst

A coin reward effect: a burst, eight coins and the coin counter they fly into, with sparkles.

The moment a player collects coins. Everything bigger than life (the flash and the ring overshoot), every coin on its own arc and its own frame, fast out of the burst and easing into the counter; the game hears each landing as an event.

Kind: Effect. Shown at 240 px wide. Teaches: arcs, stagger, spacing, exaggeration, events on the contact frame.

| Clip | Length | What happens |
|---|---|---|
| `burst` | 1 s | 2 frames of white flash, the ring expands and fades, 8 coins pop 2 to 3 frames apart, spin, land in the counter with a squash, a flash and a coin_land event each; the bar fills |
| `sparkle` | 1.5 s, loop, track 1 | three sparkles twinkle in turn around the counter |

Files: `coin-burst.json` + `.atlas` + `.png` (the rig, no clips), `coin-burst_v2.json` (the
delivery with the clips), `brief.json` (what was asked, for the studio and the gates), `preview.png`.
Rebuilt by `examples/kit/coin-burst.js` (`npm run examples`); every clip was written through the
studio's own tools and passes `check_skeleton` and `critique_animation` with no warnings
(`test/example-coin-burst.test.js`).
