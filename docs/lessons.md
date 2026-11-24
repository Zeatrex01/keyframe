# Lessons from building the example pack

What held up, what did not, and the rules that came out of making the example art and motion
(menu icons, character heads, a human body, an anime character).

## What the studio is good at

- **Motion on a finished rig.** Describing a motion and getting native keys, checked by the
  studio's engine, works and is fast. This is the product.
- **Simple, chunky vector art.** Icons and animal heads in one bold outline style come out well on
  the first or second pass.
- **Rules as checks.** A fault that shows up twice becomes a check that samples every frame: face
  placement, eyes never stretched, IK targets within reach, knees outward, feet planted. Once a
  rule is a check it does not come back.

## What it is not good at

- **Illustration-grade character art.** Code-drawn canvas art does not reach a hand-painted
  illustration. Do not promise that finish; the realistic path for production art is an artist or
  an image tool, in layers, and the studio rigs and animates it.
- **Bodies without meshes.** A body cut into rigid pieces reads as a puppet. Hair that bends
  along its length, a skirt or a soft torso needs mesh weights (`paint_weights`) or several short
  bones with overlapping motion.

## Rules that came out of the mistakes

1. **Look at the reference before drawing, not after.** A style word ("anime", "modern") means a
   particular picture. Find the reference first; enlarge it and list what makes it that style
   (line weight, proportions, how eyes and hair are built).
2. **Never redraw a named existing character.** Use a reference for its drawing language only.
3. **Look at enlarged frames before saying it is done.** Most remaining faults are visible at 3x.
4. **No non-uniform scale above the eyes.** A squash on the body or head skews the eyes under a
   tilted head. Dip and hop by moving, scale evenly.
5. **One outline per limb.** Draw each segment as an outline slot and a fill slot on the same
   bone, all outlines first, round ends centred on the joints. A bent joint then shows no seam.
6. **A two-bone IK has one bend direction.** In a front view an elbow points outward both
   hanging and raised, which are the two bends: swing the arm out straight, key `bendPositive`
   on that frame, then fold. Never flip while the limb is bent.
7. **Write limb targets as an angle and a reach about the joint,** not as offsets. A key then
   cannot ask for more limb than there is.
8. **A lid is a patch of skin.** Anything it must not erase (fringe, side locks) is drawn above
   it; anything it must hide (the lash line) is inside its box.
9. **A body moves from its core.** A limb that swings on a still torso reads as a puppet: lead
   from the hips and the chest, then let shoulder, elbow, wrist and fingers follow a frame or two
   apart (`critique_animation` measures this on a human rig).
10. **Stop and show early.** Show the first readable frame before refining a direction.
11. **Ask where the source material lives before fixing the boundary of an intake.** Link intake
    was first built YouTube-only; showreels live on many sites.
12. **Say up front how long a multi-stage run will take and what each stage buys; report
    progress without being asked.** A long, quiet background run reads as a hang.

## Left as it is

- The human and anime examples live on as Pip and Mika in `examples/showcase`; the other heads,
  the menu icons and the victory sequence were retired on 2026-11-24, their checks kept on
  fixtures in `test/fixtures` (`face`, `body`, `banner`).
