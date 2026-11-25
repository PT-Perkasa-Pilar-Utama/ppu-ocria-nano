// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr/ocria/img.rs (crates-v2.21.2, Apache-2.0).

// Perspective crops: OpenCV's getPerspectiveTransform and bicubic warpPerspective.

import { clamp, f32, roundTiesEven, totalCmp } from "../rust.js";
import type { Img, Quad } from "./img.js";
import { newImg, satShort } from "./img.js";

/** `cv2.getPerspectiveTransform(src, dst)`: the 3x3 homography taking `src` corners to `dst`. */
export function perspectiveTransform(src: Quad, dst: Quad): number[] {
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    a[i] = [x, y, 1, 0, 0, 0, -x * u, -y * u, u];
    a[i + 4] = [0, 0, 0, x, y, 1, -x * v, -y * v, v];
  }
  // Gaussian elimination with partial pivoting (OpenCV solves with LU)
  for (let col = 0; col < 8; col++) {
    // Iterator::max_by keeps the last of equal maxima
    let piv = col;
    for (let p = col + 1; p < 8; p++) {
      if (totalCmp(Math.abs(a[p][col]), Math.abs(a[piv][col])) >= 0) piv = p;
    }
    const tmp = a[col];
    a[col] = a[piv];
    a[piv] = tmp;
    const rowC = a[col];
    const d = rowC[col];
    if (Math.abs(d) < 1e-300) continue;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const row = a[r];
      const f = row[col] / d;
      if (f !== 0) for (let k = col; k < 9; k++) row[k] = row[k] - f * rowC[k];
    }
  }
  const m = Array.from({ length: 9 }, (): number => 0);
  for (let i = 0; i < 8; i++) {
    const aii = a[i][i];
    m[i] = aii !== 0 ? a[i][8] / aii : 0;
  }
  m[8] = 1;
  return m;
}

function invert3(m: readonly number[]): number[] {
  const det =
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (det === 0) return Array.from({ length: 9 }, (): number => 0);
  const d = 1 / det;
  return [
    (m[4] * m[8] - m[5] * m[7]) * d,
    (m[2] * m[7] - m[1] * m[8]) * d,
    (m[1] * m[5] - m[2] * m[4]) * d,
    (m[5] * m[6] - m[3] * m[8]) * d,
    (m[0] * m[8] - m[2] * m[6]) * d,
    (m[2] * m[3] - m[0] * m[5]) * d,
    (m[3] * m[7] - m[4] * m[6]) * d,
    (m[1] * m[6] - m[0] * m[7]) * d,
    (m[0] * m[4] - m[1] * m[3]) * d,
  ];
}

const INTER_BITS = 5;
const INTER_TAB = 1 << INTER_BITS;
const REMAP_SCALE = 1 << 15;
const I32_MIN = -2147483648;
const I32_MAX = 2147483647;

/** OpenCV `interpolateCubic` (A = -0.75), in f32 as OpenCV computes it. */
function cubicCoeffs(x: number): [number, number, number, number] {
  const A = -0.75;
  const x1 = f32(x + 1);
  const c0 = f32(f32(f32(f32(f32(f32(A * x1) + 3.75) * x1) - 6) * x1) + 3);
  const c1 = f32(f32(f32(f32(f32(1.25 * x) - 2.25) * x) * x) + 1);
  const omx = f32(1 - x);
  const c2 = f32(f32(f32(f32(f32(1.25 * omx) - 2.25) * omx) * omx) + 1);
  return [c0, c1, c2, f32(f32(f32(1 - c0) - c1) - c2)];
}

let bicubic: Int32Array[] | undefined;

/**
 * OpenCV `initInterTab2D(INTER_CUBIC)` fixed-point table: 32 x 32 sub-pixel
 * positions, 16 weights each, corrected to sum to exactly 2^15.
 */
export function bicubicTab(): Int32Array[] {
  if (bicubic) return bicubic;
  const oneD: Array<[number, number, number, number]> = [];
  for (let i = 0; i < INTER_TAB; i++) oneD.push(cubicCoeffs(f32(i / INTER_TAB)));
  const tab: Int32Array[] = [];
  for (let iy = 0; iy < INTER_TAB; iy++) {
    for (let ix = 0; ix < INTER_TAB; ix++) {
      const vy = oneD[iy];
      const vx = oneD[ix];
      const t = new Int32Array(16);
      let isum = 0;
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          const v = f32(vy[i] * vx[j]);
          t[i * 4 + j] = satShort(f32(v * REMAP_SCALE));
          isum += t[i * 4 + j];
        }
      }
      if (isum !== REMAP_SCALE) {
        const diff = isum - REMAP_SCALE;
        let mk = 2 * 4 + 2;
        let big = 2 * 4 + 2;
        for (let k1 = 2; k1 < 4; k1++) {
          for (let k2 = 2; k2 < 4; k2++) {
            const at = k1 * 4 + k2;
            if (t[at] < t[mk]) mk = at;
            else if (t[at] > t[big]) big = at;
          }
        }
        if (diff < 0) t[big] = t[big] - diff;
        else t[mk] = t[mk] - diff;
      }
      tab.push(t);
    }
  }
  bicubic = tab;
  return tab;
}

/** `cv2.warpPerspective(img, m, (w, h), flags=INTER_CUBIC, borderMode=BORDER_REPLICATE)`. */
export function warpPerspectiveCubic(img: Img, m: readonly number[], w: number, h: number): Img {
  const inv = invert3(m);
  const tab = bicubicTab();
  const { ch, data } = img;
  const out = newImg(w, h, ch);
  const sw = img.w;
  const sh = img.h;
  const cols = [0, 0, 0, 0];
  const sum = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = inv[0] * x + inv[1] * y + inv[2];
      const y0 = inv[3] * x + inv[4] * y + inv[5];
      let ww = inv[6] * x + inv[7] * y + inv[8];
      ww = ww !== 0 ? INTER_TAB / ww : 0;
      const fx = clamp(x0 * ww, I32_MIN, I32_MAX);
      const fy = clamp(y0 * ww, I32_MIN, I32_MAX);
      const xi = roundTiesEven(fx);
      const yi = roundTiesEven(fy);
      // arithmetic shift and mask of a value in i32 range
      const sx = Math.floor(xi / INTER_TAB);
      const sy = Math.floor(yi / INTER_TAB);
      const wt = tab[(yi & (INTER_TAB - 1)) * INTER_TAB + (xi & (INTER_TAB - 1))];
      // the 4 x 4 source window, clamped to the image (BORDER_REPLICATE)
      const inside = sx >= 1 && sy >= 1 && sx + 2 < sw && sy + 2 < sh;
      for (let j = 0; j < 4; j++) cols[j] = inside ? sx - 1 + j : clamp(sx - 1 + j, 0, sw - 1);
      sum.fill(0);
      for (let i = 0; i < 4; i++) {
        const yy = inside ? sy - 1 + i : clamp(sy - 1 + i, 0, sh - 1);
        const row = yy * sw * ch;
        for (let j = 0; j < 4; j++) {
          const wv = wt[i * 4 + j];
          const px = row + cols[j] * ch;
          for (let c = 0; c < ch; c++) sum[c] = sum[c] + data[px + c] * wv;
        }
      }
      const o = (y * w + x) * ch;
      for (let c = 0; c < ch; c++) {
        out.data[o + c] = clamp(Math.floor((sum[c] + (1 << 14)) / 32768), 0, 255);
      }
    }
  }
  return out;
}
