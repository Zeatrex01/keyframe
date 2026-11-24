// Reads a Spine .atlas and returns plain geometry, with the studio's own reader (src/engine/atlas.js).
//
// test/engine.test.js holds the reader to the official parser's output on every shipped atlas
// when the Spine add-on is present; the reader itself needs no Spine code.

import { parseAtlas } from '../engine/atlas.js';
import { StudioError } from '../shared/errors.js';

/**
 * @param {string} text .atlas file contents
 * @returns {Promise<{ pages: object[], regions: object[] }>}
 *   pages:   { name, width, height, pma, format, minFilter, magFilter }
 *   regions: { name, page, x, y, width, height, degrees, offsetX, offsetY,
 *              originalWidth, originalHeight, index }
 *   `width`/`height` are the region's size before rotation, as Spine writes them; a region
 *   at 90 or 270 degrees occupies height x width on its page.
 */
export async function readAtlas(text) {
  if (typeof text !== 'string') throw new StudioError('bad-argument', 'Atlas text must be a string.');
  let atlas;
  try {
    atlas = parseAtlas(text);
  } catch (err) {
    throw new StudioError('atlas-parse', `This atlas could not be read: ${err.message}`, { cause: err.message });
  }
  return {
    pages: atlas.pages,
    regions: atlas.regions.map(({ u, v, u2, v2, ...region }) => region),
  };
}
