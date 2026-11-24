// The shared human rig in test/fixtures/body (the rig Pip is cut from): arms and legs on two-bone IK.
// Sampled on the official runtime, every frame of the body clips: a target never leaves its
// limb's reach, a knee always points away from the body's middle, planted feet do not slide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const project = mkdtempSync(join(tmpdir(), 'ks-human-'));
cpSync(join(root, 'test/fixtures/body'), project, { recursive: true });
const file = 'human_v2.json';
const skeleton = JSON.parse(readFileSync(join(project, file), 'utf8'));
const length = Object.fromEntries(skeleton.bones.filter(b => b.length).map(b => [b.name, b.length]));
const LIMBS = [['thighL', 'shinL', 'footTargetL'], ['thighR', 'shinR', 'footTargetR'], ['armL', 'forearmL', 'handTargetL'], ['armR', 'forearmR', 'handTargetR']];

function sample(animation, seconds) {
  const args = join(project, 'args.json');
  const times = Array.from({ length: Math.round(seconds * 30) + 1 }, (_, i) => +(i / 30).toFixed(4));
  writeFileSync(args, JSON.stringify({ file, animation, times, bones: ['hips', 'footL', 'footR', ...LIMBS.flat()] }));
  const out = execFileSync(process.execPath, [join(root, 'tools/cli.js'), 'sample_animation', '--project', project, '--args', '@' + args], { encoding: 'utf8', maxBuffer: 1 << 27 });
  return JSON.parse(out).samples;
}
const at = (s, bone) => s.bones[bone].world;
const distance = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

test('the human rig has the four IK limbs and the four looks', () => {
  assert.deepEqual(skeleton.ik.map(c => c.name).sort(), ['armL', 'armR', 'legL', 'legR']);
  assert.deepEqual(skeleton.skins.map(s => s.name).sort(), ['boy_casual', 'boy_sport', 'default', 'girl_casual', 'girl_dress']);
});

for (const [animation, seconds] of [['stand', 3.2], ['walk', 0.8], ['wave', 1.6], ['cheer', 1.2], ['jump', 1.1]]) {
  test(animation + ': every IK target stays within reach and the knees point outward', () => {
    for (const s of sample(animation, seconds)) {
      for (const [upper, lower, target] of LIMBS) {
        const limb = (length[upper] + length[lower]) * distance(at(s, upper), at(s, lower)) / length[upper];
        assert.ok(distance(at(s, upper), at(s, target)) <= limb + 0.6, `${animation} @${s.time}: ${target} is out of reach`);
      }
      for (const [thigh, shin, target] of LIMBS.slice(0, 2)) {
        const hip = at(s, thigh), knee = at(s, shin), foot = at(s, target);
        const onLine = hip.x + (foot.x - hip.x) * (knee.y - hip.y) / (foot.y - hip.y);
        assert.ok((knee.x - onLine) * Math.sign(hip.x - at(s, 'hips').x) > 0, `${animation} @${s.time}: ${shin} knee points inward`);
      }
    }
  });
}

test('elbows point outward, hanging and raised, and a bend only flips while the arm is straight', () => {
  const side = (s, shoulder, elbow, hand) => { const S = at(s, shoulder), E = at(s, elbow), H = at(s, hand); return (S.x - H.x) * (E.y - H.y) - (S.y - H.y) * (E.x - H.x); };
  const rest = sample('stand', 0)[0];
  // hanging: the elbow is farther from the middle than the shoulder-to-hand line
  for (const [arm, forearm, hand] of LIMBS.slice(2)) {
    const S = at(rest, arm), E = at(rest, forearm), H = at(rest, hand), onLine = S.x + (H.x - S.x) * (E.y - S.y) / (H.y - S.y);
    assert.ok((E.x - onLine) * Math.sign(S.x) > 0.5, forearm + ' elbow points inward at rest');
  }
  const wave = sample('wave', 1.6);
  const raised = wave.find(s => s.time >= 0.53);
  // raised beside the head, the elbow is below and outside the shoulder-to-hand line: the other bend
  assert.equal(Math.sign(side(raised, 'armR', 'forearmR', 'handTargetR')), -Math.sign(side(rest, 'armR', 'forearmR', 'handTargetR')), 'the raised elbow points toward the head');
  for (const animation of ['wave', 'cheer', 'jump']) {
    let last = null;
    for (const s of animation === 'wave' ? wave : sample(animation, 1.1)) {
      const sign = Math.sign(side(s, 'armR', 'forearmR', 'handTargetR'));
      const straight = distance(at(s, 'armR'), at(s, 'handTargetR')) / (length.armR + length.forearmR);
      if (last && last.sign !== sign) assert.ok(Math.max(last.straight, straight) > 0.999, `${animation} @${s.time}: the elbow flips while bent`);
      last = { sign, straight };
    }
  }
});

test('stand: the feet stay planted while the hips shift', () => {
  const samples = sample('stand', 3.2);
  for (const foot of ['footL', 'footR']) {
    const xs = samples.map(s => at(s, foot).x), ys = samples.map(s => at(s, foot).y);
    assert.ok(Math.max(...xs) - Math.min(...xs) < 0.2 && Math.max(...ys) - Math.min(...ys) < 0.2, foot + ' slides');
  }
  const hips = samples.map(s => at(s, 'hips').x);
  assert.ok(Math.max(...hips) - Math.min(...hips) > 5, 'the hips do not move, so planted feet prove nothing');
});
