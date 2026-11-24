# Warrior

A platformer hero in profile, dressed for a fight: plate armour (leather as the other look of every piece) and a weapon slot that holds a sword, a spear, a bow or an axe.

One dressable skeleton for a side-scroller: a guard stance and an attack for each weapon, a punch with no weapon, a run and a jump. The body drives every blow and the feet stay planted where they stand while the hips shift.

Kind: Character. Shown at 320 px wide. Teaches: weight shift with planted feet, a stance per weapon, anticipation and impact, a run with a moment in the air.

| Clip | Length | What happens |
|---|---|---|
| `idle_sword` | 1.6 s, loop | guard stance, sword up and forward, breathing over planted feet |
| `attack_sword` | 0.78 s | raise the sword overhead, cut down and forward driven by the hips, hold the hit, recover |
| `idle_spear` | 1.6 s, loop | spear level at the hip, both hands on it, breathing |
| `attack_spear` | 0.82 s | draw back, thrust with the whole body, hold, recover |
| `idle_bow` | 1.6 s, loop | bow low in the near hand, relaxed |
| `shoot_bow` | 1.1 s | raise the bow, draw to the cheek, hold, release with a recoil |
| `idle_axe` | 1.6 s, loop | the sword stance with the axe in hand |
| `attack_axe` | 0.78 s | the overhead cut with the axe |
| `idle_unarmed` | 1.6 s, loop | no weapon: fists up in guard, breathing over planted feet |
| `punch` | 0.72 s | no weapon: guard, a short pull back, a straight punch from the hips, hold, recover |
| `run` | 0.6 s, loop | two strides with a moment in the air after each push-off, arms opposite the legs; keeps whatever weapon the game gave it |
| `jump` | 1 s | crouch with the feet planted, launch, tuck at the top, land into a planted crouch and stand; keeps the weapon in hand |

Files: `warrior.json` + `.atlas` + `.png` (the rig, no clips), `warrior_v2.json` (the
delivery with the clips), `brief.json` (what was asked, for the studio and the gates), `preview.png`.
Rebuilt by `examples/kit/warrior.js` (`npm run examples`); every clip was written through the
studio's own tools and passes `check_skeleton` and `critique_animation` with no warnings
(`test/example-warrior.test.js`).
