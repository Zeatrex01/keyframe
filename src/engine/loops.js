// Whether a clip cycles or plays once, for exports that must say so (a sprite sheet's map, a
// Godot AnimationPlayer). A clip named for a one-shot action (a jump, an attack, a hit, a reveal)
// plays once even when it lands back in its first pose; any other clip loops when its pose at its
// end is its pose at its start. An explicit answer always wins: one given to the export, or one the
// clip was written with (write_animation's `loop`, kept in the delivery). Pure and isomorphic.

/** Names of actions that play once. */
const ONE_SHOT = /jump|leap|land|attack|punch|strike|slash|stab|thrust|shoot|fire|cast|kick|jab|cross|uppercut|hook|block|parry|dodge|dash|roll|throw|grab|stagger|flinch|recoil|knock|taunt|step|swing|smash|hit|hurt|die|death|dead|spawn|appear|disappear|open|close|press|tap|click|pop|burst|collect|win|lose|(^|[_\-. ])(in|out|intro|outro|enter|exit)$/i;

/** True when a clip's name says it plays once. */
export const isOneShot = name => ONE_SHOT.test(String(name ?? ''));

/**
 * Whether a clip loops.
 * @param {string} name  the clip's name
 * @param {boolean} closes  its last pose is its first
 * @param {boolean} [asked]  an explicit answer, which wins
 */
export function clipLoops(name, closes, asked) {
  if (typeof asked === 'boolean') return asked;
  return !!closes && !isOneShot(name);
}

/**
 * The loop answers a skeleton carries for its clips: what write_animation was told (`loop`), kept
 * in the delivery's marker. { <clip>: true | false }.
 * @param {any} json
 * @returns {Record<string, boolean>}
 */
export function declaredLoops(json) {
  const loops = json?._kfDelivery?.loops;
  return loops && typeof loops === 'object' ? Object.fromEntries(Object.entries(loops).filter(([, v]) => typeof v === 'boolean')) : {};
}

/**
 * The explicit answer for one clip, if any: the given map first, then the skeleton's own.
 * @param {string} name @param {Record<string, boolean> | undefined} given @param {any} json
 * @returns {boolean | undefined}
 */
export function loopAnswer(name, given, json) {
  const g = given?.[name];
  return typeof g === 'boolean' ? g : declaredLoops(json)[name];
}
