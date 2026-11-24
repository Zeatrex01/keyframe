// Labels as shapes: a small built-in stroke font, so a button says PLAY in every output (the
// studio's own renderer, an atlas PNG, an engine, a web page) without a font file or text support.
//
// Each glyph is a few strokes on a grid 10 units tall (y down, 0 the cap line, 10 the baseline),
// drawn with round caps and joins. Capitals, digits, common punctuation and the Turkish capitals
// (cedillas, breve, dots) are drawn; lower case is set as small capitals. Original drawing. Pure.

const arc = (cx, cy, rx, ry, a0, a1, step = 15) => {
  const out = [], n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / step));
  for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
  return out;
};
const dot = (x, y) => [[x, y - 0.2], [x, y + 0.2]];

/** glyph: [advance width, strokes]; a stroke is a list of [x, y] points. */
const G = {
  A: [6, [[[0, 10], [3, 0], [6, 10]], [[1.1, 6.6], [4.9, 6.6]]]],
  B: [5.8, [[[0, 5], [0, 0], [3.4, 0], ...arc(3.4, 2.5, 2.1, 2.5, -90, 90), [0, 5], [3.6, 5], ...arc(3.6, 7.5, 2.2, 2.5, -90, 90), [0, 10], [0, 5]]]],
  C: [6.2, [arc(3.4, 5, 3.2, 5, -45, -315)]],
  D: [6.2, [[[2.4, 10], [0, 10], [0, 0], [2.4, 0], ...arc(2.4, 5, 3.6, 5, -90, 90)]]],
  E: [5.4, [[[5.4, 0], [0, 0], [0, 10], [5.4, 10]], [[0, 5], [4.4, 5]]]],
  F: [5.2, [[[5.2, 0], [0, 0], [0, 10]], [[0, 5], [4.2, 5]]]],
  G: [6.4, [[...arc(3.4, 5, 3.2, 5, -45, -360), [3.8, 5]]]],
  H: [6, [[[0, 0], [0, 10]], [[6, 0], [6, 10]], [[0, 5], [6, 5]]]],
  I: [0.01, [[[0, 0], [0, 10]]]],
  J: [5, [[[5, 0], [5, 7.4], ...arc(2.5, 7.4, 2.5, 2.6, 0, 180)]]],
  K: [5.8, [[[0, 0], [0, 10]], [[5.6, 0], [0, 6.2]], [[2, 4.3], [5.8, 10]]]],
  L: [5, [[[0, 0], [0, 10], [5, 10]]]],
  M: [7.2, [[[0, 10], [0, 0], [3.6, 6.4], [7.2, 0], [7.2, 10]]]],
  N: [6, [[[0, 10], [0, 0], [6, 10], [6, 0]]]],
  O: [7, [arc(3.5, 5, 3.5, 5, 0, 360)]],
  P: [5.6, [[[0, 10], [0, 0], [3.2, 0], ...arc(3.2, 2.7, 2.4, 2.7, -90, 90), [0, 5.4]]]],
  Q: [7, [arc(3.5, 5, 3.5, 5, 0, 360), [[4.2, 7.2], [7.2, 10.6]]]],
  R: [5.8, [[[0, 10], [0, 0], [3.2, 0], ...arc(3.2, 2.7, 2.4, 2.7, -90, 90), [0, 5.4]], [[2.8, 5.4], [5.8, 10]]]],
  S: [5.8, [[...arc(2.9, 2.5, 2.7, 2.5, -20, -270), ...arc(2.9, 7.5, 2.9, 2.5, -90, 160)]]],
  T: [6, [[[0, 0], [6, 0]], [[3, 0], [3, 10]]]],
  U: [6, [[[0, 0], [0, 6.8], ...arc(3, 6.8, 3, 3.2, 180, 0), [6, 0]]]],
  V: [6.2, [[[0, 0], [3.1, 10], [6.2, 0]]]],
  W: [8.4, [[[0, 0], [2.1, 10], [4.2, 3], [6.3, 10], [8.4, 0]]]],
  X: [6, [[[0, 0], [6, 10]], [[6, 0], [0, 10]]]],
  Y: [6, [[[0, 0], [3, 5.2], [6, 0]], [[3, 5.2], [3, 10]]]],
  Z: [5.8, [[[0, 0], [5.8, 0], [0, 10], [5.8, 10]]]],
  0: [6, [arc(3, 5, 3, 5, 0, 360)]],
  1: [3.2, [[[0, 1.8], [2.2, 0], [2.2, 10]]]],
  2: [5.8, [[...arc(2.9, 2.9, 2.8, 2.9, -165, 10), [0, 10], [5.8, 10]]]],
  3: [5.6, [[...arc(2.7, 2.5, 2.6, 2.5, -160, 90), ...arc(2.7, 7.5, 2.9, 2.5, -90, 160)]]],
  4: [6, [[[4.6, 10], [4.6, 0], [0, 7], [6, 7]]]],
  5: [5.8, [[[5.4, 0], [0.8, 0], [0.4, 4.6], ...arc(2.8, 6.8, 3, 3.2, -135, 150)]]],
  6: [6, [[...arc(6, 7, 6, 7, -100, -180), ...arc(3, 7, 3, 3, 180, 540)]]],
  7: [5.8, [[[0, 0], [5.8, 0], [2, 10]]]],
  8: [6, [arc(3, 2.4, 2.6, 2.4, 90, 450), arc(3, 7.4, 3, 2.6, -90, 270)]],
  9: [6, [[...arc(3, 3, 3, 3, 0, 360), ...arc(0, 3, 6, 7, 0, 80)]]],
  '!': [0.01, [[[0, 0], [0, 6.6]], dot(0, 9.8)]],
  '?': [5.4, [[...arc(2.7, 2.7, 2.7, 2.7, -170, 60), [2.7, 6], [2.7, 6.8]], dot(2.7, 9.8)]],
  '.': [0.01, [dot(0, 9.8)]],
  ',': [1, [[[1, 9.3], [0.2, 11.4]]]],
  ':': [0.01, [dot(0, 3.2), dot(0, 9.8)]],
  '-': [4, [[[0, 5.6], [4, 5.6]]]],
  '_': [5, [[[0, 10.6], [5, 10.6]]]],
  '+': [5, [[[0, 5], [5, 5]], [[2.5, 2.5], [2.5, 7.5]]]],
  '/': [4.2, [[[0, 10.4], [4.2, -0.4]]]],
  '%': [6.4, [[[0.2, 10], [6.2, 0]], arc(1.3, 1.8, 1.3, 1.8, 0, 360), arc(5.1, 8.2, 1.3, 1.8, 0, 360)]],
  "'": [0.01, [[[0, 0], [0, 2.6]]]],
  '\u00d7': [5, [[[0.5, 3], [4.5, 7.4]], [[4.5, 3], [0.5, 7.4]]]],
  ' ': [3.4, []],
};
const MARKS = {
  '\u00c7': ['C', [[[3.4, 10], [3.4, 11], [2.4, 12.2]]]],
  '\u015e': ['S', [[[2.9, 10], [2.9, 11], [1.9, 12.2]]]],
  '\u011e': ['G', [arc(3.4, -2.6, 1.6, 1.2, 0, 180)]],
  '\u00d6': ['O', [dot(2.2, -2), dot(4.8, -2)]],
  '\u00dc': ['U', [dot(1.7, -2), dot(4.3, -2)]],
  '\u0130': ['I', [dot(0, -2)]],
};
const LOWER = { '\u00e7': '\u00c7', '\u015f': '\u015e', '\u011f': '\u011e', '\u00f6': '\u00d6', '\u00fc': '\u00dc', '\u0131': 'I', 'i': 'I' };
const GAP = 2.4, SMALL = 0.74;

/** The glyph for a character: [width, strokes], or null when the font has none. */
function glyph(ch) {
  if (G[ch]) return G[ch];
  if (MARKS[ch]) { const [base, extra] = MARKS[ch]; return [G[base][0], [...G[base][1], ...extra]]; }
  return null;
}

/**
 * A line of text as strokes, laid out in a box.
 * @param {string} text
 * @param {{ size: number, upper?: boolean, align?: 'start' | 'middle' | 'end', x?: number, y?: number, tracking?: number }} options
 *   size: cap height in units; (x, y): the anchor on the baseline's middle (align middle) or ends
 * @returns {{ strokes: number[][][], width: number, missing: string[] }}
 */
export function layoutText(text, { size, upper = true, align = 'middle', x = 0, y = 0, tracking = 0 }) {
  const s = size / 10, strokes = [], missing = [];
  const chars = [...String(text ?? '')].map(ch => {
    const small = !upper && ch !== ch.toUpperCase();
    const key = LOWER[ch] ?? ch.toUpperCase();
    const g = glyph(key) ?? glyph(ch);
    if (!g) missing.push(ch);
    return { g: g ?? G['?'], k: small ? SMALL : 1 };
  });
  const widthOf = c => (c.g[0] + GAP + tracking) * c.k * s;
  const total = chars.reduce((sum, c) => sum + widthOf(c), 0) - (chars.length ? (GAP + tracking) * chars[chars.length - 1].k * s : 0);
  let pen = align === 'middle' ? x - total / 2 : align === 'end' ? x - total : x;
  for (const c of chars) {
    const k = c.k * s;
    for (const stroke of c.g[1]) strokes.push(stroke.map(([gx, gy]) => [round(pen + gx * k), round(y - (10 - gy) * k)]));
    pen += widthOf(c);
  }
  return { strokes, width: round(total), missing: [...new Set(missing)] };
}
const round = v => Math.round(v * 100) / 100;

/** Strokes as one SVG path `d`. */
export const strokesPath = strokes => strokes.filter(s => s.length).map(s => `M${s.map(p => p.join(' ')).join('L')}`).join('');

/** The characters the font draws (for the docs and the tool text). */
export const FONT_CHARACTERS = [...Object.keys(G), ...Object.keys(MARKS)].filter(c => c !== ' ').join('');
