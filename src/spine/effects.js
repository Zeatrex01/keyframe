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

export const EFFECTS = Object.freeze(['burst', 'trail', 'flash', 'glow', 'shake', 'emit']);

/**
 * Ready-made emitters, each a starting point any setting overrides. `art` names an item of the
 * keyframe-vfx asset pack (the tool resolves it). Gravity pulls down in units/s² (negative
 * rises), speeds are units/s, life and duration seconds, size the art's longest side in units.
 */
export const EMIT_PRESETS = Object.freeze({
  sparks: { art: 'streak', count: 14, duration: 0, life: [0.22, 0.42], speed: [280, 560], spread: 360, gravity: 700, drag: 3, scale: [1, 0.25], size: 28, align: true, color: ['fff8d6', 'ffb02e'], fade: [0, 0.35], additive: true },
  shockwave: { art: 'ring', count: 1, duration: 0, life: [0.32, 0.32], speed: [0, 0], scale: [0.15, 2.4], size: 70, color: ['ffffff', 'fff1c2'], fade: [0, 0.75], additive: true },
  smoke: { art: 'puff', count: 12, duration: 0.6, life: [1, 1.6], speed: [40, 90], direction: 90, spread: 60, gravity: -50, drag: 1, scale: [0.4, 2], size: 46, color: ['e4e0da', '8d8893'], alpha: 0.7, fade: [0.15, 0.6], spin: [-50, 50] },
  dust: { art: 'puff', count: 8, duration: 0, life: [0.4, 0.75], speed: [70, 150], direction: 90, spread: 150, gravity: 140, drag: 4, scale: [0.4, 1.15], size: 30, color: ['ece3d2', 'c9b89c'], alpha: 0.85, fade: [0.05, 0.6], shape: 'line', width: 34 },
  fire: { art: 'flame', count: 30, duration: 1, loop: true, life: [0.4, 0.7], speed: [80, 140], direction: 90, spread: 14, gravity: -150, drag: 1.5, scale: [1.1, 0.25], size: 44, color: ['ffe08a', 'ff7a1f', 'd0300f'], alpha: 0.9, fade: [0.08, 0.5], additive: true, shape: 'line', width: 28 },
  embers: { art: 'dot', count: 18, duration: 1.6, loop: true, life: [0.8, 1.4], speed: [30, 80], direction: 90, spread: 40, gravity: -30, scale: [0.6, 0.15], size: 12, color: ['ffe3a0', 'ff7a2a'], additive: true, shape: 'line', width: 32 },
  magic: { art: 'spark', count: 22, duration: 0.8, life: [0.5, 0.9], speed: [20, 60], spread: 360, gravity: -40, scale: [1, 0], size: 22, color: ['ffffff', '9f7bff'], additive: true, spin: [-180, 180], shape: 'circle', radius: 30 },
  confetti: { art: 'confetti', count: 30, duration: 0, life: [1.2, 1.8], speed: [220, 420], direction: 90, spread: 70, gravity: 520, drag: 1.5, scale: [1, 1], size: 12, palette: ['ff5a7a', 'ffc93c', '4cc9f0', '7bd88f', 'b28dff'], fade: [0, 0.2], spin: [-540, 540] },
});
/** The most particles one emitter writes. */
export const EMIT_MAX = 96;
const EMIT_SHAPES = ['point', 'circle', 'ring', 'rect', 'line'];

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

// ── emit: a particle emitter, simulated once and written as keys ─────────────────────────────
//
// Each particle is launched from the emitter's shape with a speed and direction, pulled by
// gravity and slowed by drag, and scales, turns, tints and fades over its life. The path is
// exact: every key pair carries the particle's own velocity in its bezier handles (a Hermite
// segment), which is the true path under gravity alone and within a fraction of a unit with
// drag (four segments). Particles whose lives do not overlap share a slot, so a long emitter
// stays light. With `loop`, lives that run past the end continue from the start, so a
// looping clip (a fire, embers) has no seam.

const pair = (v, d) => (Array.isArray(v) && v.length === 2 && v.every(isNumber) ? v : isNumber(v) ? [v, v] : d);
const lerp = (a, b, u) => a + (b - a) * u;
const hexRgb = h => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const isHex = v => typeof v === 'string' && /^[0-9a-f]{6}$/i.test(v);
const hex2 = v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');

/** A value that runs through `values` evenly over a life (u in 0..1), linearly between them. */
function overLife(values, u) {
  if (values.length === 1) return values[0];
  const x = Math.max(0, Math.min(1, u)) * (values.length - 1), i = Math.min(values.length - 2, Math.floor(x));
  return lerp(values[i], values[i + 1], x - i);
}
const lifeKnots = n => Array.from({ length: n }, (_, i) => (n === 1 ? 0 : i / (n - 1)));

/** The emitter's settings: the preset, then the caller's own. */
function emitterOf(o) {
  const preset = o.preset === undefined ? null : EMIT_PRESETS[o.preset];
  if (o.preset !== undefined && !preset) throw new StudioError('bad-argument', `preset is one of ${Object.keys(EMIT_PRESETS).join(', ')}.`, { preset: o.preset });
  const s = { ...(preset ?? {}), ...Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) };
  const count = Math.round(num(s.count, 16));
  if (!(count >= 1 && count <= EMIT_MAX)) throw new StudioError('bad-argument', `An emitter writes 1 to ${EMIT_MAX} particles.`, { count });
  const shape = s.shape ?? 'point';
  if (!EMIT_SHAPES.includes(shape)) throw new StudioError('bad-argument', `shape is one of ${EMIT_SHAPES.join(', ')}.`, { shape });
  const duration = Math.max(0, num(s.duration, 0));
  if (s.loop && !(duration > 0)) throw new StudioError('bad-argument', 'A looping emitter emits over `duration` seconds (the clip\'s length).');
  const color = (Array.isArray(s.color) ? s.color : [s.color ?? 'ffffff']).filter(isHex);
  const palette = Array.isArray(s.palette) ? s.palette.filter(isHex) : [];
  const scale = (Array.isArray(s.scale) ? s.scale : [num(s.scale, 1)]).filter(isNumber);
  const [fadeIn, fadeOut] = pair(s.fade, [0.1, 0.4]).map(v => Math.max(0, Math.min(1, v)));
  return {
    count, shape, duration, loop: !!s.loop, at: Math.max(0, num(s.at, 0)),
    // Around a loop a life is shorter than the loop, so it never meets its own start.
    life: pair(s.life, [0.5, 0.9]).map(v => Math.max(0.02, s.loop ? Math.min(v, duration * 0.9) : v)), speed: pair(s.speed, [120, 260]),
    direction: num(s.direction, 90), spread: num(s.spread, 360), gravity: num(s.gravity, 300), drag: Math.max(0, num(s.drag, 0)),
    scale: scale.length ? scale : [1, 0.2], spin: pair(s.spin, [0, 0]), align: !!s.align,
    color: color.length ? color : ['ffffff'], palette, alpha: Math.max(0, Math.min(1, num(s.alpha, 1))),
    fade: fadeIn + fadeOut > 1 ? [fadeIn / (fadeIn + fadeOut), fadeOut / (fadeIn + fadeOut)] : [fadeIn, fadeOut],
    radius: num(s.radius, 20), width: num(s.width, 40), height: num(s.height, 40), x: num(s.x, 0), y: num(s.y, 0),
    additive: !!s.additive, seed: s.seed, name: typeof s.name === 'string' && /^\w{1,32}$/.test(s.name) ? s.name : (o.preset ?? 'emit'),
  };
}

/** Where a particle starts and how it leaves, from the emitter's shape. */
function launch(e, rand) {
  let px = 0, py = 0, outward = null;
  if (e.shape === 'circle' || e.shape === 'ring') {
    const a = rand() * Math.PI * 2, r = e.shape === 'ring' ? e.radius : e.radius * Math.sqrt(rand());
    px = Math.cos(a) * r; py = Math.sin(a) * r;
    if (e.shape === 'ring') outward = a * 180 / Math.PI;
  } else if (e.shape === 'rect') { px = (rand() - 0.5) * e.width; py = (rand() - 0.5) * e.height; }
  else if (e.shape === 'line') px = (rand() - 0.5) * e.width;
  const angle = ((outward ?? e.direction) + (rand() - 0.5) * (outward === null ? e.spread : Math.min(e.spread, 60))) * Math.PI / 180;
  const speed = lerp(e.speed[0], e.speed[1], rand());
  return { px: px + e.x, py: py + e.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

/** Position and velocity τ seconds into a life: gravity pulls down, drag slows (exactly). */
function flight(p, e, tau) {
  const ay = -e.gravity, k = e.drag;
  if (k < 1e-6) return { x: p.px + p.vx * tau, y: p.py + p.vy * tau + 0.5 * ay * tau * tau, vx: p.vx, vy: p.vy + ay * tau };
  const decay = Math.exp(-k * tau), gone = (1 - decay) / k;
  const vtx = 0, vty = ay / k;   // the speed drag settles at under gravity
  return { x: p.px + vtx * tau + (p.vx - vtx) * gone, y: p.py + vty * tau + (p.vy - vty) * gone,
    vx: vtx + (p.vx - vtx) * decay, vy: vty + (p.vy - vty) * decay };
}

function emit(sk, o, report) {
  const e = emitterOf(o);
  const rand = random(e.seed);
  // The art: a sprite the rig already has, or a library item the tool resolved (o.artSprite).
  let artName, artDef, after;
  if (o.artSprite) {
    const { region, width, height } = o.artSprite;
    artName = region; artDef = { width: round4(width), height: round4(height) };
    after = o.sprite?.slot ? requireSlot(sk, o.sprite.slot).name : null;
  } else {
    const sprite = spriteOf(sk, o.sprite);
    if (sprite.att.type && sprite.att.type !== 'region') throw new StudioError('bad-argument', `emit draws a region attachment; "${sprite.name}" is a ${sprite.att.type}. Name a library item in \`art\` instead.`, { attachment: sprite.name });
    // Centred on the particle: the copy drops the art's offset from its own bone.
    artName = sprite.name; artDef = { ...sprite.att, x: 0, y: 0, rotation: 0 }; after = sprite.slot.name;
  }
  const source = o.bone ? requireBone(sk, o.bone).name : o.sprite?.slot ? requireSlot(sk, o.sprite.slot).bone : sk.bones[0]?.name;
  if (!source) throw new StudioError('bad-argument', 'The skeleton has no bone to emit from.');
  const taken = new Set([...sk.bones.map(b => b.name), ...sk.slots.map(s => s.name)]);
  const root = freshName(taken, `fx_${e.name}`);
  sk.bones.push(emitterBone(sk, root, source, o));
  const parentBone = source;
  const clip = clipOf(sk, o.animation);
  clip.bones ??= {}; clip.slots ??= {};
  const end = e.at + e.duration;

  // Every particle: when it starts, how long it lives, how it flies, its look; then the parts of
  // its life on the clip's timeline (two when a loop carries it past the end back to the start).
  const particles = [];
  for (let i = 0; i < e.count; i++) {
    const step = e.duration / e.count;
    const start = e.duration > 0 ? e.at + step * (i + (rand() - 0.5) * 0.8 + 0.5) : e.at;
    let life = lerp(e.life[0], e.life[1], rand());
    const p = launch(e, rand);
    // A spinning particle starts at any angle; one that does not spin stands as drawn (a flame).
    const turned = rand() * 360, spin = lerp(e.spin[0], e.spin[1], rand());
    const spin0 = e.spin[0] || e.spin[1] ? turned : 0;
    const tint = e.palette.length ? e.palette[Math.floor(rand() * e.palette.length)] : null;
    const t0 = t6(Math.min(start, e.loop ? end - 1e-3 : Infinity));
    // A life that would cross the loop's end by a hair ends there instead (no sliver of a part).
    if (e.loop && t0 + life > end && t0 + life < end + 1e-3) life = end - t0;
    const parts = [];
    if (e.loop && t0 + life > end) {
      const seam = end - t0;
      parts.push({ time: t0, from: 0, to: seam }, { time: e.at, from: seam, to: life });
    } else parts.push({ time: t0, from: 0, to: life });
    particles.push({ p, life, spin0, spin, tint, parts });
  }

  // Slots: a particle takes the first slot whose earlier lives are over (a frame apart).
  // In start order, first fit is the fewest slots for one burst. Around a loop the tails that
  // wrap to the start block that, so a loop also tries dealing the particles out in turn.
  const GAP = 1 / 30;
  const busy = (pool, parts) => parts.some(a => pool.some(b => a.time < b.time + (b.to - b.from) + GAP && b.time < a.time + (a.to - a.from) + GAP));
  const ordered = particles.slice().sort((a, b) => a.parts[0].time - b.parts[0].time);
  let pools = [];
  for (const particle of ordered) {
    const pool = pools.find(entry => !busy(entry.spans, particle.parts));
    if (pool) { pool.spans.push(...particle.parts); pool.lives.push(particle); } else pools.push({ spans: [...particle.parts], lives: [particle] });
  }
  if (e.loop) {
    for (let n = 1; n < pools.length; n++) {
      const dealt = Array.from({ length: n }, () => ({ spans: [], lives: [] }));
      if (ordered.every((particle, i) => {
        const pool = dealt[i % n];
        if (busy(pool.spans, particle.parts)) return false;
        pool.spans.push(...particle.parts); pool.lives.push(particle);
        return true;
      })) { pools = dealt; break; }
    }
  }

  const slotNames = new Set(sk.slots.map(s => s.name));
  const slots = [];
  const segments = e.drag > 0 || e.align ? 4 : 1;
  const [fadeIn, fadeOut] = e.fade;
  const alphaKnots = [0, fadeIn, 1 - fadeOut, 1];
  const alphaAt = u => (u < fadeIn ? (fadeIn > 0 ? u / fadeIn : 1) : u > 1 - fadeOut ? (fadeOut > 0 ? (1 - u) / fadeOut : 1) : 1) * e.alpha;
  pools.forEach((pool, n) => {
    const bone = freshName(taken, `${root}_${n + 1}`), slot = freshName(slotNames, bone);
    sk.bones.push({ name: bone, parent: root });
    slots.push({ name: slot, bone, ...(e.additive ? { blend: 'additive' } : {}) });
    addAttachment(sk, slot, artName, artDef);
    const translate = [], rotate = [], scale = [], rgba = [], attachment = [];
    const spans = pool.lives.flatMap(life => life.parts.map(part => ({ life, part }))).sort((a, b) => a.part.time - b.part.time);
    spans.forEach(({ life, part }, j) => {
      const last = j === spans.length - 1;
      const at = tau => t6(part.time + (tau - part.from));
      // Knots inside this part of the life, in seconds of life, at least a frame grid apart.
      const knots = [];
      for (let s = 1; s < segments; s++) knots.push(life.life * s / segments);
      for (const u of [...alphaKnots, ...lifeKnots(Math.max(e.scale.length, e.color.length))]) knots.push(u * life.life);
      const taus = [part.from];
      for (const t of knots.filter(t => t > part.from + 2e-4 && t < part.to - 2e-4).sort((a, b) => a - b)) if (t - taus.at(-1) > 2e-4) taus.push(t);
      taus.push(part.to);
      const states = taus.map(tau => flight(life.p, e, tau));
      // Motion keys: a Hermite segment per knot pair (the handles carry the velocity).
      taus.forEach((tau, k) => {
        const s = states[k];
        const key = { time: at(tau), x: round4(s.x), y: round4(s.y) };
        if (k < taus.length - 1) {
          const t1 = at(taus[k + 1]), h = (t1 - key.time) / 3, n1 = states[k + 1], dt = (taus[k + 1] - tau) / 3;
          key.curve = [round4(key.time + h), round4(s.x + s.vx * dt), round4(t1 - h), round4(n1.x - n1.vx * dt),
            round4(key.time + h), round4(s.y + s.vy * dt), round4(t1 - h), round4(n1.y - n1.vy * dt)];
        } else if (!last) key.curve = 'stepped';
        translate.push(key);
      });
      // Turn: along the flight, or a steady spin from a random start.
      let previous = null;
      taus.forEach((tau, k) => {
        let value;
        if (e.align) {
          const s = states[k];
          value = Math.atan2(s.vy, s.vx) * 180 / Math.PI;
          if (previous !== null) value += 360 * Math.round((previous - value) / 360);
        } else value = life.spin0 + life.spin * tau;
        previous = value;
        rotate.push({ time: at(tau), value: round4(value), ...(k === taus.length - 1 && !last ? { curve: 'stepped' } : {}) });
      });
      // Size, colour and fade over the life: linear between knots.
      taus.forEach((tau, k) => {
        const u = tau / life.life;
        const s = overLife(e.scale, u);
        const rgb = life.tint ? hexRgb(life.tint) : [0, 1, 2].map(c => overLife(e.color.map(h => hexRgb(h)[c]), u));
        const step = k === taus.length - 1 && !last ? { curve: 'stepped' } : {};
        scale.push({ time: at(tau), x: round4(s), y: round4(s), ...step });
        rgba.push({ time: at(tau), color: `${rgb.map(hex2).join('')}${hex2(alphaAt(u))}`, ...step });
      });
      attachment.push({ time: at(part.from), name: artName });
      // A life that a loop carries on from the start is not hidden at the clip's end.
      const carried = e.loop && part.to < life.life && Math.abs(at(part.to) - t6(end)) < 1e-6;
      if (!carried) attachment.push({ time: at(part.to), name: null });
    });
    // A life carried over the loop is shown from the start of the clip: keys go in time order.
    for (const list of [translate, rotate, scale, rgba, attachment]) list.sort((a, b) => a.time - b.time);
    clip.bones[bone] = { translate, rotate, scale };
    clip.slots[slot] = { attachment: dedupeAttachments(attachment), rgba };
  });
  // A looping clip runs to the emitter's end, even when no life happens to end there.
  if (e.loop) clip.bones[root] = { translate: [{ time: t6(end), x: 0, y: 0 }] };
  if (after) insertSlots(sk, after, slots); else sk.slots.push(...slots);
  report.push(`emit ${root}: ${e.count} particles${o.preset ? ` (${o.preset})` : ''} on ${pools.length} slots from ${parentBone}, ${e.duration ? `over ${e.duration} s ` : ''}from ${e.at} s${e.loop ? ', looping' : ''}`);
}
/**
 * The emitter's own bone. Particles fly in the skeleton's space: gravity pulls down the screen
 * however the source bone is turned. By default they stay where they were let go: the emitter
 * sits under the root bone at `release` (where the source bone is at the emit time, in the root
 * bone's space; the tool poses the clip for it), or where the bone is in the setup pose. With
 * `follow` they ride the source bone (its position only).
 */
function emitterBone(sk, name, source, o) {
  const sourceBone = sk.bones.find(b => b.name === source);
  if (!sourceBone.parent) return { name, parent: source };
  if (o.follow) return { name, parent: source, inherit: 'onlyTranslation' };
  const rootBone = sk.bones.find(b => !b.parent);
  const at = o.release && isNumber(o.release.x) && isNumber(o.release.y) ? o.release : setupInRoot(sk, source, rootBone.name);
  return { name, parent: rootBone.name, x: round4(at.x), y: round4(at.y) };
}

/** Where a bone is in the setup pose, in the space of the root bone (every inherit taken as normal). */
function setupInRoot(sk, name, rootName) {
  const byName = new Map(sk.bones.map(b => [b.name, b]));
  const world = bone => {
    const r = num(bone.rotation, 0), sx = num(bone.scaleX, 1), sy = num(bone.scaleY, 1), shx = num(bone.shearX, 0), shy = num(bone.shearY, 0);
    const deg = Math.PI / 180;
    const local = { a: Math.cos((r + shx) * deg) * sx, b: Math.cos((r + 90 + shy) * deg) * sy, c: Math.sin((r + shx) * deg) * sx, d: Math.sin((r + 90 + shy) * deg) * sy, x: num(bone.x, 0), y: num(bone.y, 0) };
    if (bone.name === rootName || !bone.parent) return { a: 1, b: 0, c: 0, d: 1, x: 0, y: 0 };
    const p = world(byName.get(bone.parent));
    return { a: p.a * local.a + p.b * local.c, b: p.a * local.b + p.b * local.d, c: p.c * local.a + p.d * local.c, d: p.c * local.b + p.d * local.d,
      x: p.a * local.x + p.b * local.y + p.x, y: p.c * local.x + p.d * local.y + p.y };
  };
  const w = world(byName.get(name));
  return { x: w.x, y: w.y };
}

/** Attachment keys in time order (a hide and a show at one instant: the show wins). */
function dedupeAttachments(keys) {
  const out = [];
  for (const k of keys) {
    if (out.length && Math.abs(out.at(-1).time - k.time) < 1e-9) { if (k.name !== null) out[out.length - 1] = k; } else out.push(k);
  }
  return out;
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
  if (spec.kind !== 'emit' && spec.duration !== undefined && !(spec.duration >= 0.01)) throw new StudioError('bad-argument', `A ${spec.kind} lasts at least 0.01 s.`, { duration: spec.duration });
  const sk = structuredClone(skeleton);
  sk.bones ??= []; sk.slots ??= [];
  const bonesBefore = new Set(sk.bones.map(b => b.name)), slotsBefore = new Set(sk.slots.map(x => x.name));
  const report = [];
  if (spec.kind === 'burst') burst(sk, spec, report);
  else if (spec.kind === 'flash' || spec.kind === 'glow') overlay(sk, spec, report, spec.kind);
  else if (spec.kind === 'trail') trail(sk, spec, report);
  else if (spec.kind === 'emit') emit(sk, spec, report);
  else shake(sk, spec, report);
  // What the effect added to the rig is recorded, so a later write rebuilt from the base keeps it.
  const bones = sk.bones.map(b => b.name).filter(n => !bonesBefore.has(n));
  const slots = sk.slots.map(x => x.name).filter(n => !slotsBefore.has(n));
  if (bones.length || slots.length) {
    const added = sk[ADDED_MARKER] ?? {};
    sk[ADDED_MARKER] = { bones: [...new Set([...(added.bones ?? []), ...bones])], slots: [...new Set([...(added.slots ?? []), ...slots])] };
    if (added.art) sk[ADDED_MARKER].art = added.art;
  }
  // Library art the effect drew with goes on the delivery's own atlas page (see fx-art.js).
  if (spec.kind === 'emit' && spec.artSprite?.ref) {
    const record = sk[ADDED_MARKER];
    const { region, ref, width, height } = spec.artSprite;
    const earlier = (record.art ?? []).find(a => a.region === region);
    // One region serves every emitter that draws the item: it is drawn at the largest size used.
    record.art = [...(record.art ?? []).filter(a => a.region !== region),
      { region, ref, width: round4(Math.max(width, earlier?.width ?? 0)), height: round4(Math.max(height, earlier?.height ?? 0)) }];
  }
  return { skeleton: sk, report };
}

/** Marks the bones and slots the studio added to a delivery (effects), beyond the base. */
export const ADDED_MARKER = '_kfAdded';

/**
 * Put back into a delivery rebuilt from the base what the studio added to the previous one
 * (effect bones and slots, with their attachments), where the base still has what they hang on.
 * @param {any} out the new delivery (a copy of the base, with its clips)
 * @param {any} previous the previous delivery
 * @returns {{ kept: string[], dropped: string[] }}
 */
export function carryAdded(out, previous) {
  const record = previous?.[ADDED_MARKER];
  const kept = [], dropped = [];
  if (!record || typeof record !== 'object') return { kept, dropped };
  out.bones ??= []; out.slots ??= [];
  const bones = new Set(out.bones.map(b => b.name)), slots = new Set(out.slots.map(x => x.name));
  const keptBones = [], keptSlots = [];
  for (const name of record.bones ?? []) {
    const bone = (previous.bones ?? []).find(b => b.name === name);
    if (!bone || bones.has(name)) continue;
    if (bone.parent && !bones.has(bone.parent)) { dropped.push(name); continue; }
    out.bones.push(structuredClone(bone)); bones.add(name); keptBones.push(name);
  }
  const wanted = new Set(record.slots ?? []);
  let after = null;   // the last slot of the previous draw order that the new one has
  for (const slot of previous.slots ?? []) {
    if (!wanted.has(slot.name) || slots.has(slot.name)) { if (slots.has(slot.name)) after = slot.name; continue; }
    if (!bones.has(slot.bone)) { dropped.push(slot.name); continue; }
    const at = after === null ? 0 : out.slots.findIndex(x => x.name === after) + 1;
    out.slots.splice(at, 0, structuredClone(slot)); slots.add(slot.name); after = slot.name; keptSlots.push(slot.name);
    for (const skin of skinsOf(previous)) {
      const attachments = skin.attachments?.[slot.name];
      if (!attachments) continue;
      const target = skinsOf(out).find(x => x.name === skin.name) ?? (out.skins.push({ name: skin.name, attachments: {} }), out.skins.at(-1));
      target.attachments ??= {};
      target.attachments[slot.name] = structuredClone(attachments);
    }
  }
  if (keptBones.length || keptSlots.length) {
    out[ADDED_MARKER] = { bones: keptBones, slots: keptSlots };
    // The library art the kept slots still show.
    const shown = new Set(skinsOf(out).flatMap(skin => keptSlots.flatMap(slot => Object.entries(skin.attachments?.[slot] ?? {}).map(([key, att]) => att?.path ?? att?.name ?? key))));
    const art = (Array.isArray(record.art) ? record.art : []).filter(a => shown.has(a.region));
    if (art.length) out[ADDED_MARKER].art = structuredClone(art);
  }
  kept.push(...keptBones, ...keptSlots);
  return { kept, dropped };
}
