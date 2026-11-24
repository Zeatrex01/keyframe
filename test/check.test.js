// Gate for src/spine/check.js — and the answer to "checked against what?".
// Ported from legacy test_spinecheck.js. Each broken sample must produce its code at the
// expected level, and the official spine-ts 4.2 parser must agree with the stated
// expectation. The legacy gate needed a headless browser for that half and skipped it
// when none was found; here the runtime is in-process and the cross-check always runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkSkeleton, DEFORM_BUDGET_BYTES } from '../src/spine/check.js';
import { fatalsOf } from '../src/spine/findings.js';
import { parseSkeleton } from '../src/runtime/index.js';
import { SPINE } from './helpers/spine-addon.js';

const CLEAN = {
  skeleton: { hash: 'h', spine: '4.2.43', x: 0, width: 100, height: 100, images: '', audio: '' },
  bones: [{ name: 'root' }, { name: 'b', parent: 'root' }],
  slots: [{ name: 's', bone: 'b', attachment: 'img' }],
  skins: [{ name: 'default', attachments: { s: { img: { width: 10, height: 10 } } } }],
  animations: { intro: { bones: { b: {
    rotate: [{ value: 0, curve: [0.1, 0, 0.2, 5] }, { time: 1, value: 5 }],
    translate: [{ x: 0, y: 0, curve: [0.1, 0, 0.2, 5, 0.1, 0, 0.2, 5] }, { time: 1, x: 5, y: 5 }],
  } } } },
};
const clone = o => structuredClone(o);
const broken = mutate => { const sk = clone(CLEAN); mutate(sk); return sk; };

function mesh(sk) {
  sk.skins[0].attachments.s.img = { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    triangles: [0, 1, 2, 2, 3, 0], vertices: [0, 0, 10, 0, 10, 10, 0, 10], hull: 4, width: 10, height: 10 };
}
function deform(sk, keys) {
  mesh(sk);
  sk.animations.intro.attachments = { default: { s: { img: { deform: keys } } } };
}
function path(sk, attachment) {
  sk.slots.push({ name: 'p', bone: 'b', attachment: 'pth' });
  sk.skins[0].attachments.p = { pth: { type: 'path', closed: false, constantSpeed: true, ...attachment } };
}

// [label, breaker, code, level, does the official parser reject it]
// `runtime: false` on a fatal row means an editor or Unity reader rejects what spine-ts accepts.
const CASES = [
  ['skeleton.hash missing (Unity cannot read it)', sk => { delete sk.skeleton.hash; }, 'no-hash', 'fatal', false],
  ['4.2 deform under the wrong top-level key', sk => {
    deform(sk, [{ vertices: new Array(8).fill(0) }, { time: 2, vertices: new Array(8).fill(1) }]);
    sk.animations.intro.deform = sk.animations.intro.attachments;
    delete sk.animations.intro.attachments;
  }, 'anim-unknown', 'warn', false],
  ['bezier cx written as a fraction instead of seconds', sk => {
    sk.animations.intro.bones.b.rotate = [{ time: 1, value: 0, curve: [0.333, 0, 0.667, 5] }, { time: 2, value: 5 }];
  }, 'curve-time', 'warn', false],
  ['deform size over budget', sk => {
    deform(sk, Array.from({ length: 1800 }, (_, i) => ({ time: i / 30, vertices: new Array(8).fill(1.23456789) })));
  }, 'deform-budget', 'warn', false],
  ['path vertexCount not a multiple of 3', sk => {
    path(sk, { vertexCount: 61, lengths: new Array(21).fill(10), vertices: new Array(122).fill(0) });
  }, 'path-vc3', 'fatal', true],
  ['path lengths count wrong', sk => {
    path(sk, { vertexCount: 6, lengths: [10, 10, 10], vertices: new Array(12).fill(0) });
  }, 'path-lengths', 'fatal', false],
  // Measured 2026-10-28: spine-ts parses this without complaint, then reads past the array
  // and poses NaN. Fatal because playback is garbage, not because the parser refuses.
  ['path vertices neither flat nor weighted', sk => {
    path(sk, { vertexCount: 6, lengths: [10, 10], vertices: new Array(7).fill(0) });
  }, 'path-verts', 'fatal', false],
  ['bone parent defined later', sk => {
    sk.bones = [{ name: 'root' }, { name: 'child', parent: 'later' }, { name: 'later', parent: 'root' }];
  }, 'bone-order', 'fatal', true],
  ['slot bone missing', sk => { sk.slots[0].bone = 'missing'; }, 'slot-bone', 'fatal', true],
  // spine-ts accepts a duplicate skin name silently; the Spine editor refuses the file.
  ['skin name duplicated', sk => { sk.skins.push({ name: 'default', attachments: {} }); }, 'skin-dup', 'fatal', false],
  ['setup attachment not in any skin', sk => { sk.slots[0].attachment = 'missing'; }, 'slot-attachment', 'fatal', false],
  ['animation keys a bone that does not exist', sk => {
    sk.animations.intro.bones.ghost = { rotate: [{ value: 0 }] };
  }, 'anim-bone', 'fatal', true],
  ['attachment timeline shows an undefined attachment', sk => {
    sk.animations.intro.slots = { s: { attachment: [{ name: 'not_there' }] } };
  }, 'anim-attachment', 'fatal', false],
  ['animation fires an undefined event', sk => {
    sk.animations.intro.events = [{ time: 0.5, name: 'missing' }];
  }, 'anim-event', 'fatal', true],
  ['translate curve with 4 numbers instead of 8', sk => {
    sk.animations.intro.bones.b.translate[0].curve = [0.1, 0, 0.2, 5];
  }, 'curve-len', 'fatal', false],
  ['mesh triangle index out of range', sk => {
    sk.skins[0].attachments.s.img = { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      triangles: [0, 1, 99], vertices: [0, 0, 10, 0, 10, 10, 0, 10], hull: 4, width: 10, height: 10 };
  }, 'mesh-tri', 'fatal', false],
  // The runtime host refuses these before its parser sees them: unsorted offsets make the
  // parser run out of memory (measured), so the cross-check expects a refusal, not a crash.
  ['draw order key lists a slot twice', sk => {
    sk.slots.push({ name: 't', bone: 'b' });
    sk.animations.intro.drawOrder = [{ offsets: [{ slot: 's', offset: 1 }, { slot: 's', offset: 0 }] }];
  }, 'draw-order-unsorted', 'fatal', true],
  ['draw order offsets out of slot order', sk => {
    sk.slots.push({ name: 't', bone: 'b' });
    sk.animations.intro.drawOrder = [{ offsets: [{ slot: 't', offset: -1 }, { slot: 's', offset: 1 }] }];
  }, 'draw-order-unsorted', 'fatal', true],
  ['draw order offset outside the slot list', sk => {
    sk.animations.intro.drawOrder = [{ offsets: [{ slot: 's', offset: 3 }] }];
  }, 'draw-order-out-of-range', 'fatal', true],
  ['two draw order offsets land on one index', sk => {
    sk.slots.push({ name: 't', bone: 'b' }, { name: 'u', bone: 'b' });
    sk.animations.intro.drawOrder = [{ offsets: [{ slot: 's', offset: 2 }, { slot: 'u', offset: 0 }] }];
  }, 'draw-order-collision', 'fatal', true],
  ['path constraint target slot missing', sk => {
    sk.path = [{ name: 'pc', bones: ['b'], target: 'no_slot' }];
  }, 'c-target', 'fatal', true],
];

// The rules were measured against the official parser: where the Spine add-on is here, every
// case is held to it again; the studio's engine must at least accept what the official parser does.
const runtimeAccepts = async sk => {
  try { await parseSkeleton(sk, SPINE ? { backend: 'spine' } : {}); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
};

test('the clean base has no findings, and the official parser accepts it', async () => {
  assert.deepEqual(checkSkeleton(CLEAN), []);
  assert.equal((await runtimeAccepts(CLEAN)).ok, true);
});

for (const [label, breakIt, code, level, runtimeRejects] of CASES) {
  test(`${label}: "${code}" at level ${level}`, async () => {
    const sk = broken(breakIt);
    const found = checkSkeleton(sk);
    assert.ok(found.some(f => f.code === code && f.level === level), JSON.stringify(found));
    if (level === 'warn') assert.equal(fatalsOf(found).length, 0, 'a warning row must not block a write');
    for (const f of found) {
      assert.equal(typeof f.message, 'string');
      assert.ok(f.message.length > 10, `${f.code} has a real message`);
      assert.equal(typeof f.params, 'object');
    }
    if (runtimeRejects !== null && SPINE) {
      const r = await runtimeAccepts(sk);
      assert.equal(r.ok, !runtimeRejects,
        runtimeRejects ? `the official parser accepted it; expected a rejection (${code})` : `the official parser rejected it: ${r.error}`);
    }
  });
}

test('the real fixtures raise none of the 4.2-specific rules', () => {
  for (const name of ['ident', 'nova']) {
    const sk = JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}/${name}.json`, import.meta.url), 'utf8'));
    const found = checkSkeleton(sk).filter(f => ['no-hash', 'anim-unknown', 'curve-time', 'deform-budget'].includes(f.code));
    assert.deepEqual(found, [], name);
  }
});

test('every unknown animation key is named, and the 4.2 key rule skips 3.8 files', () => {
  const sk = clone(CLEAN);
  sk.animations.intro.mystery = {};
  assert.ok(checkSkeleton(sk).some(f => f.code === 'anim-unknown' && f.params.key === 'mystery'));
  sk.skeleton.spine = '3.8.99';
  assert.ok(!checkSkeleton(sk).some(f => f.code === 'anim-unknown'));
});

test('cx is checked for every packed property in its own key pair; cy and edges raise nothing', () => {
  const sk = clone(CLEAN);
  const keys = (properties, bad = -1) => [{ time: 1,
    curve: Array.from({ length: properties }, (_, p) => [1, -100, p === bad ? 0.667 : 2, 100]).flat(),
    color: 'ffffffff', mix: 1, softness: 0 }, { time: 2, color: 'ffffffff', mix: 1, softness: 0 }];
  sk.animations.intro.bones.b.translate = keys(2, 1);
  sk.animations.intro.slots = { s: { rgba: keys(4, 3), alpha: keys(1) } };
  sk.ik = [{ name: 'ik', bones: ['b'], target: 'root' }];
  sk.animations.intro.ik = { ik: keys(2, 1) };
  deform(sk, keys(1, 0));
  const found = checkSkeleton(sk).filter(f => f.code === 'curve-time');
  for (const channel of ['translate', 'rgba', 'ik', 'deform']) {
    assert.ok(found.some(f => f.where.includes(`/${channel}/1`) && f.params.cx === 0.667), channel);
  }
  assert.equal(found.length, 4, JSON.stringify(found));
  const late = clone(CLEAN);
  late.animations.intro.bones.b.rotate[0].curve = [0.2, 0, 1.5, 5];
  assert.ok(checkSkeleton(late).some(f => f.code === 'curve-time' && f.params.cx === 1.5), 'a handle past the next key is caught');
  const last = clone(CLEAN);
  last.animations.intro.bones.b.rotate[1].curve = [99, 0, 99, 1];
  assert.ok(!checkSkeleton(last).some(f => f.code === 'curve-time'), 'the unread curve on the last key is not a pair');
});

test('the deform budget counts real floats, and a two-key deform stays quiet', () => {
  const small = clone(CLEAN);
  deform(small, [{ vertices: new Array(8).fill(0) }, { time: 1, vertices: new Array(8).fill(1) }]);
  assert.ok(!checkSkeleton(small).some(f => f.code === 'deform-budget'));
  const large = broken(CASES.find(c => c[2] === 'deform-budget')[1]);
  const hit = checkSkeleton(large).find(f => f.code === 'deform-budget');
  assert.equal(hit.params.count, 14400);
  assert.equal(hit.params.budgetKB, DEFORM_BUDGET_BYTES / 1024);
  assert.match(hit.message, /14400/);
  assert.match(hit.message, /KB/);
});

test('the 4.x curve-length rule does not stamp a valid 3.8 file, and says so once', () => {
  const file38 = {
    skeleton: { spine: '3.8.99', hash: 'v38', images: './' },
    bones: [{ name: 'root' }, { name: 'k', parent: 'root' }],
    slots: [{ name: 's', bone: 'k', attachment: 'g' }],
    skins: [{ name: 'default', attachments: { s: { g: { width: 4, height: 4 } } } }],
    animations: {
      a: { bones: { k: { translate: [{ time: 0, x: 0, y: 0, curve: [0.25, 0, 0.75, 1] }, { time: 1, x: 10, y: 5 }] } } },
      b: { bones: { k: { translate: [{ time: 0, x: 0, y: 0, curve: [0.25, 0, 0.75, 1] }, { time: 1, x: 1, y: 1 }] } } },
    },
  };
  const found = checkSkeleton(file38);
  assert.equal(fatalsOf(found).length, 0, JSON.stringify(fatalsOf(found)));
  assert.equal(found.filter(f => f.code === 'curve-ver').length, 1, 'once per file, not per key or animation');
  const file42 = clone(file38);
  file42.skeleton.spine = '4.2.43';
  assert.ok(fatalsOf(checkSkeleton(file42)).some(f => f.code === 'curve-len'), 'the same file under 4.2 is still fatal');
});

test('a weighted path with exactly vertexCount groups is accepted by the rule and the runtime', async () => {
  const sk = broken(s => path(s, { vertexCount: 3, lengths: [10],
    vertices: [1, 1, 0, 0, 1, 1, 1, 5, 5, 1, 1, 1, 9, 9, 1] }));
  assert.ok(!checkSkeleton(sk).some(f => f.code.startsWith('path-')), JSON.stringify(checkSkeleton(sk)));
  assert.equal((await runtimeAccepts(sk)).ok, true);
});

test('garbage input is a single fatal, never a crash', () => {
  for (const input of [null, undefined, 42, 'text', []]) {
    const found = checkSkeleton(input);
    assert.equal(found.length, 1);
    assert.equal(found[0].code, 'not-json');
  }
});

test('the runtime host refuses draw-order hazards before its parser sees them; a legal move plays', async () => {
  const { sampleAnimation } = await import('../src/runtime/index.js');
  const { isStudioError } = await import('../src/shared/errors.js');
  const unsorted = broken(s => {
    s.slots.push({ name: 't', bone: 'b' });
    s.animations.intro.drawOrder = [{ offsets: [{ slot: 't', offset: -1 }, { slot: 's', offset: 1 }] }];
  });
  // Without the guard this call kills the process (out of memory, measured on 4.2.119).
  await assert.rejects(parseSkeleton(unsorted), err => isStudioError(err, 'runtime-guard') && err.details.findings.length > 0);
  const fine = broken(s => {
    s.slots.push({ name: 't', bone: 'b' });
    s.animations.intro.drawOrder = [{ offsets: [{ slot: 's', offset: 1 }] }];
  });
  assert.ok(!checkSkeleton(fine).some(f => f.code.startsWith('draw-order')), 'a legal move raises nothing');
  const [played] = await sampleAnimation(await parseSkeleton(fine), 'intro', [0]);
  assert.deepEqual(played.drawOrder, ['t', 's']);
});
