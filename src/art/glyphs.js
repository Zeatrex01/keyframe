// The icon family: one set of simple, bold glyphs drawn on the same 64-unit grid with the same
// weight, so icons placed side by side read as a family. Each is a body (one filled outline the
// style paints, outlines and shades) and optional details (cut-outs and marks in the ink or a
// darker tone). Original drawing, made from circles, arcs and straight lines. Pure.

const r2 = v => Math.round(v * 100) / 100;
const poly = pts => `M${pts.map(p => p.map(r2).join(' ')).join('L')}Z`;
const circle = (cx, cy, r) => `M${r2(cx - r)} ${cy}a${r} ${r} 0 1 0 ${r2(2 * r)} 0a${r} ${r} 0 1 0 ${r2(-2 * r)} 0Z`;
const rrect = (x, y, w, h, r) => `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
const star = (cx, cy, ro, ri, n = 5, turn = -90) => poly(Array.from({ length: n * 2 }, (_, i) => {
  const a = (turn + i * 180 / n) * Math.PI / 180, r = i % 2 ? ri : ro;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}));
const gear = (cx, cy, ro, ri, teeth) => poly(Array.from({ length: teeth * 4 }, (_, i) => {
  const k = Math.floor(i / 4), part = i % 4, step = 360 / teeth;
  const a = ((k * step) + [-0.18, 0.18, 0.32, 0.68][part] * step - 90) * Math.PI / 180;
  const r = part < 2 ? ro : ri;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}));

/** name -> { body, details?: [{ d, tone: 'ink' | 'dark' | 'light' | 'hole' }], note } */
export const GLYPHS = Object.freeze({
  star: { body: star(32, 34, 28, 13), note: 'favourite, rating, reward' },
  heart: { body: 'M32 56C10 42 4 30 6 20C8 10 18 5 26 9C29 10.5 31 13 32 15C33 13 35 10.5 38 9C46 5 56 10 58 20C60 30 54 42 32 56Z', note: 'life, like' },
  coin: { body: circle(32, 32, 26), details: [{ d: circle(32, 32, 18), tone: 'dark' }, { d: rrect(28, 20, 8, 24, 4), tone: 'light' }], note: 'currency' },
  gem: { body: poly([[14, 22], [24, 10], [40, 10], [50, 22], [32, 54]]), details: [{ d: poly([[14, 22], [50, 22], [32, 54]]), tone: 'dark' }, { d: poly([[24, 10], [30, 22], [20, 22]]), tone: 'light' }], note: 'premium currency' },
  check: { body: poly([[8, 34], [16, 26], [26, 36], [48, 12], [56, 20], [26, 52]]), note: 'confirm, done' },
  close: { body: poly([[14, 8], [32, 26], [50, 8], [56, 14], [38, 32], [56, 50], [50, 56], [32, 38], [14, 56], [8, 50], [26, 32], [8, 14]]), note: 'close, cancel' },
  plus: { body: poly([[26, 8], [38, 8], [38, 26], [56, 26], [56, 38], [38, 38], [38, 56], [26, 56], [26, 38], [8, 38], [8, 26], [26, 26]]), note: 'add, more' },
  minus: { body: rrect(8, 26, 48, 12, 3), note: 'remove, less' },
  play: { body: 'M18 10Q18 6 22 8L54 28Q58 32 54 36L22 56Q18 58 18 54Z', note: 'play, start' },
  pause: { body: `${rrect(14, 10, 13, 44, 3)}${rrect(37, 10, 13, 44, 3)}`, note: 'pause' },
  home: { body: poly([[32, 6], [58, 30], [50, 30], [50, 56], [38, 56], [38, 40], [26, 40], [26, 56], [14, 56], [14, 30], [6, 30]]), note: 'home, menu' },
  lock: { body: `${rrect(12, 28, 40, 28, 6)}M18 28V20A14 14 0 0 1 46 20V28H39V20A7 7 0 0 0 25 20V28Z`, details: [{ d: rrect(29, 36, 6, 12, 3), tone: 'ink' }], note: 'locked' },
  gear: { body: gear(32, 32, 27, 20, 8), details: [{ d: circle(32, 32, 9), tone: 'hole' }], note: 'settings' },
  sound: { body: poly([[8, 24], [20, 24], [34, 10], [34, 54], [20, 40], [8, 40]]), details: [{ d: 'M42 22Q48 32 42 42', tone: 'line' }, { d: 'M48 14Q60 32 48 50', tone: 'line' }], note: 'sound on' },
  mute: { body: poly([[8, 24], [20, 24], [34, 10], [34, 54], [20, 40], [8, 40]]), details: [{ d: 'M42 24L56 40M56 24L42 40', tone: 'line' }], note: 'sound off' },
  music: { body: `M22 12L52 6V44A8 7 0 1 1 46 37V18L28 22V50A8 7 0 1 1 22 43Z`, note: 'music' },
  back: { body: poly([[6, 32], [30, 8], [30, 22], [58, 22], [58, 42], [30, 42], [30, 56]]), note: 'back' },
  next: { body: poly([[58, 32], [34, 8], [34, 22], [6, 22], [6, 42], [34, 42], [34, 56]]), note: 'next, forward' },
  info: { body: circle(32, 32, 26), details: [{ d: rrect(28, 28, 8, 20, 3), tone: 'light' }, { d: circle(32, 19, 4.5), tone: 'light' }], note: 'information' },
  question: { body: circle(32, 32, 26), details: [{ d: 'M24 24Q24 15 32 15Q41 15 41 23Q41 29 35 31Q32 33 32 38', tone: 'lightline' }, { d: circle(32, 46, 3.5), tone: 'light' }], note: 'help' },
  trophy: { body: 'M16 8H48V24Q48 40 36 42V48H44V56H20V48H28V42Q16 40 16 24Z', details: [{ d: 'M16 14H8V20Q8 28 17 30', tone: 'line' }, { d: 'M48 14H56V20Q56 28 47 30', tone: 'line' }], note: 'win, achievement' },
  shield: { body: 'M32 6L54 14V30Q54 48 32 58Q10 48 10 30V14Z', details: [{ d: 'M32 13L47 18.5V30Q47 43 32 50Z', tone: 'dark' }], note: 'defence, safe' },
  bolt: { body: poly([[36, 4], [12, 36], [28, 36], [24, 60], [52, 24], [35, 24]]), note: 'energy, power' },
  clock: { body: circle(32, 32, 26), details: [{ d: 'M32 16V32L42 40', tone: 'inkline' }], note: 'time' },
  cart: { body: poly([[6, 12], [16, 12], [22, 40], [50, 40], [56, 20], [18, 20]]), details: [{ d: circle(25, 50, 5), tone: 'ink' }, { d: circle(47, 50, 5), tone: 'ink' }], note: 'shop' },
  user: { body: `${circle(32, 20, 12)}M10 58Q10 36 32 36Q54 36 54 58Z`, note: 'profile' },
  menu: { body: `${rrect(8, 12, 48, 9, 4)}${rrect(8, 28, 48, 9, 4)}${rrect(8, 44, 48, 9, 4)}`, note: 'menu' },
  refresh: { body: 'M32 8A24 24 0 1 1 9.4 40L17 37.3A16 16 0 1 0 32 16V24L18 12L32 0Z', note: 'retry, refresh' },
  key: { body: `${circle(18, 32, 12)}M28 28H58V36H54V44H47V36H28Z`, details: [{ d: circle(16, 32, 4), tone: 'hole' }], note: 'key, unlock' },
  flag: { body: 'M12 6H18V58H12ZM18 8Q30 2 40 8Q48 12 56 8V34Q48 38 40 34Q30 28 18 34Z', note: 'level, goal' },
});
export const GLYPH_NAMES = Object.freeze(Object.keys(GLYPHS));
