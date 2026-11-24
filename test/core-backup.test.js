// Gate for src/core/backup.js: every write is reversible, not just the last one.
// Ported from the backup assertions of legacy test_silme.js (1c: restoring the OLDEST of a
// saturated chain), test_player_animation_delivery.js (Unicode identities, NFC/NFD, case
// aliases, colliding marker-less history, the history junction), test_rigid_bind.js and
// test_rig_edit.js (oldest generation restores exact bytes; restore is undoable),
// test_browser_save_security.js (an unsafe history root receives nothing).
// Plus the decision of 2026-10-28: generations are written under `.backup/` and the
// legacy roots are read as aliases. Real temporary folders, cleaned up after each case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  KEEP, MARKER, historyRoots, normalizeRel, identityRel, slugOf, readableSlugOf, hashedSlugOf, isReadableLossless,
  dirFor, snapshot, snapshotBytes, snapshotBytesDeferred, list, hasExactHistory, restore,
} from '../src/core/backup.js';
import { PROJECT_FOLDERS } from '../src/core/paths.js';
import { isStudioError } from '../src/shared/errors.js';

const LINK = process.platform === 'win32' ? 'junction' : 'dir';
const day = i => new Date(Date.UTC(2026, 0, 1 + i));

function scratch() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-backup-'));
  const project = path.join(temp, 'project');
  const outside = path.join(temp, 'outside');
  fs.mkdirSync(project);
  fs.mkdirSync(outside);
  return { temp, project, outside, done: () => fs.rmSync(temp, { recursive: true, force: true }) };
}

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
const read = file => fs.readFileSync(file, 'utf8');
const refusedWith = code => err => isStudioError(err, code);
const tree = dir => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).sort() : []);
// Seed an exact history folder by hand, as a legacy studio would have left it.
function seedExact(dir, rel, generations) {
  write(path.join(dir, MARKER), JSON.stringify({ path: rel }));
  for (const [name, text] of Object.entries(generations)) write(path.join(dir, name), text);
}

test('generations are written under .backup/<slug>/ with an exact identity marker', () => {
  const s = scratch();
  try {
    const f = write(path.join(s.project, 'exports', 'game.json'), '{"gen":1}');
    assert.equal(historyRoots(s.project)[0], path.join(s.project, PROJECT_FOLDERS.backup.name));
    const stamp = snapshot(s.project, f, 'exports/game.json', day(0));
    assert.equal(stamp, '2026-01-01T00-00-00-000Z');
    const dir = dirFor(s.project, 'exports/game.json');
    assert.equal(path.dirname(dir), path.join(s.project, '.backup'));
    assert.equal(read(path.join(dir, stamp + '.json')), '{"gen":1}', 'exact bytes from before the write');
    assert.deepEqual(JSON.parse(read(path.join(dir, MARKER))), { path: 'exports/game.json' });
    for (const legacy of PROJECT_FOLDERS.backup.legacy) {
      assert.equal(fs.existsSync(path.join(s.project, legacy)), false, `nothing is written under ${legacy}`);
    }
    const [entry] = list(s.project, 'exports/game.json');
    assert.equal(entry.backup, stamp);
    assert.equal(entry.file, stamp + '.json');
    assert.equal(entry.size, 9);
    assert.match(entry.time, /^\d{4}-\d\d-\d\dT/);
    assert.equal(hasExactHistory(s.project, 'exports/game.json'), true);
  } finally { s.done(); }
});

test('a brand new file has nothing to snapshot', () => {
  const s = scratch();
  try {
    assert.equal(snapshot(s.project, path.join(s.project, 'fresh.json'), 'fresh.json'), null);
    assert.equal(fs.existsSync(path.join(s.project, '.backup')), false);
    assert.deepEqual(list(s.project, 'fresh.json'), []);
    assert.equal(hasExactHistory(s.project, 'fresh.json'), false);
  } finally { s.done(); }
});

test('restoring the OLDEST generation of a saturated chain does not delete it', () => {
  // restore() snapshots the current state before copying the chosen generation back, and
  // snapshot prunes this same folder to KEEP. At the steady state the pruned one is the
  // oldest, which is exactly what "take me back to the first version" asks for. Measured
  // in legacy 2026-08-20: ENOENT, the generation gone, the live file untouched, and each
  // retry ate the next one. The old gate filled two generations, not KEEP, and never saw it.
  const s = scratch();
  try {
    const f = write(path.join(s.project, 'rig.json'), JSON.stringify({ gen: -1 }));
    for (let i = 0; i < KEEP; i++) {
      write(f, JSON.stringify({ gen: i }));
      snapshot(s.project, f, 'rig.json', day(i));
    }
    const chain = list(s.project, 'rig.json');
    assert.equal(chain.length, KEEP, 'saturated chain');
    assert.ok(chain[0].backup > chain[1].backup, 'newest first');
    const oldest = chain.at(-1).backup;
    write(f, JSON.stringify({ gen: 'now' }));
    const r = restore(s.project, f, 'rig.json', oldest);
    assert.equal(r.restored, oldest);
    assert.equal(read(f), JSON.stringify({ gen: 0 }), 'the live file really is that generation');
    assert.ok(list(s.project, 'rig.json').some(x => x.backup === r.previousState), 'the restore itself is in the chain');
    // Restore is undoable: the previous state brings back the exact bytes before the restore.
    const redo = restore(s.project, f, 'rig.json', r.previousState);
    assert.equal(redo.restored, r.previousState);
    assert.equal(read(f), JSON.stringify({ gen: 'now' }));
  } finally { s.done(); }
});

test('a restore may name the generation file as well as its stamp', () => {
  const s = scratch();
  try {
    const f = write(path.join(s.project, 'rig.json'), 'one');
    const stamp = snapshot(s.project, f, 'rig.json', day(0));
    write(f, 'two');
    assert.equal(restore(s.project, f, 'rig.json', stamp + '.json').restored, stamp);
    assert.equal(read(f), 'one');
  } finally { s.done(); }
});

test('pruning keeps the KEEP newest generations', () => {
  const s = scratch();
  try {
    const f = write(path.join(s.project, 'rig.json'), '');
    for (let i = 0; i < KEEP + 3; i++) { write(f, String(i)); snapshot(s.project, f, 'rig.json', day(i)); }
    const chain = list(s.project, 'rig.json');
    assert.equal(chain.length, KEEP);
    assert.equal(chain[0].backup, day(KEEP + 2).toISOString().replace(/[:.]/g, '-'));
    assert.equal(chain.at(-1).backup, day(3).toISOString().replace(/[:.]/g, '-'), 'the three oldest are gone');
    assert.deepEqual(fs.readdirSync(dirFor(s.project, 'rig.json')).filter(n => n.startsWith('.')), [MARKER], 'no staging debris');
  } finally { s.done(); }
});

test('same-millisecond generations are ordered by their suffix, numerically', () => {
  // Legacy sorted names as strings: `Z-1.json` sorts before `Z.json` and `-10` before `-2`,
  // so the newer generation was listed as older and pruned first.
  const s = scratch();
  try {
    const f = write(path.join(s.project, 'rig.json'), '');
    const stamps = [];
    for (let i = 0; i < 12; i++) { write(f, `v${i}`); stamps.push(snapshot(s.project, f, 'rig.json', day(0))); }
    assert.equal(stamps[1], stamps[0] + '-1');
    assert.equal(stamps[11], stamps[0] + '-11');
    assert.deepEqual(list(s.project, 'rig.json').map(x => x.backup), [...stamps].reverse(), 'newest first, -11 before -2');
    write(f, 'now');
    restore(s.project, f, 'rig.json', list(s.project, 'rig.json')[0].backup);
    assert.equal(read(f), 'v11', 'list()[0] really is the last write');
  } finally { s.done(); }
});

test('pruning a same-millisecond chain drops the oldest, not the newest', () => {
  const s = scratch();
  try {
    const f = write(path.join(s.project, 'rig.json'), '');
    const stamps = [];
    for (let i = 0; i < KEEP + 1; i++) { write(f, `v${i}`); stamps.push(snapshot(s.project, f, 'rig.json', day(0))); }
    const kept = list(s.project, 'rig.json').map(x => x.backup);
    assert.equal(kept.length, KEEP);
    assert.ok(!kept.includes(stamps[0]), 'the first one is pruned');
    assert.equal(kept[0], stamps.at(-1), 'the latest survives');
  } finally { s.done(); }
});

test('Unicode full-path identities get separate collision-resistant folders', () => {
  const s = scratch();
  try {
    const a = 'rig_\u015e.json';
    const b = 'rig_\u00d6.json';
    const fa = write(path.join(s.project, a), '{"which":"S"}');
    const fb = write(path.join(s.project, b), '{"which":"O"}');
    assert.ok(snapshot(s.project, fa, a, day(0)));
    assert.ok(snapshot(s.project, fb, b, day(1)));
    assert.notEqual(dirFor(s.project, a), dirFor(s.project, b));
    assert.equal(list(s.project, a).length, 1);
    assert.equal(list(s.project, b).length, 1);
    assert.equal(path.basename(dirFor(s.project, a)), hashedSlugOf(a));
    assert.match(hashedSlugOf(a), new RegExp('^rig_\u015e\\.json--[0-9a-f]{64}$'), 'readable prefix keeps the letter');
  } finally { s.done(); }
});

test('NFC and NFD spellings are different identities', () => {
  const nfc = 'rig_\u015e\u00f6len.json';
  const nfd = nfc.normalize('NFD');
  assert.notEqual(nfc, nfd);
  assert.notEqual(slugOf(nfd), slugOf(nfc));
  assert.notEqual(hashedSlugOf(nfd), hashedSlugOf(nfc));
});

test('a dotted capital I and i + combining dot never merge, though case folding would', () => {
  const s = scratch();
  try {
    const dottedA = '\u0130.json';
    const dottedB = 'i\u0307.json';
    const fa = write(path.join(s.project, dottedA), '{"which":"capital-dotted"}');
    const fb = write(path.join(s.project, dottedB), '{"which":"decomposed-lower"}');
    assert.ok(snapshot(s.project, fa, dottedA, day(2)));
    assert.ok(snapshot(s.project, fb, dottedB, day(3)));
    // macOS (APFS, case-insensitive) folds the two names to one file; there the filesystem says they
    // are the same file, so one history is right (the case-alias rule below). Elsewhere they never merge.
    if (fs.statSync(fa).ino === fs.statSync(fb).ino) {
      assert.equal(list(s.project, dottedA).length, 2, 'one file, one history');
      assert.equal(list(s.project, dottedB).length, 2);
      return;
    }
    assert.notEqual(dirFor(s.project, dottedA), dirFor(s.project, dottedB));
    assert.equal(list(s.project, dottedA).length, 1);
    assert.equal(list(s.project, dottedB).length, 1);
  } finally { s.done(); }
});

test('a case alias finds the same history exactly where the filesystem says it is the same file', () => {
  const s = scratch();
  try {
    const rel = 'rig_\u015e.json';
    const f = write(path.join(s.project, rel), '{}');
    snapshot(s.project, f, rel, day(0));
    const alias = rel.toUpperCase();
    const sameFile = fs.existsSync(path.join(s.project, alias));
    assert.equal(identityRel(s.project, alias), sameFile ? rel : alias);
    assert.equal(list(s.project, alias).length, sameFile ? 1 : 0, sameFile ? 'case-insensitive filesystem' : 'case-sensitive filesystem');
  } finally { s.done(); }
});

test('colliding marker-less legacy history can neither list nor restore', () => {
  const s = scratch();
  try {
    const a = 'rig_\u015e.json';
    write(path.join(s.project, a), '{}');
    for (const root of historyRoots(s.project)) write(path.join(root, readableSlugOf(a), '2020.json'), '{}');
    assert.equal(hasExactHistory(s.project, a), false);
    assert.deepEqual(list(s.project, a), []);
    assert.throws(() => restore(s.project, path.join(s.project, a), a, '2020'), refusedWith('no-history'));
  } finally { s.done(); }
});

test('a readable folder holding marker-less generations is not claimed: new snapshots go to the hashed folder', () => {
  const s = scratch();
  try {
    assert.equal(isReadableLossless('rig.json'), true);
    assert.equal(slugOf('rig.json'), 'rig.json');
    const readable = path.join(s.project, '.backup', 'rig.json');
    write(path.join(readable, '2020.json'), 'ambiguous');
    const f = write(path.join(s.project, 'rig.json'), 'mine');
    const stamp = snapshot(s.project, f, 'rig.json', day(0));
    assert.equal(dirFor(s.project, 'rig.json'), path.join(s.project, '.backup', hashedSlugOf('rig.json')));
    assert.deepEqual(list(s.project, 'rig.json').map(x => x.backup), [stamp], 'the ambiguous generation is not offered');
    assert.equal(fs.existsSync(path.join(readable, MARKER)), false, 'the old folder is not stamped as ours');
  } finally { s.done(); }
});

test('a lossy path is never readable; a lossless one needs no underscore', () => {
  assert.equal(isReadableLossless('exports/game.json'), true);
  assert.equal(slugOf('exports/game.json'), 'exports__game.json');
  assert.equal(isReadableLossless('my_rig.json'), false, 'an underscore would collide with a folder separator');
  assert.equal(isReadableLossless('rig \u015e.json'), false);
  assert.equal(isReadableLossless(''), false);
  assert.equal(normalizeRel('./a\\b.json'), 'a/b.json');
  assert.equal(normalizeRel('/a/b.json'), 'a/b.json');
});

test('a marker naming another file is not this file\'s history, and is not written into', () => {
  const s = scratch();
  try {
    const dir = path.join(s.project, '.backup', 'rig.json');
    seedExact(dir, 'other.json', { '2020-01-01T00-00-00-000Z.json': 'theirs' });
    const f = write(path.join(s.project, 'rig.json'), 'mine');
    assert.equal(hasExactHistory(s.project, 'rig.json'), false);
    const stamp = snapshot(s.project, f, 'rig.json', day(0));
    assert.ok(stamp, 'written elsewhere');
    assert.notEqual(dirFor(s.project, 'rig.json'), dir);
    assert.deepEqual(tree(dir), [MARKER, '2020-01-01T00-00-00-000Z.json']);
  } finally { s.done(); }
});

test('a history root that is a junction to the outside receives nothing', () => {
  const s = scratch();
  try {
    const f = write(path.join(s.project, 'guarded.json'), 'old');
    fs.symlinkSync(s.outside, path.join(s.project, '.backup'), LINK);
    // Not even a folder created and removed again: the root is judged BEFORE any mkdir,
    // and a directory's modification time moves on every entry added or removed.
    const past = new Date('2020-01-01T00:00:00Z');
    fs.utimesSync(s.outside, past, past);
    assert.equal(snapshot(s.project, f, 'guarded.json', day(0)), null, 'a failed backup is null, never a throw');
    assert.equal(snapshotBytes(s.project, Buffer.from('x'), 'guarded.json'), null);
    assert.equal(snapshotBytesDeferred(s.project, Buffer.from('x'), 'guarded.json'), null);
    assert.deepEqual(fs.readdirSync(s.outside), [], 'no outside-project artifact');
    assert.equal(fs.statSync(s.outside).mtimeMs, past.getTime(), 'the outside folder was not touched at all');
    assert.equal(read(f), 'old');
  } finally { s.done(); }
});

test('a per-file history folder that is a junction to the outside receives nothing', () => {
  const s = scratch();
  try {
    const f = write(path.join(s.project, 'rig.json'), 'old');
    fs.mkdirSync(path.join(s.project, '.backup'));
    fs.symlinkSync(s.outside, dirFor(s.project, 'rig.json'), LINK);
    assert.equal(snapshot(s.project, f, 'rig.json', day(0)), null);
    assert.deepEqual(fs.readdirSync(s.outside), [], 'not even the marker');
    assert.equal(hasExactHistory(s.project, 'rig.json'), false);
  } finally { s.done(); }
});

test('a legacy history root that leads outside is not read', () => {
  const s = scratch();
  try {
    const f = write(path.join(s.project, 'rig.json'), 'live');
    seedExact(path.join(s.outside, 'rig.json'), 'rig.json', { '2020-01-01T00-00-00-000Z.json': 'outside bytes' });
    fs.mkdirSync(path.join(s.project, 'studio'));
    fs.symlinkSync(s.outside, path.join(s.project, PROJECT_FOLDERS.backup.legacy[0]), LINK);
    assert.deepEqual(list(s.project, 'rig.json'), []);
    assert.throws(() => restore(s.project, f, 'rig.json', '2020-01-01T00-00-00-000Z'), refusedWith('no-history'));
    assert.equal(read(f), 'live');
  } finally { s.done(); }
});

test('restore never writes through a link to the outside', () => {
  // Legacy restore wrote wherever the absolute path pointed.
  const s = scratch();
  try {
    const victim = write(path.join(s.outside, 'victim.json'), 'outside-safe');
    fs.symlinkSync(s.outside, path.join(s.project, 'link'), LINK);
    const through = path.join(s.project, 'link', 'victim.json');
    // A generation exists under that identity (snapshot only READ through the link).
    const stamp = snapshot(s.project, through, 'link/victim.json', day(0));
    assert.ok(stamp);
    assert.equal(list(s.project, 'link/victim.json').length, 1);
    assert.throws(() => restore(s.project, through, 'link/victim.json', stamp), refusedWith('outside-project'));
    assert.equal(read(victim), 'outside-safe');
  } finally { s.done(); }
});

test('restore refusals carry stable codes', () => {
  const s = scratch();
  try {
    const f = write(path.join(s.project, 'rig.json'), 'a');
    assert.throws(() => restore(s.project, f, 'rig.json', 'x'), err => refusedWith('no-history')(err) && err.details.file === 'rig.json');
    const stamp = snapshot(s.project, f, 'rig.json', day(0));
    assert.throws(() => restore(s.project, f, 'rig.json', 'nope'),
      err => refusedWith('no-such-backup')(err) && err.details.available.join() === stamp);
    assert.equal(read(f), 'a', 'a refusal writes nothing');
  } finally { s.done(); }
});

test('restore recreates a deleted file and its folder', () => {
  const s = scratch();
  try {
    const f = write(path.join(s.project, 'exports', 'game.json'), 'kept');
    const stamp = snapshot(s.project, f, 'exports/game.json', day(0));
    fs.rmSync(path.join(s.project, 'exports'), { recursive: true });
    const r = restore(s.project, f, 'exports/game.json', stamp);
    assert.equal(read(f), 'kept');
    assert.equal(r.previousState, null, 'nothing to snapshot before');
  } finally { s.done(); }
});

test('a write failure during restore is refused with write-failed', () => {
  const s = scratch();
  try {
    const f = write(path.join(s.project, 'rig.json'), 'a');
    const stamp = snapshot(s.project, f, 'rig.json', day(0));
    fs.rmSync(f);
    fs.mkdirSync(f); // a folder where the file was: the write cannot land
    assert.throws(() => restore(s.project, f, 'rig.json', stamp), refusedWith('write-failed'));
  } finally { s.done(); }
});

test('snapshotBytes seeds a delivery\'s trail without creating the delivery', () => {
  const s = scratch();
  try {
    const stamp = snapshotBytes(s.project, Buffer.from('source state'), './exports\\new.json', '.json', day(0));
    assert.ok(stamp);
    assert.equal(fs.existsSync(path.join(s.project, 'exports', 'new.json')), false);
    assert.equal(read(path.join(dirFor(s.project, 'exports/new.json'), stamp + '.json')), 'source state');
    assert.equal(hasExactHistory(s.project, 'exports/new.json'), true, 'identity is the normalized target path');
    assert.equal(fs.existsSync(path.join(s.project, 'exports')), false, 'not even its folder');
    const skel = snapshotBytes(s.project, new Uint8Array([1, 2]), 'rig.skel', '.skel', day(0));
    assert.ok(fs.existsSync(path.join(dirFor(s.project, 'rig.skel'), skel + '.skel')));
    const odd = snapshotBytes(s.project, 'text', 'odd.bin', '../evil', day(0));
    assert.ok(fs.existsSync(path.join(dirFor(s.project, 'odd.bin'), odd + '.json')), 'an unsafe extension falls back to .json');
    const none = snapshotBytes(s.project, 'text', 'none.bin', undefined, day(0));
    assert.ok(fs.existsSync(path.join(dirFor(s.project, 'none.bin'), none + '.json')));
  } finally { s.done(); }
});

test('a deferred snapshot prunes only on commit', () => {
  const s = scratch();
  try {
    for (let i = 0; i < KEEP; i++) snapshotBytes(s.project, String(i), 'game.json', '.json', day(i));
    const pending = snapshotBytesDeferred(s.project, 'next', 'game.json', '.json', day(KEEP));
    assert.equal(fs.readdirSync(dirFor(s.project, 'game.json')).filter(n => !n.startsWith('.')).length, KEEP + 1,
      'durable before the caller publishes, nothing pruned yet');
    assert.equal(list(s.project, 'game.json')[0].backup, pending.stamp);
    assert.equal(pending.commit(), pending.stamp);
    assert.equal(list(s.project, 'game.json').length, KEEP);
    assert.equal(pending.commit(), null, 'closed');
    assert.equal(pending.rollback(), false, 'a committed generation is not rolled back');
  } finally { s.done(); }
});

test('a deferred rollback removes the generation and only what was created for it', () => {
  const s = scratch();
  try {
    const fresh = snapshotBytesDeferred(s.project, 'x', 'fresh.json', '.json', day(0));
    assert.equal(hasExactHistory(s.project, 'fresh.json'), true);
    assert.equal(fresh.rollback(), true);
    assert.equal(fs.existsSync(dirFor(s.project, 'fresh.json')), false, 'folder and marker made for it are gone');
    assert.equal(hasExactHistory(s.project, 'fresh.json'), false);
    assert.equal(fresh.rollback(), false);
    assert.equal(fresh.commit(), null);

    const kept = snapshotBytes(s.project, 'kept', 'game.json', '.json', day(0));
    const failed = snapshotBytesDeferred(s.project, 'failed', 'game.json', '.json', day(1));
    assert.equal(failed.rollback(), true);
    assert.deepEqual(list(s.project, 'game.json').map(x => x.backup), [kept], 'an existing trail is left exactly as it was');
  } finally { s.done(); }
});

for (const [index, legacyRoot] of PROJECT_FOLDERS.backup.legacy.entries()) {
  test(`legacy root ${index + 1} is read as an alias, never written or pruned`, () => {
    const s = scratch();
    try {
      const f = write(path.join(s.project, 'rig.json'), 'live');
      const legacyDir = path.join(s.project, legacyRoot, slugOf('rig.json'));
      const old = {};
      for (let i = 0; i < KEEP + 2; i++) old[day(i).toISOString().replace(/[:.]/g, '-') + '.json'] = `legacy ${i}`;
      seedExact(legacyDir, 'rig.json', old);
      const before = tree(legacyDir);

      assert.equal(hasExactHistory(s.project, 'rig.json'), true, 'a trail the legacy studio left is ownership evidence');
      const chain = list(s.project, 'rig.json');
      assert.equal(chain.length, KEEP + 2, 'every legacy generation is offered');
      const oldest = chain.at(-1).backup;
      const r = restore(s.project, f, 'rig.json', oldest);
      assert.equal(read(f), 'legacy 0');
      assert.ok(fs.existsSync(path.join(dirFor(s.project, 'rig.json'), r.previousState + '.json')),
        'the state before the restore is written under .backup');
      assert.equal(path.dirname(dirFor(s.project, 'rig.json')), path.join(s.project, '.backup'));
      assert.deepEqual(tree(legacyDir), before, 'the legacy folder is untouched and unpruned');
      assert.equal(list(s.project, 'rig.json')[0].backup, r.previousState, 'new and legacy generations form one chain');
    } finally { s.done(); }
  });
}

test('a generation present in both roots is offered once, from .backup', () => {
  const s = scratch();
  try {
    const f = write(path.join(s.project, 'rig.json'), 'live');
    const name = '2020-01-01T00-00-00-000Z.json';
    seedExact(path.join(s.project, '.backup', 'rig.json'), 'rig.json', { [name]: 'new root' });
    seedExact(path.join(s.project, PROJECT_FOLDERS.backup.legacy[0], 'rig.json'), 'rig.json', { [name]: 'legacy root' });
    assert.equal(list(s.project, 'rig.json').length, 1);
    restore(s.project, f, 'rig.json', name);
    assert.equal(read(f), 'new root');
  } finally { s.done(); }
});
