// Gate for src/deliver/transform.js — one write model for whole-skeleton tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeTransform } from '../src/deliver/transform.js';
import { writeDelivery } from '../src/deliver/write.js';
import { isStudioError } from '../src/shared/errors.js';

const FIXTURE = new URL('./fixtures/ident/', import.meta.url);
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-transform-'));
  for (const ext of ['json', 'atlas']) fs.copyFileSync(new URL(`ident.${ext}`, FIXTURE), path.join(dir, `logo.${ext}`));
  fs.copyFileSync(new URL('ident.png', FIXTURE), path.join(dir, 'ident.png'));
  const base = JSON.parse(fs.readFileSync(path.join(dir, 'logo.json'), 'utf8'));
  return { dir, base, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const readJson = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
const renameFirstClip = sk => {
  const [first] = Object.keys(sk.animations);
  sk.animations.renamed = sk.animations[first];
  delete sk.animations[first];
  return { skeleton: sk, report: { renamed: first } };
};

test('a base source becomes a new delivery; the base is untouched', async () => {
  const p = project();
  try {
    const before = fs.readFileSync(path.join(p.dir, 'logo.json'));
    const result = await writeTransform({ projectDir: p.dir, transform: renameFirstClip });
    assert.equal(result.file, 'logo_v2.json');
    assert.equal(result.inPlace, false);
    assert.equal(result.renamed, Object.keys(p.base.animations)[0]);
    assert.ok(fs.readFileSync(path.join(p.dir, 'logo.json')).equals(before));
    assert.equal(readJson(p.dir, 'logo_v2.json')._kfDelivery.base, 'logo.json');
    assert.equal(result.atlas.status, 'copied');
  } finally { p.cleanup(); }
});

test('a delivery source is transformed in place, backed up, accumulated work kept', async () => {
  const p = project();
  try {
    const bone = p.base.bones[1].name;
    await writeDelivery({ projectDir: p.dir, name: 'wave', animation: { bones: { [bone]: { rotate: [{ value: 0 }, { time: 1, value: 10 }] } } } });
    const result = await writeTransform({ projectDir: p.dir, file: 'logo_v2.json', transform: sk => {
      sk.animations.copy = structuredClone(sk.animations.wave);
      return { skeleton: sk };
    } });
    assert.equal(result.inPlace, true);
    assert.ok(result.backup);
    const delivered = readJson(p.dir, 'logo_v2.json');
    assert.ok(delivered.animations.wave && delivered.animations.copy);
    assert.equal(delivered._kfDelivery.base, 'logo.json');
  } finally { p.cleanup(); }
});

test('transforming the base while a delivery exists is refused, so its work is not discarded', async () => {
  const p = project();
  try {
    await writeTransform({ projectDir: p.dir, transform: renameFirstClip });
    await assert.rejects(writeTransform({ projectDir: p.dir, file: 'logo.json', transform: renameFirstClip }),
      err => isStudioError(err, 'delivery-exists') && err.details.delivery === 'logo_v2.json');
    const other = await writeTransform({ projectDir: p.dir, file: 'logo.json', into: 'logo_alt.json', transform: renameFirstClip });
    assert.equal(other.file, 'logo_alt.json');
    await assert.rejects(writeTransform({ projectDir: p.dir, file: 'logo_v2.json', into: 'x.json', transform: renameFirstClip }),
      err => isStudioError(err, 'bad-argument'));
  } finally { p.cleanup(); }
});

test('a transform that breaks the skeleton writes nothing', async () => {
  const p = project();
  try {
    await assert.rejects(writeTransform({ projectDir: p.dir, transform: sk => { sk.slots[0].bone = 'ghost'; return { skeleton: sk }; } }),
      err => isStudioError(err, 'delivery-refused') && err.details.findings.some(f => f.code === 'slot-bone'));
    assert.ok(!fs.existsSync(path.join(p.dir, 'logo_v2.json')));
    await assert.rejects(writeTransform({ projectDir: p.dir, into: 'logo.json', transform: renameFirstClip }), err => isStudioError(err, 'base-protected'));
  } finally { p.cleanup(); }
});
