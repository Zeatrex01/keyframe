// What every tool needs from the bound project: open a skeleton safely, find its atlas and
// page images. Paths are always project-relative and contained (src/core/paths.js).

import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from '../shared/errors.js';
import { openSkeleton, insideProjectReal } from '../core/paths.js';
import { findSkeletons, atlasBeside } from '../deliver/write.js';
import { decodePng } from '../render/png.js';

const toRel = (dir, abs) => path.relative(dir, abs).split(path.sep).join('/');

export function projectOf(session) {
  if (!session?.dir) throw new StudioError('no-project', 'No project is open: open one in the studio page (Projects), or start the server with --project <folder>.');
  const dir = session.dir;
  const getDir = () => dir;
  return {
    dir,
    /** @returns {{ sk: object, rel: string, abs: string, autoChosen?: object }} */
    // An empty `file` picks the folder's base skeleton (deliveries are never chosen).
    skeleton(file) {
      return openSkeleton(getDir, file, { findSkeletons: d => findSkeletons(d) });
    },
    resolve(file) { return insideProjectReal(getDir, file); },
    rel(abs) { return toRel(dir, abs); },
    /** The atlas paired with a skeleton by name, or null. */
    atlasFor(skeletonAbs) {
      const abs = atlasBeside(skeletonAbs);
      return abs ? { abs, rel: toRel(dir, abs), text: fs.readFileSync(abs, 'utf8') } : null;
    },
    /** Decoded page images for an atlas, by page name; refuses with the missing page named. */
    pagesFor(atlas, pageNames) {
      const pages = {};
      for (const name of pageNames) {
        const abs = path.join(path.dirname(atlas.abs), name);
        if (!fs.existsSync(abs)) throw new StudioError('missing-page', `The atlas page "${name}" is not next to ${atlas.rel}.`, { page: name, atlas: atlas.rel });
        pages[name] = decodePng(new Uint8Array(fs.readFileSync(abs)));
      }
      return pages;
    },
    list: () => findSkeletons(dir, { includeDeliveries: true }),
  };
}
