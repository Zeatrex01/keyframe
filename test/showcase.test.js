// examples/showcase: every example folder carries its brief, its README, a 480 x 360 preview, the
// base rig with its atlas and page, the delivery, and its own gate in test/example-<name>.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../src/render/png.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOWCASE = path.join(ROOT, 'examples', 'showcase');
const names = fs.readdirSync(SHOWCASE, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();

test('the showcase holds the five examples the Examples page lists', () => {
  assert.deepEqual(names, ['chest', 'coin-burst', 'mika', 'pip', 'play-button']);
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
    for (const left of fs.readdirSync(dir)) assert.ok(!['.backup', '.keyframe'].includes(left), `${name}/${left} is a working folder the build should have removed`);
  });
}
