// Draw a posed skeleton onto a Canvas 2D context: the Keyframe player's renderer, shared by
// the studio page and the standalone player file. No WebGL, no Spine code.
//
// Each triangle is drawn as the affine map of its texture triangle, clipped to itself (a
// region's quad is one parallelogram, drawn in one go, so no seam crosses it). Clipping attachments clip with a path.
// Tint multiplies a cached copy of the page; alpha is the context's global alpha; blend modes
// map to composite operations.
//
// Pure and isomorphic: the caller passes the context and the decoded page images.

const COMPOSITE = ['source-over', 'lighter', 'multiply', 'screen'];

/**
 * @param {object} options
 * @param {(width: number, height: number) => any} options.makeCanvas  an offscreen canvas factory (for tinting)
 */
export function createCanvasRenderer({ makeCanvas }) {
  const tinted = new Map();

  function tintedPage(image, light) {
    if (light.r > 0.995 && light.g > 0.995 && light.b > 0.995) return image;
    const q = v => Math.round(v * 31);
    const key = `${q(light.r)},${q(light.g)},${q(light.b)}`;
    let byColor = tinted.get(image);
    if (!byColor) { byColor = new Map(); tinted.set(image, byColor); }
    let canvas = byColor.get(key);
    if (!canvas) {
      canvas = makeCanvas(image.width, image.height);
      const c = canvas.getContext('2d');
      c.drawImage(image, 0, 0);
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = `rgb(${Math.round(light.r * 255)},${Math.round(light.g * 255)},${Math.round(light.b * 255)})`;
      c.fillRect(0, 0, image.width, image.height);
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(image, 0, 0);
      byColor.set(key, canvas);
    }
    return canvas;
  }

  // The affine map that takes texture triangle (u, v in pixels) to screen triangle (x, y).
  function affine(x0, y0, x1, y1, x2, y2, u0, v0, u1, v1, u2, v2) {
    const du1 = u1 - u0, dv1 = v1 - v0, du2 = u2 - u0, dv2 = v2 - v0;
    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-9) return null;
    const dx1 = x1 - x0, dy1 = y1 - y0, dx2 = x2 - x0, dy2 = y2 - y0;
    const a = (dx1 * dv2 - dx2 * dv1) / det, b = (dy1 * dv2 - dy2 * dv1) / det;
    const c = (dx2 * du1 - dx1 * du2) / det, d = (dy2 * du1 - dy1 * du2) / det;
    return [a, b, c, d, x0 - a * u0 - c * v0, y0 - b * u0 - d * v0];
  }

  // Draw the image under an affine map, clipped to a polygon grown by `extra` pixels so
  // neighbouring pieces leave no seam.
  function drawPiece(ctx, image, m, xs, ys, extra) {
    const n = xs.length;
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { cx += xs[i] / n; cy += ys[i] / n; }
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const l = Math.hypot(xs[i] - cx, ys[i] - cy) || 1;
      const x = xs[i] + (xs[i] - cx) / l * extra, y = ys[i] + (ys[i] - cy) / l * extra;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.clip();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.drawImage(image, 0, 0);
    ctx.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {ReturnType<import('./draws.js').collectDraws>['draws']} draws
   * @param {(page: string) => any} pageImage  decoded image of an atlas page (or null while loading)
   * @param {{ scale: number, x: number, y: number }} view  screen = (world - (x, y)) * scale, y flipped, centred
   */
  function render(ctx, draws, pageImage, view) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const sx = wx => W / 2 + (wx - view.x) * view.scale;
    const sy = wy => H / 2 - (wy - view.y) * view.scale;
    for (const d of draws) {
      const image = pageImage(d.page);
      if (!image) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, d.light.a));
      ctx.globalCompositeOperation = /** @type {GlobalCompositeOperation} */ (COMPOSITE[d.blend] ?? 'source-over');
      if (d.clip) {
        ctx.beginPath();
        for (let i = 0; i < d.clip.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, sx(d.clip[i]), sy(d.clip[i + 1]));
        ctx.closePath();
        ctx.clip();
      }
      const source = tintedPage(image, d.light);
      const iw = image.width, ih = image.height;
      const P = d.positions, U = d.uvs, I = d.indices;
      const X = i => sx(P[i * 2]), Y = i => sy(P[i * 2 + 1]), Uu = i => U[i * 2] * iw, Vv = i => U[i * 2 + 1] * ih;
      // A region (or any one-quad piece) whose texture maps by one affine map is drawn in one go:
      // two triangles side by side would leave a faint seam along the diagonal.
      if (I.length === 6 && P.length === 8) {
        const [a, b, c] = [I[0], I[1], I[2]];
        const corner = [0, 1, 2, 3].find(i => i !== a && i !== b && i !== c);
        const m = affine(X(a), Y(a), X(b), Y(b), X(c), Y(c), Uu(a), Vv(a), Uu(b), Vv(b), Uu(c), Vv(c));
        if (m && corner !== undefined && Math.hypot(m[0] * Uu(corner) + m[2] * Vv(corner) + m[4] - X(corner), m[1] * Uu(corner) + m[3] * Vv(corner) + m[5] - Y(corner)) < 0.5) {
          // Around the centre, so the clip is the quad's outline whatever the vertex order.
          const mx = (X(0) + X(1) + X(2) + X(3)) / 4, my = (Y(0) + Y(1) + Y(2) + Y(3)) / 4;
          const order = [0, 1, 2, 3].sort((p, q) => Math.atan2(Y(p) - my, X(p) - mx) - Math.atan2(Y(q) - my, X(q) - mx));
          drawPiece(ctx, source, m, order.map(X), order.map(Y), 0.35);
          ctx.restore();
          continue;
        }
      }
      for (let t = 0; t < I.length; t += 3) {
        const i0 = I[t], i1 = I[t + 1], i2 = I[t + 2];
        const m = affine(X(i0), Y(i0), X(i1), Y(i1), X(i2), Y(i2), Uu(i0), Vv(i0), Uu(i1), Vv(i1), Uu(i2), Vv(i2));
        if (m) drawPiece(ctx, source, m, [X(i0), X(i1), X(i2)], [Y(i0), Y(i1), Y(i2)], 0.35);
      }
      ctx.restore();
    }
  }

  return { render };
}

/** The view that fits a world box into a canvas with a margin. */
export function fitView(box, width, height, margin = 0.08) {
  if (!box) return { scale: 1, x: 0, y: 0 };
  const scale = Math.min(width * (1 - 2 * margin) / Math.max(box.width, 1e-6), height * (1 - 2 * margin) / Math.max(box.height, 1e-6));
  return { scale, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
