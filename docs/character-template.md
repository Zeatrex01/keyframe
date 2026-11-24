# Character template

How to prepare a character so the studio can animate it straight away: the emotion clips, the
body clips, weight painting and follow-through all work on any character that uses these names.

Two empty starting skeletons sit in `examples/template/`, made from the working examples with
the art and the clips taken out:

| File | For | Has |
|---|---|---|
| `head.json` | a head on its own (an icon, an avatar, a reaction face) | the face rig |
| `body.json` | a character with a body, full or waist up | trunk, two-bone IK arms and legs, and the same face rig on its head |

Bones and slots carry the names and parents the clips expect. Their positions come from the
examples; in Spine you move each bone onto your own art. Names and parents are what matter,
positions are yours.

## 1. Choose the cut

- **Head only.** Smallest and safest; the emotions carry the character.
- **Portrait, waist or shoulders up.** What most mobile games show in menus and dialogue. Use
  `body.json` and delete the leg bones, the foot targets and the leg IK.
- **Full body.** Use all of `body.json`. More to go wrong; the face still carries most of it.

## 2. Draw the layers

One layer per slot, each named exactly like the slot. Draw every part whole, including what
another part covers, so nothing shows a hole when it moves.

### The face (both templates)

| Slot | Draw | Rule |
|---|---|---|
| `head` | the head shape and skin | the eye line sits just below the middle of the head |
| `eyeL`, `eyeR` | the white of each eye, a full ellipse | level, mirrored, the same size |
| `pupilL`, `pupilR` | iris and pupil together, with the highlight | fills most of the eye; it slides inside the eye for a glance |
| `eyeClipL`, `eyeClipR` | no picture: a clipping attachment in Spine, traced just inside the white's outline, ending at `pupilL` / `pupilR` | the pupil draws only inside it, so a glance or a squint never crosses the eye's outline; the lid stays outside the mask (a mask has hard edges and would leave a dotted ring) |
| `lidL`, `lidR` | five attachments each, see below | each lid is the eye's own box and the eye's own ellipse |
| `browL`, `browR` | one brow each | just above the eye, never touching it |
| `nose` | the nose | on the centre line |
| `mouth` | five attachments, see below | starts just under the nose and never overlaps it |
| `blushL`, `blushR` | a soft cheek blush | hidden in the setup pose; clips fade it in |
| `tearL`, `tearR`, `anger`, `heart`, `zzz` | the effect pictures | hidden in the setup pose |
| `earL`, `earR` | ears, or whatever hangs at the sides of the head (pigtails, side locks) | drawn whole down to the root, which sits under the head |

Lid attachments, in the slots `lidL` and `lidR` (the right one is the mirror of the left):

| Attachment | Shape |
|---|---|
| `lid_half` | the upper half of the eye covered, a straight edge |
| `lid_angry` | covered lower toward the nose |
| `lid_sad` | covered lower toward the outside |
| `lid_closed` | the whole eye covered, a closed line curving down |
| `lid_happy` | the whole eye covered, a closed line curving up |

Mouth attachments, in the slot `mouth`: `mouth_neutral` (shown in the setup pose),
`mouth_smile`, `mouth_o`, `mouth_frown`, `mouth_grr`.

The head template also has `whiskerL`, `whiskerR` and `muzzle` (animal heads; delete them on a
human), and `shadow`, `sparkle1`, `sparkle2` and `badge`, which every asset in the pack shares (a
ground shadow, two hidden sparkles, a hidden notification badge); keep or delete them.

A partial lid (`lid_half`, `lid_angry`, `lid_sad`) is a patch of skin inside the eye: draw it in the skin colour
around the eye. A full lid (`lid_closed`, `lid_happy`) is only the closed line, with no patch: the clips hide the
white and the pupil while it shows, so nothing is painted over the face and no ring shows around a closed eye. Hair that hangs over the eyes
(a fringe, side locks) goes in a slot drawn above the lids, otherwise a closing lid paints over it.

### The body (`body.json`)

| Slot | Draw | Rule |
|---|---|---|
| `neck`, `top`, `waist`, `bottom` | neck, chest, belly, hips or skirt | each overlaps the next by a margin, so a lean opens no gap |
| `armL`/`armR`, `forearmL`/`forearmR`, `handL`/`handR` | upper arm, forearm, hand | round ends centred on the shoulder, elbow and wrist; the hanging elbow sits a little outward of the shoulder-to-hand line |
| `thighL`/`thighR`, `shinL`/`shinR`, `footL`/`footR` | thigh, shin, shoe | the same at hip, knee and ankle; the knee a little outward |
| `hairBack`, `fringe` | hair behind the head, hair over the forehead | the fringe in front of the face, behind the brows |
| `earLobeL`, `earLobeR` | the ears of a human head | drawn behind the head's edge; `earL`/`earR` then carry the side hair |

### Parts that bend

Draw a part that should bend (a cape, a tail, a long lock, a ribbon, a soft torso) as one whole
picture, not as pieces. In the studio `paint_weights` turns it into a mesh and binds it to its
bones, so it bends instead of folding at a seam. Give it a chain of bones in Spine that runs
through the picture from its root to its tip; more bones give a rounder curve.

## 3. Set it up in Spine

1. Open the template (or import your art into it with the images in `images/`).
2. Move every bone onto your art: a joint's bone origin on the joint, its tip toward the next
   joint. Keep the names and the parents.
3. Put each layer in its slot under the same name; add the lid and mouth attachments to their slots.
4. Leave the IK as it is. The arm and leg bend directions are already set so elbows and knees
   point outward.
5. Export JSON for Spine 4.2 with an atlas, into one folder.

## 4. Bring it to the studio

Connect the studio to that folder and ask for what you want. What exists for a character on
these names:

- the face clips: `neutral`, `<emotion>_in` and `<emotion>` for happy, sad, angry, surprised,
  sleepy and love, and `to_neutral`;
- body clips on the IK: idle, walk, jump, cheer (`examples/showcase/pip` shows them);
- `paint_weights` for the parts that bend, and follow requests in `write_animation` for anything
  that should trail (ears, hair, tails, ribbons);
- `see_animation` and `check_skeleton` before anything is called done.

The studio never writes your file; every result is a new `<name>_v2.json` beside it.

## Checklist before handing over

- [ ] Slot and attachment names match the tables above, letter for letter.
- [ ] Eyes level and the same size; pupils inside the whites; lids the eye's own shape.
- [ ] Mouth under the nose, all five mouth shapes drawn; all five lid shapes drawn.
- [ ] Every part drawn whole, overlapping its neighbour at the joint.
- [ ] Parts meant to bend are one picture each, with a bone chain through them.
- [ ] Exported as Spine 4.2 JSON with its atlas, in one folder.
