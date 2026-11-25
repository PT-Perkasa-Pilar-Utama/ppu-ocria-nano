// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): density-valley cut search.

import { asUsize, f32, totalCmp } from "../rust.js";
import type { CutAxis, Rect } from "../types/geometry.js";
import type { ProjectedTextItem } from "./types.js";
import { sumF32 } from "./projected-item.js";
import type { CutCandidate } from "./xy-consts.js";
import {
  XY_MIN_H_VALLEY_FACTOR,
  XY_MIN_V_VALLEY_PT,
  XY_T_DENS,
  xyBucketPt,
  xyItemWeight,
} from "./xy-consts.js";

/** Add `weight` to every bucket covered by `[c0, c1]` along the axis. */
function stampDensity(
  density: Float32Array,
  c0: number,
  c1: number,
  weight: number,
  origin: number,
  bucketPt: number
): void {
  const nBuckets = density.length;
  const b0F = Math.floor(f32(f32(c0 - origin) / bucketPt));
  const b1F = Math.ceil(f32(f32(c1 - origin) / bucketPt));
  const b0 = asUsize(Math.max(b0F, 0.0));
  const b1 = Math.min(asUsize(Math.max(b1F, f32(b0F + 1.0))), nBuckets);
  for (let b = b0; b < b1; b++) density[b] = f32(density[b] + weight);
}

/**
 * Hard-reject companion to the density-stamping in `xyFindBestCut`.
 * Density-stamping makes the recursion prefer cuts around obstacles, but
 * sparsely-filled tables have inter-cell gaps that still score better than the
 * stamped obstacle band. Returns true iff the cut line at `position` strictly
 * passes through any obstacle that intersects `bbox`.
 */
export function cutLinePassesThroughObstacle(
  axis: CutAxis,
  position: number,
  bbox: Rect,
  obstacles: readonly Rect[]
): boolean {
  // Tolerance: a cut whose position lands within ~1pt of an obstacle's
  // edge is allowed (the obstacle's edge is itself a natural cut line).
  const EDGE_TOLERANCE_PT = 1.0;
  for (const ob of obstacles) {
    // Skip obstacles that don't intersect bbox at all.
    const ox0 = Math.max(ob.x, bbox.x);
    const oy0 = Math.max(ob.y, bbox.y);
    const ox1 = Math.min(f32(ob.x + ob.width), f32(bbox.x + bbox.width));
    const oy1 = Math.min(f32(ob.y + ob.height), f32(bbox.y + bbox.height));
    if (ox1 <= ox0 || oy1 <= oy0) continue;
    const through =
      axis === "Vertical"
        ? position > f32(ox0 + EDGE_TOLERANCE_PT) && position < f32(ox1 - EDGE_TOLERANCE_PT)
        : position > f32(oy0 + EDGE_TOLERANCE_PT) && position < f32(oy1 - EDGE_TOLERANCE_PT);
    if (through) return true;
  }
  return false;
}

/**
 * Find the best valley along `axis` inside `bbox` for the given items. The
 * returned position is in absolute page coordinates.
 *
 * `figures` is the set of figure-region rectangles on the page. Any figure
 * that intersects `bbox` is stamped into the density projection like a giant
 * opaque text block: its perpendicular extent (clipped to `bbox`) is added to
 * each bucket it covers along `axis`. This makes the recursion prefer cuts
 * around figures rather than slicing through them.
 */
export function xyFindBestCut(
  items: readonly ProjectedTextItem[],
  idxs: readonly number[],
  bbox: Rect,
  axis: CutAxis,
  medianH: number,
  figures: readonly Rect[]
): CutCandidate | null {
  const [origin, length] = axis === "Horizontal" ? [bbox.y, bbox.height] : [bbox.x, bbox.width];
  if (length <= 0.0) return null;
  const bucketPt = xyBucketPt(length);
  const nBuckets = Math.max(asUsize(Math.ceil(f32(length / bucketPt))), 1);
  const density = new Float32Array(nBuckets);

  for (const i of idxs) {
    const it = items[i].item;
    const [c0, c1] =
      axis === "Horizontal"
        ? [it.y, f32(it.y + Math.max(it.height, 0.0))]
        : [it.x, f32(it.x + Math.max(it.width, 0.0))];
    stampDensity(density, c0, c1, xyItemWeight(it), origin, bucketPt);
  }

  // Stamp figures into the projection as opaque obstacles. A figure that
  // intersects `bbox` adds density to each axis-parallel bucket it spans;
  // weight = its perpendicular extent (clipped to bbox) so figures behave
  // like very wide/tall pseudo-items relative to text. The valley search
  // naturally finds cuts adjacent to figures rather than through them.
  for (const fig of figures) {
    const fx0 = Math.max(fig.x, bbox.x);
    const fy0 = Math.max(fig.y, bbox.y);
    const fx1 = Math.min(f32(fig.x + fig.width), f32(bbox.x + bbox.width));
    const fy1 = Math.min(f32(fig.y + fig.height), f32(bbox.y + bbox.height));
    if (fx1 <= fx0 || fy1 <= fy0) continue;
    const [c0, c1, perp] =
      axis === "Horizontal" ? [fy0, fy1, f32(fx1 - fx0)] : [fx0, fx1, f32(fy1 - fy0)];
    stampDensity(density, c0, c1, Math.max(perp, 1.0), origin, bucketPt);
  }

  const nonzero = Array.from(density).filter((d) => d > 0.0);
  if (nonzero.length === 0) return null;
  nonzero.sort(totalCmp);
  const median = nonzero[Math.floor(nonzero.length / 2)];
  if (median <= 0.0) return null;
  const threshold = f32(median * XY_T_DENS);

  // Don't cut at leading/trailing whitespace: only consider valleys interior
  // to the content's span on this axis.
  const firstDense = density.findIndex((d) => d > threshold);
  if (firstDense < 0) return null;
  const lastDense = density.findLastIndex((d) => d > threshold);
  if (lastDense <= firstDense + 1) return null;

  const minValleyPt =
    axis === "Vertical" ? XY_MIN_V_VALLEY_PT : f32(medianH * XY_MIN_H_VALLEY_FACTOR);
  const minValleyBuckets = Math.max(asUsize(Math.ceil(f32(minValleyPt / bucketPt))), 1);

  let best: CutCandidate | null = null;
  let i = firstDense + 1;
  while (i <= lastDense) {
    if (density[i] <= threshold) {
      const s = i;
      while (i <= lastDense && density[i] <= threshold) i += 1;
      const e = i; // exclusive
      const width = e - s;
      if (width >= minValleyBuckets) {
        const mean = f32(sumF32(density.subarray(s, e)) / width);
        const depth = Math.max(f32(1.0 - f32(mean / median)), 0.0);
        const score = f32(width * depth);
        const mid = f32(f32(s + e) * 0.5);
        const position = f32(origin + f32(mid * bucketPt));
        // Density-stamping alone isn't always enough to push the gutter
        // inside a table region below threshold: the inter-cell gaps win on
        // tables with sparsely-filled cells. Hard-reject any cut line that
        // passes strictly through an obstacle rect intersecting `bbox`.
        if (
          !cutLinePassesThroughObstacle(axis, position, bbox, figures) &&
          (best === null || score > best.score)
        ) {
          best = { axis, position, score };
        }
      }
    } else {
      i += 1;
    }
  }
  return best;
}
