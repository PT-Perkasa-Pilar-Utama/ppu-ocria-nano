// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/figure_cluster.rs (crates-v2.21.2, Apache-2.0): text coverage of a candidate figure.

import { f32, totalCmp } from "../rust.js";
import type { Rect } from "../types/geometry.js";
import type { TextItem } from "../types/text-item.js";

type Clipped = [number, number, number, number];

const mid = (c: Clipped): number => f32(f32(c[1] + c[3]) * 0.5);

/**
 * Fraction of `bbox` area covered by text. Computed by y-banding the items
 * inside `bbox` into lines (same y within +-0.5 x median_h) and taking the
 * union bbox of each band: a much better proxy for "this region is
 * dominated by text" than summing per-glyph rectangles, which leaves the
 * large inter-word and inter-cell gaps unaccounted for and lets text-dense
 * tables slip below a reasonable coverage threshold.
 */
export function textCoverage(bbox: Rect, textItems: readonly TextItem[]): number {
  const bboxArea = f32(bbox.width * bbox.height);
  if (bboxArea <= 0.0) return 0.0;
  // Collect items that overlap the bbox (any intersection), keep their clipped extents.
  const clipped: Clipped[] = [];
  const heights: number[] = [];
  for (const it of textItems) {
    const ix0 = Math.max(it.x, bbox.x);
    const iy0 = Math.max(it.y, bbox.y);
    const ix1 = Math.min(f32(it.x + it.width), f32(bbox.x + bbox.width));
    const iy1 = Math.min(f32(it.y + it.height), f32(bbox.y + bbox.height));
    if (ix1 <= ix0 || iy1 <= iy0) continue;
    clipped.push([ix0, iy0, ix1, iy1]);
    const h = Math.max(Math.max(it.height, f32(iy1 - iy0)), 0.0);
    if (h > 0.5) heights.push(h);
  }
  if (clipped.length === 0) return 0.0;
  let medianH = 8.0;
  if (heights.length > 0) {
    heights.sort(totalCmp);
    medianH = Math.max(heights[Math.floor(heights.length / 2)], 4.0);
  }
  const band = f32(medianH * 0.5);
  // Sort by y midpoint, then greedy y-band into "lines": items whose
  // y-midpoints are within `band` form one line.
  clipped.sort((a, b) => totalCmp(mid(a), mid(b)));
  const area = (c: Clipped): number => f32(f32(c[2] - c[0]) * f32(c[3] - c[1]));
  let covered = 0.0;
  let cur: Clipped = clipped[0];
  for (let k = 1; k < clipped.length; k++) {
    const nxt = clipped[k];
    if (Math.abs(f32(mid(nxt) - mid(cur))) <= band) {
      cur = [
        Math.min(cur[0], nxt[0]),
        Math.min(cur[1], nxt[1]),
        Math.max(cur[2], nxt[2]),
        Math.max(cur[3], nxt[3]),
      ];
    } else {
      covered = f32(covered + area(cur));
      cur = nxt;
    }
  }
  covered = f32(covered + area(cur));
  return Math.min(f32(covered / bboxArea), 1.0);
}
