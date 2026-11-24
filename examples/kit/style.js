// The shared look of the showcase art: flat gradients, a chunky dark outline, a soft gloss.
// Colours follow the brand (key amber, onion violet) where the art carries the studio's voice.

export const INK = '#2b1b4d';
export const AMBER = ['#ffd27a', '#f4ae3f', '#d98a1c'];
export const VIOLET = ['#b3a8ff', '#8b7bff', '#5b4be0'];

/** n-point star path centred at cx, cy. */
export function star(g, cx, cy, outer, inner, n = 5, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) { const r = i % 2 ? inner : outer, a = rot + i * Math.PI / n; g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  g.closePath();
}
/** Fill the current path, then outline it in ink. */
export function paint(g, fill, line = 6) {
  g.fillStyle = fill; g.fill();
  if (line) { g.strokeStyle = INK; g.lineWidth = line; g.stroke(); }
}
/** A soft white highlight on the top of the shape `path` (a function that rebuilds the path). */
export function gloss(g, path, x, y, w, h, alpha = 0.38) {
  g.save(); path(); g.clip();
  g.fillStyle = g.linear(0, y, 0, y + h, [`rgba(255,255,255,${alpha})`, 'rgba(255,255,255,0)']);
  g.beginPath(); g.ellipse(x + w / 2, y + h * 0.18, w * 0.62, h * 0.42, 0, 0, 7); g.fill();
  g.restore();
}
/** A darker band at the bottom of the shape `path`, for volume. */
export function shade(g, path, y, h, alpha = 0.18) {
  g.save(); path(); g.clip(); g.fillStyle = `rgba(43,27,77,${alpha})`; g.fillRect(-999, y, 9999, h); g.restore();
}
/** A soft round glow: `color` at the centre fading to nothing. */
export function glow(g, w, h, color, inner = 0) {
  const [r, gr, b, a] = color;
  g.beginPath(); g.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, 7);
  g.save(); g.translate(w / 2, h / 2); g.scale(1, h / w);
  const fill = g.radial(0, 0, inner, w / 2, [`rgba(${r},${gr},${b},${a})`, `rgba(${r},${gr},${b},${a * 0.45})`, `rgba(${r},${gr},${b},0)`]);
  g.restore(); g.fillStyle = fill; g.fill();
}
/** A four-point sparkle with a bright core. */
export function sparkle(g, w, h, color = '#fff7c9') {
  star(g, w / 2, h / 2, w / 2 - 1, w * 0.11, 4); g.fillStyle = color; g.fill();
  g.beginPath(); g.arc(w / 2, h / 2, w * 0.12, 0, 7); g.fillStyle = '#ffffff'; g.fill();
}
/** A soft ground shadow. */
export function shadow(g, w, h, alpha = 0.45) {
  g.save(); g.translate(w / 2, h / 2); g.scale(1, h / w);
  g.beginPath(); g.arc(0, 0, w / 2, 0, 7);
  g.fillStyle = g.radial(0, 0, 1, w / 2, [`rgba(10,6,25,${alpha})`, 'rgba(10,6,25,0)']); g.fill();
  g.restore();
}
