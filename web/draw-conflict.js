// The board and the AI drawing the same file: when the AI changes a drawing while the board holds
// unsaved edits (the feed in draw-live.js, or a save the server refuses as stale), the board says
// so and the owner chooses: load the AI's version (dropping the board's edits) or keep the edits as
// a copy beside it. Nothing is overwritten and nothing is dropped in silence.

import { el } from './store.js';
import { api, t } from './ui.js';
import { uniqueName } from './draw-model.js';

/** @type {{ D: any, openDrawing: (file: string) => Promise<void>, save: () => Promise<void>, say: Function } | null} */
let board = null;

/**
 * Show the conflict for a drawing, or hide it ('').
 * @param {string} file
 */
export function showConflict(file) {
  if (board) board.D.conflict = file;
  el.drawConflict.hidden = !file;
  if (file) el.drawConflictText.textContent = t('draw.conflict', { file });
}

/** Wire the two choices to the board (draw.js calls it once). */
export function initConflict(b) {
  board = b;
  el.drawConflictLoad.addEventListener('click', async () => {
    const { D } = board, file = D.conflict;
    D.dirty = false;
    try { D.list = (await api('/api/drawings')).drawings; await board.openDrawing(file); } catch (err) { board.say('draw.loadFailed', { reason: err.message }, 'bad'); }
  });
  el.drawConflictCopy.addEventListener('click', async () => {
    // The board's edits go to a new drawing beside it; the AI's version stays as it is.
    const { D } = board;
    const name = uniqueName((D.list ?? []).map(d => ({ name: d.name })), `${D.name}_mine`);
    el.drawName.value = name;
    D.name = name;
    D.version = null;
    await board.save();
  });
}

/** Leaving unsaved changes asks once, in the page (no browser dialog): true on the second try. */
export function confirmLeave() {
  const { D } = board;
  if (D.leaving) { D.leaving = false; return true; }
  D.leaving = true;
  board.say('draw.unsaved', {}, 'bad');
  return false;
}
