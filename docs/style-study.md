# Style study: how current match-3 games move

Written 2026-11-13. What was studied, what was measured, and the working method that comes out of
it. This is the reference for any showcase or case piece made with the studio.

## Sources, and how far each goes

| Source | What it gave |
|---|---|
| A screen recording of **Match Villains** (9.1 s, 60 fps): three moves, a blast, the level-complete sequence, the home screen | Every number below. Read frame by frame. |
| Published breakdowns of **Royal Match** | Design intent only: every match is a small reward, power-up animations are kept short, UI motion carries the feeling of polish, a character watches and reacts to the state of play. No timings. |
| **Tasty Match** | Not studied: no recording, nothing published with detail. |

One recording of one game is a thin base. The numbers are that game's; the principles under
them are shared by the genre. **To study Royal Match and Tasty Match properly the studio needs
screen recordings of them** (60 fps, a few moves, one booster, one win): drop them in a
project's `reference/` folder and `see_reference` / `measure_reference` read them.

## What the recording shows

### The look (why code-drawn art cannot stand in for it)

Pieces and characters are rendered as soft 3D: a broad top highlight, a darker underside, a
contact shadow, no outline. Colour is saturated and limited (four or five piece colours).
Characters are stylised 3D with large heads and hands. This is painted or rendered art; the
studio animates it, it does not draw it.

### Timing, measured (frames at 60 fps)

| Event | Measured | Notes |
|---|---|---|
| A piece clears | 6 to 8 frames (0.10 to 0.13 s) | shrinks to about half, then a white puff ring opens and fades |
| Shards from a clear | 5 or 6 pieces, about 0.3 s | fly out and fall under gravity, piece-coloured |
| Fall begins | while the clear effect is still on screen | nothing waits for the effect to finish |
| A piece lands | squash for 2 to 3 frames, settle | new pieces enter from the top within about 0.2 s |
| Blast (area booster) | about 0.3 s | a bright fan opens from the source; rockets leave with trails; the board is already falling under it |
| Board dims for the win | 8 frames (0.13 s) | the board stays visible, darkened, behind everything |
| Logo letters | one about every 3 frames (0.05 s), all in within 0.4 s | they arrive from different directions and overlap; the last letter comes visibly late |
| Character rises behind the logo | about 10 frames (0.17 s) | the logo masks the lower body |
| Pose change (arms down to thumbs up) | about 8 frames (0.13 s), settled by 15 | overshoot, then settle |
| Spotlights | fade in over about 6 frames | start as the character arrives, not after |
| Confetti | starts with the dim | runs for the whole screen |
| Side characters | enter about 1.2 s after the start | secondary action, once the main read is done |
| Screen is readable | about 0.6 s after the last move | |

### What that adds up to

1. **Fast in, slow out.** Arrivals take 0.1 to 0.2 s; settles take two or three times as long.
   Almost nothing important moves for longer than 0.35 s.
2. **Everything overlaps.** The dim, the logo, the confetti, the character and the lights start
   within 0.3 s of each other. No element waits for another to finish.
3. **Stagger, never unison.** Letters, pieces, shards and stars arrive 2 to 4 frames apart.
4. **Impact is three things at once:** a flash or puff, something thrown outward, and a squash
   on whatever was hit. A scale change alone reads as cheap.
5. **Nothing is ever still.** A held pose breathes, sways, blinks; lights drift; confetti falls.
6. **Secondary action comes late and small:** after the main read, at the edges of the screen.
7. **The game never stops for its own effects.** Play resumes under the effect.

## How the studio does each of these

| Need | Tool or request |
|---|---|
| Fast in, slow out; overshoot | curve presets (`inCubic` in, `outBack` or `outCubic` settle), or a shape `{ handles }` fitted from the reference |
| Stagger | the same keys offset by 2 to 4 frames per element |
| Follow-through on cloth, hair, ribbons, tails | a `follow` request on the trailing bone (frequency 2 to 3 loose, 4 to 6 stiff) |
| Soft parts that bend | `paint_weights` on one picture over a bone chain |
| Impact | a flash slot (additive), a ring that scales and fades, shards on short arcs, a 2 to 3 frame squash, a small shake of the parent |
| A loop that follows a one-shot | write the loop as a periodic function and let the one-shot end on its phase (see `happy_in` and `happy` in `examples/showcase/mika`) |
| The reference's own timing | `measure_reference` on the recording, then `apply_motion` and `compare_reference` |
| Proof | `see_animation` frames looked at enlarged, `check_skeleton`, and a gate that samples every frame |

## The flow for a case-quality piece

1. **Reference first.** A recording of the thing to match. List its beats with frame counts before
   anything is written, the way the table above does.
2. **Art from outside,** prepared by `docs/character-template.md`: named layers, whole parts,
   bending parts as one picture, Spine 4.2 export with atlas.
3. **Rig check.** `read_rig`; `paint_weights` on what must bend; physics constraints left alone.
4. **Block the beats.** Keys on the main bones only, at the measured times. Look at frames.
5. **Overlap and stagger.** Offset every secondary element; add `follow` to everything that trails.
6. **Impacts and light.** Flash, ring, shards, shake; additive glows; a loop for whatever holds.
7. **Hold check.** Nothing still for more than a few frames; the one-shot hands over to its loop.
8. **Prove it.** Enlarged frames of every transition, the runtime check, a gate for the rules that
   mattered. Then play it at real speed and watch it: frames alone have misled before.
9. **Present it.** The sequence in context (in a game screen), a close-up, and the breakdown:
   reference beside result, the beat table, what the rig does.

## Not known yet

- Royal Match's and Tasty Match's own timings (no recordings).
- How these studios build their rigs (mesh density, bone counts): not published; a real export
  from such a game would show it.
- Sound and haptics, which the published breakdowns call half of the feel, are outside this tool.
