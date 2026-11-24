// The kit writes every clip through the studio's own tools (the same wire an agent uses), never
// by editing the delivery JSON: write_animation validates, composes and backs up; check_skeleton,
// critique_animation and see_animation prove the result.
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../../src/mcp/server.js';
import { encodePng } from '../../src/render/png.js';
import { renderFrames, filmstrip } from '../../src/render/frames.js';
import { readAtlas as readAtlasPages } from '../../src/understand/atlas.js';
import { decodePng } from '../../src/render/png.js';

export const FPS = 30;
/** Snap seconds to the 30 fps grid. */
export const f = t => +(Math.round(t * FPS) / FPS).toFixed(4);
/** Frames to seconds. */
export const fr = n => +(n / FPS).toFixed(4);

/** Call one studio tool in the project folder `dir`; returns its structured answer. */
export async function tool(dir, name, args = {}) {
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'kit', all: true, write: m => sent.push(m) });
  await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const reply = sent.find(m => m.id === 1);
  if (reply.error) throw new Error(`${name}: ${reply.error.message}`);
  const result = reply.result;
  if (result.isError) throw new Error(`${name} refused: ${JSON.stringify(result.structuredContent?.error ?? result.content).slice(0, 2000)}`);
  const image = (result.content ?? []).find(c => c.type === 'image');
  return { ...(result.structuredContent ?? {}), ...(image ? { png: Buffer.from(image.data, 'base64') } : {}) };
}

/** Start a fresh delivery: drop the old one and the studio's working folders. */
export function fresh(dir, name) {
  for (const file of [name + '_v2.json', name + '_v2.atlas']) fs.rmSync(path.join(dir, file), { force: true });
  clean(dir);
}
/** Remove what the studio keeps beside a project (backups, chat), so the example folder stays clean. */
export function clean(dir) {
  for (const folder of ['.backup', '.keyframe']) fs.rmSync(path.join(dir, folder), { recursive: true, force: true });
}

/** Write one clip (replacing it) into <name>_v2.json. */
export async function write(dir, name, animation, clip) {
  const r = await tool(dir, 'write_animation', { animation, from: name + '.json', replace: true, clip });
  return r;
}

/** Render a filmstrip of one clip to `out` with the studio's headless renderer. */
export async function filmstripOf(dir, file, animation, times, out, { width = 200, height = 200, columns = times.length, viewport, skin } = {}) {
  const json = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const atlasFile = path.join(dir, file.replace(/\.json$/, '.atlas'));
  const atlasText = fs.readFileSync(atlasFile, 'utf8');
  const pages = Object.fromEntries((await readAtlasPages(atlasText)).pages.map(p => [p.name, decodePng(fs.readFileSync(path.join(dir, p.name)))]));
  const { frames } = await renderFrames({ json, atlasText, pages, animation, times, width, height, viewport, skin, background: { r: 0.106, g: 0.094, b: 0.149, a: 1 } });
  const strip = filmstrip(frames.map(x => x.image), { columns, gap: 4, background: { r: 0.25, g: 0.24, b: 0.3, a: 1 } });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, encodePng(strip));
  return out;
}

/** The card preview: one frame at 480 x 360 on the studio's stage colour. */
export async function preview(dir, file, animation, time, viewport, skin) {
  const out = path.join(dir, 'preview.png');
  const json = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const atlasText = fs.readFileSync(path.join(dir, file.replace(/\.json$/, '.atlas')), 'utf8');
  const pages = Object.fromEntries((await readAtlasPages(atlasText)).pages.map(p => [p.name, decodePng(fs.readFileSync(path.join(dir, p.name)))]));
  const { frames } = await renderFrames({ json, atlasText, pages, animation, times: [time], width: 480, height: 360, viewport, skin, background: { r: 0.063, g: 0.055, b: 0.09, a: 1 } });
  fs.writeFileSync(out, encodePng(frames[0].image));
  return out;
}

/** Check the delivery and critique every clip the brief lists; throws on a fatal or a warning. */
export async function prove(dir, name, brief) {
  const file = name + '_v2.json';
  const check = await tool(dir, 'check_skeleton', { file });
  const fatal = (check.findings ?? []).filter(x => x.level === 'fatal');
  const problems = fatal.map(x => `check: ${x.code} ${x.where} ${x.message}`);
  const sk = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const { critiqueAnimation } = await import('../../src/understand/critique.js');
  for (const clip of brief.clips) {
    if (!sk.animations[clip.name]) { problems.push(`${clip.name}: missing`); continue; }
    const c = critiqueAnimation(sk, clip.name, { loop: clip.loop, pixelsPerUnit: brief.display.pixelsPerUnit });
    for (const x of c.findings.filter(x => x.level === 'warn')) problems.push(`${clip.name}: ${x.code} ${x.message}`);
  }
  console.log(`${name}: ${Object.keys(sk.animations).length} clips, check ${check.summary ?? ''}`);
  if (problems.length) throw new Error(`${name} is not done:\n  ${problems.join('\n  ')}`);
}
