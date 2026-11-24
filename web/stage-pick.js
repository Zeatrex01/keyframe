// Which skeleton the stage shows. The server proposes one (the delivery the agent last called
// ready, else the newest delivery, else the base); the owner can flip the stage between a
// delivery and the base it was written onto, to see what changed, or pick any skeleton of the
// project in the stage's file menu (a rig drawn on the board, another character). The pick lasts
// until the server proposes something new (a fresh "ready" from the agent wins). Pure, so it is gated.

const folderOf = file => (file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '');

/**
 * The skeleton on the other side of the flip: a delivery's base, or a base's newest delivery.
 * @param {Array<{ file: string, role: string, deliveryOf?: string, modified?: number }>} skeletons
 * @param {string} file
 * @returns {object|null}
 */
export function counterpart(skeletons, file) {
  const shown = skeletons.find(s => s.file === file);
  if (!shown) return null;
  if (shown.role === 'delivery') {
    if (!shown.deliveryOf) return null;
    const base = folderOf(shown.file) + shown.deliveryOf;
    return skeletons.find(s => s.file === base && s.role === 'base') ?? null;
  }
  const name = shown.file.slice(folderOf(shown.file).length);
  return skeletons
    .filter(s => s.role === 'delivery' && s.deliveryOf === name && folderOf(s.file) === folderOf(shown.file))
    .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0))[0] ?? null;
}

/**
 * The skeleton to put on the stage: the owner's pick (a flip, or a skeleton chosen in the stage's
 * file menu) while it is still in the project, else the server's proposal.
 * @param {object[]} skeletons
 * @param {string|null} proposed  the file the server proposes
 * @param {string|null} picked    the file the owner flipped to, or null
 */
export function stageFile(skeletons, proposed, picked) {
  if (!proposed) return null;
  if (picked && picked !== proposed && skeletons.some(s => s.file === picked)) return picked;
  return proposed;
}
