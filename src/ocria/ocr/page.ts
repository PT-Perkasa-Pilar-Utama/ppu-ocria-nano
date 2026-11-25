// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr/ocria/page.rs (crates-v2.21.2, Apache-2.0).

// Page-level steps around the models: line crops, column-gutter splitting,
// orientation, reading-order quads, and the reading filters.

import { asInt, f32 } from "../rust.js";
import type { Img, Pt, Quad } from "./img.js";
import { rot90 } from "./img.js";
import { perspectiveTransform, warpPerspectiveCubic } from "./warp.js";

function dist(a: Pt, b: Pt): number {
  const dx = f32(a[0] - b[0]);
  const dy = f32(a[1] - b[1]);
  return f32(Math.sqrt(f32(f32(dx * dx) + f32(dy * dy))));
}

/** Perspective-crop a (possibly rotated) quad, as PaddleOCR does. */
export function crop(img: Img, q: Quad): Img {
  const w = Math.max(asInt(Math.max(dist(q[0], q[1]), dist(q[2], q[3]))), 2);
  const h = Math.max(asInt(Math.max(dist(q[0], q[3]), dist(q[1], q[2]))), 2);
  const m = perspectiveTransform(q, [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ]);
  const c = warpPerspectiveCubic(img, m, w, h);
  // vertical box: turn it horizontal
  return h / w >= 1.5 ? rot90(c, 1) : c;
}

export type Ext = [x0: number, y0: number, x1: number, y1: number];

export function extent(q: Quad): Ext {
  return [
    Math.min(q[0][0], q[1][0], q[2][0], q[3][0]),
    Math.min(q[0][1], q[1][1], q[2][1], q[3][1]),
    Math.max(q[0][0], q[1][0], q[2][0], q[3][0]),
    Math.max(q[0][1], q[1][1], q[2][1], q[3][1]),
  ];
}

/** Boxes that are clearly horizontal text lines (at least 3x wider than tall, >= 30 px). */
export function longLines(boxes: readonly Quad[]): number {
  let n = 0;
  for (const q of boxes) {
    const [x0, y0, x1, y1] = extent(q);
    const dx = x1 - x0;
    if (dx >= 30 && dx >= 3 * (y1 - y0)) n++;
  }
  return n;
}

/** Detector boxes of a page scanned on its side: many boxes, almost none horizontal lines. */
export function looksSideways(boxes: readonly Quad[]): boolean {
  return boxes.length >= 15 && longLines(boxes) < 0.25 * boxes.length;
}

/**
 * A box quad (screen order in the image it was read in) as a quad in the
 * original image whose corners run in reading order: upside-down pages swap
 * corners; pages read after a quarter turn map back with x = w0 - 1 - y', y = x'.
 */
export function readingFrame(q: Quad, flip: boolean, sideways: boolean, w0: number): Quad {
  const p: Quad = flip ? [q[2], q[3], q[0], q[1]] : [q[0], q[1], q[2], q[3]];
  const back = (pt: Pt): Pt => (sideways ? [f32(w0 - 1 - pt[1]), pt[0]] : [pt[0], pt[1]]);
  return [back(p[0]), back(p[1]), back(p[2]), back(p[3])];
}

/** The most common group (np.bincount(..).argmax(): the lowest index on ties). */
export function majority(groups: readonly number[]): number {
  const n = [0, 0, 0, 0];
  for (const g of groups) n[g] = n[g] + 1;
  let best = 0;
  for (let i = 1; i < 4; i++) if (n[i] > n[best]) best = i;
  return best;
}
