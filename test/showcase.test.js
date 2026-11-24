// examples/showcase: every example folder carries its brief, its README, a 480 x 360 preview, the
// base rig with its atlas and page, the delivery, and its own gate in test/example-<name>.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { decodePng } from '../src/render/png.js';
import { copyExample } from '../src/server/examples.js';
import { critiqueAnimationTool } from '../src/mcp/tools/understand.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOWCASE = path.join(ROOT, 'examples', 'showcase');
const names = fs.readdirSync(SHOWCASE, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();

test('the showcase holds the examples the Examples page lists', () => {
  assert.deepEqual(names, ['chest', 'coin-burst', 'mika', 'pip', 'play-button', 'warrior']);
});

for (const name of names) {
  test(`showcase ${name}: brief, README, preview, rig, delivery and gate are all there`, () => {
    const dir = path.join(SHOWCASE, name);
    for (const file of ['brief.json', 'README.md', 'preview.png', `${name}.json`, `${name}.atlas`, `${name}.png`, `${name}_v2.json`, `${name}_v2.atlas`]) {
      assert.ok(fs.existsSync(path.join(dir, file)), `${name}/${file} is missing`);
    }
    const brief = JSON.parse(fs.readFileSync(path.join(dir, 'brief.json'), 'utf8'));
    assert.equal(brief.name, name);
    for (const key of ['subject', 'intent']) assert.ok(typeof brief[key] === 'string' && brief[key].length > 10, `brief.${key}`);
    assert.ok(['character', 'prop', 'ui', 'effect'].includes(brief.principles), `brief.principles is ${brief.principles}`);
    assert.ok(brief.display.width > 0 && brief.display.pixelsPerUnit > 0, 'brief.display');
    assert.ok(brief.clips.length >= 2 && brief.clips.every(c => c.name && c.seconds > 0 && typeof c.loop === 'boolean'), 'brief.clips');
    const preview = decodePng(fs.readFileSync(path.join(dir, 'preview.png')));
    assert.deepEqual([preview.width, preview.height], [480, 360]);
    assert.ok(fs.existsSync(path.join(ROOT, 'test', `example-${name}.test.js`)), `test/example-${name}.test.js is missing`);
    assert.ok(!fs.existsSync(path.join(dir, '.backup')), `${name}/.backup is a working folder the build should have removed`);
    assert.deepEqual(fs.readdirSync(path.join(dir, '.keyframe')), ['brief.json'], `${name}/.keyframe keeps only the confirmed brief`);
  });

  test(`showcase ${name}: opened as a project, the studio judges every clip as the build did (no warning, none mechanical)`, async (t) => {
    const samples = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-showcase-'));
    t.after(() => fs.rmSync(samples, { recursive: true, force: true }));
    const copy = copyExample({ name, dir: path.join(SHOWCASE, name) }, samples);
    const sk = JSON.parse(fs.readFileSync(path.join(copy, `${name}_v2.json`), 'utf8'));
    for (const clip of Object.keys(sk.animations)) {
      const out = await critiqueAnimationTool.run({ file: `${name}_v2.json`, animation: clip }, { session: { dir: copy, writable: () => true } });
      assert.ok(['good', 'unmeasured'].includes(out.verdict), `${name} ${clip}: ${out.verdict}`);
      const warns = out.findings.filter((/** @type {any} */ f) => f.level === 'warn').map((/** @type {any} */ f) => f.code);
      assert.deepEqual(warns, [], `${name} ${clip} warns`);
    }
  });
}
