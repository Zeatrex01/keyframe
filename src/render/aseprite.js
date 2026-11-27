// Aseprite files (.aseprite, .ase) read with the standard library, from the published file format
// (docs/ase-file-specs.md in the Aseprite repository): the canvas, the layers and their groups,
// every frame with its duration, the cels as straight RGBA, the tags and the palette.
//
// Then a drawing from it: each visible image layer becomes one part whose art is its pixels as
// SVG (one path per colour, every pixel a whole unit, so the atlas drawn at a whole number of
// pixels per unit has no soft edge); a layer whose pixels change from frame to frame becomes a
// flipbook of its distinct cels, and every tag becomes a clip that plays the frames in the tag's
// direction at the file's own frame durations. One rig unit is one pixel of the canvas; the
// canvas's bottom centre is the rig's origin.
//
// Node only (zlib); everything else is plain data.

import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { StudioError } from '../shared/errors.js';

const DIRECTIONS = ['forward', 'reverse', 'pingpong', 'pingpong-reverse'];
// Aseprite blend modes the runtime can draw; the others draw as normal and are named.
const BLENDS = { 0: null, 1: 'multiply', 2: 'screen', 16: 'additive' };
const BLEND_NAMES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color dodge', 'color burn', 'hard light', 'soft light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'addition', 'subtract', 'divide'];

const bad = (message, details = {}) => new StudioError('bad-aseprite', message, details);

/**
 * Read an Aseprite file.
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number, depth: number, frames: Array<{ duration: number }>,
 *   layers: Array<{ index: number, name: string, type: 'image'|'group'|'tilemap', level: number, parent: number|null,
 *     visible: boolean, background: boolean, reference: boolean, blend: number, opacity: number }>,
 *   cels: Array<{ layer: number, frame: number, x: number, y: number, opacity: number, z: number, width: number, height: number, data: Uint8Array, linked: boolean }>,
 *   tags: Array<{ name: string, from: number, to: number, direction: string, repeat: number }>,
 *   palette: number[][], notes: string[] }}
 */
export function readAseprite(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 128 || buf.readUInt16LE(4) !== 0xA5E0) throw bad('This is not an Aseprite file (no 0xA5E0 header).');
  const frameCount = buf.readUInt16LE(6), width = buf.readUInt16LE(8), height = buf.readUInt16LE(10), depth = buf.readUInt16LE(12);
  const flags = buf.readUInt32LE(14), speed = buf.readUInt16LE(18), transparent = buf[28];
  const pixelW = buf[34], pixelH = buf[35];
  if (![8, 16, 32].includes(depth)) throw bad(`Unknown colour depth ${depth} (8, 16 or 32 bits per pixel).`, { depth });
  if (!width || !height) throw bad('The canvas has no size.', { width, height });
  const notes = new Set();
  if (pixelW && pixelH && pixelW !== pixelH) notes.add(`pixels are ${pixelW}:${pixelH} in the file; they are read as square`);
  const layers = [], rawCels = [], tags = [];
  let palette = [], newPalette = false;
  const parents = [];
  let at = 128;
  const frames = [];
  for (let f = 0; f < frameCount; f++) {
    if (at + 16 > buf.length) throw bad(`The file ends inside frame ${f}.`, { frame: f });
    const frameBytes = buf.readUInt32LE(at);
    if (buf.readUInt16LE(at + 4) !== 0xF1FA) throw bad(`Frame ${f} has no 0xF1FA header.`, { frame: f });
    const oldChunks = buf.readUInt16LE(at + 6), duration = buf.readUInt16LE(at + 8), newChunks = buf.readUInt32LE(at + 12);
    const chunks = newChunks || oldChunks;
    frames.push({ duration: (duration || speed || 100) / 1000 });
    const end = at + frameBytes;
    if (end > buf.length) throw bad(`The file ends inside frame ${f}.`, { frame: f });
    let c = at + 16;
    const celsHere = [];
    for (let k = 0; k < chunks && c + 6 <= end; k++) {
      const size = buf.readUInt32LE(c), type = buf.readUInt16LE(c + 4);
      if (size < 6 || c + size > end) throw bad(`A chunk in frame ${f} runs past the frame.`, { frame: f, type });
      const d = c + 6;
      if (type === 0x2004) {
        const lflags = buf.readUInt16LE(d), ltype = buf.readUInt16LE(d + 2), level = buf.readUInt16LE(d + 4);
        const blend = buf.readUInt16LE(d + 10), opacity = buf[d + 12];
        const nameLen = buf.readUInt16LE(d + 16);
        const name = buf.toString('utf8', d + 18, d + 18 + nameLen);
        parents.length = level;
        const parent = level > 0 ? parents[level - 1] ?? null : null;
        const index = layers.length;
        // Opacity is valid with header flag 1, and for groups (with their blend) only with flag 2.
        const group = ltype === 1, valid = group ? flags & 2 : flags & 1;
        layers.push({ index, name, type: /** @type {'image'|'group'|'tilemap'} */ (group ? 'group' : ltype === 2 ? 'tilemap' : 'image'), level, parent,
          visible: !!(lflags & 1), background: !!(lflags & 8), reference: !!(lflags & 64), blend: group && !(flags & 2) ? 0 : blend,
          opacity: valid ? opacity / 255 : 1 });
        parents[level] = index;
      } else if (type === 0x2005) {
        const layer = buf.readUInt16LE(d), x = buf.readInt16LE(d + 2), y = buf.readInt16LE(d + 4), opacity = buf[d + 6];
        const celType = buf.readUInt16LE(d + 7), z = buf.readInt16LE(d + 9);
        const body = d + 16;
        if (celType === 1) celsHere.push({ layer, frame: f, x, y, opacity: opacity / 255, z, link: buf.readUInt16LE(body) });
        else if (celType === 0 || celType === 2) {
          const w = buf.readUInt16LE(body), h = buf.readUInt16LE(body + 2);
          const packed = buf.subarray(body + 4, c + size);
          let pixels;
          try { pixels = celType === 2 ? inflateSync(packed) : packed; } catch { throw bad(`The cel of layer ${layer} in frame ${f} does not inflate.`, { layer, frame: f }); }
          if (pixels.length < w * h * (depth / 8)) throw bad(`The cel of layer ${layer} in frame ${f} is shorter than ${w}x${h}.`, { layer, frame: f });
          celsHere.push({ layer, frame: f, x, y, opacity: opacity / 255, z, width: w, height: h, pixels });
        } else if (celType === 3) notes.add('tilemap cels are not read');
      } else if (type === 0x2018) {
        const n = buf.readUInt16LE(d);
        let t = d + 10;
        for (let i = 0; i < n; i++) {
          const from = buf.readUInt16LE(t), to = buf.readUInt16LE(t + 2), dir = buf[t + 4], repeat = buf.readUInt16LE(t + 5);
          const nameLen = buf.readUInt16LE(t + 17);
          tags.push({ name: buf.toString('utf8', t + 19, t + 19 + nameLen), from, to, direction: DIRECTIONS[dir] ?? 'forward', repeat });
          t += 19 + nameLen;
        }
      } else if (type === 0x2019) {
        const total = buf.readUInt32LE(d), first = buf.readUInt32LE(d + 4), last = buf.readUInt32LE(d + 8);
        if (!newPalette) palette = [];
        newPalette = true;
        palette.length = Math.max(palette.length, total);
        let p = d + 20;
        for (let i = first; i <= last; i++) {
          const entry = buf.readUInt16LE(p);
          palette[i] = [buf[p + 2], buf[p + 3], buf[p + 4], buf[p + 5]];
          p += 6;
          if (entry & 1) p += 2 + buf.readUInt16LE(p);
        }
      } else if ((type === 0x0004 || type === 0x0011) && !newPalette) {
        const packets = buf.readUInt16LE(d);
        let p = d + 2, index = 0;
        for (let i = 0; i < packets; i++) {
          index += buf[p];
          const n = buf[p + 1] || 256;
          p += 2;
          for (let j = 0; j < n; j++, p += 3) {
            const k = type === 0x0011 ? v => Math.round(v * 255 / 63) : v => v;
            palette[index++] = [k(buf[p]), k(buf[p + 1]), k(buf[p + 2]), 255];
          }
        }
      }
      c += size;
    }
    // Indexed cels take the palette as it stands at the end of their frame.
    for (const cel of celsHere) rawCels.push(cel.pixels ? { ...cel, palette: depth === 8 ? palette.slice() : null } : cel);
    at = end;
  }
  if (!layers.length) throw bad('The file has no layers.');
  const toRgba = cel => {
    const n = cel.width * cel.height, out = new Uint8Array(n * 4), src = cel.pixels;
    const layer = layers[cel.layer];
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (depth === 32) { out[o] = src[o]; out[o + 1] = src[o + 1]; out[o + 2] = src[o + 2]; out[o + 3] = src[o + 3]; }
      else if (depth === 16) { const v = src[i * 2]; out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = src[i * 2 + 1]; }
      else {
        const index = src[i], c = cel.palette[index];
        if (!c || (index === transparent && !layer?.background)) continue;
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = c[3];
      }
    }
    return out;
  };
  const cels = [];
  const byKey = new Map();
  for (const cel of rawCels) if (cel.pixels) {
    const read = { layer: cel.layer, frame: cel.frame, x: cel.x, y: cel.y, opacity: cel.opacity, z: cel.z, width: cel.width, height: cel.height, data: toRgba(cel), linked: false };
    byKey.set(`${cel.layer}:${cel.frame}`, read);
    cels.push(read);
  }
  for (const cel of rawCels) if (!cel.pixels) {
    const source = byKey.get(`${cel.layer}:${cel.link}`);
    if (!source) { notes.add(`a linked cel of layer ${cel.layer} points at an empty frame`); continue; }
    cels.push({ ...source, frame: cel.frame, opacity: cel.opacity, z: cel.z, linked: true });
  }
  cels.sort((a, b) => a.frame - b.frame || a.layer - b.layer);
  if (cels.some(c => c.z)) notes.add('cel z-index (a cel drawn above or below its layer) is not kept: cels stay in their layer\'s order');
  for (const t of tags) if (t.from > t.to || t.to >= frameCount) throw bad(`The tag "${t.name}" runs from frame ${t.from} to ${t.to} of ${frameCount}.`, { tag: t.name });
  return { width, height, depth, frames, layers, cels, tags, palette: palette.filter(Boolean), notes: [...notes] };
}

const PART_NAME = /[^A-Za-z0-9_ .-]/g;

/** A layer name the rig accepts: letters, digits, space, _ . - (others become _), unique. */
function partNames(layers) {
  const used = new Set(['root']), out = new Map();
  for (const l of layers) {
    let base = l.name.replace(PART_NAME, '_').replace(/^ +/, '').slice(0, 60) || `layer${l.index}`;
    if (!/^[A-Za-z0-9_]/.test(base)) base = `_${base}`;
    let name = base, n = 2;
    while (used.has(name.toLowerCase())) name = `${base}_${n++}`;
    used.add(name.toLowerCase());
    out.set(l.index, name);
  }
  return out;
}

const hex2 = v => v.toString(16).padStart(2, '0');

/** A cel cut to its drawn pixels (a background or a cel saved at canvas size), or null when it draws nothing. */
function trimmed(cel) {
  const { width, height, data } = cel;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0 || !(cel.opacity > 0)) return null;
  if (x0 === 0 && y0 === 0 && x1 === width - 1 && y1 === height - 1) return cel;
  const w = x1 - x0 + 1, h = y1 - y0 + 1, out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(data.subarray(((y0 + y) * width + x0) * 4, ((y0 + y) * width + x0 + w) * 4), y * w * 4);
  return { ...cel, x: cel.x + x0, y: cel.y + y0, width: w, height: h, data: out };
}

/**
 * Pixels as SVG: one path per colour, made of rectangles (each row's runs, merged down while the
 * run below is the same), every corner on a whole pixel.
 * @param {{ width: number, height: number, data: Uint8Array }} img  straight RGBA
 * @param {number} ox @param {number} oy  where the image sits in the SVG's own space
 * @param {number} w @param {number} h    the SVG's own space
 * @param {number} alpha  multiplies every pixel's alpha (the layer's and the cel's opacity)
 */
export function pixelsToSvg(img, ox, oy, w, h, alpha = 1) {
  const { width, height, data } = img;
  const colorAt = (x, y) => {
    const o = (y * width + x) * 4, a = Math.round(data[o + 3] * alpha);
    return a ? (data[o] << 24 | data[o + 1] << 16 | data[o + 2] << 8 | a) >>> 0 : 0;
  };
  const paths = new Map();
  let open = new Map();                 // `${x},${w},${colour}` -> rectangle growing down
  const close = r => { if (!paths.has(r.c)) paths.set(r.c, []); paths.get(r.c).push(`M${r.x + ox} ${r.y + oy}h${r.w}v${r.h}h-${r.w}z`); };
  for (let y = 0; y < height; y++) {
    const next = new Map();
    for (let x = 0; x < width;) {
      const c = colorAt(x, y);
      let e = x + 1;
      while (e < width && colorAt(e, y) === c) e++;
      if (c) {
        const key = `${x},${e - x},${c}`;
        const r = open.get(key);
        if (r) { r.h++; open.delete(key); next.set(key, r); } else next.set(key, { x, y, w: e - x, h: 1, c });
      }
      x = e;
    }
    for (const r of open.values()) close(r);
    open = next;
  }
  for (const r of open.values()) close(r);
  let body = '';
  for (const [c, rects] of [...paths.entries()].sort((a, b) => a[0] - b[0])) {
    const rgb = `#${hex2(c >>> 24)}${hex2(c >>> 16 & 255)}${hex2(c >>> 8 & 255)}`, a = c & 255;
    body += `<path fill="${rgb}"${a < 255 ? ` fill-opacity="${Math.round(a / 255 * 1000) / 1000}"` : ''} d="${rects.join('')}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges">${body}</svg>`;
}

/** The frames a tag plays, in its direction (a ping-pong does not play its ends twice). */
export function tagFrames(tag) {
  const up = [];
  for (let f = tag.from; f <= tag.to; f++) up.push(f);
  const down = up.slice().reverse();
  if (tag.direction === 'reverse') return down;
  if (tag.direction === 'pingpong') return [...up, ...down.slice(1, -1)];
  if (tag.direction === 'pingpong-reverse') return [...down, ...up.slice(1, -1)];
  return up;
}

const t6 = v => Math.round(v * 1e6) / 1e6;

/**
 * A drawing from a read Aseprite file: the parts draw_rig builds and the clips its tags make.
 * @param {ReturnType<typeof readAseprite>} ase
 * @param {{ file?: string }} [options]  file: where it was read from, kept in each part's source
 * @returns {{ parts: object[], clips: Record<string, object>, skipped: string[], notes: string[], palette: string[] }}
 */
export function asepriteDrawing(ase, { file = '' } = {}) {
  const { width: W, height: H, layers } = ase;
  const skipped = [], notes = [...ase.notes];
  const shown = l => { for (let q = l; q; q = q.parent === null ? null : layers[q.parent]) if (!q.visible) return false; return true; };
  const groupOpacity = l => { let a = 1; for (let q = l.parent === null ? null : layers[l.parent]; q; q = q.parent === null ? null : layers[q.parent]) a *= q.opacity; return a; };
  const kept = [];
  for (const l of layers) {
    if (l.type === 'group') { if (l.blend && shown(l)) notes.push(`group "${l.name}": its ${BLEND_NAMES[l.blend] ?? l.blend} blend is not kept (its layers keep their own)`); continue; }
    if (l.type === 'tilemap') { skipped.push(`${l.name}: a tilemap layer`); continue; }
    if (l.reference) { skipped.push(`${l.name}: a reference layer`); continue; }
    if (!shown(l)) { skipped.push(`${l.name}: hidden`); continue; }
    const cels = ase.cels.filter(c => c.layer === l.index).map(trimmed).filter(Boolean);
    if (!cels.length) { skipped.push(`${l.name}: empty`); continue; }
    kept.push({ ...l, cels });
  }
  if (!kept.length) throw bad('The file has no visible layer with pixels.', { skipped });
  if (kept.length > 64) throw bad(`The file has ${kept.length} visible layers; a drawing has at most 64 parts (merge layers in Aseprite, or hide the ones not needed).`, { layers: kept.length });
  const names = partNames(kept);
  const frameCount = ase.frames.length;
  const parts = [], flip = new Map();
  for (const l of kept) {
    const name = names.get(l.index);
    const { cels } = l;
    // Distinct looks, in the order they first appear; every frame points at one or at none.
    const looks = [], indexOf = new Array(frameCount).fill(-1);
    const keyOf = c => `${c.x},${c.y},${c.width},${c.height},${c.opacity},${createHash('sha1').update(c.data).digest('hex')}`;
    const seen = new Map();
    for (const c of cels) {
      const key = keyOf(c);
      if (!seen.has(key)) { seen.set(key, looks.length); looks.push(c); }
      indexOf[c.frame] = seen.get(key);
    }
    if (looks.length > 64) throw bad(`Layer "${l.name}" has ${looks.length} different cels; a flipbook holds at most 64.`, { layer: l.name });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of looks) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x + c.width); y1 = Math.max(y1, c.y + c.height); }
    const bw = x1 - x0, bh = y1 - y0;
    const alpha = l.opacity * groupOpacity(l);
    const svgs = looks.map(c => pixelsToSvg(c, c.x - x0, c.y - y0, bw, bh, alpha * c.opacity));
    for (const [i, s] of svgs.entries()) if (s.length > 200000) throw bad(`Layer "${l.name}" (cel ${i + 1}) has too many colour runs for one part (${Math.round(s.length / 1000)} kB of SVG): split it into layers in Aseprite.`, { layer: l.name });
    const blend = BLENDS[l.blend];
    if (blend === undefined) notes.push(`${name}: the ${BLEND_NAMES[l.blend] ?? l.blend} blend draws as normal`);
    parts.push({ name, svg: svgs[0], at: [t6(x0 + bw / 2 - W / 2), t6(H - (y0 + bh / 2))],
      ...(svgs.length > 1 ? { frames: svgs } : {}), ...(blend ? { blend } : {}), ...(indexOf[0] < 0 ? { hidden: true } : {}),
      source: { aseprite: file, layer: l.name } });
    flip.set(name, { indexOf, frames: svgs.length });
  }

  // A clip per tag (or one for the whole timeline): the flipbooks step through their cels and a
  // layer with no cel in a frame is empty there; every timeline ends on the clip's last moment.
  const clips = {};
  const tags = ase.tags.length ? ase.tags : frameCount > 1 ? [{ name: 'all', from: 0, to: frameCount - 1, direction: 'forward', repeat: 0 }] : [];
  for (const tag of tags) {
    const order = tagFrames(tag);
    const starts = [];
    let time = 0;
    for (const f of order) { starts.push(t6(time)); time += ase.frames[f].duration; }
    const end = t6(time);
    const slots = {}, attachments = {};
    for (const p of parts) {
      const { indexOf, frames } = flip.get(p.name);
      const shownAt = order.map(f => indexOf[f] >= 0);
      if (shownAt.some(s => !s) || p.hidden) {
        const keys = [];
        shownAt.forEach((s, k) => { const name = s ? p.name : null; if (!keys.length || keys.at(-1).name !== name) keys.push({ time: starts[k], name }); });
        keys.push({ time: end, name: keys.at(-1).name });
        slots[p.name] = { attachment: keys };
      }
      if (frames > 1) {
        const keys = [];
        order.forEach((f, k) => { const index = indexOf[f]; if (index >= 0 && keys.at(-1)?.index !== index) keys.push({ time: starts[k], mode: 'hold', index }); });
        if (keys.length) {
          if (keys[0].time > 0) keys.unshift({ time: 0, mode: 'hold', index: keys[0].index });
          keys.push({ time: end, mode: 'hold', index: keys.at(-1).index });
          attachments[p.name] = { [p.name]: { sequence: keys } };
        }
      }
    }
    if (!Object.keys(slots).length && !Object.keys(attachments).length) {
      const p = parts.find(q => !q.hidden) ?? parts[0];
      slots[p.name] = { attachment: [{ time: 0, name: p.name }, { time: end, name: p.name }] };
    }
    const name = tag.name.trim() || `tag${Object.keys(clips).length + 1}`;
    if (clips[name]) notes.push(`tag "${name}" appears twice: the last one is kept`);
    clips[name] = { ...(Object.keys(slots).length ? { slots } : {}), ...(Object.keys(attachments).length ? { attachments: { default: attachments } } : {}) };
    if (tag.repeat > 1) notes.push(`tag "${name}" repeats ${tag.repeat} times in Aseprite; the clip is one pass (loop it in the player)`);
  }
  const palette = [...new Set(ase.palette.filter(c => c[3] > 0).map(c => c.slice(0, 3).map(hex2).join('')))];
  return { parts, clips, skipped, notes, palette };
}
