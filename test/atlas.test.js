// Gate for src/understand/atlas.js: the official parser, plain numbers out.
// Values ported from legacy test_read_atlas.js (one plain region, one rotated and trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readAtlas } from '../src/understand/atlas.js';
import { isStudioError } from '../src/shared/errors.js';

// Legacy 4.0-style atlas: indented region fields, explicit rotate/orig/offset.
const LEGACY_STYLE = 'base.png\nsize:64,64\nformat:RGBA8888\nfilter:Linear,Linear\npma: true\n'
  + 'plain\n  rotate: false\n  xy: 2, 4\n  size: 10, 20\n  orig: 10, 20\n  offset: 0, 0\n  index: -1\n'
  + 'turned\n  rotate: true\n  xy: 20, 4\n  size: 8, 6\n  orig: 12, 10\n  offset: 1, 2\n  index: -1\n';

// 4.1+ short form: bounds and offsets, rotate in degrees, no pma line.
const SHORT_FORM = 'sheet.png\nsize:128,64\nfilter:Linear,Linear\n'
  + 'plain\nbounds:2,4,10,20\n'
  + 'turned\nbounds:20,4,8,6\noffsets:1,2,12,10\nrotate:90\n';

const byName = atlas => Object.fromEntries(atlas.regions.map(r => [r.name, r]));

test('a 4.0-style atlas: page header and both regions, number for number', async () => {
  const atlas = await readAtlas(LEGACY_STYLE);
  assert.equal(atlas.pages.length, 1);
  assert.deepEqual(
    { name: atlas.pages[0].name, width: atlas.pages[0].width, height: atlas.pages[0].height, pma: atlas.pages[0].pma },
    { name: 'base.png', width: 64, height: 64, pma: true });
  const r = byName(atlas);
  assert.deepEqual(
    [r.plain.page, r.plain.x, r.plain.y, r.plain.width, r.plain.height, r.plain.degrees,
      r.plain.offsetX, r.plain.offsetY, r.plain.originalWidth, r.plain.originalHeight],
    ['base.png', 2, 4, 10, 20, 0, 0, 0, 10, 20]);
  assert.deepEqual(
    [r.turned.x, r.turned.y, r.turned.width, r.turned.height, r.turned.degrees,
      r.turned.offsetX, r.turned.offsetY, r.turned.originalWidth, r.turned.originalHeight],
    [20, 4, 8, 6, 90, 1, 2, 12, 10]);
});

test('the 4.1 short form reads to the same geometry', async () => {
  const short = byName(await readAtlas(SHORT_FORM));
  const legacy = byName(await readAtlas(LEGACY_STYLE));
  for (const name of ['plain', 'turned']) {
    for (const field of ['x', 'y', 'width', 'height', 'degrees', 'offsetX', 'offsetY', 'originalWidth', 'originalHeight']) {
      assert.equal(short[name][field], legacy[name][field], `${name}.${field}`);
    }
  }
  const atlas = await readAtlas(SHORT_FORM);
  assert.equal(atlas.pages[0].pma, false, 'no pma line means straight alpha');
  assert.equal(atlas.pages[0].width, 128);
});

test('a real exported atlas lists every region the skeleton uses', async () => {
  const text = fs.readFileSync(new URL('./fixtures/ident/ident.atlas', import.meta.url), 'utf8');
  const json = JSON.parse(fs.readFileSync(new URL('./fixtures/ident/ident.json', import.meta.url), 'utf8'));
  const atlas = await readAtlas(text);
  const names = new Set(atlas.regions.map(r => r.name));
  for (const skin of json.skins) {
    for (const attachments of Object.values(skin.attachments)) {
      for (const [key, a] of Object.entries(attachments)) assert.ok(names.has(a.path ?? key), `region for ${a.path ?? key}`);
    }
  }
  for (const r of atlas.regions) {
    const page = atlas.pages.find(p => p.name === r.page);
    const [w, h] = r.degrees % 180 ? [r.height, r.width] : [r.width, r.height];
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + w <= page.width && r.y + h <= page.height, `${r.name} lies inside its page`);
  }
});

test('non-text input is refused with a code', async () => {
  await assert.rejects(readAtlas(undefined), err => isStudioError(err, 'bad-argument'));
  await assert.rejects(readAtlas(42), err => isStudioError(err, 'bad-argument'));
});
