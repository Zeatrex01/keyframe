// Headless frames of an animation (ADR-3): the studio's engine (or, with the Spine add-on on and
// a file that needs it, the official runtime) poses the skeleton and computes world vertices
// and clipping; src/render/raster.js fills the pixels.
//
// Replaces legacy see_animation (needed an open studio window) and render_frames.js
// (needed playwright and Chromium). Any agent can now look at what it wrote.

import { parseSkeleton, createPoser, loadRuntime } from '../runtime/index.js';
import { collectDraws as engineDraws, applyClip, parseAtlas, atlasRegions } from '../engine/index.js';
import { StudioError } from '../shared/errors.js';
import { createCanvas, prepareTexture, drawTriangles, toImage, BLEND } from './raster.js';

const QUAD = [0, 1, 2, 2, 3, 0];
const MAX_PIXELS = 4096 * 4096;

/**
 * Collect what one posed skeleton draws, in draw order, in world coordinates.
 * @returns {Array<{ positions: Float32Array, uvs: Float32Array, indices: number[], page: string,
 *   pma: boolean, blend: number, light: object, dark: object|null }>}
 */
export function collectDraws(spine, skeleton) {
  const draws = [];
  const clipper = new spine.SkeletonClipping();
  const light = new spine.Color();
  const dark = new spine.Color();
  for (const slot of skeleton.drawOrder) {
    const attachment = slot.bone.active ? slot.getAttachment() : null;
    if (attachment instanceof spine.ClippingAttachment) { clipper.clipStart(slot, attachment); continue; }
    let positions, uvs, indices;
    if (attachment instanceof spine.RegionAttachment) {
      positions = new Float32Array(8);
      attachment.computeWorldVertices(slot, positions, 0, 2);
      uvs = attachment.uvs;
      indices = QUAD;
    } else if (attachment instanceof spine.MeshAttachment) {
      positions = new Float32Array(attachment.worldVerticesLength);
      attachment.computeWorldVertices(slot, 0, attachment.worldVerticesLength, positions, 0, 2);
      uvs = attachment.uvs;
      indices = attachment.triangles;
    } else {
      clipper.clipEndWithSlot(slot);
      continue; // bounding boxes, paths, points draw nothing
    }
    const region = attachment.region;
    const sc = skeleton.color, lc = slot.color, ac = attachment.color;
    light.set(sc.r * lc.r * ac.r, sc.g * lc.g * ac.g, sc.b * lc.b * ac.b, sc.a * lc.a * ac.a);
    if (region && light.a > 0) {
      const darkColor = slot.darkColor ? { r: slot.darkColor.r, g: slot.darkColor.g, b: slot.darkColor.b } : null;
      if (clipper.isClipping()) {
        dark.set(darkColor?.r ?? 0, darkColor?.g ?? 0, darkColor?.b ?? 0, 1);
        clipper.clipTriangles(positions, indices, indices.length, uvs, light, dark, false);
        const v = clipper.clippedVertices; // stride 8: x, y, r, g, b, a, u, v
        const count = v.length / 8;
        positions = new Float32Array(count * 2);
        uvs = new Float32Array(count * 2);
        for (let i = 0; i < count; i++) {
          positions[i * 2] = v[i * 8]; positions[i * 2 + 1] = v[i * 8 + 1];
          uvs[i * 2] = v[i * 8 + 6]; uvs[i * 2 + 1] = v[i * 8 + 7];
        }
        indices = Array.from(clipper.clippedTriangles);
      }
      if (indices.length) {
        draws.push({
          slot: slot.data.name, positions, uvs: Float32Array.from(uvs), indices: Array.from(indices),
          page: region.page.name, pma: !!region.page.pma, blend: slot.data.blendMode,
          light: { r: light.r, g: light.g, b: light.b, a: light.a }, dark: darkColor,
        });
      }
    }
    clipper.clipEndWithSlot(slot);
  }
  clipper.clipEnd();
  return draws;
}

function boundsOf(frames) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const draws of frames) {
    for (const d of draws) {
      for (let i = 0; i < d.positions.length; i += 2) {
        const x = d.positions[i], y = d.positions[i + 1];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
}

/**
 * Render frames of one animation.
 * @param {object} options
 * @param {object} options.json           skeleton JSON
 * @param {string} options.atlasText      its .atlas
 * @param {Map<string, {width:number,height:number,data:Uint8Array}>|object} options.pages
 *        decoded page images by atlas page name (see src/render/png.js)
 * @param {string} options.animation
 * @param {number[]} options.times        seconds, ascending order not required
 * @param {number} [options.width=256]  @param {number} [options.height=256]
 * @param {number} [options.margin=0.08] fraction of the frame left around the subject
 * @param {{x:number,y:number,width:number,height:number}} [options.viewport] world-space
 *        box to frame; default is the union of everything drawn across `times`
 * @param {{r,g,b,a}} [options.background]  straight colour; default transparent
 * @param {number} [options.supersample=2]  edge anti-aliasing factor
 * @param {boolean} [options.boundsOnly] return only the framed box (`viewport`), drawing nothing
 * @param {string} [options.skin] @param {number} [options.fps=60]
 */
export async function renderFrames({ json, atlasText, pages, animation, times, width = 256, height = 256, margin = 0.08,
  viewport, background = null, supersample = 2, skin, fps = 60, boundsOnly = false }) {
  if (!(width > 0 && height > 0) || width * height * supersample * supersample > MAX_PIXELS) {
    throw new StudioError('bad-argument', 'Frame size is out of range.', { width, height, supersample });
  }
  if (!Array.isArray(times) || !times.length) throw new StudioError('bad-argument', 'Give at least one time to render.');
  const data = await parseSkeleton(json, { atlasText });
  const poser = await createPoser(data, animation, { fps, skin });
  const pageOf = name => (pages instanceof Map ? pages.get(name) : pages?.[name]);
  let drawsAt;
  if (data.backend === 'keyframe') {
    const regionOf = atlasRegions(parseAtlas(atlasText));
    drawsAt = pose => {
      const { draws, missing } = engineDraws(pose, regionOf);
      if (missing.length) throw new StudioError('runtime-parse', `Region not found in atlas: ${missing.join(', ')}.`, { missing });
      return draws.map(d => applyClip(d));
    };
  } else {
    const spine = await loadRuntime();
    drawsAt = skeleton => collectDraws(spine, skeleton);
  }

  const order = times.map((time, index) => ({ time, index })).sort((a, b) => a.time - b.time);
  const drawsByIndex = new Array(times.length);
  for (const { time, index } of order) drawsByIndex[index] = drawsAt(poser.at(time));

  const box = viewport ?? boundsOf(drawsByIndex);
  if (boundsOnly) return { frames: [], viewport: box, scale: 0 };
  if (!box) return { frames: times.map(time => ({ time, image: toImage(createCanvas(width, height), 1, background) })), viewport: null, scale: 0 };
  const W = width * supersample, H = height * supersample;
  const usableW = W * (1 - 2 * margin), usableH = H * (1 - 2 * margin);
  const scale = Math.min(usableW / Math.max(box.width, 1e-6), usableH / Math.max(box.height, 1e-6));
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  const textures = new Map();
  const textureFor = (page, pma) => {
    const key = `${page}|${pma}`;
    if (!textures.has(key)) {
      const image = pageOf(page);
      if (!image) throw new StudioError('missing-page', `The atlas page "${page}" was not provided.`, { page });
      textures.set(key, prepareTexture(image, pma));
    }
    return textures.get(key);
  };

  const frames = drawsByIndex.map((draws, index) => {
    const canvas = createCanvas(W, H);
    for (const d of draws) {
      const positions = new Float32Array(d.positions.length);
      for (let i = 0; i < positions.length; i += 2) {
        positions[i] = W / 2 + (d.positions[i] - cx) * scale;
        positions[i + 1] = H / 2 - (d.positions[i + 1] - cy) * scale; // Spine is y-up, images are y-down
      }
      drawTriangles(canvas, { positions, uvs: d.uvs, indices: d.indices, texture: textureFor(d.page, d.pma),
        light: d.light, dark: d.dark, blend: d.blend ?? BLEND.normal });
    }
    return { time: times[index], image: toImage(canvas, supersample, background) };
  });
  return { frames, viewport: box, scale: scale / supersample };
}

/**
 * Lay images out left to right, wrapping after `columns`.
 * @param {Array<{width:number,height:number,data:Uint8Array}>} images same size
 */
export function filmstrip(images, { columns = images.length, gap = 4, background = { r: 0, g: 0, b: 0, a: 0 } } = {}) {
  if (!images.length) throw new StudioError('bad-argument', 'A filmstrip needs at least one image.');
  const { width: w, height: h } = images[0];
  if (images.some(i => i.width !== w || i.height !== h)) throw new StudioError('bad-argument', 'Filmstrip images must share one size.');
  const cols = Math.max(1, Math.min(columns, images.length));
  const rows = Math.ceil(images.length / cols);
  const width = cols * w + (cols - 1) * gap;
  const height = rows * h + (rows - 1) * gap;
  const data = new Uint8Array(width * height * 4);
  const bg = [background.r, background.g, background.b, background.a].map(v => Math.round(v * 255));
  for (let i = 0; i < data.length; i += 4) data.set(bg, i);
  images.forEach((image, n) => {
    const ox = (n % cols) * (w + gap), oy = Math.floor(n / cols) * (h + gap);
    for (let y = 0; y < h; y++) data.set(image.data.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * width + ox) * 4);
  });
  return { width, height, data };
}
