// The effect art of a delivery, on the pixel side: the library items its emitters draw with
// (src/spine/effects.js records them), drawn onto one atlas page. src/deliver/fx-atlas.js puts
// the page's section into the delivery's atlas; add_effect hands this drawer to the write.

import { readAssetSvg } from '../core/asset-library.js';
import { StudioError } from '../shared/errors.js';
import { rasterizeSvg } from '../engine/svg.js';
import { encodePng } from './png.js';
import { packImages } from './svg-rig.js';

/** Atlas pixels per skeleton unit of the effect art. */
export const FX_RESOLUTION = 2;

/**
 * Draw the art onto one page.
 * @param {Array<{ region: string, ref: string, width: number, height: number }>} art
 * @param {string} page  the page's file name
 * @param {{ resolution?: number, root?: string }} [options]
 * @returns {{ png: Uint8Array, section: string, width: number, height: number }}
 */
export function buildFxPage(art, page, { resolution = FX_RESOLUTION, root } = {}) {
  if (!art.length) throw new StudioError('bad-argument', 'There is no effect art to draw.');
  const images = art.map(a => {
    const svg = root ? readAssetSvg(a.ref, root) : readAssetSvg(a.ref);
    return rasterizeSvg(svg, { width: Math.max(1, Math.round(a.width * resolution)), height: Math.max(1, Math.round(a.height * resolution)) });
  });
  const { at, width, height } = packImages(images);
  const data = new Uint8Array(width * height * 4);
  images.forEach((img, i) => {
    const [ox, oy] = at[i];
    for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((oy + y) * width + ox) * 4);
  });
  let section = `${page}\nsize:${width},${height}\nfilter:Linear,Linear\npma:false\n`;
  art.forEach((a, i) => { section += `${a.region}\nbounds:${at[i][0]},${at[i][1]},${images[i].width},${images[i].height}\n`; });
  return { png: encodePng({ width, height, data }), section, width, height };
}
