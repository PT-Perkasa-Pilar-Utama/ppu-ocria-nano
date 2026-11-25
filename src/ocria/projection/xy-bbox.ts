// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): XY-cut region geometry.

import { f32, totalCmp } from "../rust.js";
import type { Rect } from "../types/geometry.js";
import type { CutCandidate } from "./xy-consts.js";
import type { ProjectedTextItem } from "./types.js";

export function xyRootBbox(
  items: readonly ProjectedTextItem[],
  indices: readonly number[],
  pageWidth: number,
  pageHeight: number
): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const idx of indices) {
    const it = items[idx];
    if (it.item.text === "") continue;
    minX = Math.min(minX, it.item.x);
    minY = Math.min(minY, it.item.y);
    maxX = Math.max(maxX, f32(it.item.x + Math.max(it.item.width, 0.0)));
    maxY = Math.max(maxY, f32(it.item.y + Math.max(it.item.height, 0.0)));
  }
  if (!Number.isFinite(minX)) {
    return { x: 0.0, y: 0.0, width: Math.max(pageWidth, 1.0), height: Math.max(pageHeight, 1.0) };
  }
  const x = Math.max(minX, 0.0);
  const y = Math.max(minY, 0.0);
  const w = Math.max(f32(maxX - x), 1.0);
  const h = Math.max(f32(maxY - y), 1.0);
  // Span the actual item extent. The page dimensions are only used as a
  // fallback (no items). We must NOT clamp the bbox down to them:
  // `handle_rotation_reading_order` lays rotated marginalia (e.g. an arXiv
  // sidebar stamp) out on a virtual canvas taller/wider than the physical
  // page and pushes the non-rotated body below it. Clamping to page_height
  // would drop those displaced body items outside the density buckets, so no
  // horizontal valley between a full-width header and the 2-column body is
  // ever found and the column V-cut shreds the centered title/author band.
  return { x, y, width: w, height: h };
}

export function xyMedianLineHeight(
  items: readonly ProjectedTextItem[],
  idxs: readonly number[]
): number {
  const heights: number[] = [];
  for (const i of idxs) {
    const h = items[i].item.height;
    if (h > 0.5) heights.push(h);
  }
  if (heights.length === 0) return 10.0;
  heights.sort(totalCmp);
  return heights[Math.floor(heights.length / 2)];
}

/**
 * Approximate distinct-line count by y-banding, used only to enforce
 * `XY_MIN_LINES_PER_H_SIDE`.
 */
export function xyDistinctLines(
  items: readonly ProjectedTextItem[],
  idxs: readonly number[],
  medianH: number
): number {
  if (idxs.length === 0) return 0;
  const band = Math.max(f32(medianH * 0.5), 2.0);
  const ys = idxs.map((i) => items[i].item.y);
  ys.sort(totalCmp);
  let lines = 1;
  let last = ys[0];
  for (let k = 1; k < ys.length; k++) {
    const y = ys[k];
    if (Math.abs(f32(y - last)) > band) {
      lines += 1;
      last = y;
    }
  }
  return lines;
}

export function xySplitBbox(bbox: Rect, cut: CutCandidate): [Rect, Rect] {
  if (cut.axis === "Horizontal") {
    const topH = Math.max(f32(cut.position - bbox.y), 0.0);
    const top: Rect = { x: bbox.x, y: bbox.y, width: bbox.width, height: topH };
    const bot: Rect = {
      x: bbox.x,
      y: cut.position,
      width: bbox.width,
      height: Math.max(f32(bbox.height - topH), 0.0),
    };
    return [top, bot];
  }
  const leftW = Math.max(f32(cut.position - bbox.x), 0.0);
  const left: Rect = { x: bbox.x, y: bbox.y, width: leftW, height: bbox.height };
  const right: Rect = {
    x: cut.position,
    y: bbox.y,
    width: Math.max(f32(bbox.width - leftW), 0.0),
    height: bbox.height,
  };
  return [left, right];
}

/** Union horizontal extent (min x, max x) of `idxs`. */
export function xExtent(
  items: readonly ProjectedTextItem[],
  idxs: readonly number[]
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of idxs) {
    const it = items[i].item;
    lo = Math.min(lo, it.x);
    hi = Math.max(hi, f32(it.x + Math.max(it.width, 0.0)));
  }
  return [lo, hi];
}
