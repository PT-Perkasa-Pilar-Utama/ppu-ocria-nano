// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr/ocria/img.rs (crates-v2.21.2, Apache-2.0).

// Component labelling and rotated rectangles for the detector, and Otsu's threshold.

import { f32, totalCmp } from "../rust.js";
import type { Pt, Quad } from "./img.js";

/** One 4-connected component of a binary mask: its bounding box and pixels. */
export type Component = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Pixel indices `y * w + x`, in the order the flood fill visits them. */
  pixels: number[];
};

/**
 * 4-connected components of `mask` (row-major, `w` x `h`), labelled in raster
 * order of each component's first pixel, as `cv2.connectedComponentsWithStats`
 * numbers them. The pixel order follows the Rust stack fill, since the mean
 * probability sums pixels in that order.
 */
export function components4(mask: ArrayLike<boolean | number>, w: number, h: number): Component[] {
  const seen = new Uint8Array(w * h);
  const out: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    const comp: Component = { x0: Infinity, y0: Infinity, x1: 0, y1: 0, pixels: [] };
    while (stack.length > 0) {
      // SAFETY: the loop condition guarantees a value.
      const p = stack.pop() as number;
      const x = p % w;
      const y = (p - x) / w;
      if (x < comp.x0) comp.x0 = x;
      if (y < comp.y0) comp.y0 = y;
      if (x > comp.x1) comp.x1 = x;
      if (y > comp.y1) comp.y1 = y;
      comp.pixels.push(p);
      if (x > 0 && mask[p - 1] && !seen[p - 1]) {
        seen[p - 1] = 1;
        stack.push(p - 1);
      }
      if (x + 1 < w && mask[p + 1] && !seen[p + 1]) {
        seen[p + 1] = 1;
        stack.push(p + 1);
      }
      if (y > 0 && mask[p - w] && !seen[p - w]) {
        seen[p - w] = 1;
        stack.push(p - w);
      }
      if (y + 1 < h && mask[p + w] && !seen[p + w]) {
        seen[p + w] = 1;
        stack.push(p + w);
      }
    }
    out.push(comp);
  }
  return out;
}

/**
 * A rotated rectangle: centre, side lengths along `u` (w) and its normal (h),
 * and `u`'s angle in degrees. All f32.
 */
export type RotRect = { cx: number; cy: number; w: number; h: number; angle: number };

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

/** `cv2.minAreaRect`: the smallest-area rectangle around `pts` (convex hull + one candidate per hull edge). */
export function minAreaRect(pts: readonly Pt[]): RotRect {
  const sorted = pts
    .map((q): Pt => [q[0], q[1]])
    .sort((a, b) => totalCmp(a[0], b[0]) || totalCmp(a[1], b[1]));
  const p: Pt[] = [];
  for (const q of sorted) {
    const last = p[p.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) p.push(q);
  }
  // SAFETY: callers pass at least one point.
  const first = p[0] as Pt;
  const degenerate: RotRect = { cx: f32(first[0]), cy: f32(first[1]), w: 0, h: 0, angle: 0 };
  if (p.length === 1) return degenerate;
  // monotone chain
  const hull: Pt[] = [];
  for (const q of p) {
    while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], q) <= 0) {
      hull.pop();
    }
    hull.push(q);
  }
  const lower = hull.length + 1;
  for (let i = p.length - 2; i >= 0; i--) {
    const q = p[i];
    while (hull.length >= lower && cross(hull[hull.length - 2], hull[hull.length - 1], q) <= 0) {
      hull.pop();
    }
    hull.push(q);
  }
  hull.pop();
  let bestArea = Infinity;
  let best: RotRect | undefined;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const ux = dx / len;
    const uy = dy / len;
    const vx = -uy;
    const vy = ux;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const q of hull) {
      const pu = q[0] * ux + q[1] * uy;
      const pv = q[0] * vx + q[1] * vy;
      u0 = Math.min(u0, pu);
      u1 = Math.max(u1, pu);
      v0 = Math.min(v0, pv);
      v1 = Math.max(v1, pv);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (best === undefined || area < bestArea) {
      const cu = (u0 + u1) / 2;
      const cv = (v0 + v1) / 2;
      bestArea = area;
      best = {
        cx: f32(cu * ux + cv * vx),
        cy: f32(cu * uy + cv * vy),
        w: f32(u1 - u0),
        h: f32(v1 - v0),
        angle: f32(Math.atan2(uy, ux) * RAD_TO_DEG),
      };
    }
  }
  return best ?? degenerate;
}

/** `cv2.boxPoints`: the rectangle's four corners. */
export function boxPoints(r: RotRect): Quad {
  const a = r.angle * DEG_TO_RAD;
  const b = f32(Math.cos(a) * 0.5);
  const c = f32(Math.sin(a) * 0.5);
  const p0: Pt = [
    f32(f32(r.cx - f32(c * r.h)) - f32(b * r.w)),
    f32(f32(r.cy + f32(b * r.h)) - f32(c * r.w)),
  ];
  const p1: Pt = [
    f32(f32(r.cx + f32(c * r.h)) - f32(b * r.w)),
    f32(f32(r.cy - f32(b * r.h)) - f32(c * r.w)),
  ];
  const p2: Pt = [f32(f32(2 * r.cx) - p0[0]), f32(f32(2 * r.cy) - p0[1])];
  const p3: Pt = [f32(f32(2 * r.cx) - p1[0]), f32(f32(2 * r.cy) - p1[1])];
  return [p0, p1, p2, p3];
}

/** Otsu's threshold over 8-bit values: the first level maximising the between-class variance. */
export function otsu(values: Iterable<number>): number {
  const hist = new Float64Array(256);
  let n = 0;
  for (const v of values) {
    hist[v] = hist[v] + 1;
    n += 1;
  }
  n = Math.max(n, 1);
  let w = 0;
  let mu = 0;
  const cumW = new Float64Array(256);
  const cumMu = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    w += hist[i] / n;
    mu += (hist[i] / n) * i;
    cumW[i] = w;
    cumMu[i] = mu;
  }
  const muT = cumMu[255];
  let bestS = -Infinity;
  let best = 0;
  for (let i = 0; i < 256; i++) {
    const wi = cumW[i];
    const d = muT * wi - cumMu[i];
    const s = (d * d) / (wi * (1 - wi));
    if (Number.isFinite(s) && s > bestS) {
      bestS = s;
      best = i;
    }
  }
  return best;
}
