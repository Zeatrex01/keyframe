// The effect page of a delivery, on the atlas side. An emitter that draws with an item of the
// asset library (a spark, a puff, a flame) needs that item on an atlas page, and the base's atlas
// is the owner's. The delivery gets a page of its own beside it (<delivery>_fx.png, drawn by
// src/render/fx-art.js when an effect is added) and its copy of the base's atlas gets one more
// section naming that page's regions. A later write that copies the base's atlas again keeps
// the section, so every player that reads the atlas (the studio, the add-on for Godot, a Spine
// runtime) still finds the art.
//
// The delivery records what it draws with under `_kfAdded.art`: [{ region, ref, width, height }].

import path from 'node:path';
import { ADDED_MARKER } from '../spine/effects.js';

/** The page of effect art beside a delivery: <stem>_fx.png. */
export const fxPageName = (/** @type {string} */ deliveryAbs) => `${path.basename(deliveryAbs).replace(/\.json$/i, '')}_fx.png`;

/**
 * The library art a delivery records, valid entries only.
 * @param {any} skeleton
 * @returns {Array<{ region: string, ref: string, width: number, height: number }>}
 */
export function fxArtOf(skeleton) {
  const art = skeleton?.[ADDED_MARKER]?.art;
  if (!Array.isArray(art)) return [];
  const seen = new Set();
  return art.filter(a => a && typeof a.region === 'string' && typeof a.ref === 'string' && a.width > 0 && a.height > 0
    && !seen.has(a.region) && seen.add(a.region));
}

const blocksOf = (/** @type {string} */ atlasText) => atlasText.replace(/\r/g, '').split(/\n[ \t]*\n/);
const pageOfBlock = (/** @type {string} */ block) => block.trim().split('\n')[0].trim();

/** One page's section of an atlas text (its name line up to the next blank line), or null. */
export function sectionOf(/** @type {string} */ atlasText, /** @type {string} */ page) {
  const block = blocksOf(atlasText).find(b => pageOfBlock(b) === page);
  return block ? `${block.trim()}\n` : null;
}

/** An atlas text without one page's section. */
export function withoutPage(/** @type {string} */ atlasText, /** @type {string} */ page) {
  return blocksOf(atlasText).filter(block => pageOfBlock(block) !== page).join('\n\n');
}

/** An atlas text with the effect page's section in place of any earlier one. */
export function withFxSection(/** @type {string} */ atlasText, /** @type {string} */ page, /** @type {string} */ section) {
  const rest = withoutPage(atlasText, page).replace(/\s+$/, '');
  return `${rest ? `${rest}\n\n` : ''}${section}`;
}
