# Pip

A full-body cartoon kid in a T-shirt and shorts: arms and legs on two-bone IK, the face rig on the head, the shirt on a leaf bone for squash and stretch.

A small game hero. The jump is the lesson: a crouch before it, a stretch at take-off, a hang at the top, a squash on landing with the volume kept, and a settle; the walk next to it shows how much faster and more even a cycle is.

Kind: Character. Shown at 200 px wide. Teaches: anticipation, squash and stretch, arcs, timing.

| Clip | Length | What happens |
|---|---|---|
| `idle` | 2 s, loop | weight shifts from foot to foot over planted feet, a breath, a blink |
| `jump` | 1.1 s | crouch, stretch at take-off, tuck and hang at the top, land squash on the contact frame (land), absorb and settle |
| `walk` | 1 s, loop | a march on the spot: feet lift in turn, the hips ride over the standing leg, arms swing against the legs |
| `cheer` | 1.4 s | a dip, a hop with both fists thrown up, a second pump, and the arms come down |

Files: `pip.json` + `.atlas` + `.png` (the rig, no clips), `pip_v2.json` (the
delivery with the clips), `brief.json` (what was asked, for the studio and the gates), `preview.png`.
Rebuilt by `examples/kit/pip.js` (`npm run examples`); every clip was written through the
studio's own tools and passes `check_skeleton` and `critique_animation` with no warnings
(`test/example-pip.test.js`).
