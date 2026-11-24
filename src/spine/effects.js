// Effects as plain skeleton data: bursts, trails, flashes, glows and shakes written as ordinary
// bones, slots and keys, so every player shows them the same (the studio's engine, Godot through
// the add-on, a Spine runtime) and an animator can still edit every key.
//
// Effects reuse art the skeleton already has (a coin, a star, a spark): a burst copies one
// attachment into new slots, a flash or glow lays an additive copy of a slot over it. Nothing
// here draws pixels; the drawing board makes new art.
//
// Pure and isomorphic.

import { StudioError } from '../shared/errors.js';
import { handlesFor } from './curves/presets.js';
import { ease1, ease2, round4 } from './curves/key-math.js';

export const EFFECTS = Object.freeze(['burst', 'trail', 'flash', 'glow', 'shake']);

const isNumber = v => typeof v === 'number' && Number.isFinite(v);
const num = (v, d) => (isNumber(v) ? v : d);
const t6 = t => +(+t).toFixed(6);

/** A small seeded generator, so the same call writes the same effect. */
function random(seed) {
  let a = (Math.floor(num(seed, 1)) >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function skinsOf(sk) {
  if (Array.isArray(sk.skins)) return sk.skins;
  sk.skins = Object.entries(sk.skins ?? {}).map(([name, attachments]) => ({ name, attachments }));
  return sk.skins;
}
function attachmentOf(sk, slot, name) {
  for (const skin of skinsOf(sk)) {
    const att = skin.attachments?.[slot]?.[name];
    if (att) return { skin: skin.name, att };
  }
  return null;
}
function requireSlot(sk, name) {
  const slot = (sk.slots ?? []).find(s => s.name === name);
  if (!slot) throw new StudioError('unknown-slot', `No slot named "${name}".`, { slot: name, available: (sk.slots ?? []).map(s => s.name) });
  return slot;
}
function requireBone(sk, name) {
  const bone = (sk.bones ?? []).find(b => b.name === name);
  if (!bone) throw new StudioError('unknown-bone', `No bone named "${name}".`, { bone: name });
  return bone;
}
function freshName(taken, base) {
  let name = base, i = 2;
  while (taken.has(name)) name = `${base}_${i++}`;
  taken.add(name);
  return name;
}
/** Insert slots into the draw order right after `after` (in front of it). */
function insertSlots(sk, after, slots) {
  const i = sk.slots.findIndex(s => s.name === after);
  sk.slots.splice(i + 1, 0, ...slots);
}
function addAttachment(sk, slot, name, att) {
  const skin = skinsOf(sk).find(s => s.name === 'default') ?? (sk.skins.unshift({ name: 'default', attachments: {} }), sk.skins[0]);
  skin.attachments ??= {};
  skin.attachments[slot] = { ...(skin.attachments[slot] ?? {}), [name]: structuredClone(att) };
}
const clipOf = (sk, name) => {
  sk.animations ??= {};
  return (sk.animations[name] ??= {});
};
/** An rgba key's curve when only alpha changes: flat r, g, b, then alpha eased (16 numbers). */
const alphaCurve = (t0, t1, a0, a1, handles) => [...ease1(t0, t1, 1, 1, 1 / 3), ...ease1(t0, t1, 1, 1, 1 / 3), ...ease1(t0, t1, 1, 1, 1 / 3), ...ease1(t0, t1, a0, a1, handles)];
const alphaHex = a => Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');

/** One sprite from an existing slot's attachment: the slot, its attachment name and definition. */
function spriteOf(sk, sprite) {
  if (!sprite || typeof sprite.slot !== 'string') throw new StudioError('bad-argument', 'An effect needs `sprite: { slot, attachment? }`: the art it reuses.');
  const slot = requireSlot(sk, sprite.slot);
  const name = sprite.attachment ?? slot.attachment;
  const found = name ? attachmentOf(sk, slot.name, name) : null;
  if (!found) throw new StudioError('unknown-attachment', `Slot "${slot.name}" has no attachment "${name}".`, { slot: slot.name, attachment: name });
  return { slot, name, att: found.att };
}

function burst(sk, o, report) {
  const sprite = spriteOf(sk, o.sprite);
  const rand = random(o.seed);
  const count = Math.round(num(o.count, 10)), at = num(o.at, 0), life = num(o.duration, 0.7);
  if (!(count >= 1 && count <= 64)) throw new StudioError('bad-argument', 'A burst has 1 to 64 particles.', { count });
  const spread = num(o.spread, 360), dir = num(o.direction, 90), distance = num(o.distance, 140), gravity = num(o.gravity, 0.35);
  const spin = num(o.spin, 240), [s0, s1] = Array.isArray(o.scale) ? o.scale : [1, 0.3], stagger = num(o.stagger, 0.02);
  const taken = new Set([...sk.bones.map(b => b.name), ...sk.slots.map(s => s.name)]);
  const parentBone = o.bone ? requireBone(sk, o.bone).name : sprite.slot.bone;
  const slotNames = new Set(sk.slots.map(s => s.name));
  const root = freshName(taken, `fx_${o.name ?? 'burst'}`);
  sk.bones.push({ name: root, parent: parentBone, x: num(o.x, 0), y: num(o.y, 0) });
  const clip = clipOf(sk, o.animation);
  clip.bones ??= {}; clip.slots ??= {};
  const ease = handlesFor('outCubic'), fall = handlesFor('inQuad'), rise = handlesFor('outQuad');
  const slots = [];
  for (let i = 0; i < count; i++) {
    const bone = freshName(taken, `${root}_${i + 1}`), slot = freshName(slotNames, bone);
    sk.bones.push({ name: bone, parent: root });
    slots.push({ name: slot, bone, ...(o.additive ? { blend: 'additive' } : {}) });
    addAttachment(sk, slot, sprite.name, sprite.att);
    const angle = (dir + (rand() - 0.5) * spread) * Math.PI / 180;
    const d = distance * (0.55 + 0.45 * rand());
    const start = t6(at + i * stagger * rand() * 2), apex = t6(start + life * 0.45), end = t6(start + life * (0.85 + 0.3 * rand()));
    const dx = Math.cos(angle) * d, dy = Math.sin(angle) * d, drop = -distance * gravity;
    const ax = dx * 0.7, ay = dy * 0.7 + Math.abs(drop) * 0.15;
    clip.bones[bone] = {
      translate: [
        { time: start, x: 0, y: 0, curve: ease2(start, apex, 0, ax, 0, ay, rise) },
        { time: apex, x: round4(ax), y: round4(ay), curve: ease2(apex, end, ax, dx, ay, dy + drop, gravity ? fall : ease) },
        { time: end, x: round4(dx), y: round4(dy + drop) },
      ],
      rotate: [{ time: start, value: 0, curve: ease1(start, end, 0, (rand() - 0.5) * 2 * spin, ease) }, { time: end, value: round4((rand() - 0.5) * 2 * spin) }],
      scale: [{ time: start, x: s0, y: s0, curve: ease2(start, end, s0, s1, s0, s1, ease) }, { time: end, x: s1, y: s1 }],
    };
    // The curve of the last rotate key must end where its value is: rewrite it from the final value.
    const r = clip.bones[bone].rotate;
    r[0].curve = ease1(start, end, 0, r[1].value, ease);
    const fadeFrom = t6(start + (end - start) * 0.6);
    clip.slots[slot] = {
      attachment: [{ time: start, name: sprite.name }, { time: end, name: null }],
      rgba: [{ time: start, color: 'ffffffff' }, { time: fadeFrom, color: 'ffffffff', curve: alphaCurve(fadeFrom, end, 1, 0, handlesFor('inQuad')) }, { time: end, color: 'ffffff00' }],
    };
  }
  insertSlots(sk, sprite.slot.name, slots);
  report.push(`burst ${root}: ${count} copies of ${sprite.slot.name}/${sprite.name} from ${parentBone}, ${life} s from ${at} s`);
}

function overlay(sk, o, report, kind) {
  const sprite = spriteOf(sk, o.sprite ?? { slot: o.slot, attachment: o.attachment });
  const taken = new Set(sk.slots.map(s => s.name));
  const slot = freshName(taken, `${sprite.slot.name}_${kind}`);
  const hex = /^[0-9a-f]{6}$/i.test(o.color ?? '') ? o.color.toLowerCase() : 'ffffff';
  insertSlots(sk, sprite.slot.name, [{ name: slot, bone: sprite.slot.bone, color: `${hex}00`, blend: 'additive' }]);
  addAttachment(sk, slot, sprite.name, sprite.att);
  const clip = clipOf(sk, o.animation);
  clip.slots ??= {};
  const at = num(o.at, 0), strength = Math.max(0, Math.min(1, num(o.strength, kind === 'flash' ? 1 : 0.6)));
  const keys = [];
  if (kind === 'flash') {
    const duration = num(o.duration, 0.25), peak = t6(at + Math.min(0.05, duration / 4)), end = t6(at + duration);
    keys.push({ time: t6(at), color: `${hex}00`, curve: ease1(t6(at), peak, 0, strength, handlesFor('outQuad')) },
      { time: peak, color: `${hex}${alphaHex(strength)}`, curve: ease1(peak, end, strength, 0, handlesFor('outCubic')) }, { time: end, color: `${hex}00` });
  } else {
    const period = num(o.period, 1.2), cycles = Math.max(1, Math.round(num(o.cycles, 2)));
    const low = strength * 0.25, wave = handlesFor('inOutSine');
    for (let c = 0; c < cycles; c++) {
      const t0 = t6(at + c * period), t1 = t6(t0 + period / 2);
      keys.push({ time: t0, color: `${hex}${alphaHex(low)}`, curve: ease1(t0, t1, low, strength, wave) },
        { time: t1, color: `${hex}${alphaHex(strength)}`, curve: ease1(t1, t6(t0 + period), strength, low, wave) });
    }
    keys.push({ time: t6(at + cycles * period), color: `${hex}${alphaHex(low)}` });
  }
  // rgba curves carry four channels: r, g, b at constant values, alpha as eased above.
  for (const k of keys) if (k.curve) k.curve = [...rgbFlat(k, keys), ...k.curve];
  clip.slots[slot] = { attachment: [{ time: t6(at), name: sprite.name }], rgba: keys };
  report.push(`${kind} ${slot}: additive copy of ${sprite.slot.name}/${sprite.name} from ${at} s`);
}
/** Flat bezier quads for r, g and b of an rgba key (they do not change). */
function rgbFlat(key, keys) {
  const next = keys[keys.indexOf(key) + 1];
  const [t0, t1] = [key.time, next.time];
  const out = [];
  for (let i = 0; i < 3; i++) {
    const v = parseInt(key.color.slice(i * 2, i * 2 + 2), 16) / 255;
    out.push(...ease1(t0, t1, v, v, 1 / 3));
  }
  return out;
}

function trail(sk, o, report) {
  const sprite = spriteOf(sk, o.sprite);
  const clip = sk.animations?.[o.animation];
  const lead = clip?.bones?.[sprite.slot.bone];
  if (!lead) throw new StudioError('bad-argument', `A trail follows the bone of its sprite ("${sprite.slot.bone}"), which has no keys in "${o.animation}". Write its motion first.`, { bone: sprite.slot.bone });
  const bone = requireBone(sk, sprite.slot.bone);
  const count = Math.round(num(o.count, 4)), delay = num(o.delay, 0.04), strength = num(o.strength, 0.5);
  if (!(count >= 1 && count <= 12)) throw new StudioError('bad-argument', 'A trail has 1 to 12 ghosts.', { count });
  const taken = new Set([...sk.bones.map(b => b.name), ...sk.slots.map(s => s.name)]);
  const slots = [];
  for (let i = 1; i <= count; i++) {
    const name = freshName(taken, `${bone.name}_ghost${i}`);
    sk.bones.splice(sk.bones.indexOf(bone) + i, 0, { ...structuredClone(bone), name });
    const shifted = {};
    for (const [channel, keys] of Object.entries(lead)) {
      if (!Array.isArray(keys)) continue;
      shifted[channel] = keys.map(k => {
        const copy = { ...k, time: t6(num(k.time, 0) + i * delay) };
        if (Array.isArray(k.curve)) copy.curve = k.curve.map((v, j) => (j % 2 === 0 ? round4(v + i * delay) : v));
        return copy;
      });
    }
    clip.bones[name] = shifted;
    const alpha = strength * (1 - (i - 1) / count);
    // Shown only while the lead moves: at rest a ghost would sit on the sprite and brighten it.
    const times = Object.values(shifted).flat().map(k => k.time);
    const from = Math.min(...times), to = Math.max(...times);
    clip.slots ??= {};
    clip.slots[name] = { attachment: [{ time: from, name: sprite.name }, { time: to, name: null }] };
    slots.push({ name, bone: name, color: `ffffff${alphaHex(alpha)}`, ...(o.additive !== false ? { blend: 'additive' } : {}) });
    addAttachment(sk, name, sprite.name, sprite.att);
  }
  // Ghosts sit behind the sprite: before it in the draw order.
  const at = sk.slots.findIndex(s => s.name === sprite.slot.name);
  sk.slots.splice(at, 0, ...slots.reverse());
  report.push(`trail: ${count} ghosts of ${sprite.slot.name} following ${bone.name}, ${delay} s apart`);
}

function shake(sk, o, report) {
  const bone = requireBone(sk, o.bone);
  const clip = clipOf(sk, o.animation);
  clip.bones ??= {};
  const channels = clip.bones[bone.name] ??= {};
  if (channels.translate || channels.translatex || channels.translatey) {
    throw new StudioError('bad-argument', `"${bone.name}" already travels in "${o.animation}"; shake its parent or a bone made for it, so the two do not fight.`, { bone: bone.name });
  }
  const rand = random(o.seed);
  const at = num(o.at, 0), duration = num(o.duration, 0.4), amplitude = num(o.amplitude, 8), frequency = num(o.frequency, 24);
  const steps = Math.max(2, Math.round(duration * frequency));
  const keys = [{ time: t6(at), x: 0, y: 0 }];
  for (let i = 1; i < steps; i++) {
    const decay = 1 - i / steps;
    const a = amplitude * decay * decay;
    keys.push({ time: t6(at + i * duration / steps), x: round4((rand() * 2 - 1) * a), y: round4((rand() * 2 - 1) * a) });
  }
  keys.push({ time: t6(at + duration), x: 0, y: 0 });
  if (at > 0) keys.unshift({ time: 0, x: 0, y: 0 });
  channels.translate = keys;
  report.push(`shake ${bone.name}: ${amplitude} units decaying over ${duration} s from ${at} s`);
}

/**
 * Add one effect to a skeleton (a copy is returned; the input is not changed).
 * @param {object} skeleton
 * @param {{ kind: string, animation: string, [option: string]: any }} spec
 * @returns {{ skeleton: object, report: string[] }}
 */
export function addEffect(skeleton, spec) {
  if (!spec || !EFFECTS.includes(spec.kind)) throw new StudioError('bad-argument', `kind is one of ${EFFECTS.join(', ')}.`, { kind: spec?.kind });
  if (typeof spec.animation !== 'string' || !spec.animation) throw new StudioError('bad-argument', 'An effect is written into a clip: name it in `animation`.');
  const sk = structuredClone(skeleton);
  sk.bones ??= []; sk.slots ??= [];
  const report = [];
  if (spec.kind === 'burst') burst(sk, spec, report);
  else if (spec.kind === 'flash' || spec.kind === 'glow') overlay(sk, spec, report, spec.kind);
  else if (spec.kind === 'trail') trail(sk, spec, report);
  else shake(sk, spec, report);
  return { skeleton: sk, report };
}
