// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr/ocria/img.rs (crates-v2.21.2, Apache-2.0).

// Image operations written to OpenCV's portable scalar definitions (pixel-centre
// mapping, fixed-point interpolation weights, border rules), so the models see
// the inputs they were trained on, with the same pixels on every platform.

import { clamp, f32, roundTiesEven } from "../rust.js";

/** An 8-bit image, `ch` interleaved channels per pixel (1 = grey, 3 = RGB). */
export type Img = { w: number; h: number; ch: number; data: Uint8Array };

export function newImg(w: number, h: number, ch: number): Img {
  return { w, h, ch, data: new Uint8Array(w * h * ch) };
}

function cloneImg(img: Img): Img {
  return { w: img.w, h: img.h, ch: img.ch, data: img.data.slice() };
}

/** `cv2.cvtColor(.., COLOR_RGB2GRAY)`: 14-bit fixed-point BT.601 weights. */
export function toGray(img: Img): Img {
  if (img.ch === 1) return cloneImg(img);
  const out = newImg(img.w, img.h, 1);
  const { data, ch } = img;
  for (let i = 0, p = 0; i < out.data.length; i++, p += ch) {
    // SAFETY: p + 2 < data.length because data holds w * h * ch bytes and ch >= 3.
    const v = data[p] * 4899 + data[p + 1] * 9617 + data[p + 2] * 1868 + (1 << 13);
    out.data[i] = v >>> 14;
  }
  return out;
}

/** `img.mean(axis=2).astype(np.uint8)`: the channel mean, truncated. */
export function meanGray(img: Img): Img {
  if (img.ch === 1) return cloneImg(img);
  const out = newImg(img.w, img.h, 1);
  const { data, ch } = img;
  for (let i = 0, p = 0; i < out.data.length; i++, p += ch) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += data[p + c];
    out.data[i] = Math.floor(s / ch);
  }
  return out;
}

/** `np.rot90(img, k)`: k quarter turns counter-clockwise. */
export function rot90(img: Img, k: number): Img {
  const { w, h, ch, data } = img;
  switch (((k % 4) + 4) % 4) {
    case 0:
      return cloneImg(img);
    case 1: {
      // out[i][j] = in[j][w - 1 - i]; out is h x w turned
      const out = newImg(h, w, ch);
      for (let i = 0; i < out.h; i++) {
        for (let j = 0; j < out.w; j++) {
          const src = (j * w + (w - 1 - i)) * ch;
          const dst = (i * out.w + j) * ch;
          for (let c = 0; c < ch; c++) out.data[dst + c] = data[src + c];
        }
      }
      return out;
    }
    case 2: {
      const out = newImg(w, h, ch);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const src = ((h - 1 - y) * w + (w - 1 - x)) * ch;
          const dst = (y * w + x) * ch;
          for (let c = 0; c < ch; c++) out.data[dst + c] = data[src + c];
        }
      }
      return out;
    }
    default:
      return rot90(rot90(img, 1), 2);
  }
}

/** OpenCV's `INTER_RESIZE_COEF_BITS`. */
const RESIZE_BITS = 11;
const RESIZE_ONE = 1 << RESIZE_BITS;

/** OpenCV `saturate_cast<short>` of a rounded value. */
export function satShort(v: number): number {
  return clamp(roundTiesEven(v), -32768, 32767);
}

/**
 * Source index and two fixed-point weights per output index, for
 * `cv2.resize`'s linear path. `area` selects INTER_AREA's upscaling
 * coefficients.
 */
function linearTaps(src: number, dst: number, area: boolean): Int32Array {
  const invScale = dst / src;
  const scale = 1 / invScale;
  const out = new Int32Array(dst * 3);
  for (let d = 0; d < dst; d++) {
    let sx: number;
    let f: number;
    if (area) {
      sx = Math.floor(d * scale);
      const ff = f32(d + 1 - (sx + 1) * invScale);
      f = ff <= 0 ? 0 : f32(ff - Math.floor(ff));
    } else {
      const fx = f32((d + 0.5) * scale - 0.5);
      sx = Math.floor(fx);
      f = f32(fx - sx);
    }
    if (sx < 0) {
      sx = 0;
      f = 0;
    }
    if (sx >= src - 1) {
      sx = src - 1;
      f = 0;
    }
    out[d * 3] = sx;
    out[d * 3 + 1] = satShort(f32(f32(1 - f) * RESIZE_ONE));
    out[d * 3 + 2] = satShort(f32(f * RESIZE_ONE));
  }
  return out;
}

function resizeLinearTaps(img: Img, w: number, h: number, area: boolean): Img {
  const xt = linearTaps(img.w, w, area);
  const yt = linearTaps(img.h, h, area);
  const { ch, data } = img;
  // horizontal pass, one row of integers per source row
  const rows: Int32Array[] = [];
  for (let y = 0; y < img.h; y++) {
    const r = new Int32Array(w * ch);
    const row = y * img.w * ch;
    for (let dx = 0; dx < w; dx++) {
      const sx = xt[dx * 3];
      const a0 = xt[dx * 3 + 1];
      const a1 = xt[dx * 3 + 2];
      for (let c = 0; c < ch; c++) {
        const s0 = data[row + sx * ch + c];
        r[dx * ch + c] =
          sx + 1 < img.w ? s0 * a0 + data[row + (sx + 1) * ch + c] * a1 : s0 * RESIZE_ONE;
      }
    }
    rows.push(r);
  }
  const out = newImg(w, h, ch);
  for (let dy = 0; dy < h; dy++) {
    const sy = yt[dy * 3];
    const b0 = yt[dy * 3 + 1];
    const b1 = yt[dy * 3 + 2];
    const r0 = rows[sy];
    const r1 = rows[Math.min(sy + 1, img.h - 1)];
    const o = dy * w * ch;
    for (let i = 0; i < w * ch; i++) {
      // FixedPtCast<int, uchar, 22>
      const v = Math.floor((r0[i] * b0 + r1[i] * b1 + (1 << 21)) / 4194304);
      out.data[o + i] = clamp(v, 0, 255);
    }
  }
  return out;
}

/** `cv2.resize(.., interpolation=INTER_LINEAR)`. */
export function resizeLinear(img: Img, w: number, h: number): Img {
  if (w === img.w && h === img.h) return cloneImg(img);
  return resizeLinearTaps(img, w, h, false);
}

/** OpenCV `computeResizeAreaTab`: (source index, weight) runs per output index. */
function areaTab(src: number, dst: number, scale: number): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  for (let d = 0; d < dst; d++) {
    const fsx1 = d * scale;
    const fsx2 = fsx1 + scale;
    const cell = Math.min(scale, src - fsx1);
    const sx2 = Math.min(Math.floor(fsx2), src - 1);
    const sx1 = Math.min(Math.ceil(fsx1), sx2);
    const t: Array<[number, number]> = [];
    if (sx1 - fsx1 > 1e-3) t.push([sx1 - 1, f32((sx1 - fsx1) / cell)]);
    for (let sx = sx1; sx < sx2; sx++) t.push([sx, f32(1 / cell)]);
    if (fsx2 - sx2 > 1e-3) t.push([sx2, f32(Math.min(fsx2 - sx2, 1, cell) / cell)]);
    out.push(t);
  }
  return out;
}

/**
 * `cv2.resize(.., interpolation=INTER_AREA)`: box averaging when shrinking
 * both axes, OpenCV's area-weighted linear taps otherwise.
 */
export function resizeArea(img: Img, w: number, h: number): Img {
  if (w === img.w && h === img.h) return cloneImg(img);
  const scaleX = img.w / w;
  const scaleY = img.h / h;
  if (scaleX < 1 || scaleY < 1) return resizeLinearTaps(img, w, h, true);
  const { ch, data } = img;
  const isx = Math.round(scaleX);
  const isy = Math.round(scaleY);
  if (Math.abs(scaleX - isx) < Number.EPSILON && Math.abs(scaleY - isy) < Number.EPSILON) {
    // integer factors: plain block mean (resizeAreaFast)
    const area = isx * isy;
    const inv = f32(1 / f32(area));
    const out = newImg(w, h, ch);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        for (let c = 0; c < ch; c++) {
          let s = 0;
          for (let yy = 0; yy < isy; yy++) {
            const row = (dy * isy + yy) * img.w;
            for (let xx = 0; xx < isx; xx++) s += data[(row + dx * isx + xx) * ch + c];
          }
          const v = area === 4 ? (s + 2) >>> 2 : roundTiesEven(s * inv);
          out.data[(dy * w + dx) * ch + c] = Math.min(v, 255);
        }
      }
    }
    return out;
  }
  // flat horizontal taps: (output offset, source offset, weight), in OpenCV's order
  const xd: number[] = [];
  const xs: number[] = [];
  const xa: number[] = [];
  areaTab(img.w, w, scaleX).forEach((taps, dx) => {
    for (const [sx, a] of taps) {
      xd.push(dx * ch);
      xs.push(sx * ch);
      xa.push(a);
    }
  });
  const yt = areaTab(img.h, h, scaleY);
  const out = newImg(w, h, ch);
  const rowLen = img.w * ch;
  // horizontal sums of one source row; adjacent output rows share boundary
  // rows, so the last row's sums are kept (the same values OpenCV computes,
  // in the same order)
  const buf = new Float32Array(w * ch);
  let bufRow = -1;
  const sum = new Float32Array(w * ch);
  for (let dy = 0; dy < h; dy++) {
    sum.fill(0);
    for (const [sy, beta] of yt[dy]) {
      if (bufRow !== sy) {
        buf.fill(0);
        const row = sy * rowLen;
        for (let k = 0; k < xd.length; k++) {
          const d = xd[k];
          const s = row + xs[k];
          const alpha = xa[k];
          for (let c = 0; c < ch; c++) buf[d + c] = buf[d + c] + f32(data[s + c] * alpha);
        }
        bufRow = sy;
      }
      for (let i = 0; i < sum.length; i++) sum[i] = sum[i] + f32(buf[i] * beta);
    }
    const o = dy * w * ch;
    for (let i = 0; i < sum.length; i++) out.data[o + i] = clamp(roundTiesEven(sum[i]), 0, 255);
  }
  return out;
}

/** A point `[x, y]` in f32 image pixels. */
export type Pt = [number, number];

/** A line quad: [top-left, top-right, bottom-right, bottom-left] along the text. */
export type Quad = [Pt, Pt, Pt, Pt];
