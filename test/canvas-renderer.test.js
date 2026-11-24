// Gate for the canvas renderer's seams: a region quad is drawn as one piece (two triangles side
// by side leave a faint line along the diagonal), a bent mesh still draws triangle by triangle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasRenderer } from '../src/engine/canvas.js';

function recorder() {
  const calls = { drawImage: 0, clipPoints: [] };
  let points = 0;
  const ctx = {
    canvas: { width: 200, height: 200 }, globalAlpha: 1, globalCompositeOperation: 'source-over',
    save() {}, restore() {}, beginPath() { points = 0; }, moveTo() { points++; }, lineTo() { points++; }, closePath() {},
    clip() { calls.clipPoints.push(points); }, transform() {}, drawImage() { calls.drawImage++; },
  };
  return { ctx, calls };
}
const light = { r: 1, g: 1, b: 1, a: 1 };
const image = { width: 64, height: 64 };
const view = { scale: 1, x: 0, y: 0 };

test('a region quad is one piece; a bent mesh is drawn per triangle', () => {
  const renderer = createCanvasRenderer({ makeCanvas: () => { throw new Error('no tint needed'); } });
  const region = { page: 'p', light, blend: 0, positions: [-20, -20, 20, -20, 20, 20, -20, 20], uvs: [0, 1, 1, 1, 1, 0, 0, 0], indices: [0, 1, 2, 2, 3, 0] };
  const a = recorder();
  renderer.render(a.ctx, [region], () => image, view);
  assert.equal(a.calls.drawImage, 1, 'one draw for the whole quad');
  assert.deepEqual(a.calls.clipPoints, [4], 'clipped to the quad outline');
  // Rotated and listed in another order: still one piece, still a 4-point outline.
  const turned = { ...region, positions: [0, -28, 28, 0, 0, 28, -28, 0], indices: [1, 2, 3, 3, 0, 1] };
  const b = recorder();
  renderer.render(b.ctx, [turned], () => image, view);
  assert.deepEqual([b.calls.drawImage, b.calls.clipPoints], [1, [4]]);
  // A quad whose fourth corner is pulled out of the parallelogram (a deformed mesh) cannot be
  // drawn by one map: two triangles.
  const bent = { ...region, positions: [-20, -20, 20, -20, 30, 35, -20, 20] };
  const c = recorder();
  renderer.render(c.ctx, [bent], () => image, view);
  assert.deepEqual([c.calls.drawImage, c.calls.clipPoints], [2, [3, 3]]);
});
