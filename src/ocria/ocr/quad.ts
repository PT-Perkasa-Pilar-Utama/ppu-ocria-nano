// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr/ocria/det.rs (crates-v2.21.2, Apache-2.0).

// Quad helpers shared by the detector and the collinear merge.

import { f32 } from "../rust.js";
import type { Pt, Quad } from "./img.js";

export function norm(x: number, y: number): number {
  return f32(Math.sqrt(f32(f32(x * x) + f32(y * y))));
}

export function minY(q: Quad): number {
  return Math.min(q[0][1], q[1][1], q[2][1], q[3][1]);
}

export function minX(q: Quad): number {
  return Math.min(q[0][0], q[1][0], q[2][0], q[3][0]);
}

/** The f32 mean of four corner coordinates, summed in order. */
export function mean4(a: number, b: number, c: number, d: number): number {
  return f32(f32(f32(f32(a + b) + c) + d) / 4);
}

/** Corners as [top-left, top-right, bottom-right, bottom-left] along the line's long axis. */
export function orderQuad(q: Quad): Quad {
  const cx = mean4(q[0][0], q[1][0], q[2][0], q[3][0]);
  const cy = mean4(q[0][1], q[1][1], q[2][1], q[3][1]);
  const e1: Pt = [f32(q[1][0] - q[0][0]), f32(q[1][1] - q[0][1])];
  const e2: Pt = [f32(q[2][0] - q[1][0]), f32(q[2][1] - q[1][1])];
  let u = norm(e1[0], e1[1]) >= norm(e2[0], e2[1]) ? e1 : e2;
  const n = f32(norm(u[0], u[1]) + f32(1e-6));
  u = [f32(u[0] / n), f32(u[1] / n)];
  if (u[0] < 0) u = [-u[0], -u[1]];
  const v: Pt = [-u[1], u[0]];
  const a = q.map((p) => f32(f32(f32(p[0] - cx) * u[0]) + f32(f32(p[1] - cy) * u[1])));
  const b = q.map((p) => f32(f32(f32(p[0] - cx) * v[0]) + f32(f32(p[1] - cy) * v[1])));
  // np.argmin / argmax: the first extreme index
  const pick = (f: (i: number) => number, max: boolean): number => {
    let best = 0;
    for (let i = 1; i < 4; i++) {
      if ((max && f(i) > f(best)) || (!max && f(i) < f(best))) best = i;
    }
    return best;
  };
  const tl = pick((i) => f32(a[i] + b[i]), false);
  const tr = pick((i) => f32(a[i] - b[i]), true);
  const br = pick((i) => f32(a[i] + b[i]), true);
  const bl = pick((i) => f32(a[i] - b[i]), false);
  const at = (i: number): Pt => [q[i][0], q[i][1]];
  return [at(tl), at(tr), at(br), at(bl)];
}
