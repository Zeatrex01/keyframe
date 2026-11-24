// The embeddable web player: keyframe-player.js, one script with the studio's engine, a
// KeyframePlayer class and a <keyframe-player> element, for web games and pages (no dependency,
// no build step). Beside it go the skeleton, its atlas and pages, and a small page showing the
// snippet and the API. Node-only (layer `deliver`).

import { bundleEngine } from './standalone.js';
import { defineKeyframePlayer } from './web-player-boot.js';

const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The script: a classic script (works from a <script> tag and from `import`); sets window.KeyframePlayer. */
export function webPlayerScript() {
  return `/* Keyframe Studio web player. MIT. API: KeyframePlayer.create(canvas, { skeleton, atlas, animation, loop, speed, autoplay, background }),
   player.play(name, { loop }), stop(), pause(), resume(), seek(s), setSpeed(x), setLook(slot, attachment), on('start'|'complete'|'loop'|'event', fn), destroy();
   element: <keyframe-player src="x.json" animation="idle" loop></keyframe-player> */
(function () {
${bundleEngine()}
const KeyframePlayer = (${defineKeyframePlayer.toString()})(__require);
if (typeof window !== 'undefined') window.KeyframePlayer = KeyframePlayer;
})();
`;
}

/**
 * The files of a web export.
 * @param {{ name: string, skeleton: object, atlasText: string, pages: Record<string, Uint8Array> }} input
 * @returns {Record<string, string | Uint8Array>}
 */
export function webPlayerFiles({ name, skeleton, atlasText, pages }) {
  const clips = Object.keys(skeleton.animations ?? {});
  const looks = (skeleton.skins?.[0] && Object.entries(skeleton.skins[0].attachments ?? {}).flatMap(([slot, atts]) => Object.keys(atts).filter(a => a !== slot).map(a => [slot, a]))) ?? [];
  const first = clips[0] ?? '';
  const demo = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Keyframe Studio">
<title>${escapeHtml(name)}</title>
<style>
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; background: #f4f3f8; color: #1d1b26; }
  main { max-width: 760px; margin: 0 auto; padding: 24px 16px; }
  keyframe-player { height: 360px; background: #262338; border-radius: 12px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
  button { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid #c9c5d8; background: #fff; cursor: pointer; }
  pre { background: #fff; border: 1px solid #e1dfea; border-radius: 8px; padding: 12px; overflow-x: auto; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(name)}</h1>
<keyframe-player id="player" src="${escapeHtml(name)}.json"${first ? ` animation="${escapeHtml(first)}"` : ''} loop></keyframe-player>
<div class="row" id="clips"></div>
<p>Put these files on any web server (or your game's assets folder) and add:</p>
<pre>&lt;script src="keyframe-player.js"&gt;&lt;/script&gt;
&lt;keyframe-player src="${escapeHtml(name)}.json" animation="${escapeHtml(first)}" loop&gt;&lt;/keyframe-player&gt;

// or from code, on your own canvas:
const player = await KeyframePlayer.create(canvas, { skeleton: '${escapeHtml(name)}.json', animation: '${escapeHtml(first)}', loop: true });
player.play('${escapeHtml(clips[1] ?? first)}', { loop: false });
player.on('complete', name =&gt; console.log('done', name));${looks[0] ? `\nplayer.setLook('${escapeHtml(looks[0][0])}', '${escapeHtml(looks[0][1])}');   // a drawn state` : ''}</pre>
<p>Clips: ${clips.map(escapeHtml).join(', ') || 'none'}. Pages opened straight from disk cannot load files; serve the folder (any static server).</p>
</main>
<script src="keyframe-player.js"></script>
<script>
  const el = document.getElementById('player'), row = document.getElementById('clips');
  for (const name of ${JSON.stringify(clips).replace(/</g, '\\u003c')}) {
    const b = document.createElement('button'); b.textContent = name;
    b.onclick = () => el.player?.play(name, { loop: false });
    row.append(b);
  }
</script>
</body>
</html>
`;
  return { 'keyframe-player.js': webPlayerScript(), [`${name}.json`]: `${JSON.stringify(skeleton)}\n`, [`${name}.atlas`]: atlasText, ...pages, 'index.html': demo };
}
