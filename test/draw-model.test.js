// Gate for the drawing board's model (web/draw-model.js): shapes the board draws are read back
// and rebuilt by the rig builder, edits keep the parts document valid, and the view maps points
// both ways.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatNumber, parseNumber, shapeSvg, readShape, uniqueName, addShape, movePart, setPivot, resizePart, restyle, renamePart, removePart, reorder,
  parentChoices, setParent, bonesOf, drawingBounds, fitView, toScreen, toRig, partAt, savePayload } from '../web/draw-model.js';
import { validateParts, buildSvgRig } from '../src/render/svg-rig.js';

const box = (x, y, width, height) => ({ x, y, width, height });

test('a board shape is read back, and the rig builder draws it', () => {
  const svg = shapeSvg({ shape: 'ellipse', width: 60, height: 40, fill: '#5E7BFF', stroke: '#2E2A52', strokeWidth: 4 });
  assert.deepEqual(readShape(svg), { shape: 'ellipse', width: 60, height: 40, fill: '#5E7BFF', stroke: '#2E2A52', strokeWidth: 4 });
  assert.equal(readShape('<svg viewBox="0 0 10 10"><circle r="4"/></svg>'), null, 'art drawn elsewhere is not a board shape');
  assert.equal(readShape(shapeSvg({ shape: 'rect', width: 10, height: 10, fill: 'red' })).fill, '#FFC890', 'a bad colour falls back to the palette');
  let parts = addShape([], { shape: 'rect', box: box(-30, 0, 60, 80), fill: '#4FC9A6', name: 'body' });
  parts = addShape(parts, { shape: 'ellipse', box: box(-25, 70, 50, 50), parent: 'body', name: 'head' });
  assert.deepEqual(parts.map(p => [p.name, p.at, p.size, p.parent ?? null]), [['body', [0, 40], [60, 80], null], ['head', [0, 95], [50, 50], 'body']]);
  const built = buildSvgRig({ name: 'pal', parts: validateParts(savePayload({ name: 'pal', parts }).parts), resolution: 1 });
  assert.deepEqual(built.skeleton.slots.map(s => s.name), ['body', 'head']);
  assert.deepEqual(built.skipped, []);
});

test('names stay unique and valid; renaming carries the links', () => {
  const parts = [{ name: 'arm', at: [0, 0], size: [1, 1] }, { name: 'hand', parent: 'arm', at: [0, 0], size: [1, 1] }];
  assert.equal(uniqueName(parts, 'arm'), 'arm_2');
  assert.equal(uniqueName(parts, 'root'), 'root_2');
  assert.equal(uniqueName(parts, ' <x>'), '_x_');
  const renamed = renamePart(parts, 'arm', 'arm_l');
  assert.deepEqual(renamed.parts.map(p => [p.name, p.parent]), [['arm_l', undefined], ['hand', 'arm_l']]);
  assert.equal(renamePart(parts, 'arm', 'hand').problem, 'taken');
  assert.equal(renamePart(parts, 'arm', 'a/b').problem, 'bad-name');
  assert.equal(renamePart(parts, 'arm', 'root').problem, 'taken');
});

test('moving keeps the pivot with the art; the pivot moves alone; resizing redraws a board shape', () => {
  let parts = addShape([], { shape: 'ellipse', box: box(0, 0, 20, 20), name: 'eye' });
  parts = movePart(parts, 'eye', 5, -3);
  assert.deepEqual([parts[0].at, parts[0].pivot], [[15, 7], [15, 7]]);
  parts = setPivot(parts, 'eye', [15, 0]);
  assert.deepEqual([parts[0].at, parts[0].pivot], [[15, 7], [15, 0]]);
  parts = resizePart(parts, 'eye', 40, 10);
  assert.deepEqual(parts[0].size, [40, 10]);
  assert.match(parts[0].svg, /viewBox="0 0 40 10"/);
  assert.equal(resizePart(parts, 'eye', 0, 5), parts, 'a size must be positive');
  parts = restyle(parts, 'eye', { fill: '#F06A82' });
  assert.equal(readShape(parts[0].svg).fill, '#F06A82');
  const art = [{ name: 'logo', svg: '<svg viewBox="0 0 8 8"><circle cx="4" cy="4" r="4"/></svg>', at: [0, 0], size: [8, 8] }];
  assert.equal(restyle(art, 'logo', { fill: '#000000' })[0].svg, art[0].svg, 'art drawn elsewhere keeps its look');
  assert.equal(resizePart(art, 'logo', 16, 16)[0].svg, art[0].svg);
});

test('removing a part re-hangs what it carried; order and parents never loop', () => {
  const parts = [{ name: 'body', at: [0, 0], size: [1, 1] }, { name: 'arm', parent: 'body', at: [0, 0], size: [1, 1] }, { name: 'hand', parent: 'arm', at: [0, 0], size: [1, 1] }];
  assert.deepEqual(removePart(parts, 'arm').map(p => [p.name, p.parent]), [['body', undefined], ['hand', 'body']]);
  assert.deepEqual(removePart(parts, 'body').map(p => [p.name, p.parent]), [['arm', undefined], ['hand', 'arm']]);
  assert.deepEqual(reorder(parts, 'hand', -1).map(p => p.name), ['body', 'hand', 'arm']);
  assert.equal(reorder(parts, 'body', -1), parts);
  assert.deepEqual(parentChoices(parts, 'body'), [], 'body carries everything else');
  assert.deepEqual(parentChoices(parts, 'hand'), ['body', 'arm']);
  assert.equal(setParent(parts, 'body', 'hand'), parts, 'a loop is refused');
  assert.equal(setParent(parts, 'hand', null)[2].parent, undefined);
  assert.deepEqual(bonesOf(parts).map(b => b.from), [null, [0, 0], [0, 0]]);
});

test('the view fits the drawing and maps points both ways; hits find the front part', () => {
  const parts = addShape(addShape([], { shape: 'rect', box: box(-50, 0, 100, 100), name: 'back' }), { shape: 'rect', box: box(0, 0, 50, 50), name: 'front' });
  assert.deepEqual(drawingBounds(parts), { x: -50, y: 0, width: 100, height: 100 });
  const view = fitView(drawingBounds(parts), 400, 300);
  assert.equal(view.scale, 300 * 0.7 / 100);
  assert.deepEqual(toScreen(view, 400, 300, [0, 50]), [200, 150]);
  assert.deepEqual(toRig(view, 400, 300, toScreen(view, 400, 300, [12, 34])), [12, 34]);
  assert.ok(toScreen(view, 400, 300, [0, 100])[1] < 150, 'y is up in the rig, down on screen');
  assert.equal(partAt(parts, [10, 10]), 'front');
  assert.equal(partAt(parts, [-40, 90]), 'back');
  assert.equal(partAt(parts, [500, 0]), null);
  assert.deepEqual(fitView(null, 400, 400), { scale: 400 * 0.7 / 400, cx: 0, cy: 100 });
  assert.deepEqual(Object.keys(savePayload({ name: 'x', parts: [{ ...parts[0], extra: 1, parent: null }] }).parts[0]).sort(), ['at', 'name', 'pivot', 'size', 'svg']);
});

test('the board writes numbers with a point and reads a point or a comma, whatever the system locale', () => {
  assert.equal(formatNumber(80.149), '80.15');
  assert.equal(formatNumber(-3), '-3');
  assert.equal(parseNumber('80,15'), 80.15, 'a decimal comma (a Turkish or German system) is read');
  assert.equal(parseNumber(' 80.15 '), 80.15);
  assert.equal(parseNumber('-.5'), -0.5);
  for (const bad of ['', 'abc', '1,2,3', '1.2.3', '--1']) assert.equal(parseNumber(bad), null, bad);
  const board = fs.readFileSync(new URL('../web/draw.js', import.meta.url), 'utf8');
  assert.doesNotMatch(board, /type = 'number'/, 'a number field would show the system decimal comma');
});
