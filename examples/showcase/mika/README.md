# Mika

An original anime girl cut at the waist, the portrait a mobile game shows in dialogue and menus: twin tails, sailor collar, a face rig with lids, brows and mouth shapes, and a right arm that can wave.

A dialogue portrait that is never frozen. She breathes and blinks, reacts with a short lead-in clip and a loop for each emotion, waves, and goes back to idle; the hair always arrives after the head that moves it.

Kind: Character. Shown at 320 px wide. Teaches: overlap and follow-through, secondary action, moving holds, no twinning.

| Clip | Length | What happens |
|---|---|---|
| `idle` | 2.4 s, loop | breath with a short top hold, a blink, the head drifts and the tails, locks and strand trail it |
| `happy_in` | 0.6 s | a blink and a dip, then a snap up past the pose into a smile; the tails follow two and three frames late |
| `happy` | 2.4 s, loop | a light bounce with a held beat, the head rocks out of step, the tails swing behind |
| `surprised_in` | 0.4 s | a startled blink and a dip, then up with wide eyes, small pupils, raised brows and an open mouth |
| `surprised` | 2 s, loop | the surprise held alive: the body rises and settles, the eyes stay wide, the hair keeps moving |
| `wave` | 1.2 s | a small backswing, the elbow swings out to the side with an overshoot, the forearm upright beside her face, three waves with the hand flapping late, and down |
| `to_idle` | 0.4 s | a blink covers the change, everything settles back to the rest pose |

Files: `mika.json` + `.atlas` + `.png` (the rig, no clips), `mika_v2.json` (the
delivery with the clips), `brief.json` (what was asked, for the studio and the gates), `preview.png`.
Rebuilt by `examples/kit/mika.js` (`npm run examples`); every clip was written through the
studio's own tools and passes `check_skeleton` and `critique_animation` with no warnings
(`test/example-mika.test.js`).
