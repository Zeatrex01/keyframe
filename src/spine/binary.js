// Spine 4.2 skeleton JSON -> binary (.skel). Ported from legacy skel_binary.js.
//
// Why this exists: Unity projects ship binary skeletons, which are
// smaller and faster to load than JSON. Without this module the only thing that could
// produce a .skel was the Spine editor or CLI: a licensed, installed, mostly-Windows
// dependency the studio otherwise does not need. The studio produces the delivery, so it
// can produce it in either format.
//
// How it was built, and why that matters: the format is not guessed. It is the exact
// inverse of the official reader, spine-runtimes 4.2 `spine-ts/spine-core/src/
// SkeletonBinary.ts`, with JSON field names and defaults from its sibling
// `SkeletonJson.ts`. Every constant below (timeline type ids, flag bits, the varint,
// UTF-8 and big-endian encodings) is transcribed from that reader.
//
// Verified the only way that counts: test/binary.test.js parses the same skeleton with
// the official SkeletonJson and with the official SkeletonBinary (fed this module's
// output) and compares the two SkeletonData results field by field, timeline by
// timeline, and pose by pose. Our own reader is never used to check our own writer; a bug
// in one would cancel a bug in the other and prove nothing.
//
// Refused, never written wrong (StudioError codes below):
//   * astral-plane characters (emoji): the official string decoder handles 1-3 byte
//     UTF-8 only, so a 4-byte sequence would come back as garbage;
//   * sequence attachments and sequence timelines: not supported yet;
//   * anything whose byte layout the reader derives instead of reading (mesh triangle
//     count, path lengths count, vertex groups): a mismatch would shift every byte after
//     it, with no error at the point of damage.
// `hash` cannot round-trip: the JSON hash is a string, the binary hash is two int32s only
// the editor computes. Zeros are written, which the reader takes as "no hash"; it is a
// cache key, not content.
//
// Pure and isomorphic: Uint8Array + DataView + TextEncoder, no node:* imports.

import { StudioError } from '../shared/errors.js';
import { weightedGroupsExact } from './vertices.js';

// ── timeline type ids, straight from SkeletonBinary.ts ────────────────────────
const BONE_ROTATE = 0, BONE_TRANSLATE = 1, BONE_TRANSLATEX = 2, BONE_TRANSLATEY = 3,
  BONE_SCALE = 4, BONE_SCALEX = 5, BONE_SCALEY = 6, BONE_SHEAR = 7,
  BONE_SHEARX = 8, BONE_SHEARY = 9, BONE_INHERIT = 10;
const SLOT_ATTACHMENT = 0, SLOT_RGBA = 1, SLOT_RGB = 2, SLOT_RGBA2 = 3,
  SLOT_RGB2 = 4, SLOT_ALPHA = 5;
const ATTACHMENT_DEFORM = 0;
const PATH_POSITION = 0, PATH_SPACING = 1, PATH_MIX = 2;
const PHYSICS_INERTIA = 0, PHYSICS_STRENGTH = 1, PHYSICS_DAMPING = 2, PHYSICS_MASS = 4,
  PHYSICS_WIND = 5, PHYSICS_GRAVITY = 6, PHYSICS_MIX = 7, PHYSICS_RESET = 8;
const CURVE_LINEAR = 0, CURVE_STEPPED = 1, CURVE_BEZIER = 2;

// Enum orders are the runtime's own declaration order: the byte written is the index.
const INHERIT = ['normal', 'onlytranslation', 'norotationorreflection', 'noscale', 'noscaleorreflection'];
const BLEND = ['normal', 'additive', 'multiply', 'screen'];
const POSITION_MODE = ['fixed', 'percent'];
const SPACING_MODE = ['length', 'fixed', 'percent', 'proportional'];
const ROTATE_MODE = ['tangent', 'chain', 'chainscale'];

/** The runtime line this format belongs to. */
export const BINARY_VERSION = '4.2';

const fail = (code, message, details) => { throw new StudioError(code, message, details); };
const val = (m, k, d) => (m && m[k] !== undefined ? m[k] : d);
function enumIndex(list, value, field) {
  const i = list.indexOf(String(value == null ? list[0] : value).toLowerCase());
  if (i < 0) fail('binary-unknown-enum', `Unknown ${field}: "${value}" (valid: ${list.join(', ')}).`, { field, value, valid: list });
  return i;
}

// ── the byte sink ───────────────────────────────────────────────────────────
// Everything is big-endian: the reader uses DataView with no littleEndian argument.
const utf8 = new TextEncoder();

class ByteWriter {
  constructor() {
    this.bytes = new Uint8Array(1 << 16);
    this.view = new DataView(this.bytes.buffer);
    this.length = 0;
  }

  room(n) {
    if (this.length + n <= this.bytes.length) return;
    let size = this.bytes.length;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.bytes.subarray(0, this.length));
    this.bytes = next;
    this.view = new DataView(next.buffer);
  }

  byte(v) { this.room(1); this.view.setUint8(this.length, v & 0xff); this.length += 1; }
  bool(v) { this.byte(v ? 1 : 0); }
  int32(v) { this.room(4); this.view.setInt32(this.length, v | 0); this.length += 4; }
  float(v) { this.room(4); this.view.setFloat32(this.length, Number(v) || 0); this.length += 4; }

  // The reader's readInt(optimizePositive): 7 bits per byte, high bit = "more follows".
  // With optimizePositive false the value is zigzagged first. A negative value written
  // with optimizePositive true takes 5 bytes and reads back as the same int32.
  varint(v, optimizePositive) {
    let x = optimizePositive ? (v >>> 0) : ((((v | 0) << 1) ^ ((v | 0) >> 31)) >>> 0);
    for (;;) {
      if ((x & ~0x7f) === 0) { this.byte(x); return; }
      this.byte((x & 0x7f) | 0x80);
      x >>>= 7;
    }
  }

  string(s) {
    if (s === null || s === undefined) { this.varint(0, true); return; }
    const text = String(s);
    if (text === '') { this.varint(1, true); return; }
    // The official reader decodes only 1-, 2- and 3-byte UTF-8, so a 4-byte sequence
    // would be silently misread. A name that survives writing but comes back corrupted
    // is the silent-loss class this project keeps paying for: refuse instead.
    for (const ch of text) {
      if (ch.codePointAt(0) > 0xffff) {
        fail('binary-astral-character',
          `"${text}" contains a character outside the Basic Multilingual Plane (an emoji or similar). The official Spine reader cannot decode it, so the file would be silently corrupted. Rename it.`,
          { text });
      }
    }
    const encoded = utf8.encode(text);
    this.varint(encoded.length + 1, true);
    this.room(encoded.length);
    this.bytes.set(encoded, this.length);
    this.length += encoded.length;
  }

  done() { return this.bytes.slice(0, this.length); }
}

// ── colours ─────────────────────────────────────────────────────────────────
// JSON carries "rrggbbaa" (or "rrggbb"); the binary carries a packed int32.
function hexDigits(hex, lengths) {
  const s = String(hex).replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(s) || !lengths.includes(s.length)) {
    fail('binary-bad-color', `Invalid colour: "${hex}".`, { color: hex });
  }
  return s;
}
function rgba8888(hex, fallback) {
  if (!hex) return fallback;
  const s = hexDigits(hex, [6, 8]);
  const byteAt = i => parseInt(s.slice(i * 2, i * 2 + 2), 16);
  const a = s.length === 8 ? byteAt(3) : 255;
  return ((byteAt(0) << 24) | (byteAt(1) << 16) | (byteAt(2) << 8) | a) | 0;
}
function rgb888(hex) {
  const s = hexDigits(hex, [6, 8]);
  return (parseInt(s.slice(0, 2), 16) << 16) | (parseInt(s.slice(2, 4), 16) << 8) | parseInt(s.slice(4, 6), 16);
}
// The colour timelines store channels as bytes.
function colorBytes(hex, count, fallback) {
  const s = hexDigits(hex ?? fallback, [6, 8]);
  const out = [];
  for (let i = 0; i < count; i++) out.push(i < s.length / 2 ? parseInt(s.slice(i * 2, i * 2 + 2), 16) : 255);
  return out;
}

// ── curves ──────────────────────────────────────────────────────────────────
// JSON: `curve` is "stepped", or a flat array of 4 numbers per value
// (cx1, cy1, cx2, cy2, ...). Binary: a byte, then those same numbers in the same order;
// setBezier consumes 4 floats per value.
const isStepped = k => k && k.curve === 'stepped';
const bezierOf = k => (k && Array.isArray(k.curve)) ? k.curve : null;
// How many setBezier calls a timeline will make; the reader preallocates from this.
function bezierCount(keys, valueCount) {
  let n = 0;
  for (let i = 0; i < keys.length - 1; i++) if (bezierOf(keys[i])) n += valueCount;
  return n;
}
function requireBezier(curve, valueCount) {
  if (curve.length < valueCount * 4) {
    fail('binary-bezier-short', `A bezier curve needs ${valueCount * 4} numbers, got ${curve.length}.`,
      { expected: valueCount * 4, actual: curve.length });
  }
}
function writeCurve(w, key, valueCount) {
  if (isStepped(key)) { w.byte(CURVE_STEPPED); return; }
  const c = bezierOf(key);
  if (!c) { w.byte(CURVE_LINEAR); return; }
  requireBezier(c, valueCount);
  w.byte(CURVE_BEZIER);
  for (let i = 0; i < valueCount * 4; i++) w.float(c[i]);
}

// The frame/curve interleave: the one thing easy to get backwards, and the official reader
// is unforgiving about it. It reads the first frame's values, then loops "read the next
// frame's values, then the curve byte describing how we got there". So the curve for the
// transition i-1 -> i is written after frame i's own values, not after frame i-1's.
// (Written the intuitive way, every curved timeline made the reader run off the end of
// the buffer; the round-trip gate caught it.)
//
// `emit(key)` writes one frame's values; every curve timeline differs only in that.
function frames(w, keys, valueCount, emit) {
  w.varint(keys.length, true);
  w.varint(bezierCount(keys, valueCount), true);
  for (let i = 0; i < keys.length; i++) {
    emit(keys[i]);
    if (i > 0) writeCurve(w, keys[i - 1], valueCount);
  }
}

// A one-value curve timeline (rotate, scaleX, path position, physics inertia, ...).
function timeline1(w, keys, field, fallback) {
  frames(w, keys, 1, k => { w.float(val(k, 'time', 0)); w.float(val(k, field, fallback)); });
}
// A two-value curve timeline (translate, scale, shear).
function timeline2(w, keys, f1, d1, f2, d2) {
  frames(w, keys, 2, k => { w.float(val(k, 'time', 0)); w.float(val(k, f1, d1)); w.float(val(k, f2, d2)); });
}

// ── vertices (mesh, path, clipping, bounding box) ───────────────────────────
// Unweighted: a flat x, y list. Weighted: per vertex, a bone count then
// (boneIndex, x, y, weight) each. The JSON encodes both in one `vertices` array and tells
// them apart by length, exactly as the official JSON reader does.
//
// How many vertices? The JSON says it two ways, and getting it wrong is silent
// corruption. `path`, `boundingbox` and `clipping` carry an explicit `vertexCount`; a mesh
// does not, and the official JSON reader derives it from `uvs.length / 2`. (Legacy read
// `vertexCount` for a mesh at first, got 0, and wrote a file the reader walked off the
// end of; adding a mesh to the gate surfaced it.)
function vertexCountOf(att) {
  const type = String(att.type || 'region').toLowerCase();
  if (type === 'mesh' || type === 'linkedmesh') return (att.uvs || []).length >> 1;
  return att.vertexCount || 0;
}
const isWeighted = att => (att.vertices || []).length !== vertexCountOf(att) * 2;

function writeVertices(w, att, key) {
  const vertexCount = vertexCountOf(att);
  const verts = att.vertices || [];
  w.varint(vertexCount, true);
  if (verts.length === vertexCount * 2) {
    for (const v of verts) w.float(v);
    return;
  }
  // The reader walks exactly vertexCount groups. A short or long array would shift every
  // byte after this attachment, so it is refused here. (Legacy wrote it as found.)
  if (!weightedGroupsExact(verts, vertexCount)) {
    fail('binary-vertices-layout',
      `Attachment "${key}": vertices hold neither ${vertexCount * 2} numbers (unweighted) nor ${vertexCount} weighted groups.`,
      { attachment: key, vertexCount, length: verts.length });
  }
  let i = 0;
  while (i < verts.length) {
    const boneCount = verts[i++];
    w.varint(boneCount, true);
    for (let b = 0; b < boneCount; b++) {
      w.varint(verts[i++], true);                      // bone index (already an index in JSON)
      w.float(verts[i++]); w.float(verts[i++]); w.float(verts[i++]);
    }
  }
}

// ── the string table ────────────────────────────────────────────────────────
// Some strings are written as an index into a table (readStringRef); index 0 means null.
// The table is emitted near the top of the file, so every such string is collected before
// anything is written.
function collectStrings(json) {
  const seen = new Map();
  const add = s => {
    if (s === null || s === undefined || seen.has(s)) return;
    // The reader refuses an empty entry ("String in string table must not be null").
    if (s === '') fail('binary-empty-name', 'An attachment, path or parent name is an empty string; the binary string table cannot hold one.');
    seen.set(s, seen.size);
  };
  for (const slot of json.slots || []) add(slot.attachment);
  for (const skin of json.skins || []) {
    for (const atts of Object.values(skin.attachments || {})) {
      for (const [key, att] of Object.entries(atts || {})) {
        add(key);
        add(att?.name); add(att?.path); add(att?.parent);
      }
    }
  }
  for (const anim of Object.values(json.animations || {})) {
    for (const slotMap of Object.values(anim.slots || {})) {
      for (const k of slotMap.attachment || []) add(k?.name);
    }
    for (const skinMap of Object.values(anim.attachments || {})) {
      for (const slotMap of Object.values(skinMap || {})) {
        for (const attName of Object.keys(slotMap || {})) add(attName);
      }
    }
  }
  return seen;
}

/**
 * Write a Spine 4.2 skeleton JSON object as binary .skel bytes.
 *
 * `nonessential` data (fps, images path, bone colours, mesh edges and size) is what the
 * Spine editor calls "Nonessential data". Runtimes do not need it; keeping it makes the
 * file a faithful round trip of the JSON. Default true, so nothing the JSON carried is
 * dropped without being asked.
 *
 * @param {object} json parsed Spine 4.2 skeleton JSON
 * @param {{ nonessential?: boolean }} [options]
 * @returns {Uint8Array}
 */
export function writeSkeletonBinary(json, { nonessential = true } = {}) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.bones)) {
    fail('binary-not-skeleton', 'This is not a Spine skeleton JSON object (no bones array).');
  }
  // The byte layout below is 4.2's. A 4.1 or 4.3 skeleton written in it would carry a
  // version string its own runtime trusts and a layout it cannot read. (Legacy wrote any
  // version string it found.)
  const sk = json.skeleton || {};
  const version = sk.spine ?? BINARY_VERSION;
  if (String(version).split('.').slice(0, 2).join('.') !== BINARY_VERSION) {
    fail('binary-version', `This skeleton is Spine ${version}; the binary writer produces the ${BINARY_VERSION} format only.`,
      { version, supported: BINARY_VERSION });
  }

  const w = new ByteWriter();
  const strings = collectStrings(json);
  const stringRef = s => w.varint(s === null || s === undefined ? 0 : strings.get(s) + 1, true);

  const boneIndex = new Map(json.bones.map((b, i) => [b.name, i]));
  const slotIndex = new Map((json.slots || []).map((s, i) => [s.name, i]));
  const boneAt = name => boneIndex.has(name) ? boneIndex.get(name)
    : fail('binary-unknown-bone', `No bone named "${name}".`, { bone: name });
  const slotAt = name => slotIndex.has(name) ? slotIndex.get(name)
    : fail('binary-unknown-slot', `No slot named "${name}".`, { slot: name });

  // Skins: the default skin is written first and separately; the rest follow. Deform
  // timelines and linked meshes index into this same order, so it is fixed here once.
  // The reader turns a default skin with no slots into "no default skin", which would
  // shift every index after it; such a skin is written as an ordinary skin instead.
  const skins = json.skins || [];
  const defaultSkin = skins.find(s => s.name === 'default' && Object.keys(s.attachments || {}).length) || null;
  const otherSkins = skins.filter(s => s !== defaultSkin);
  const skinOrder = (defaultSkin ? [defaultSkin] : []).concat(otherSkins);
  const ctx = { w, stringRef, boneAt, slotAt, skinOrder, nonessential };

  // ── header ──────────────────────────────────────────────────────────────
  w.int32(0); w.int32(0);                              // hash: editor-computed, cannot round-trip
  w.string(String(version));
  w.float(val(sk, 'x', 0)); w.float(val(sk, 'y', 0));
  w.float(val(sk, 'width', 0)); w.float(val(sk, 'height', 0));
  w.float(val(sk, 'referenceScale', 100));
  w.bool(nonessential);
  if (nonessential) {
    w.float(val(sk, 'fps', 30));
    w.string(sk.images ?? null);
    w.string(sk.audio ?? null);
  }

  // ── string table ────────────────────────────────────────────────────────
  w.varint(strings.size, true);
  for (const s of strings.keys()) w.string(s);

  // ── bones ───────────────────────────────────────────────────────────────
  w.varint(json.bones.length, true);
  json.bones.forEach((b, i) => {
    w.string(b.name);
    if (i > 0) w.varint(boneAt(b.parent), true);      // bone 0 is the root: no parent field
    w.float(val(b, 'rotation', 0));
    w.float(val(b, 'x', 0)); w.float(val(b, 'y', 0));
    w.float(val(b, 'scaleX', 1)); w.float(val(b, 'scaleY', 1));
    w.float(val(b, 'shearX', 0)); w.float(val(b, 'shearY', 0));
    w.float(val(b, 'length', 0));
    w.byte(enumIndex(INHERIT, val(b, 'inherit', 'normal'), 'inherit'));
    w.bool(val(b, 'skin', false));
    if (nonessential) {
      w.int32(rgba8888(b.color, 0x9b9b9bff | 0));
      w.string(b.icon ?? null);
      w.bool(val(b, 'visible', true));
    }
  });

  // ── slots ───────────────────────────────────────────────────────────────
  w.varint((json.slots || []).length, true);
  for (const s of json.slots || []) {
    w.string(s.name);
    w.varint(boneAt(s.bone), true);
    w.int32(rgba8888(s.color, 0xffffffff | 0));
    w.int32(s.dark ? rgb888(s.dark) : -1);
    stringRef(s.attachment ?? null);
    w.varint(enumIndex(BLEND, val(s, 'blend', 'normal'), 'blend'), true);
    if (nonessential) w.bool(val(s, 'visible', true));
  }

  // ── IK constraints ──────────────────────────────────────────────────────
  w.varint((json.ik || []).length, true);
  for (const c of json.ik || []) {
    w.string(c.name);
    w.varint(val(c, 'order', 0), true);
    w.varint((c.bones || []).length, true);
    for (const bone of c.bones || []) w.varint(boneAt(bone), true);
    w.varint(boneAt(c.target), true);
    const mix = val(c, 'mix', 1), softness = val(c, 'softness', 0);
    let flags = 0;
    if (val(c, 'skin', false)) flags |= 1;
    if (val(c, 'bendPositive', true)) flags |= 2;
    if (val(c, 'compress', false)) flags |= 4;
    if (val(c, 'stretch', false)) flags |= 8;
    if (val(c, 'uniform', false)) flags |= 16;
    if (mix !== 0) { flags |= 32; if (mix !== 1) flags |= 64; }   // the reader's default mix is 0
    if (softness !== 0) flags |= 128;
    w.byte(flags);
    if (mix !== 0 && mix !== 1) w.float(mix);
    if (softness !== 0) w.float(softness);
  }

  // ── transform constraints ───────────────────────────────────────────────
  // Every offset and mix is written only when non-zero; the reader's defaults are zero.
  w.varint((json.transform || []).length, true);
  for (const c of json.transform || []) {
    w.string(c.name);
    w.varint(val(c, 'order', 0), true);
    w.varint((c.bones || []).length, true);
    for (const bone of c.bones || []) w.varint(boneAt(bone), true);
    w.varint(boneAt(c.target), true);
    const offsets = [val(c, 'rotation', 0), val(c, 'x', 0), val(c, 'y', 0), val(c, 'scaleX', 0), val(c, 'scaleY', 0)];
    const mixX = val(c, 'mixX', 1), mixScaleX = val(c, 'mixScaleX', 1);
    const second = [val(c, 'shearY', 0), val(c, 'mixRotate', 1), mixX, val(c, 'mixY', mixX),
      mixScaleX, val(c, 'mixScaleY', mixScaleX), val(c, 'mixShearY', 1)];
    let f1 = 0;
    if (val(c, 'skin', false)) f1 |= 1;
    if (val(c, 'local', false)) f1 |= 2;
    if (val(c, 'relative', false)) f1 |= 4;
    offsets.forEach((v, i) => { if (v !== 0) f1 |= 8 << i; });
    w.byte(f1);
    for (const v of offsets) if (v !== 0) w.float(v);
    let f2 = 0;
    second.forEach((v, i) => { if (v !== 0) f2 |= 1 << i; });
    w.byte(f2);
    for (const v of second) if (v !== 0) w.float(v);
  }

  // ── path constraints ────────────────────────────────────────────────────
  w.varint((json.path || []).length, true);
  for (const c of json.path || []) {
    w.string(c.name);
    w.varint(val(c, 'order', 0), true);
    w.bool(val(c, 'skin', false));
    w.varint((c.bones || []).length, true);
    for (const bone of c.bones || []) w.varint(boneAt(bone), true);
    w.varint(slotAt(c.target), true);
    const position = enumIndex(POSITION_MODE, val(c, 'positionMode', 'percent'), 'positionMode');
    const spacing = enumIndex(SPACING_MODE, val(c, 'spacingMode', 'length'), 'spacingMode');
    const rotate = enumIndex(ROTATE_MODE, val(c, 'rotateMode', 'tangent'), 'rotateMode');
    const offsetRotation = val(c, 'rotation', 0);
    let flags = (position & 1) | ((spacing & 3) << 1) | ((rotate & 3) << 3);
    if (offsetRotation !== 0) flags |= 128;
    w.byte(flags);
    if (offsetRotation !== 0) w.float(offsetRotation);
    w.float(val(c, 'position', 0));
    w.float(val(c, 'spacing', 0));
    const mixX = val(c, 'mixX', 1);
    w.float(val(c, 'mixRotate', 1)); w.float(mixX); w.float(val(c, 'mixY', mixX));
  }

  // ── physics constraints ─────────────────────────────────────────────────
  w.varint((json.physics || []).length, true);
  for (const c of json.physics || []) {
    w.string(c.name);
    w.varint(val(c, 'order', 0), true);
    w.varint(boneAt(c.bone), true);
    const limit = val(c, 'limit', 5000), mass = val(c, 'mass', 1);
    const fps = val(c, 'fps', 60);
    // The reader takes `step = 1 / readUnsignedByte()`. A fractional or out-of-range fps
    // would be truncated into a different simulation step. (Legacy wrote the byte as is.)
    if (!Number.isInteger(fps) || fps < 1 || fps > 255) {
      fail('binary-physics-fps', `Physics constraint "${c.name}": fps ${fps} cannot be stored; the binary format holds a whole number from 1 to 255.`,
        { constraint: c.name, fps });
    }
    const optional = [val(c, 'x', 0), val(c, 'y', 0), val(c, 'rotate', 0), val(c, 'scaleX', 0), val(c, 'shearX', 0)];
    let f1 = 0;
    if (val(c, 'skin', false)) f1 |= 1;
    optional.forEach((v, i) => { if (v !== 0) f1 |= 2 << i; });
    if (limit !== 5000) f1 |= 64;
    if (mass !== 1) f1 |= 128;                         // massInverse written only when set
    w.byte(f1);
    for (const v of optional) if (v !== 0) w.float(v);
    if (limit !== 5000) w.float(limit);
    w.byte(fps);
    w.float(val(c, 'inertia', 1));
    w.float(val(c, 'strength', 100));
    w.float(val(c, 'damping', 1));
    if (mass !== 1) w.float(1 / mass);
    w.float(val(c, 'wind', 0));
    w.float(val(c, 'gravity', 0));
    const mix = val(c, 'mix', 1);
    let f2 = 0;
    ['inertiaGlobal', 'strengthGlobal', 'dampingGlobal', 'massGlobal', 'windGlobal', 'gravityGlobal', 'mixGlobal']
      .forEach((field, i) => { if (val(c, field, false)) f2 |= 1 << i; });
    if (mix !== 1) f2 |= 128;
    w.byte(f2);
    if (mix !== 1) w.float(mix);
  }

  // ── skins ───────────────────────────────────────────────────────────────
  const constraintIndex = kind => new Map((json[kind] || []).map((c, i) => [c.name, i]));
  const indexes = { ik: constraintIndex('ik'), transform: constraintIndex('transform'),
    path: constraintIndex('path'), physics: constraintIndex('physics') };
  const constraintAt = (kind, name) => indexes[kind].has(name) ? indexes[kind].get(name)
    : fail('binary-unknown-constraint', `No ${kind} constraint named "${name}".`, { kind, constraint: name });

  const writeSkinSlots = skin => {
    const slots = Object.entries(skin.attachments || {});
    w.varint(slots.length, true);
    for (const [slotName, set] of slots) {
      w.varint(slotAt(slotName), true);
      const entries = Object.entries(set || {});
      w.varint(entries.length, true);
      for (const [key, att] of entries) {
        stringRef(key);
        writeAttachment(ctx, att, key);
      }
    }
  };

  if (defaultSkin) writeSkinSlots(defaultSkin);
  else w.varint(0, true);                              // "no default skin"

  w.varint(otherSkins.length, true);
  for (const skin of otherSkins) {
    w.string(skin.name);
    if (nonessential) w.int32(rgba8888(skin.color, 0x99ff99ff | 0));
    w.varint((skin.bones || []).length, true);
    for (const bone of skin.bones || []) w.varint(boneAt(bone), true);
    for (const kind of ['ik', 'transform', 'path', 'physics']) {
      w.varint((skin[kind] || []).length, true);
      for (const name of skin[kind] || []) w.varint(constraintAt(kind, name), true);
    }
    writeSkinSlots(skin);
  }

  // ── events ──────────────────────────────────────────────────────────────
  const eventNames = Object.keys(json.events || {});
  w.varint(eventNames.length, true);
  for (const name of eventNames) {
    const e = json.events[name] || {};
    w.string(name);
    w.varint(val(e, 'int', 0), false);
    w.float(val(e, 'float', 0));
    // The JSON reader's default string is "", not null.
    w.string(e.string ?? '');
    w.string(e.audio ?? null);
    // Both readers read volume and balance only for a truthy audio path. (Legacy wrote
    // them for audio: "" too, and every byte after the event shifted.)
    if (e.audio) {
      w.float(val(e, 'volume', 1));
      w.float(val(e, 'balance', 0));
    }
  }

  // ── animations ──────────────────────────────────────────────────────────
  const animNames = Object.keys(json.animations || {});
  w.varint(animNames.length, true);
  const eventIndex = new Map(eventNames.map((n, i) => [n, i]));
  for (const name of animNames) {
    w.string(name);
    writeAnimation({ ...ctx, eventIndex, constraintAt, events: json.events || {} }, json.animations[name] || {});
  }
  return w.done();
}

const refuseSequence = (att, key) => {
  if (att.sequence) {
    fail('binary-sequence-unsupported', `Attachment "${key}" uses a sequence; sequence attachments are not supported by the binary writer yet.`,
      { attachment: key });
  }
};

// ── one attachment ──────────────────────────────────────────────────────────
function writeAttachment(ctx, attIn, key) {
  const { w, stringRef, slotAt, skinOrder, nonessential } = ctx;
  const att = attIn || {};
  const type = String(att.type || 'region').toLowerCase();
  const name = att.name === undefined ? key : att.name;
  const nameDiffers = name !== key;
  const hasColor = att.color !== undefined;
  const hasPath = att.path !== undefined && att.path !== null && att.path !== name;
  // Name, path and colour share bits 8, 16 and 32 on the textured attachments.
  const textured = flags => {
    if (nameDiffers) flags |= 8;
    if (hasPath) flags |= 16;
    if (hasColor) flags |= 32;
    return flags;
  };
  const texturedTail = () => {
    if (nameDiffers) stringRef(name);
    if (hasPath) stringRef(att.path);
    if (hasColor) w.int32(rgba8888(att.color, 0xffffffff | 0));
  };

  if (type === 'region') {
    refuseSequence(att, key);
    const rotation = val(att, 'rotation', 0);
    w.byte(textured(rotation !== 0 ? 128 : 0));
    texturedTail();
    if (rotation !== 0) w.float(rotation);
    w.float(val(att, 'x', 0)); w.float(val(att, 'y', 0));
    w.float(val(att, 'scaleX', 1)); w.float(val(att, 'scaleY', 1));
    w.float(val(att, 'width', 0)); w.float(val(att, 'height', 0));
    return;
  }
  if (type === 'mesh') {
    refuseSequence(att, key);
    w.byte(textured(2 | (isWeighted(att) ? 128 : 0)));
    texturedTail();
    const hull = val(att, 'hull', 0);
    w.varint(hull, true);                              // the reader stores hullLength = hull << 1
    // The reader does not store a triangle count, it derives one: (vertexCount * 2 - hull
    // - 2) * 3, the triangulation of a polygon with `hull` boundary vertices. If the JSON
    // disagrees, the reader consumes the wrong number of indices and every byte after this
    // mesh is garbage, with no error at the point of damage. Refuse instead.
    const vertexCount = vertexCountOf(att);
    const expected = (vertexCount * 2 - hull - 2) * 3;
    const triangles = att.triangles || [];
    if (triangles.length !== expected) {
      fail('binary-mesh-triangles',
        `Mesh "${key}": ${triangles.length} triangle indices, but the binary format derives ${expected} from vertexCount ${vertexCount} and hull ${hull}. Written as is, everything after this mesh would decode as garbage.`,
        { attachment: key, expected, actual: triangles.length, vertexCount, hull });
    }
    writeVertices(w, att, key);
    for (const uv of att.uvs || []) w.float(uv);
    for (const t of triangles) w.varint(t, true);
    if (nonessential) {
      const edges = att.edges || [];
      w.varint(edges.length, true);
      for (const e of edges) w.varint(e, true);
      w.float(val(att, 'width', 0));
      w.float(val(att, 'height', 0));
    }
    return;
  }
  if (type === 'linkedmesh') {
    refuseSequence(att, key);
    w.byte(textured(3 | (val(att, 'timelines', true) ? 128 : 0)));
    texturedTail();
    const skinName = att.skin ?? 'default';
    const index = skinOrder.findIndex(s => s.name === skinName);
    if (index < 0) fail('binary-unknown-skin', `Linked mesh "${key}" names skin "${skinName}", which does not exist.`, { attachment: key, skin: skinName });
    w.varint(index, true);
    stringRef(att.parent);
    if (nonessential) { w.float(val(att, 'width', 0)); w.float(val(att, 'height', 0)); }
    return;
  }
  if (type === 'boundingbox') {
    let flags = 1;
    if (nameDiffers) flags |= 8;
    if (isWeighted(att)) flags |= 16;
    w.byte(flags);
    if (nameDiffers) stringRef(name);
    writeVertices(w, att, key);
    if (nonessential) w.int32(rgba8888(att.color, 0x60f000ff | 0));
    return;
  }
  if (type === 'path') {
    // The reader allocates vertexCount / 3 lengths and reads exactly that many floats. A
    // vertexCount that is not a multiple of 3 throws "Invalid array length" (that is
    // path-fix's case), and a lengths list of another size shifts every byte after it.
    // (Legacy wrote `lengths` as found.)
    const vertexCount = vertexCountOf(att);
    const lengths = att.lengths || [];
    if (vertexCount % 3 !== 0 || lengths.length !== vertexCount / 3) {
      fail('binary-path-lengths',
        `Path "${key}": vertexCount ${vertexCount} must be a multiple of 3 with vertexCount / 3 lengths; it has ${lengths.length}.`,
        { attachment: key, vertexCount, lengths: lengths.length });
    }
    let flags = 4;
    if (nameDiffers) flags |= 8;
    if (val(att, 'closed', false)) flags |= 16;
    if (val(att, 'constantSpeed', true)) flags |= 32;
    if (isWeighted(att)) flags |= 64;
    w.byte(flags);
    if (nameDiffers) stringRef(name);
    writeVertices(w, att, key);
    for (const l of lengths) w.float(l);
    if (nonessential) w.int32(rgba8888(att.color, 0xff7f00ff | 0));
    return;
  }
  if (type === 'point') {
    w.byte(nameDiffers ? 5 | 8 : 5);
    if (nameDiffers) stringRef(name);
    w.float(val(att, 'rotation', 0));
    w.float(val(att, 'x', 0)); w.float(val(att, 'y', 0));
    if (nonessential) w.int32(rgba8888(att.color, 0xf1f100ff | 0));
    return;
  }
  if (type === 'clipping') {
    let flags = 6;
    if (nameDiffers) flags |= 8;
    if (isWeighted(att)) flags |= 16;
    w.byte(flags);
    if (nameDiffers) stringRef(name);
    w.varint(slotAt(att.end), true);
    writeVertices(w, att, key);
    if (nonessential) w.int32(rgba8888(att.color, 0xce3a3aff | 0));
    return;
  }
  fail('binary-unknown-attachment-type', `Unknown attachment type "${type}" (${key}).`, { attachment: key, type });
}

const keyed = map => Object.entries(map || {}).filter(([, keys]) => (keys || []).length);
const BONE_TIMELINE = { rotate: BONE_ROTATE, translate: BONE_TRANSLATE, translatex: BONE_TRANSLATEX,
  translatey: BONE_TRANSLATEY, scale: BONE_SCALE, scalex: BONE_SCALEX, scaley: BONE_SCALEY,
  shear: BONE_SHEAR, shearx: BONE_SHEARX, sheary: BONE_SHEARY };
const PHYSICS_TIMELINE = { inertia: PHYSICS_INERTIA, strength: PHYSICS_STRENGTH, damping: PHYSICS_DAMPING,
  mass: PHYSICS_MASS, wind: PHYSICS_WIND, gravity: PHYSICS_GRAVITY, mix: PHYSICS_MIX };
// Colour timelines: [timeline id, colour field, its channel count, dark channel count].
// The JSON reader takes rgba/rgb from `color`, and rgba2/rgb2 from `light` and `dark`.
// (Legacy read `color` for the two-colour timelines and wrote white for every key.)
const COLOR_TIMELINE = { rgba: [SLOT_RGBA, 'color', 4, 0], rgb: [SLOT_RGB, 'color', 3, 0],
  rgba2: [SLOT_RGBA2, 'light', 4, 3], rgb2: [SLOT_RGB2, 'light', 3, 3] };
const unknownTimeline = (group, kind) =>
  fail('binary-unknown-timeline', `Unknown ${group} timeline "${kind}".`, { group, timeline: kind });

// ── one animation ───────────────────────────────────────────────────────────
function writeAnimation(ctx, anim) {
  const { w, stringRef, boneAt, slotAt, skinOrder, eventIndex, constraintAt, events } = ctx;
  w.varint(0, true);   // "number of timelines": the reader reads and discards it

  // slots
  const slotEntries = Object.entries(anim.slots || {});
  w.varint(slotEntries.length, true);
  for (const [slotName, map] of slotEntries) {
    w.varint(slotAt(slotName), true);
    const kinds = keyed(map);
    w.varint(kinds.length, true);
    for (const [kind, keys] of kinds) {
      if (kind === 'attachment') {
        w.byte(SLOT_ATTACHMENT); w.varint(keys.length, true);
        for (const k of keys) { w.float(val(k, 'time', 0)); stringRef(k.name ?? null); }
      } else if (COLOR_TIMELINE[kind]) {
        // All colour timelines share one shape: N colour bytes per key, then the curve.
        const [id, field, light, dark] = COLOR_TIMELINE[kind];
        w.byte(id);
        frames(w, keys, light + dark, k => {
          w.float(val(k, 'time', 0));
          for (const b of colorBytes(k[field], light, 'ffffffff')) w.byte(b);
          if (dark) for (const b of colorBytes(k.dark, dark, '000000')) w.byte(b);
        });
      } else if (kind === 'alpha') {
        w.byte(SLOT_ALPHA);
        frames(w, keys, 1, k => {
          w.float(val(k, 'time', 0));
          w.byte(Math.round(val(k, 'value', 1) * 255));
        });
      } else unknownTimeline('slot', kind);
    }
  }

  // bones
  const boneEntries = Object.entries(anim.bones || {});
  w.varint(boneEntries.length, true);
  for (const [boneName, map] of boneEntries) {
    w.varint(boneAt(boneName), true);
    const kinds = keyed(map);
    w.varint(kinds.length, true);
    for (const [rawKind, keys] of kinds) {
      const kind = rawKind.toLowerCase();
      if (kind === 'inherit') {
        w.byte(BONE_INHERIT); w.varint(keys.length, true);
        for (const k of keys) {
          w.float(val(k, 'time', 0));
          w.byte(enumIndex(INHERIT, val(k, 'inherit', 'normal'), 'inherit'));
        }
        continue;
      }
      const id = BONE_TIMELINE[kind];
      if (id === undefined) unknownTimeline('bone', rawKind);
      w.byte(id);
      if (kind === 'translate' || kind === 'shear') timeline2(w, keys, 'x', 0, 'y', 0);
      else if (kind === 'scale') timeline2(w, keys, 'x', 1, 'y', 1);
      else if (kind === 'scalex' || kind === 'scaley') timeline1(w, keys, 'value', 1);
      else timeline1(w, keys, 'value', 0);            // rotate, translatex/y, shearx/y
    }
  }

  // ik
  const ikEntries = Object.entries(anim.ik || {});
  w.varint(ikEntries.length, true);
  for (const [name, keys] of ikEntries) {
    w.varint(constraintAt('ik', name), true);
    w.varint(keys.length, true);
    w.varint(bezierCount(keys, 2), true);
    // IK packs its curve into the next frame's flag byte (bits 64 and 128) instead of a
    // separate curve byte, and the bezier floats follow that frame's values. So the flags
    // written for frame i describe frame i's own values and how the timeline got there
    // from frame i-1.
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i], prev = i > 0 ? keys[i - 1] : null;
      const mix = val(k, 'mix', 1), softness = val(k, 'softness', 0);
      const curve = prev && !isStepped(prev) ? bezierOf(prev) : null;
      let flags = 0;
      if (mix !== 0) { flags |= 1; if (mix !== 1) flags |= 2; }
      if (softness !== 0) flags |= 4;
      if (val(k, 'bendPositive', true)) flags |= 8;
      if (val(k, 'compress', false)) flags |= 16;
      if (val(k, 'stretch', false)) flags |= 32;
      if (prev && isStepped(prev)) flags |= 64;
      else if (curve) flags |= 128;
      w.byte(flags);
      w.float(val(k, 'time', 0));
      if (mix !== 0 && mix !== 1) w.float(mix);
      if (softness !== 0) w.float(softness);
      if (curve) {
        requireBezier(curve, 2);
        for (let j = 0; j < 8; j++) w.float(curve[j]);
      }
    }
  }

  // transform
  const transformEntries = Object.entries(anim.transform || {});
  w.varint(transformEntries.length, true);
  for (const [name, keys] of transformEntries) {
    w.varint(constraintAt('transform', name), true);
    frames(w, keys, 6, k => {
      const mixX = val(k, 'mixX', 1), mixScaleX = val(k, 'mixScaleX', 1);
      w.float(val(k, 'time', 0));
      w.float(val(k, 'mixRotate', 1));
      w.float(mixX); w.float(val(k, 'mixY', mixX));
      w.float(mixScaleX); w.float(val(k, 'mixScaleY', mixScaleX));
      w.float(val(k, 'mixShearY', 1));
    });
  }

  // path
  const pathEntries = Object.entries(anim.path || {});
  w.varint(pathEntries.length, true);
  for (const [name, map] of pathEntries) {
    w.varint(constraintAt('path', name), true);
    const kinds = keyed(map);
    w.varint(kinds.length, true);
    for (const [kind, keys] of kinds) {
      if (kind === 'position' || kind === 'spacing') {
        w.byte(kind === 'position' ? PATH_POSITION : PATH_SPACING);
        timeline1(w, keys, 'value', 0);
      } else if (kind === 'mix') {
        w.byte(PATH_MIX);
        frames(w, keys, 3, k => {
          const mixX = val(k, 'mixX', 1);
          w.float(val(k, 'time', 0));
          w.float(val(k, 'mixRotate', 1)); w.float(mixX); w.float(val(k, 'mixY', mixX));
        });
      } else unknownTimeline('path', kind);
    }
  }

  // physics
  const physicsEntries = Object.entries(anim.physics || {});
  w.varint(physicsEntries.length, true);
  for (const [name, map] of physicsEntries) {
    // The reader does `readInt(true) - 1`, so an empty constraint name (meaning "every
    // physics constraint") is index -1, written as 0.
    w.varint(name === '' ? 0 : constraintAt('physics', name) + 1, true);
    const kinds = keyed(map);
    w.varint(kinds.length, true);
    for (const [kind, keys] of kinds) {
      if (kind === 'reset') {
        w.byte(PHYSICS_RESET); w.varint(keys.length, true);
        for (const k of keys) w.float(val(k, 'time', 0));
        continue;
      }
      const id = PHYSICS_TIMELINE[kind];
      if (id === undefined) unknownTimeline('physics', kind);
      w.byte(id);
      timeline1(w, keys, 'value', 0);
    }
  }

  // deform (the JSON calls this group `attachments`)
  const deformEntries = Object.entries(anim.attachments || {});
  w.varint(deformEntries.length, true);
  for (const [skinName, slotMap] of deformEntries) {
    const skinIndex = skinOrder.findIndex(s => s.name === skinName);
    if (skinIndex < 0) fail('binary-unknown-skin', `A deform timeline names skin "${skinName}", which does not exist.`, { skin: skinName });
    w.varint(skinIndex, true);
    const slots = Object.entries(slotMap || {});
    w.varint(slots.length, true);
    for (const [slotName, attMap] of slots) {
      w.varint(slotAt(slotName), true);
      const atts = Object.entries(attMap || {});
      w.varint(atts.length, true);
      for (const [attName, timelineMap] of atts) {
        stringRef(attName);
        const kinds = keyed(timelineMap);
        if (kinds.length !== 1) {
          fail('binary-attachment-timeline-count', `Attachment "${attName}" must carry exactly one attachment timeline, has ${kinds.length}.`,
            { attachment: attName, count: kinds.length });
        }
        const [kind, keys] = kinds[0];
        if (kind === 'sequence') {
          fail('binary-sequence-unsupported', `Attachment "${attName}" has a sequence timeline; sequence timelines are not supported by the binary writer yet.`,
            { attachment: attName });
        }
        if (kind !== 'deform') unknownTimeline('attachment', kind);
        w.byte(ATTACHMENT_DEFORM);
        w.varint(keys.length, true);
        w.varint(bezierCount(keys, 1), true);
        // Deform interleaves differently again: the reader takes the first time up front,
        // then per frame reads the vertex block, and only afterwards the next time plus
        // the curve byte: time0, verts0, time1, curve0, verts1, time2, curve1, verts2, ...
        w.float(val(keys[0], 'time', 0));
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          const verts = k.vertices || null;
          if (!verts || !verts.length) w.varint(0, true);   // "no change this frame"
          else {
            w.varint(verts.length, true);
            w.varint(val(k, 'offset', 0), true);
            for (const v of verts) w.float(v);
          }
          if (i < keys.length - 1) {
            w.float(val(keys[i + 1], 'time', 0));
            writeCurve(w, k, 1);
          }
        }
      }
    }
  }

  // draw order. Only `drawOrder`: the JSON reader ignores any other spelling, so writing
  // one would make the binary play differently from its source. (Legacy also accepted
  // `draworder`.)
  const drawOrder = anim.drawOrder || [];
  w.varint(drawOrder.length, true);
  for (const frame of drawOrder) {
    w.float(val(frame, 'time', 0));
    // The reader walks slots in order (`while (originalIndex != slotIndex)`), so the
    // offsets are sorted by slot index; out of order it would run past the end.
    const sorted = (frame.offsets || []).map(o => ({ index: slotAt(o.slot), offset: val(o, 'offset', 0) }))
      .sort((a, b) => a.index - b.index);
    w.varint(sorted.length, true);
    for (const o of sorted) { w.varint(o.index, true); w.varint(o.offset, true); }
  }

  // events
  const keys = anim.events || [];
  w.varint(keys.length, true);
  for (const e of keys) {
    if (!eventIndex.has(e.name)) fail('binary-unknown-event', `No event named "${e.name}".`, { event: e.name });
    const def = events[e.name] || {};
    w.float(val(e, 'time', 0));
    w.varint(eventIndex.get(e.name), true);
    w.varint(val(e, 'int', val(def, 'int', 0)), false);
    w.float(val(e, 'float', val(def, 'float', 0)));
    // null means "the event's own string" to the reader; an explicit string is written.
    w.string(e.string ?? null);
    if (def.audio) {
      // The JSON reader's defaults here are 1 and 0, not the event definition's values.
      // (Legacy fell back to the definition's volume and balance.)
      w.float(val(e, 'volume', 1));
      w.float(val(e, 'balance', 0));
    }
  }
}
