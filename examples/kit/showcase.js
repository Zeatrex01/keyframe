// The last steps every showcase example shares: write the clips through the studio, prove them
// (check_skeleton, critique_animation with no warnings), write brief.json and README.md, render
// preview.png for the Examples card and a filmstrip of every clip into examples/kit/look/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { write, prove, preview, filmstripOf, clean } from './studio.js';

export const LOOK = fileURLToPath(new URL('./look/', import.meta.url));

/** White with alpha `a` (0..1), as an RGBA hex string. */
export const rgba = (a, rgb = 'ffffff') => rgb + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');

function readme(brief) {
  const rows = brief.clips.map(c => `| \`${c.name}\` | ${c.seconds} s${c.loop ? ', loop' : ''}${c.track ? `, track ${c.track}` : ''} | ${c.does} |`).join('\n');
  return `# ${brief.title}

${brief.subject}

${brief.intent}

Kind: ${brief.kind}. Shown at ${brief.display.width} px wide. Teaches: ${brief.teaches.join(', ')}.

| Clip | Length | What happens |
|---|---|---|
${rows}

Files: \`${brief.name}.json\` + \`.atlas\` + \`.png\` (the rig, no clips), \`${brief.name}_v2.json\` (the
delivery with the clips), \`brief.json\` (what was asked, for the studio and the gates), \`preview.png\`.
Rebuilt by \`examples/kit/${brief.name}.js\` (\`npm run examples\`); every clip was written through the
studio's own tools and passes \`check_skeleton\` and \`critique_animation\` with no warnings
(\`test/example-${brief.name}.test.js\`).
`;
}

/**
 * @param {string} dir the example folder  @param {string} name base name
 * @param {object} brief  @param {Record<string, object>} clips animation JSON per clip name
 */
export async function finish(dir, name, brief, clips, { viewport, skin, strip = {} } = {}) {
  for (const c of brief.clips) {
    if (!clips[c.name]) throw new Error(`${name}: the brief lists ${c.name} but no clip was written`);
    await write(dir, name, c.name, clips[c.name]);
  }
  await prove(dir, name, brief);
  fs.writeFileSync(path.join(dir, 'brief.json'), JSON.stringify(brief, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'README.md'), readme(brief));
  await preview(dir, name + '_v2.json', brief.preview.clip, brief.preview.time, brief.preview.viewport ?? viewport, skin);
  const strips = [];
  for (const c of brief.clips) {
    const n = Math.max(6, Math.min(12, Math.round(c.seconds * 10) + 1));
    const times = Array.from({ length: n }, (_, i) => +(c.seconds * i / (n - 1)).toFixed(4));
    const size = strip.width ?? 180;
    strips.push(await filmstripOf(dir, name + '_v2.json', c.name, times, path.join(LOOK, `${name}_${c.name}.png`),
      { width: size, height: Math.round(size / (strip.aspect ?? (viewport ? viewport.width / viewport.height : 1))), columns: Math.min(n, strip.columns ?? 6), viewport, skin }));
  }
  clean(dir);
  console.log(`${name}: ${brief.clips.length} clips proven; filmstrips in ${LOOK}`);
  return strips;
}
