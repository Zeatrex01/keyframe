// Every text colour the page uses is readable on every ground it sits on: at least 4.5:1 (WCAG AA
// for body text), in the dark theme and in the light one; and the light theme a system preference
// picks is the same as the one chosen in Settings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../web/tokens.css', import.meta.url), 'utf8');

/** The custom properties set in the first rule whose selector starts with `selector`. */
function block(selector) {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, selector);
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
}
const base = block(':root');
const themes = { dark: { ...base, ...block(':root, :root[data-theme="dark"], [data-ground="dark"]') }, light: { ...base, ...block(':root[data-theme="light"]') } };

function colour(vars, value, depth = 0) {
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  if (ref) { assert.ok(depth < 5 && vars[ref[1]], value); return colour(vars, vars[ref[1]], depth + 1); }
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  assert.ok(rgba, `a colour: ${value}`);
  return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
}
const over = (top, under) => top.slice(0, 3).map((c, i) => c * top[3] + under[i] * (1 - top[3])).concat(1);
const luminance = rgb => {
  const [r, g, b] = rgb.slice(0, 3).map(c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const TEXTS = ['--text', '--text-2', '--text-3', '--accent-text', '--agent-text', '--ok-text', '--bad-text', '--warn-text'];
const GROUNDS = ['--bg', '--surface', '--surface-2'];
// Tinted grounds the page puts text on: a soft wash over a surface, and the text drawn on it.
const TINTED = [['--agent-soft', '--surface', ['--text', '--text-2', '--agent-text']], ['--accent-soft', '--surface', ['--text', '--accent-text']],
  ['--ok-soft', '--surface-2', ['--ok-text']], ['--bad-soft', '--surface-2', ['--bad-text']], ['--warn-soft', '--surface', ['--warn-text']]];

for (const [name, vars] of Object.entries(themes)) {
  test(`${name}: every text token on every ground is at least 4.5:1`, () => {
    const low = [];
    for (const text of TEXTS) for (const ground of GROUNDS) {
      const r = ratio(over(colour(vars, vars[text]), colour(vars, vars[ground])), colour(vars, vars[ground]));
      if (r < 4.5) low.push(`${text} on ${ground}: ${r.toFixed(2)}`);
    }
    for (const [soft, under, texts] of TINTED) {
      const ground = over(colour(vars, vars[soft]), colour(vars, vars[under]));
      for (const text of texts) { const r = ratio(colour(vars, vars[text]), ground); if (r < 4.5) low.push(`${text} on ${soft}: ${r.toFixed(2)}`); }
    }
    const ink = ratio(colour(vars, vars['--accent-ink']), colour(vars, vars['--accent']));
    if (ink < 4.5) low.push(`--accent-ink on --accent: ${ink.toFixed(2)}`);
    assert.deepEqual(low, []);
  });
}

test('the light theme from the system preference is the light theme from Settings', () => {
  const at = css.indexOf('@media (prefers-color-scheme: light)');
  const body = css.slice(css.indexOf('{', css.indexOf(':root:not([data-theme])', at)) + 1, css.indexOf('}', css.indexOf(':root:not([data-theme])', at)));
  const system = Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  for (const [key, value] of Object.entries(system)) assert.equal(value, themes.light[key], key);
  for (const key of [...TEXTS, ...GROUNDS]) assert.ok(key in system, `${key} follows the system preference too`);
});

test('reduced motion stops the opening, the mark and the working diamond', () => {
  const pages = ['app.css', 'views.css', 'components.css', 'tokens.css'].map(f => fs.readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8')).join('\n');
  const reduced = [...pages.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n?\}\s*\}?/g)].map(m => m[1]).join('\n');
  for (const selector of ['.steps .s.now .kd', '.dot.busy', '.kf-mark-anim', '.splash-mark']) assert.ok(reduced.includes(selector), selector);
  assert.match(fs.readFileSync(new URL('../web/views.js', import.meta.url), 'utf8'), /prefers-reduced-motion: reduce\)'\)\.matches\) return still\(\)/, 'the live opening does not play');
});
