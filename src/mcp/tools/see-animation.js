// see_animation — the animation as an image, rendered headlessly from the real runtime.

import { projectOf } from '../project.js';
import { readAtlas } from '../../understand/atlas.js';
import { renderFrames, filmstrip } from '../../render/frames.js';
import { encodePng } from '../../render/png.js';
import { StudioError } from '../../shared/errors.js';

const DEFAULT_FRAMES = 6;
const durationOf = (data, name) => data?.findAnimation?.(name)?.duration ?? 0;

export default {
  name: 'see_animation',
  tier: 'core',
  writes: false,
  summary: 'A filmstrip PNG of the animation at chosen times, rendered headlessly without a browser.',
  description: 'Renders frames of one animation and returns ONE filmstrip PNG as the tool result, so you look at what you wrote. The studio\'s engine poses the skeleton (curves, IK, transform, path and physics constraints, skin-only bones, sequences, meshes, clipping, draw order); `then` and `layers` show a crossfade or a layer the way a game mixes them and a headless rasterizer draws it with the blend modes; no studio window or browser is involved. Frames are framed on the union of everything drawn across the requested times (so motion stays comparable between frames) unless `viewport` is given. Cost is roughly width x height / 750 tokens per frame; the default six 240 px frames cost a few hundred tokens and answer "who is in front, is the size right, how does the ease read" faster than numbers. Use sample_animation when you need exact values.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      file: { type: 'string', short: 'skeleton; empty = the folder base', description: 'Project-relative skeleton JSON; empty picks the folder\'s base skeleton.' },
      animation: { type: 'string', short: 'empty = the first animation', description: 'Animation name; empty renders the first one.' },
      times: { type: 'array', items: { type: 'number', minimum: 0 }, short: 'seconds; empty = 6 even steps', description: 'Instants in seconds; empty takes six evenly spaced times from 0 to the end.' },
      width: { type: 'integer', minimum: 64, maximum: 640, short: 'frame width px, 64 to 640 (default 240)', description: 'Width of each frame in pixels (64-640, default 240). This sets the token cost.' },
      aspect: { type: 'number', minimum: 0.2, maximum: 5, short: 'width / height (default 1.5)', description: 'Frame aspect ratio width / height (0.2-5, default 1.5).' },
      margin: { type: 'number', minimum: 0, maximum: 0.4, short: 'space around the subject (default 0.08)', description: 'Fraction of the frame kept free around the subject (0-0.4, default 0.08).' },
      columns: { type: 'integer', minimum: 1, maximum: 12, short: 'frames per row (default 3)', description: 'Frames per filmstrip row (1-12, default 3).' },
      skin: { type: 'string', short: 'skin name', description: 'Skin to show; empty uses the skeleton default.' },
      then: {
        type: 'object', additionalProperties: false, short: 'crossfade into a clip',
        description: 'Crossfade from `animation` into another clip at `at` seconds over `mix` seconds (default 0.2), to see a transition (idle into run) the way a game plays it. With `then` or `layers` the clip loops and the frames are posed on a 1/60 s grid.',
        properties: {
          animation: { type: 'string', short: 'clip', description: 'The clip to crossfade into.' },
          at: { type: 'number', minimum: 0, short: 's', description: 'When the crossfade starts, in seconds.' },
          mix: { type: 'number', minimum: 0, maximum: 5, short: 's', description: 'Crossfade length in seconds (default 0.2; 0 cuts).' },
        },
        required: ['animation', 'at'],
      },
      layers: {
        type: 'array', maxItems: 4, short: 'clips played over it',
        description: 'Clips played over `animation` on tracks 1 and up, to see a layer as a game plays it (an upper-body punch over a run): what a layer keys wins by its `alpha`, the rest keeps playing; `add` adds its offsets instead. A layer plays once from `at` unless `loop`.',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            animation: { type: 'string', short: 'clip', description: 'The layer clip.' },
            at: { type: 'number', minimum: 0, short: 's', description: 'When it starts, in seconds (default 0).' },
            alpha: { type: 'number', minimum: 0, maximum: 1, short: '0-1', description: 'How much it wins (default 1).' },
            add: { type: 'boolean', short: 'additive', description: 'Additive: its offsets from the setup pose are added on top.' },
            loop: { type: 'boolean', short: 'loop', description: 'Loop it instead of playing once.' },
            mix: { type: 'number', minimum: 0, maximum: 5, short: 'fade-in s', description: 'Fade-in seconds (default 0).' },
          },
          required: ['animation'],
        },
      },
      viewport: {
        type: 'object', short: 'world box {x, y, width, height}',
        description: 'Fixed world-space box to frame instead of the automatic union of everything drawn.',
        properties: {
          x: { type: 'number', description: 'Left edge in world units (the skeleton\'s own units, y up).' },
          y: { type: 'number', description: 'Bottom edge in world units (y up).' },
          width: { type: 'number', minimum: 0.001, description: 'Width in world units.' },
          height: { type: 'number', minimum: 0.001, description: 'Height in world units.' },
        },
        required: ['x', 'y', 'width', 'height'],
      },
    },
  },
  async run({ file, animation, times, width = 240, aspect = 1.5, margin = 0.08, columns = 3, skin, viewport, then, layers }, { session }) {
    const project = projectOf(session);
    const { sk, rel, abs } = project.skeleton(file);
    const names = Object.keys(sk.animations ?? {});
    if (!names.length) throw new StudioError('no-animation', `${rel} has no animations to show.`, { file: rel });
    const name = animation ?? names[0];
    if (!names.includes(name)) throw new StudioError('unknown-animation', `No animation named "${name}" in ${rel}.`, { animation: name, available: names });
    const atlas = project.atlasFor(abs);
    if (!atlas) throw new StudioError('no-atlas', `${rel} has no paired .atlas beside it, so there is nothing to draw with. Export with an atlas from Spine.`, { file: rel });
    const pages = project.pagesFor(atlas, (await readAtlas(atlas.text)).pages.map(p => p.name));

    for (const clip of [then?.animation, ...(layers ?? []).map(l => l.animation)].filter(Boolean)) {
      if (!names.includes(clip)) throw new StudioError('unknown-animation', `No animation named "${clip}" in ${rel}.`, { animation: clip, available: names });
    }
    const mixing = !!(then || layers?.length);
    let instants = times;
    if (!instants?.length) {
      const { parseSkeleton } = await import('../../runtime/index.js');
      const parsedFor = await parseSkeleton(sk);
      // A mix is seen up to the end of whatever plays last.
      const ends = [durationOf(parsedFor, name), ...(then ? [then.at + (then.mix ?? 0.2) + durationOf(parsedFor, then.animation)] : []),
        ...(layers ?? []).map(l => (l.at ?? 0) + durationOf(parsedFor, l.animation))];
      const duration = mixing ? Math.max(...ends) : ends[0];
      instants = Array.from({ length: DEFAULT_FRAMES }, (_, i) => +(duration * i / (DEFAULT_FRAMES - 1)).toFixed(4));
    }
    const { parseSkeleton, limitsNote } = await import('../../runtime/index.js');
    const parsed = await parseSkeleton(sk);
    const length = durationOf(parsed, name);
    const limits = limitsNote(parsed);
    const pastEnd = mixing ? [] : instants.filter(t => t > length + 1e-6);
    const height = Math.max(32, Math.round(width / aspect));
    const { frames, viewport: framed } = await renderFrames({ json: sk, atlasText: atlas.text, pages, animation: name, times: instants,
      width, height, margin, viewport, skin, background: { r: 0.13, g: 0.14, b: 0.17, a: 1 }, ...(mixing ? { mix: { then, layers } } : {}) });
    const strip = filmstrip(frames.map(f => f.image), { columns, gap: 4, background: { r: 0.35, g: 0.35, b: 0.38, a: 1 } });
    return {
      image: { data: Buffer.from(encodePng(strip)).toString('base64'), mimeType: 'image/png' },
      meta: { file: rel, animation: name, duration: +length.toFixed(4), times: instants, frame: { width, height }, columns, viewport: framed,
        ...(mixing ? { mix: { ...(then ? { then } : {}), ...(layers?.length ? { layers } : {}), note: 'Played from 0 on the studio\'s mixer, the clip looping; frames on the 1/60 s grid.' } } : {}),
        ...(limits ? { notEvaluated: limits } : {}),
        ...(pastEnd.length ? { warning: `${pastEnd.join(', ')} s is past the end of the clip (${+length.toFixed(4)} s); those frames show the last pose.` } : {}),
        note: 'Frames run left to right, top to bottom, at the listed times; a lighter cell after the last frame is empty. Spine is y-up; the image is drawn upright. The automatic viewport is the union of what these frames draw: pass the returned viewport back to compare two renders.' },
    };
  },
};
