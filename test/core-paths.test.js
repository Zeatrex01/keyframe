// Gate for src/core/paths.js: path containment, skeleton resolution, the protected-base
// rule of the one-way rule, and the project folder aliases.
// Ported from the paths assertions of legacy test_player_animation_delivery.js (lexical
// traversal, junction parent, colliding legacy history), test_silme.js section 10 (the
// one-way rule with the delivery in another folder) and the live-project rule of
// test_roots.js. Real temporary folders, cleaned up after each case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PROJECT_FOLDERS, projectFolders, insideProject, isRealInside, insideProjectReal, baseCandidates,
  chooseSkeleton, resolveSkeletonPath, readSkeletonFile, openSkeleton, protectedBases, isProtectedBase,
} from '../src/core/paths.js';
import { snapshot, hasExactHistory, historyRoots, readableSlugOf } from '../src/core/backup.js';
import { isStudioError } from '../src/shared/errors.js';
import { LEGACY_BACKUP_ROOTS, LEGACY_REFERENCE_FOLDER } from '../src/shared/legacy-names.js';

const LINK = process.platform === 'win32' ? 'junction' : 'dir';
const SKELETON = JSON.stringify({ skeleton: { spine: '4.2.43', hash: 'h' }, bones: [{ name: 'root' }] });

function scratch() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-paths-'));
  const project = path.join(temp, 'project');
  const outside = path.join(temp, 'outside');
  fs.mkdirSync(project);
  fs.mkdirSync(outside);
  return { temp, project, outside, get: () => project, done: () => fs.rmSync(temp, { recursive: true, force: true }) };
}

const write = (file, text = SKELETON) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
const refusedWith = code => err => isStudioError(err, code);
const files = (...names) => names.map(file => ({ file }));

// ── containment ──

test('a path inside the project resolves; the empty path is the project itself', () => {
  const s = scratch();
  try {
    assert.equal(insideProject(s.get, 'a/b.json'), path.join(s.project, 'a', 'b.json'));
    assert.equal(insideProject(s.get, ''), s.project);
    assert.equal(insideProject(s.get, undefined), s.project);
    assert.equal(insideProject(s.get, '..foo.json'), path.join(s.project, '..foo.json'), 'a name starting with two dots is not a parent');
    assert.equal(insideProject(s.get, path.join(s.project, 'x.json')), path.join(s.project, 'x.json'), 'an absolute path inside is accepted');
  } finally { s.done(); }
});

test('lexical traversal is refused with outside-project', () => {
  const s = scratch();
  try {
    for (const rel of ['..', '../escaped.json', 'a/../../escaped.json', '../project-evil/x.json', './../x.json']) {
      assert.throws(() => insideProject(s.get, rel), err => refusedWith('outside-project')(err) && err.details.path === rel, rel);
    }
  } finally { s.done(); }
});

test('an absolute path outside the project is refused, not clamped', () => {
  const s = scratch();
  try {
    assert.throws(() => insideProject(s.get, path.join(s.outside, 'victim.json')), refusedWith('outside-project'));
    assert.throws(() => insideProject(s.get, path.parse(s.project).root), refusedWith('outside-project'));
  } finally { s.done(); }
});

test('Windows drive letters and backslashes', () => {
  const s = scratch();
  try {
    if (process.platform === 'win32') {
      const other = s.project[0].toUpperCase() === 'Z' ? 'Y' : 'Z';
      assert.throws(() => insideProject(s.get, `${other}:\\victim.json`), refusedWith('outside-project'), 'another drive');
      assert.throws(() => insideProject(s.get, `${other}:victim.json`), refusedWith('outside-project'), 'drive-relative');
      assert.throws(() => insideProject(s.get, `${s.project[0]}:\\Windows\\victim.json`), refusedWith('outside-project'), 'same drive, elsewhere');
      assert.throws(() => insideProject(s.get, 'a\\..\\..\\victim.json'), refusedWith('outside-project'), 'backslash traversal');
      assert.equal(insideProject(s.get, 'a\\b.json'), path.join(s.project, 'a', 'b.json'));
    } else {
      // On POSIX a drive prefix and a backslash are ordinary name characters: still inside.
      assert.equal(insideProject(s.get, 'C:\\x.json'), path.join(s.project, 'C:\\x.json'));
      assert.equal(insideProject(s.get, 'a\\..\\..\\x.json'), path.join(s.project, 'a\\..\\..\\x.json'));
    }
  } finally { s.done(); }
});

test('a project directory given with a trailing separator or forward slashes still works', () => {
  // Legacy compared against the raw string and refused every path for such a project.
  const s = scratch();
  try {
    const expected = path.join(s.project, 'rig.json');
    assert.equal(insideProject(() => s.project + path.sep, 'rig.json'), expected);
    assert.equal(insideProject(() => s.project.replace(/\\/g, '/') + '/', 'rig.json'), expected);
    assert.throws(() => insideProject(() => s.project + path.sep, '../x.json'), refusedWith('outside-project'));
  } finally { s.done(); }
});

test('NFC and NFD names are kept exactly as given, never normalized', () => {
  const s = scratch();
  try {
    const nfc = 'caf\u00e9.json';
    const nfd = nfc.normalize('NFD');
    assert.notEqual(nfc, nfd);
    assert.equal(insideProject(s.get, nfc), path.join(s.project, nfc));
    assert.equal(insideProject(s.get, nfd), path.join(s.project, nfd));
    assert.throws(() => insideProject(s.get, '../' + nfd), refusedWith('outside-project'));
  } finally { s.done(); }
});

test('the project directory is read live: a mid-session switch moves every resolution', () => {
  const s = scratch();
  try {
    const a = path.join(s.temp, 'A');
    const b = path.join(s.temp, 'B');
    write(path.join(a, 'rig.json'));
    write(path.join(b, 'rig.json'));
    let current = a;
    const get = () => current;
    assert.equal(resolveSkeletonPath(get, 'rig').abs, path.join(a, 'rig.json'));
    current = b;
    assert.equal(resolveSkeletonPath(get, 'rig').abs, path.join(b, 'rig.json'));
    assert.equal(insideProject(get, 'x.json'), path.join(b, 'x.json'));
    assert.equal(openSkeleton(get, 'rig.json').abs, path.join(b, 'rig.json'));
  } finally { s.done(); }
});

test('a junction or symlink parent cannot carry a path outside the project', () => {
  const s = scratch();
  try {
    const link = path.join(s.project, 'outside_link');
    fs.symlinkSync(s.outside, link, LINK);
    write(path.join(s.outside, 'victim.json'), 'outside-safe');
    // Lexically inside, really outside: existing file, new file, and the link itself.
    assert.equal(insideProject(s.get, 'outside_link/victim.json'), path.join(link, 'victim.json'));
    for (const rel of ['outside_link/victim.json', 'outside_link/escaped.json', 'outside_link', 'outside_link/new/deep.json']) {
      assert.equal(isRealInside(s.project, path.join(s.project, rel)), false, rel);
      assert.throws(() => insideProjectReal(s.get, rel), err => refusedWith('outside-project')(err) && err.details.link === true, rel);
    }
    assert.equal(fs.readFileSync(path.join(s.outside, 'victim.json'), 'utf8'), 'outside-safe');
  } finally { s.done(); }
});

test('real containment accepts new and nested files, and a project reached through a link', () => {
  const s = scratch();
  try {
    write(path.join(s.project, 'exports', 'game.json'));
    assert.equal(isRealInside(s.project, path.join(s.project, 'exports', 'game.json')), true);
    assert.equal(isRealInside(s.project, path.join(s.project, 'exports', 'new', 'deep.json')), true, 'not created yet');
    assert.equal(insideProjectReal(s.get, 'fresh.json'), path.join(s.project, 'fresh.json'));
    // A link INSIDE the project to another place inside is fine.
    fs.symlinkSync(path.join(s.project, 'exports'), path.join(s.project, 'alias'), LINK);
    assert.equal(isRealInside(s.project, path.join(s.project, 'alias', 'game.json')), true);
    // The project itself opened through a link: both sides resolve to the same real folder.
    const viaLink = path.join(s.temp, 'project_link');
    fs.symlinkSync(s.project, viaLink, LINK);
    assert.equal(isRealInside(viaLink, path.join(viaLink, 'exports', 'game.json')), true);
    assert.equal(isRealInside(s.project, path.join(s.outside, 'x.json')), false);
    assert.equal(isRealInside(path.join(s.temp, 'missing-project'), path.join(s.project, 'x.json')), false, 'no project, no containment');
  } finally { s.done(); }
});

// ── project folders: new names written, legacy names read ──

test('folders are written under the new names; legacy names are read as aliases', () => {
  const s = scratch();
  try {
    assert.equal(PROJECT_FOLDERS.backup.name, '.backup');
    assert.equal(PROJECT_FOLDERS.reference.name, 'reference');
    // The legacy spellings come from the one sanctioned home of legacy names.
    assert.deepEqual(PROJECT_FOLDERS.backup.legacy, LEGACY_BACKUP_ROOTS);
    assert.ok(LEGACY_BACKUP_ROOTS.includes('studio/history'), 'where legacy backup.js actually wrote');
    assert.deepEqual(PROJECT_FOLDERS.reference.legacy, [LEGACY_REFERENCE_FOLDER]);
    for (const kind of ['backup', 'reference']) {
      assert.ok(!PROJECT_FOLDERS[kind].legacy.includes(PROJECT_FOLDERS[kind].name), `${kind}: the write name is not a legacy name`);
    }

    for (const kind of ['backup', 'reference']) {
      const { name, legacy } = PROJECT_FOLDERS[kind];
      assert.deepEqual(projectFolders(s.project, kind), { write: path.join(s.project, name), read: [] }, `${kind}: nothing yet`);
      fs.mkdirSync(path.join(s.project, legacy.at(-1)), { recursive: true });
      assert.deepEqual(projectFolders(s.project, kind),
        { write: path.join(s.project, name), read: [path.join(s.project, legacy.at(-1))] }, `${kind}: an old project opens`);
      fs.mkdirSync(path.join(s.project, name));
      assert.deepEqual(projectFolders(s.project, kind).read, [path.join(s.project, name), path.join(s.project, legacy.at(-1))],
        `${kind}: the new name is read first`);
      assert.equal(projectFolders(s.project, kind).write, path.join(s.project, name), `${kind}: a legacy folder is never written`);
    }
    assert.throws(() => projectFolders(s.project, 'scenes'), refusedWith('unknown-folder'));
  } finally { s.done(); }
});

test('a legacy name that is a file, not a folder, is not read', () => {
  const s = scratch();
  try {
    write(path.join(s.project, PROJECT_FOLDERS.reference.legacy[0]), 'a file');
    assert.deepEqual(projectFolders(s.project, 'reference').read, []);
  } finally { s.done(); }
});

// ── choosing a skeleton ──

test('chooseSkeleton: none, one, the base, or no guess', () => {
  assert.throws(() => chooseSkeleton([]), refusedWith('no-skeleton'));
  assert.deepEqual(chooseSkeleton(files('rig.json')), { file: 'rig.json', reason: 'only-skeleton', why: 'the only skeleton in the folder' });
  const base = chooseSkeleton(files('rig_v2.json', 'rig.json', 'rig_v3.json'));
  assert.equal(base.file, 'rig.json');
  assert.equal(base.reason, 'base-file');
  assert.match(base.why, /rig_v2\.json, rig_v3\.json/);
  assert.throws(() => chooseSkeleton(files('hero.json', 'villain.json')),
    err => refusedWith('ambiguous-skeleton')(err) && err.details.candidates.join() === 'hero.json,villain.json');
});

test('the base is chosen by NAME, the same rule protectedBases uses', () => {
  // Legacy chooseSkeleton compared whole paths ("b/rig_v2" never starts with "a/rig") while
  // protectedBases compared names; both claimed to be the same rule.
  assert.equal(chooseSkeleton(files('a/rig.json', 'b/rig_v2.json')).file, 'a/rig.json');
  assert.deepEqual(baseCandidates(['exports\\rig_jump.json', 'scenes/rig.json']), ['scenes/rig.json'], 'backslashes are separators');
  assert.throws(() => chooseSkeleton(files('rig.json', 'old/rig.json')), refusedWith('ambiguous-skeleton'), 'two files with the same name');
  assert.equal(chooseSkeleton(files('RIG.JSON', 'RIG_v2.json')).file, 'RIG.JSON', 'the extension is matched without case');
});

// ── resolving and reading ──

test('the .json extension is optional, and a miss names both attempts', () => {
  const s = scratch();
  try {
    write(path.join(s.project, 'rig.json'));
    assert.deepEqual(resolveSkeletonPath(s.get, 'rig'), { rel: 'rig.json', abs: path.join(s.project, 'rig.json') });
    assert.deepEqual(resolveSkeletonPath(s.get, 'rig.json'), { rel: 'rig.json', abs: path.join(s.project, 'rig.json') });
    assert.throws(() => resolveSkeletonPath(s.get, 'ghost'),
      err => refusedWith('file-not-found')(err) && err.details.tried.join() === 'ghost,ghost.json' && /also tried: ghost\.json/.test(err.message));
    assert.throws(() => resolveSkeletonPath(s.get, 'ghost.json'),
      err => refusedWith('file-not-found')(err) && err.details.tried.join() === 'ghost.json');
    assert.throws(() => resolveSkeletonPath(s.get, '../outside.json'), refusedWith('outside-project'));
    assert.throws(() => resolveSkeletonPath(s.get, '../outside'), refusedWith('outside-project'));
  } finally { s.done(); }
});

test('a folder is never resolved as the skeleton', () => {
  // Legacy accepted anything that existed: `rig` resolved to a folder named rig.
  const s = scratch();
  try {
    write(path.join(s.project, 'rig.json'));
    fs.mkdirSync(path.join(s.project, 'rig'));
    assert.equal(resolveSkeletonPath(s.get, 'rig').rel, 'rig.json');
    assert.throws(() => resolveSkeletonPath(s.get, ''), refusedWith('file-not-found'), 'the project folder itself');
    fs.mkdirSync(path.join(s.project, 'dir.json'));
    assert.throws(() => resolveSkeletonPath(s.get, 'dir.json'), refusedWith('file-not-found'));
  } finally { s.done(); }
});

test('reading names the file when the JSON is broken or is not a skeleton', () => {
  const s = scratch();
  try {
    const cut = write(path.join(s.project, 'cut.json'), SKELETON.slice(0, 30));
    assert.throws(() => readSkeletonFile('cut.json', cut),
      err => refusedWith('not-json')(err) && err.message.includes('"cut.json"') && err.details.file === 'cut.json' && !!err.details.reason);
    for (const [name, text] of [['plain.json', '{"a":1}'], ['null.json', 'null'], ['list.json', '[]'], ['str.json', '"x"'],
      ['bones.json', '{"bones":{}}']]) {
      const abs = write(path.join(s.project, name), text);
      assert.throws(() => readSkeletonFile(name, abs), err => refusedWith('not-skeleton')(err) && err.message.includes(name), name);
    }
    assert.deepEqual(readSkeletonFile('ok.json', write(path.join(s.project, 'ok.json'))).bones, [{ name: 'root' }]);
  } finally { s.done(); }
});

test('openSkeleton: explicit path, or the folder\'s own with the reason, and the onRead hook', () => {
  const s = scratch();
  try {
    write(path.join(s.project, 'rig.json'));
    write(path.join(s.project, 'rig_v2.json'));
    const explicit = openSkeleton(s.get, 'rig_v2');
    assert.equal(explicit.rel, 'rig_v2.json');
    assert.equal('autoChosen' in explicit, false);
    const reads = [];
    const auto = openSkeleton(s.get, undefined, {
      findSkeletons: dir => { assert.equal(dir, s.project); return files('rig_v2.json', 'rig.json'); },
      onRead: (dir, rel, sk) => reads.push([dir, rel, sk.bones.length]),
    });
    assert.equal(auto.rel, 'rig.json');
    assert.equal(auto.abs, path.join(s.project, 'rig.json'));
    assert.equal(auto.autoChosen.reason, 'base-file');
    assert.deepEqual(reads, [[s.project, 'rig.json', 1]]);
    const single = openSkeleton(s.get, undefined, { findSkeletons: () => files('rig_v2.json') });
    assert.equal(single.autoChosen.reason, 'only-skeleton');
  } finally { s.done(); }
});

test('history is a convenience: a failing onRead or scanner never fails the real work', () => {
  const s = scratch();
  try {
    write(path.join(s.project, 'rig.json'));
    const r = openSkeleton(s.get, 'rig.json', { onRead: () => { throw new Error('disk full'); } });
    assert.equal(r.rel, 'rig.json');
    assert.throws(() => openSkeleton(s.get, undefined, { findSkeletons: () => { throw new Error('unreadable'); } }),
      refusedWith('no-skeleton'), 'an unreadable folder is an empty one');
    assert.throws(() => openSkeleton(s.get), refusedWith('no-skeleton'), 'no scanner at all');
  } finally { s.done(); }
});

// ── the one-way rule ──

test('the base of a prefix family is protected, the deliveries are not', () => {
  const s = scratch();
  try {
    const find = () => files('rig.json', 'rig_v2.json');
    assert.deepEqual(protectedBases(s.get, { findSkeletons: find }), ['rig.json']);
    assert.equal(isProtectedBase(s.get, path.join(s.project, 'rig.json'), { findSkeletons: find }), true);
    assert.equal(isProtectedBase(s.get, path.join(s.project, 'rig_v2.json'), { findSkeletons: find }), false);
    assert.equal(isProtectedBase(s.get, path.join(s.project, 'sub', '..', 'rig.json'), { findSkeletons: find }), true,
      'a different spelling of the same file is still the base');
    assert.deepEqual(protectedBases(s.get, {}), [], 'no scanner, nothing extra');
    assert.deepEqual(protectedBases(s.get, { findSkeletons: () => { throw new Error('x'); } }), []);
  } finally { s.done(); }
});

test('a delivery in another folder does not switch the one-way rule off', () => {
  // Legacy finding (measured 2026-08-20): rig.json + exports/delivery.json, two unrelated
  // names in two folders, returned [] and the member's Spine export became writable.
  const s = scratch();
  try {
    write(path.join(s.project, 'rig.json'));
    const delivery = write(path.join(s.project, 'exports', 'delivery.json'));
    const opts = { findSkeletons: () => files('rig.json', 'exports/delivery.json'), hasExactHistory };
    assert.deepEqual(protectedBases(s.get, opts), ['rig.json', 'exports/delivery.json'], 'protective: nothing proves ownership yet');
    // The studio writes the delivery: its snapshot is exact-path history, the only proof of ownership.
    assert.ok(snapshot(s.project, delivery, 'exports/delivery.json'));
    assert.deepEqual(protectedBases(s.get, opts), ['rig.json'], 'the studio still owns what it wrote');
    assert.equal(isProtectedBase(s.get, path.join(s.project, 'rig.json'), opts), true);
    assert.equal(isProtectedBase(s.get, delivery, opts), false);
    assert.deepEqual(protectedBases(s.get, { ...opts, hasExactHistory: () => { throw new Error('x'); } }),
      ['rig.json', 'exports/delivery.json'], 'a failing ownership check protects');
  } finally { s.done(); }
});

test('colliding marker-less legacy history cannot lift base protection', () => {
  // rig_S-cedilla and rig_O-umlaut share one legacy readable slug; a generation there proves
  // nothing about either file, in the new root or a legacy one.
  const s = scratch();
  try {
    const a = 'rig_\u015e.json';
    const b = 'rig_\u00d6.json';
    write(path.join(s.project, a), '{}');
    write(path.join(s.project, b), '{}');
    assert.equal(readableSlugOf(a), readableSlugOf(b));
    for (const root of historyRoots(s.project)) write(path.join(root, readableSlugOf(a), '2020.json'), '{}');
    const bases = protectedBases(s.get, { findSkeletons: () => files(a, b), hasExactHistory });
    assert.deepEqual(bases, [a, b]);
  } finally { s.done(); }
});
