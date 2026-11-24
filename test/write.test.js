// Gate for src/deliver/write.js — the file half of the one-way rule, on real temp projects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeDelivery, prepareDelivery, commitDelivery, findSkeletons } from '../src/deliver/write.js';
import { list as listBackups } from '../src/core/backup.js';
import { parseSkeleton } from '../src/runtime/index.js';
import { isStudioError } from '../src/shared/errors.js';

const FIXTURE = new URL('./fixtures/ident/', import.meta.url);
const wave = boneName => ({ bones: { [boneName]: { rotate: [{ value: 0 }, { time: 1, value: 20 }] } } });

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-write-'));
  for (const ext of ['json', 'atlas']) fs.copyFileSync(new URL(`ident.${ext}`, FIXTURE), path.join(dir, `logo.${ext}`));
  // The page keeps the name the atlas gives it, as in a real export.
  fs.copyFileSync(new URL('ident.png', FIXTURE), path.join(dir, 'ident.png'));
  const base = JSON.parse(fs.readFileSync(path.join(dir, 'logo.json'), 'utf8'));
  return { dir, bone: base.bones[1].name, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel));

test('a first write creates logo_v2.json and its atlas, the base stays byte-identical', async () => {
  const p = project();
  try {
    const before = read(p.dir, 'logo.json');
    const result = await writeDelivery({ projectDir: p.dir, name: 'wave', animation: wave(p.bone) });
    assert.equal(result.file, 'logo_v2.json');
    assert.equal(result.created, true);
    assert.equal(result.backup, null);
    assert.deepEqual(result.atlas, { status: 'copied', file: 'logo_v2.atlas', backup: null });
    assert.ok(read(p.dir, 'logo.json').equals(before), 'the base is never written');
    assert.ok(read(p.dir, 'logo_v2.atlas').equals(read(p.dir, 'logo.atlas')));
    const delivered = JSON.parse(read(p.dir, 'logo_v2.json'));
    assert.equal(delivered._kfDelivery.base, 'logo.json');
    await parseSkeleton(delivered, { atlasText: read(p.dir, 'logo_v2.atlas').toString('utf8') });
    assert.equal(result.baseChosen.reason, 'only-skeleton');
  } finally { p.cleanup(); }
});

test('a second write accumulates, backs up the previous delivery, and the base is still the base', async () => {
  const p = project();
  try {
    await writeDelivery({ projectDir: p.dir, name: 'wave', animation: wave(p.bone) });
    const firstBytes = read(p.dir, 'logo_v2.json');
    const second = await writeDelivery({ projectDir: p.dir, name: 'nod', animation: wave(p.bone) });
    assert.equal(second.created, false);
    assert.ok(second.backup, 'the previous delivery was backed up');
    assert.equal(second.atlas.status, 'unchanged');
    const delivered = JSON.parse(read(p.dir, 'logo_v2.json'));
    assert.ok(delivered.animations.wave && delivered.animations.nod);
    const backups = listBackups(p.dir, 'logo_v2.json');
    assert.equal(backups.length, 1);
    assert.deepEqual(findSkeletons(p.dir).map(s => s.file), ['logo.json'], 'deliveries are never base candidates');
    assert.ok(firstBytes.length > 0);
  } finally { p.cleanup(); }
});

test('the base, an owner file, a delivery as base and another folder are refused before anything is written', async () => {
  const p = project();
  try {
    const animation = wave(p.bone);
    await assert.rejects(writeDelivery({ projectDir: p.dir, into: 'logo.json', name: 'w', animation }), err => isStudioError(err, 'base-protected'));
    if (process.platform === 'win32') {
      // Same file on a case-insensitive file system: still the base.
      await assert.rejects(writeDelivery({ projectDir: p.dir, into: 'LOGO.JSON', name: 'w', animation }), err => isStudioError(err, 'base-protected'));
    }
    fs.writeFileSync(path.join(p.dir, 'owner.json'), JSON.stringify({ skeleton: { spine: '4.2.43' }, bones: [{ name: 'root' }] }));
    await assert.rejects(writeDelivery({ projectDir: p.dir, from: 'logo.json', into: 'owner.json', name: 'w', animation }),
      err => isStudioError(err, 'target-not-delivery'));
    fs.mkdirSync(path.join(p.dir, 'out'));
    await assert.rejects(writeDelivery({ projectDir: p.dir, from: 'logo.json', into: 'out/x.json', name: 'w', animation }),
      err => isStudioError(err, 'delivery-folder'));
    await assert.rejects(writeDelivery({ projectDir: p.dir, from: 'logo.json', into: '../escape.json', name: 'w', animation }),
      err => isStudioError(err, 'outside-project'));
    await writeDelivery({ projectDir: p.dir, from: 'logo.json', name: 'w', animation });
    await assert.rejects(writeDelivery({ projectDir: p.dir, from: 'logo_v2.json', name: 'w', animation }),
      err => isStudioError(err, 'base-is-delivery') && err.details.base === 'logo.json');
    assert.ok(!fs.existsSync(path.join(p.dir, 'out', 'x.json')));
  } finally { p.cleanup(); }
});

test('a change between reading and writing is caught and nothing is written', async () => {
  const p = project();
  try {
    const plan = await prepareDelivery({ projectDir: p.dir, name: 'wave', animation: wave(p.bone) });
    const base = JSON.parse(read(p.dir, 'logo.json'));
    base.skeleton.hash = 'owner re-exported';
    fs.writeFileSync(path.join(p.dir, 'logo.json'), JSON.stringify(base));
    assert.throws(() => commitDelivery(plan), err => isStudioError(err, 'changed-during-write'));
    assert.ok(!fs.existsSync(path.join(p.dir, 'logo_v2.json')));

    const fresh = await prepareDelivery({ projectDir: p.dir, name: 'wave', animation: wave(p.bone) });
    fs.writeFileSync(path.join(p.dir, 'logo_v2.json'), JSON.stringify({ _kfDelivery: {}, skeleton: {}, bones: [] }));
    assert.throws(() => commitDelivery(fresh), err => isStudioError(err, 'changed-during-write'), 'a target created meanwhile counts too');
  } finally { p.cleanup(); }
});

test('a refused composition writes nothing at all', async () => {
  const p = project();
  try {
    await assert.rejects(writeDelivery({ projectDir: p.dir, name: 'bad', animation: { bones: { ghost: { rotate: [{ value: 1 }] } } } }),
      err => isStudioError(err, 'delivery-refused'));
    assert.deepEqual(fs.readdirSync(p.dir).sort(), ['ident.png', 'logo.atlas', 'logo.json']);
  } finally { p.cleanup(); }
});
