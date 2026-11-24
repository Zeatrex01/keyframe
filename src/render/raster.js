// A small textured-triangle rasterizer with Spine's blend modes (ADR-3).
//
// Everything is premultiplied-alpha float RGBA in 0..1, the space spine-webgl blends in.
// The blend equations below are the ones spine-webgl sets for premultiplied textures:
//   normal   ONE, ONE_MINUS_SRC_ALPHA
//   additive ONE, ONE
//   multiply DST_COLOR, ONE_MINUS_SRC_ALPHA
//   screen   ONE, ONE_MINUS_SRC_COLOR
// and the fragment colour is spine's two-colour-tint shader in its premultiplied form:
//   rgb = ((tex.a - 1) * dark.a + 1 - tex.rgb) * dark.rgb + tex.rgb * light.rgb
//   a   = tex.a * light.a
// with light premultiplied by its own alpha. Without a dark colour that reduces to
// tex * light.

export const BLEND = Object.freeze({ normal: 0, additive: 1, multiply: 2, screen: 3 });

/** A premultiplied RGBA float canvas. */
export function createCanvas(width, height) {
  return { width, height, data: new Float32Array(width * height * 4) };
}

/**
 * Turn decoded 8-bit RGBA into a premultiplied float texture.
 * @param {{ width: number, height: number, data: Uint8Array }} image
 * @param {boolean} alreadyPremultiplied true when the atlas page says pma
 */
export function prepareTexture(image, alreadyPremultiplied) {
  const { width, height, data } = image;
  const out = new Float32Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    const k = alreadyPremultiplied ? 1 / 255 : a / 255;
    out[i] = data[i] * k; out[i + 1] = data[i + 1] * k; out[i + 2] = data[i + 2] * k; out[i + 3] = a;
  }
  return { width, height, data: out };
}

// Bilinear sample at normalized (u, v), clamped to the edge. Writes into `out`.
function sample(texture, u, v, out) {
  const { width, height, data } = texture;
  const x = u * width - 0.5;
  const y = v * height - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const cx0 = Math.min(width - 1, Math.max(0, x0)), cx1 = Math.min(width - 1, Math.max(0, x0 + 1));
  const cy0 = Math.min(height - 1, Math.max(0, y0)), cy1 = Math.min(height - 1, Math.max(0, y0 + 1));
  const i00 = (cy0 * width + cx0) * 4, i10 = (cy0 * width + cx1) * 4;
  const i01 = (cy1 * width + cx0) * 4, i11 = (cy1 * width + cx1) * 4;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  for (let c = 0; c < 4; c++) out[c] = data[i00 + c] * w00 + data[i10 + c] * w10 + data[i01 + c] * w01 + data[i11 + c] * w11;
}

/**
 * Draw indexed triangles into the canvas.
 * @param {ReturnType<typeof createCanvas>} canvas
 * @param {object} draw
 * @param {ArrayLike<number>} draw.positions  x, y pairs in canvas pixels (y down)
 * @param {ArrayLike<number>} draw.uvs        u, v pairs, 0..1
 * @param {ArrayLike<number>} draw.indices    three per triangle
 * @param {ReturnType<typeof prepareTexture>} draw.texture
 * @param {{ r: number, g: number, b: number, a: number }} draw.light  straight colour
 * @param {{ r: number, g: number, b: number }} [draw.dark]          two-colour tint, straight
 * @param {number} [draw.blend]  BLEND value
 */
export function drawTriangles(canvas, { positions, uvs, indices, texture, light, dark = null, blend = BLEND.normal }) {
  const L = [light.r * light.a, light.g * light.a, light.b * light.a, light.a];
  const texel = new Float32Array(4);
  const src = new Float32Array(4);
  const { width, height, data } = canvas;

  for (let t = 0; t + 2 < indices.length; t += 3) {
    const i0 = indices[t] * 2, i1 = indices[t + 1] * 2, i2 = indices[t + 2] * 2;
    const x0 = positions[i0], y0 = positions[i0 + 1];
    const x1 = positions[i1], y1 = positions[i1 + 1];
    const x2 = positions[i2], y2 = positions[i2 + 1];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (!area || !Number.isFinite(area)) continue;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (minX > maxX || minY > maxY) continue;
    const u0 = uvs[i0], v0 = uvs[i0 + 1], u1 = uvs[i1], v1 = uvs[i1 + 1], u2 = uvs[i2], v2 = uvs[i2 + 1];
    const inv = 1 / area;
    // Top-left fill rule, so shared edges are drawn exactly once.
    const bias = (ax, ay, bx, by) => {
      const dy = by - ay, dx = bx - ax;
      const topLeft = area > 0 ? (dy < 0 || (dy === 0 && dx > 0)) : (dy > 0 || (dy === 0 && dx < 0));
      return topLeft ? 0 : -1e-9;
    };
    const b0 = bias(x1, y1, x2, y2), b1 = bias(x2, y2, x0, y0), b2 = bias(x0, y0, x1, y1);
    for (let py = minY; py <= maxY; py++) {
      const cy = py + 0.5;
      for (let px = minX; px <= maxX; px++) {
        const cx = px + 0.5;
        const w0 = ((x2 - x1) * (cy - y1) - (y2 - y1) * (cx - x1)) * inv;
        const w1 = ((x0 - x2) * (cy - y2) - (y0 - y2) * (cx - x2)) * inv;
        const w2 = ((x1 - x0) * (cy - y0) - (y1 - y0) * (cx - x0)) * inv;
        if (w0 + b0 < 0 || w1 + b1 < 0 || w2 + b2 < 0) continue;
        sample(texture, u0 * w0 + u1 * w1 + u2 * w2, v0 * w0 + v1 * w1 + v2 * w2, texel);
        const ta = texel[3];
        if (dark) {
          for (let c = 0; c < 3; c++) {
            const d = c === 0 ? dark.r : c === 1 ? dark.g : dark.b;
            src[c] = ((ta - 1) * 1 + 1 - texel[c]) * d * L[3] + texel[c] * L[c];
          }
        } else {
          src[0] = texel[0] * L[0]; src[1] = texel[1] * L[1]; src[2] = texel[2] * L[2];
        }
        src[3] = ta * L[3];
        if (src[3] <= 0 && blend !== BLEND.additive) continue;
        const o = (py * width + px) * 4;
        blendInto(data, o, src, blend);
      }
    }
  }
}

function blendInto(d, o, s, blend) {
  const sa = s[3];
  switch (blend) {
    case BLEND.additive:
      d[o] += s[0]; d[o + 1] += s[1]; d[o + 2] += s[2]; d[o + 3] += sa;
      break;
    case BLEND.multiply:
      for (let c = 0; c < 4; c++) d[o + c] = s[c] * d[o + c] + d[o + c] * (1 - sa);
      break;
    case BLEND.screen:
      for (let c = 0; c < 4; c++) d[o + c] = s[c] + d[o + c] * (1 - s[c]);
      break;
    default:
      for (let c = 0; c < 4; c++) d[o + c] = s[c] + d[o + c] * (1 - sa);
  }
  for (let c = 0; c < 4; c++) if (d[o + c] > 1) d[o + c] = 1;
}

/**
 * Box-downsample a supersampled canvas and convert to 8-bit straight-alpha RGBA,
 * composited over an optional straight background colour.
 */
export function toImage(canvas, factor = 1, background = null) {
  const width = Math.floor(canvas.width / factor);
  const height = Math.floor(canvas.height / factor);
  const out = new Uint8Array(width * height * 4);
  const n = factor * factor;
  const bg = background ? [background.r * background.a, background.g * background.a, background.b * background.a, background.a] : null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const i = ((y * factor + sy) * canvas.width + (x * factor + sx)) * 4;
          r += canvas.data[i]; g += canvas.data[i + 1]; b += canvas.data[i + 2]; a += canvas.data[i + 3];
        }
      }
      r /= n; g /= n; b /= n; a /= n;
      if (bg) { r += bg[0] * (1 - a); g += bg[1] * (1 - a); b += bg[2] * (1 - a); a += bg[3] * (1 - a); }
      const o = (y * width + x) * 4;
      const k = a > 0 ? 255 / a : 0; // un-premultiply for PNG
      out[o] = Math.round(Math.min(255, r * k));
      out[o + 1] = Math.round(Math.min(255, g * k));
      out[o + 2] = Math.round(Math.min(255, b * k));
      out[o + 3] = Math.round(Math.min(255, a * 255));
    }
  }
  return { width, height, data: out };
}
