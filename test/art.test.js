// Gate for the drawing side (src/art): the style guide, parametric shapes, the stroke font, the icon
// family, components with states, draw_rig drawing from them (and restyling, and artboards),
// critique_art and export_art, and the token budget that makes drawing cheap.
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { presetStyle, validateStyle, colorOf, contrast, STYLE_PRESETS } from '../src/art/style.js';
import { layoutText, FONT_CHARACTERS } from '../src/art/font.js';
import { renderShapes } from '../src/art/shapes.js';
import { GLYPH_NAMES } from '../src/art/glyphs.js';
import { componentParts, COMPONENTS } from '../src/art/components.js';
import { expandParts, deriveShapes } from '../src/art/draw-spec.js';
import { critiqueArt } from '../src/art/critique-art.js';
import { FIGURE_PARTS } from '../src/art/figure.js';
import { editableOf, applyEdit } from '../src/art/edit.js';
import { jointSeparations } from '../src/understand/joints.js';
import { critiqueAnimation } from '../src/understand/critique.js';
import { rasterizeSvg, svgSize } from '../src/engine/svg.js';
import { safeTree } from '../src/render/svg-safe.js';
import { decodePng } from '../src/render/png.js';
import { createServer } from '../src/mcp/server.js';

const style = validateStyle(presetStyle('casual-game'));

test('a style guide fills from its preset, names colours by role and refuses what it cannot use', () => {
  for (const name of Object.keys(STYLE_PRESETS)) assert.equal(validateStyle(presetStyle(name)).preset, name);
  const own = validateStyle({ preset: 'flat-web', palette: { brand: '#ff00aa' } });
  assert.equal(own.palette.brand, '#ff00aa');
  assert.equal(own.palette.primary, STYLE_PRESETS['flat-web'].palette.primary, 'the rest comes from the preset');
  assert.equal(colorOf(style, 'primary'), style.palette.primary);
  assert.notEqual(colorOf(style, 'primary-20'), style.palette.primary);
  assert.ok(contrast(colorOf(style, 'primary-40'), '#000000') < contrast(style.palette.primary, '#000000'), 'minus is darker');
  assert.ok(contrast(colorOf(style, 'primary+40'), '#000000') > contrast(style.palette.primary, '#000000'), 'plus is lighter');
  assert.equal(colorOf(style, 'none'), 'none');
  assert.throws(() => colorOf(style, 'brandX'), /not a palette role/);
  assert.throws(() => validateStyle({ palette: { primary: 'green' } }), { code: 'bad-style' });
  assert.throws(() => validateStyle({ light: { shade: 3 } }), /light.shade/);
});

test('the stroke font sets labels, Turkish capitals included, and names what it cannot draw', () => {
  const play = layoutText('PLAY', { size: 20, x: 50, y: 30 });
  assert.ok(play.strokes.length >= 4);
  const xs = play.strokes.flat().map(p => p[0]);
  assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 50) < 2, 'centred on x');
  assert.ok(play.strokes.flat().every(p => p[1] <= 30.1 && p[1] >= 9.9), 'sits between the cap line and the baseline');
  assert.deepEqual(layoutText('\u00c7\u011e\u0130\u00d6\u015e\u00dc \u00e7\u011f\u0131\u00f6\u015f\u00fc 0123456789', { size: 10 }).missing, []);
  assert.deepEqual(layoutText('a\u20acb', { size: 10 }).missing, ['\u20ac']);
  assert.ok(FONT_CHARACTERS.includes('Z') && FONT_CHARACTERS.includes('9'));
});

test('shapes become one clean SVG in the guide: gradients, outline, shine, text and icons all draw', () => {
  const { svg, missing } = renderShapes({ box: [220, 90], shapes: [
    { rect: [0, 0, 220, 80], r: 'pill', fill: 'primary', shine: true, shadow: true },
    { text: 'PLAY', at: [110, 54], size: 'md' },
    { icon: 'star', box: [10, 10, 40] },
    { circle: [200, 20, 10], fill: '#123456', stroke: false },
  ] }, style);
  assert.deepEqual(missing, []);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 220 90"/);
  assert.match(svg, /linearGradient/);
  assert.match(svg, new RegExp(`stroke="${style.palette.ink}"`));
  const img = rasterizeSvg(svg, { width: 220, height: 90 });
  assert.deepEqual(img.skipped, []);
  assert.ok(img.data[(40 * 220 + 110) * 4 + 3] > 200, 'the body is drawn');
  const tree = safeTree(svg, 'p');
  assert.equal(tree.shapes > 5, true, 'the safe subset keeps it whole');
  for (const name of GLYPH_NAMES) assert.doesNotThrow(() => rasterizeSvg(renderShapes({ box: [64, 64], shapes: [{ icon: name }] }, style).svg, { width: 32, height: 32 }), name);
  assert.throws(() => renderShapes({ box: [10, 10], shapes: [{ blob: 1 }] }, style), /names no shape/);
  assert.throws(() => renderShapes({ box: [10, 10], shapes: [{ icon: 'unicorn' }] }, style), /icon family/);
});

test('components split into the parts an animator needs, with states as other looks', () => {
  assert.ok(Object.keys(COMPONENTS).length >= 8);
  const button = componentParts({ component: 'button', label: 'GO' }, style, 'go');
  assert.equal(button.length, 1);
  assert.deepEqual(Object.keys(button[0].states), ['hover', 'pressed', 'disabled']);
  assert.deepEqual(componentParts({ component: 'progress' }, style, 'xp').map(p => p.name), ['xp_track', 'xp_fill', 'xp_frame']);
  const fill = componentParts({ component: 'progress' }, style, 'xp')[1];
  assert.equal(fill.pivot[0], -fill.box[0] / 2, 'the fill turns and scales from its left edge');
  assert.deepEqual(componentParts({ component: 'toggle' }, style, 's').map(p => p.name), ['s_track', 's_knob']);
  assert.deepEqual(componentParts({ component: 'popup', title: 'HI' }, style, 'w').map(p => p.name), ['w_dim', 'w', 'w_title', 'w_ok', 'w_close']);
  assert.ok(componentParts({ component: 'badge', value: '5' }, style, 'b').some(p => p.blend === 'additive'));
  assert.throws(() => componentParts({ component: 'carousel' }, style, 'x'), /not a component/);
  const pressed = deriveShapes([{ rect: [0, 0, 10, 10], fill: 'primary', shine: true }], 'pressed', style)[0];
  assert.equal(pressed.fill, 'primary-18');
  assert.equal(pressed.shine, false);
  assert.equal(pressed.rect[1], style.light.shadow * 0.75, 'a pressed state sinks by the shadow depth');
});

function studio() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-art-'));
  const sent = [];
  const { wire } = createServer({ session: { dir, writable: () => true }, version: 'test', write: m => sent.push(m), all: true });
  let chars = 0;
  const call = async (name, args) => { chars += JSON.stringify(args).length; sent.length = 0; await wire.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }); const r = sent[0].result;
    // A tool that shows an image answers with the image and its result as text.
    if (r.structuredContent) return r.structuredContent;
    const image = r.content?.find(c => c.type === 'image'), text = r.content?.find(c => c.type === 'text');
    return image ? { image, meta: JSON.parse(text.text) } : JSON.parse(text?.text ?? 'null');
  };
  return { dir, call, chars: () => chars, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const PACK = [
  { name: 'play', component: { component: 'button', label: 'PLAY', icon: 'play' }, at: [0, 300] },
  { name: 'shop', component: { component: 'button', label: 'SHOP', color: 'secondary', icon: 'cart' }, at: [0, 180] },
  { name: 'gear', component: { component: 'iconButton', icon: 'gear', color: 'surfaceAlt' }, at: [240, 300] },
  { name: 'xp', component: { component: 'progress' }, at: [0, 80] },
  { name: 'sound', component: { component: 'toggle' }, at: [240, 180] },
  { name: 'reward', component: { component: 'badge', icon: 'coin', value: '+250' }, at: [480, 240] },
  { name: 'heart', component: { component: 'icon', icon: 'heart', plate: 'round', color: 'danger' }, at: [240, 80] },
  { name: 'win', component: { component: 'popup', title: 'YOU WIN!', lines: ['Level 3 complete'], button: 'NEXT' }, at: [0, -240] },
];

test('draw_rig draws components and shapes in the style guide, states as slot attachments, at a small token cost', async () => {
  const s = studio();
  try {
    const guide = await s.call('style_guide', { preset: 'casual-game', name: 'pack' });
    assert.equal(guide.guide.name, 'pack');
    assert.ok(fs.existsSync(path.join(s.dir, 'keyframe.style.json')));
    const before = s.chars();
    const r = await s.call('draw_rig', { name: 'ui', folder: 'ui', parts: PACK });
    assert.equal(r.error, undefined, JSON.stringify(r.error));
    const spent = s.chars() - before;
    assert.equal(r.style, 'pack');
    const sk = JSON.parse(fs.readFileSync(path.join(s.dir, 'ui', 'ui.json'), 'utf8'));
    const skin = sk.skins[0].attachments;
    assert.deepEqual(Object.keys(skin.play), ['play', 'play_hover', 'play_pressed', 'play_disabled']);
    assert.equal(sk.slots.find(x => x.name === 'play').attachment, 'play', 'the setup look is the normal one');
    const atlas = fs.readFileSync(path.join(s.dir, 'ui', 'ui.atlas'), 'utf8');
    assert.match(atlas, /^play_pressed$/m);
    assert.ok(sk.bones.find(b => b.name === 'win_ok').parent === 'win', 'the popup button rides on the popup');
    // The token budget: the whole pack costs a few hundred tokens to ask for, a fraction of its SVG.
    const doc = JSON.parse(fs.readFileSync(path.join(s.dir, 'ui', 'ui.parts.json'), 'utf8'));
    const svgChars = doc.parts.reduce((n, p) => n + p.svg.length + Object.values(p.states ?? {}).reduce((m, v) => m + v.length, 0), 0);
    assert.ok(spent <= 1200, `the pack's arguments are ${spent} characters (budget 1200, about 300 tokens)`);
    assert.ok(svgChars / spent >= 50, `written as SVG it would be ${Math.round(svgChars / spent)}x larger`);
    const answer = JSON.stringify(r).length;
    assert.ok(answer <= 2500, `the answer stays short (${answer} characters)`);
  } finally { s.done(); }
});

test('a changed style guide redraws a drawing (restyle), and an artboard writes SVG and PNG with no skeleton', async () => {
  const s = studio();
  try {
    await s.call('draw_rig', { name: 'ui', parts: PACK.slice(0, 2).concat({ name: 'dot', box: [40, 40], shapes: [{ circle: [20, 20, 16], fill: 'accent' }], at: [300, 0], states: ['hover'] }) });
    const before = JSON.parse(fs.readFileSync(path.join(s.dir, 'ui.parts.json'), 'utf8'));
    await s.call('style_guide', { set: { palette: { primary: '#aa22cc', accent: '#00aaff' } } });
    const again = await s.call('draw_rig', { name: 'ui', restyle: true });
    assert.equal(again.error, undefined, JSON.stringify(again.error));
    const after = JSON.parse(fs.readFileSync(path.join(s.dir, 'ui.parts.json'), 'utf8'));
    assert.deepEqual(after.parts.map(p => p.name), before.parts.map(p => p.name));
    assert.notEqual(after.parts[0].svg, before.parts[0].svg);
    assert.match(after.parts.find(p => p.name === 'dot').svg, /#00aaff|#[0-9a-f]{6}/);
    assert.notEqual(after.parts.find(p => p.name === 'dot').svg, before.parts.find(p => p.name === 'dot').svg);
    assert.equal(after.parts[1].svg, before.parts[1].svg.replace(/x/g, 'x'), 'a secondary-coloured button does not change');

    const board = await s.call('draw_rig', { name: 'icons', as: 'artboard', parts: ['heart', 'star', 'coin'].map((icon, i) => ({ name: icon, box: [64, 64], shapes: [{ icon }], at: [i * 80, 0] })) });
    assert.equal(board.kind, 'artboard');
    assert.deepEqual(board.written.sort(), ['icons.parts.json', 'icons.png', 'icons.svg']);
    assert.ok(!fs.existsSync(path.join(s.dir, 'icons.json')), 'no skeleton for an artboard');
    const png = decodePng(fs.readFileSync(path.join(s.dir, 'icons.png')));
    assert.ok(png.width > png.height * 2, 'three icons side by side');
    assert.match(fs.readFileSync(path.join(s.dir, 'icons.svg'), 'utf8'), /<g id="heart"/);
    const kept = await s.call('draw_rig', { name: 'icons', parts: [{ name: 'heart', box: [64, 64], shapes: [{ icon: 'heart' }], at: [0, 0] }] });
    assert.equal(kept.kind, 'artboard', 'a drawing keeps its kind');
  } finally { s.done(); }
});

test('critique_art flags off-palette colours, states that look alike and near-misses, and passes a clean drawing', () => {
  const part = (name, svg, at, extra = {}) => ({ name, svg, at, pivot: at, size: [100, 40], ...extra });
  const button = renderShapes({ box: [100, 40], shapes: [{ rect: [2, 2, 96, 36], r: 'md', fill: 'primary' }] }, style).svg;
  const clean = { name: 'c', parts: [part('a', button, [0, 0]), part('b', button, [0, 60])] };
  assert.equal(critiqueArt(clean, style).counts.warn, 0, JSON.stringify(critiqueArt(clean, style).findings));
  const odd = button.replace(/#[0-9a-f]{6}"\/><\/svg>|stop-color="#[0-9a-f]{6}"/, 'stop-color="#13f2a0"');
  const bad = { name: 'b', parts: [
    part('a', odd, [0, 0]),
    part('b', button, [2, 60], { states: { pressed: button } }),
  ] };
  const checks = critiqueArt(bad, style).findings.map(f => f.check);
  assert.ok(checks.includes('palette'), 'an off-palette colour');
  assert.ok(checks.includes('states'), 'a pressed look identical to the normal one');
  assert.ok(checks.includes('align'), 'two parts 2 units apart');
});

test('text is set to fit its shape, centred on its ink, and critique_art catches text cut off or off the middle', () => {
  // A popup title is measured, never guessed from its letter count: the ribbon holds it, centred.
  for (const preset of ['casual-game', 'flat-web', 'dark-sci']) {
    const st = validateStyle(presetStyle(preset));
    const { parts } = expandParts([{ name: 'win', component: { component: 'popup', title: 'YOU WON 250', lines: ['Coins added to your bank'] } },
      { name: 'go', component: { component: 'button', label: 'CONTINUE TO THE NEXT LEVEL', icon: 'play', w: 200 } }], st);
    for (const p of parts) for (const t of p.source?.texts ?? []) {
      assert.ok(t.ink[0] >= t.frame[0] - 0.5 && t.ink[2] <= t.frame[2] + 0.5, `${preset} ${p.name}: "${t.text}" stays inside its shape`);
      if (t.align === 'middle') assert.ok(Math.abs((t.ink[0] + t.ink[2]) / 2 - (t.frame[0] + t.frame[2]) / 2) < 1, `${preset} ${p.name}: "${t.text}" is centred`);
      if (p.name === 'win_title') assert.equal(t.size, t.asked, `${preset}: the ribbon is made wide enough for its title`);
    }
    const doc = { name: 'w', parts: parts.map(p => ({ ...p, size: p.source?.texts?.[0]?.box ?? [100, 100] })) };
    assert.deepEqual(critiqueArt(doc, st).findings.filter(f => f.check === 'text' && f.level === 'warn'), [], preset);
  }
  const one = layoutText('1', { size: 20 });
  assert.ok(Math.abs((one.bounds[0] + one.bounds[2]) / 2) < 0.05, 'centred text is centred on its ink');
  // A long label in a small box is set smaller, and says so.
  const long = renderShapes({ box: [120, 40], shapes: [{ rect: [0, 0, 120, 40], fill: 'primary' }, { text: 'A VERY LONG LABEL', at: [60, 28], size: 20 }] }, style).texts[0];
  assert.ok(long.size < long.asked && long.ink[2] <= 120, 'shrunk to fit');
  const part = (texts, svg) => ({ name: 'p', svg, at: [0, 0], pivot: [0, 0], size: [200, 60], source: { texts } });
  const draw = shapes => renderShapes({ box: [200, 60], shapes: [{ rect: [0, 0, 200, 60], fill: 'primary' }, ...shapes] }, style);
  const textsOf = shapes => { const d = draw(shapes); return critiqueArt({ name: 'x', parts: [part(d.texts, d.svg)] }, style).findings.filter(f => f.check === 'text').map(f => f.message); };
  assert.deepEqual(textsOf([{ text: 'PLAY', at: [100, 40] }]), [], 'centred');
  assert.match(textsOf([{ text: 'PLAY', at: [130, 40] }]).join(' '), /right of the middle/);
  assert.match(textsOf([{ text: 'A VERY LONG LABEL TEXT', at: [100, 40], fit: false }]).join(' '), /cut off/);
  assert.match(textsOf([{ text: 'PLAY', at: [100, 22], size: 12 }]).join(' '), /above the middle/);
});

test('a figure is jointed: limbs in three parts with hands and feet, each turning at its joint, so a wave keeps the arm on', async () => {
  const s = studio();
  try {
    const r = await s.call('draw_rig', { name: 'kid', parts: [{ name: 'kid', component: { component: 'figure', h: 320 }, at: [0, 0] }] });
    assert.equal(r.error, undefined, JSON.stringify(r.error));
    assert.deepEqual([...r.parts].sort(), [...FIGURE_PARTS].sort());
    const sk = JSON.parse(fs.readFileSync(path.join(s.dir, 'kid.json'), 'utf8'));
    const parent = Object.fromEntries(sk.bones.map(b => [b.name, b.parent]));
    for (const [child, up] of [['handR', 'forearmR'], ['forearmR', 'upperArmR'], ['upperArmR', 'body'], ['footL', 'shinL'], ['shinL', 'thighL'], ['head', 'body']]) assert.equal(parent[child], up, child);
    // Turned at the shoulder and elbow the arm stays on, and the hand clears the head: a wave that reads.
    const wave = { bones: {
      upperArmR: { rotate: [{ time: 0, value: 0 }, { time: 0.3, value: -165 }, { time: 1.2, value: -160 }, { time: 1.5, value: 0 }] },
      forearmR: { rotate: [{ time: 0.3, value: 0 }, { time: 0.5, value: -25 }, { time: 0.7, value: 20 }, { time: 0.9, value: -25 }, { time: 1.1, value: 20 }, { time: 1.3, value: 0 }] },
      body: { rotate: [{ time: 0, value: 0 }, { time: 0.6, value: 3 }, { time: 1.5, value: 0 }] },
    } };
    const posed = { ...sk, animations: { wave } };
    assert.deepEqual(jointSeparations(posed, 'wave'), [], 'no limb comes apart');
    const codes = critiqueAnimation(posed, 'wave', { subject: 'character' }).findings.map(f => f.code);
    assert.ok(!codes.includes('low-wave') && !codes.includes('limb-separates'), codes.join(', '));
    // Moving the arm instead of turning it pulls it off the shoulder.
    const pulled = { ...sk, animations: { wave: { bones: { upperArmR: { translate: [{ time: 0, x: 0, y: 0 }, { time: 0.5, x: -40, y: 30 }, { time: 1, x: 0, y: 0 }] } } } } };
    assert.equal(jointSeparations(pulled, 'wave')[0]?.limb, 'upperArmR');
  } finally { s.done(); }
});

test('the words and colours of AI-drawn parts are edited by hand and drawn again in the guide, keeping where the owner put them', () => {
  const { parts } = expandParts([{ name: 'win', component: { component: 'popup', title: 'YOU WON', lines: ['Nice'] }, at: [0, 0] },
    { name: 'coin', box: [64, 64], shapes: [{ circle: [32, 32, 28], fill: 'reward' }, { text: '5', at: [32, 44], size: 24 }], at: [300, 0] }], style);
  const sized = parts.map(p => ({ ...p, size: [svgSize(p.svg).width, svgSize(p.svg).height] }));
  const moved = sized.map(p => (p.name === 'win_title' ? { ...p, at: [12, 140] } : p));
  const fields = editableOf(moved, moved.find(p => p.name === 'win_title'));
  assert.equal(fields.owner, 'win', 'a sub-part edits its component');
  assert.deepEqual(fields.texts.map(t => t.key), ['title', 'lines.0']);
  assert.ok(fields.colours.some(c => c.key === 'titleColor'));
  const retitled = applyEdit(moved, 'win_title', 'title', 'YOU WON 250', style);
  const title = retitled.find(p => p.name === 'win_title');
  assert.deepEqual(title.at, [12, 140], 'the owner\'s move is kept');
  assert.equal(title.source.texts[0].text, 'YOU WON 250');
  assert.ok(title.size[0] > moved.find(p => p.name === 'win_title').size[0], 'the ribbon grows with its title');
  const red = applyEdit(retitled, 'win', 'titleColor', 'danger', style);
  assert.notEqual(red.find(p => p.name === 'win_title').svg, title.svg);
  assert.equal(red.find(p => p.name === 'win').source.component.titleColor, 'danger');
  // A shapes part: its fill and its text.
  const coin = editableOf(red, red.find(p => p.name === 'coin'));
  assert.deepEqual(coin.texts, [{ key: 'shapes.1.text', value: '5' }]);
  assert.deepEqual(coin.colours, [{ key: 'fill:reward', value: 'reward' }]);
  const blue = applyEdit(red, 'coin', 'fill:reward', 'secondary', style);
  assert.equal(blue.find(p => p.name === 'coin').svg, renderShapes({ box: [64, 64], shapes: [{ circle: [32, 32, 28], fill: 'secondary' }, { text: '5', at: [32, 44], size: 24 }] }, style).svg, 'drawn in the new colour');
  assert.equal(applyEdit(blue, 'coin', 'shapes.1.text', '10', style).find(p => p.name === 'coin').source.shapes[1].text, '10');
  assert.throws(() => applyEdit(blue, 'coin', 'fill:secondary', 'notacolour', style), /palette role/);
  assert.equal(editableOf(blue, { name: 'x', svg: '<svg/>' }), null, 'a part drawn as SVG has nothing to edit this way');
});

test('critique_art writes a contact sheet; export_art writes trimmed PNGs with pivots, a sprite sheet with its map, and clean SVG', async () => {
  const s = studio();
  try {
    await s.call('draw_rig', { name: 'ui', parts: PACK.slice(0, 4) });
    const seen = await s.call('critique_art', { file: 'ui.parts.json' });
    const c = seen.meta;
    assert.ok(Array.isArray(c.findings));
    const sheet = decodePng(fs.readFileSync(path.join(s.dir, c.sheet)));
    assert.ok(sheet.width > 300 && sheet.height > 150);
    assert.equal(seen.image.mimeType, 'image/png', 'the agent sees the drawing without a clip');
    assert.deepEqual(decodePng(Buffer.from(seen.image.data, 'base64')).width, sheet.width);
    const e = await s.call('export_art', { file: 'ui.parts.json', scales: [1, 3] });
    assert.equal(e.error, undefined, JSON.stringify(e.error));
    const out = path.join(s.dir, 'ui-export');
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'parts.json'), 'utf8'));
    const one = manifest.parts.play.png['1x'].play, three = manifest.parts.play.png['3x'].play;
    assert.ok(Math.abs(three.size[0] / one.size[0] - 3) < 0.1, 'three times the pixels at 3x');
    const img = decodePng(fs.readFileSync(path.join(out, one.file)));
    assert.deepEqual([img.width, img.height], one.size);
    const edge = [0, img.width - 1].some(x => [...Array(img.height).keys()].some(y => img.data[(y * img.width + x) * 4 + 3] > 0));
    assert.ok(edge, 'trimmed: the image reaches its own edge');
    assert.ok(fs.existsSync(path.join(out, 'png@1x', 'play_pressed.png')), 'states export too');
    const map = JSON.parse(fs.readFileSync(path.join(out, 'ui@3x.json'), 'utf8'));
    assert.ok(map.frames.play.frame.w > 0 && map.meta.image === 'ui@3x.png' && map.frames.xp_fill.pivot.x < 0.1, 'the fill turns at its left edge');
    const svg = fs.readFileSync(path.join(out, 'ui.svg'), 'utf8');
    assert.match(svg, /<g id="play"/);
    assert.doesNotMatch(svg, /script|on[a-z]+=/i);
    assert.ok(fs.existsSync(path.join(out, 'svg', 'shop.svg')));
  } finally { s.done(); }
});

test('export_art turns a clip into a PNG sequence and a sheet with its frame times', async () => {
  const s = studio();
  try {
    await s.call('draw_rig', { name: 'b', parts: [PACK[0]] });
    const file = path.join(s.dir, 'b.json');
    const sk = JSON.parse(fs.readFileSync(file, 'utf8'));
    sk.animations = { press: { bones: { play: { scale: [{ x: 1, y: 1 }, { time: 0.25, x: 1.1, y: 0.9 }, { time: 0.5, x: 1, y: 1 }] } } } };
    fs.writeFileSync(file, JSON.stringify(sk));
    const e = await s.call('export_art', { file: 'b.parts.json', kinds: ['clip'], animation: 'press', fps: 12, size: 64 });
    assert.equal(e.error, undefined, JSON.stringify(e.error));
    assert.equal(e.clip.frames, 7);
    const map = JSON.parse(fs.readFileSync(path.join(s.dir, 'b-export', 'clip-press@sheet.json'), 'utf8'));
    assert.equal(Object.keys(map.frames).length, 7);
    assert.equal(map.meta.fps, 12);
    assert.ok(fs.existsSync(path.join(s.dir, 'b-export', 'clip-press', 'frame_0006.png')));
    // Frames never touch: clear pixels around each one and from the sheet's edges.
    const frames = Object.values(map.frames).map(f => f.frame);
    for (const f of frames) assert.ok(f.x >= 2 && f.y >= 2 && f.x + f.w <= map.meta.size.w - 2 && f.y + f.h <= map.meta.size.h - 2, JSON.stringify(f));
    for (const a of frames) for (const b of frames) if (a !== b) assert.ok(a.x + a.w + 2 <= b.x || b.x + b.w + 2 <= a.x || a.y + a.h + 2 <= b.y || b.y + b.h + 2 <= a.y, 'two pixels apart');
    const wide = await s.call('export_art', { file: 'b.parts.json', kinds: ['clip'], animation: 'press', fps: 12, size: 64, padding: 6 });
    assert.equal(wide.error, undefined);
    const map6 = JSON.parse(fs.readFileSync(path.join(s.dir, 'b-export', 'clip-press@sheet.json'), 'utf8'));
    assert.equal(Object.values(map6.frames)[0].frame.x, 6);
  } finally { s.done(); }
});

test('draw_rig refuses a part with two ways of drawing it, and shapes without a box', async () => {
  const s = studio();
  try {
    const both = await s.call('draw_rig', { name: 'x', parts: [{ name: 'a', svg: '<svg viewBox="0 0 1 1"/>', shapes: [{ circle: [1, 1, 1] }], box: [2, 2], at: [0, 0] }] });
    assert.match(both.error.message, /exactly one of svg, shapes or component/);
    const nobox = await s.call('draw_rig', { name: 'x', parts: [{ name: 'a', shapes: [{ circle: [1, 1, 1] }], at: [0, 0] }] });
    assert.match(nobox.error.message, /box/);
    assert.deepEqual(expandParts([{ name: 'a', svg: '<svg/>', at: [0, 0] }], style).parametric, 0);
  } finally { s.done(); }
});

test('export_art web writes an embeddable player script, the skeleton with its atlas and pages, and a demo page', async () => {
  const s = studio();
  try {
    await s.call('draw_rig', { name: 'b', parts: [PACK[0]] });
    const e = await s.call('export_art', { file: 'b.parts.json', kinds: ['web'] });
    assert.equal(e.error, undefined, JSON.stringify(e.error));
    const web = path.join(s.dir, 'b-export', 'web');
    for (const f of ['keyframe-player.js', 'b.json', 'b.atlas', 'b.png', 'index.html']) assert.ok(fs.existsSync(path.join(web, f)), f);
    const script = fs.readFileSync(path.join(web, 'keyframe-player.js'), 'utf8');
    assert.doesNotThrow(() => new vm.Script(script), 'one classic script');
    for (const api of ['play(name', 'stop()', 'setLook(slot', "customElements.define('keyframe-player'", 'window.KeyframePlayer']) assert.ok(script.includes(api), api);
    assert.match(fs.readFileSync(path.join(web, 'index.html'), 'utf8'), /<keyframe-player id="player" src="b.json"/);
    assert.ok(!fs.existsSync(path.join(s.dir, 'b-export', 'png@1x')), 'only what was asked');
  } finally { s.done(); }
});
