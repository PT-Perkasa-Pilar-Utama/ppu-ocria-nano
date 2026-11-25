// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr/ocria/det.rs (crates-v2.21.2, Apache-2.0).

// Join collinear line quads.

import { f32 } from "../rust.js";
import type { Pt, Quad } from "./img.js";
import { mean4, norm, orderQuad } from "./quad.js";

/**
 * Join near-horizontal line quads that continue one another: each box links
 * to its nearest qualifying right neighbour when that neighbour's nearest left
 * neighbour is the same box, and each chain becomes the rectangle spanning it
 * along its longest member's axis.
 */
export function mergeCollinear(boxes: readonly Quad[], gap: number): Quad[] {
  const MAX_TILT = f32(0.35);
  const MAX_PERP = f32(0.35);
  const MIN_H_RATIO = f32(0.6);
  const MAX_DANGLE = f32(0.07);
  const n = boxes.length;
  if (n < 2) return boxes.slice();
  const c = boxes.map((q): Pt => [
    mean4(q[0][0], q[1][0], q[2][0], q[3][0]),
    mean4(q[0][1], q[1][1], q[2][1], q[3][1]),
  ]);
  const u: Pt[] = [];
  const len: number[] = [];
  const hgt: number[] = [];
  for (const q of boxes) {
    const dx = f32(q[1][0] - q[0][0]);
    const dy = f32(q[1][1] - q[0][1]);
    const l = Math.max(norm(dx, dy), f32(1e-3));
    u.push([f32(dx / l), f32(dy / l)]);
    len.push(l);
    hgt.push(Math.max(norm(f32(q[3][0] - q[0][0]), f32(q[3][1] - q[0][1])), f32(1e-3)));
  }
  const v = u.map((d): Pt => [-d[1], d[0]]);
  const flat = u.map((d, i) => Math.abs(d[1]) <= MAX_TILT && len[i] >= f32(0.5 * hgt[i]));
  const cosMin = f32(1 - f32(f32(MAX_DANGLE * MAX_DANGLE) / 2));
  const right = Array.from({ length: n }, (): number => -1);
  const leftG = Array.from({ length: n }, (): number => Infinity);
  const leftA = Array.from({ length: n }, (): number => -1);
  for (let a = 0; a < n; a++) {
    let bestG = Infinity;
    let bestB = -1;
    if (flat[a]) {
      const [ua0, ua1] = u[a];
      const [va0, va1] = v[a];
      for (let b = 0; b < n; b++) {
        if (a === b || !flat[b]) continue;
        const d0 = f32(c[b][0] - c[a][0]);
        const d1 = f32(c[b][1] - c[a][1]);
        const along = f32(f32(d0 * ua0) + f32(d1 * ua1));
        const perp = Math.abs(f32(f32(d0 * va0) + f32(d1 * va1)));
        const hm = f32(f32(hgt[a] + hgt[b]) / 2);
        const g = f32(along - f32(f32(len[a] + len[b]) / 2));
        const ok =
          along > 0 &&
          f32(Math.min(hgt[a], hgt[b]) / Math.max(hgt[a], hgt[b])) >= MIN_H_RATIO &&
          Math.abs(f32(f32(ua0 * u[b][0]) + f32(ua1 * u[b][1]))) >= cosMin &&
          perp <= f32(MAX_PERP * hm) &&
          g <= f32(gap * hm) &&
          g >= f32(-0.5 * Math.min(len[a], len[b]));
        if (ok) {
          if (g < bestG) {
            bestG = g;
            bestB = b;
          }
          // column-wise argmin for b: first a reaching the minimum
          if (g < leftG[b]) {
            leftG[b] = g;
            leftA[b] = a;
          }
        }
      }
    }
    right[a] = bestB;
  }
  const nxt = Array.from({ length: n }, (): number => -1);
  for (let a = 0; a < n; a++) {
    const b = right[a];
    if (b >= 0 && leftA[b] === a) nxt[a] = b;
  }
  const hasPrev = Array.from({ length: n }, (): boolean => false);
  for (const b of nxt) if (b >= 0) hasPrev[b] = true;
  const out: Quad[] = [];
  const seen = Array.from({ length: n }, (): boolean => false);
  for (let a = 0; a < n; a++) {
    if (hasPrev[a] || seen[a]) continue;
    const chain = [a];
    seen[a] = true;
    for (;;) {
      const nx = nxt[chain[chain.length - 1]];
      if (nx < 0 || seen[nx]) break;
      chain.push(nx);
      seen[nx] = true;
    }
    if (chain.length === 1) {
      out.push(boxes[a]);
      continue;
    }
    const pts = chain.flatMap((i) => boxes[i]);
    // the chain's direction is its longest member's (first one on ties)
    let k = chain[0];
    for (const i of chain.slice(1)) if (len[i] > len[k]) k = i;
    const np = f32(pts.length);
    let sx = 0;
    let sy = 0;
    for (const p of pts) {
      sx = f32(sx + p[0]);
      sy = f32(sy + p[1]);
    }
    const ca: Pt = [f32(sx / np), f32(sy / np)];
    const ua = u[k];
    const va = v[k];
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (const p of pts) {
      const dx = f32(p[0] - ca[0]);
      const dy = f32(p[1] - ca[1]);
      const pa = f32(f32(dx * ua[0]) + f32(dy * ua[1]));
      const pb = f32(f32(dx * va[0]) + f32(dy * va[1]));
      a0 = Math.min(a0, pa);
      a1 = Math.max(a1, pa);
      b0 = Math.min(b0, pb);
      b1 = Math.max(b1, pb);
    }
    const at = (s: number, t: number): Pt => [
      f32(f32(ca[0] + f32(ua[0] * s)) + f32(va[0] * t)),
      f32(f32(ca[1] + f32(ua[1] * s)) + f32(va[1] * t)),
    ];
    out.push(orderQuad([at(a0, b0), at(a1, b0), at(a1, b1), at(a0, b1)]));
  }
  for (let i = 0; i < n; i++) if (!seen[i]) out.push(boxes[i]);
  return out;
}
