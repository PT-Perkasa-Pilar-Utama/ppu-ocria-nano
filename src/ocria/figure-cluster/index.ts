// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/figure_cluster.rs (crates-v2.21.2, Apache-2.0).

// Figure-region clustering from page vector graphics.
//
// Groups significant vector graphics (filled rects, stroke clusters that
// aren't HR-like or table-grid-like) into figure bounding rectangles. These
// rects are fed into the XY-cut layout pass as obstacles, so the recursion
// partitions around figures (e.g. an abstract column next to a figure that
// straddles two columns on the first page of an academic paper).
//
// Detection is intentionally cautious: false positives here corrupt the
// reading order. When in doubt we drop the cluster.

import { f32, totalCmp } from "../rust.js";
import { graphicBbox } from "../types/geometry.js";
import type { GraphicPrimitive, Rect } from "../types/geometry.js";
import type { TextItem } from "../types/text-item.js";
import { clusterBboxesSpatial, ufFind, unionRect } from "./cluster.js";
import {
  FIG_LARGE_SOLO_AREA,
  FIG_MAX_ASPECT_RATIO,
  FIG_MAX_FRACTION,
  FIG_MAX_TEXT_COVERAGE,
  FIG_MIN_AREA_PT2,
  FIG_MIN_EXTENT_PT,
  HR_MAX_THICKNESS_PT,
  HR_MIN_WIDTH_FRACTION,
} from "./constants.js";
import { textCoverage } from "./text-coverage.js";

export * from "./cluster.js";
export * from "./constants.js";
export { textCoverage } from "./text-coverage.js";

/** Returns the union-find parent array for the primitive boxes. */
export type BboxClusterer = (
  bboxes: readonly Rect[],
  pageWidth: number,
  pageHeight: number
) => number[];

/**
 * Detect figure rectangles on a page.
 *
 * Returns a list of bounding rectangles, each enclosing a vector-graphics
 * cluster judged to be a figure (chart, diagram, embedded illustration).
 * Empty when the page has no significant graphics.
 */
export function detectFigureRects(
  graphics: readonly GraphicPrimitive[],
  textItems: readonly TextItem[],
  pageWidth: number,
  pageHeight: number
): Rect[] {
  return detectFigureRectsWithClusterer(
    graphics,
    textItems,
    pageWidth,
    pageHeight,
    clusterBboxesSpatial
  );
}

export function detectFigureRectsWithClusterer(
  graphics: readonly GraphicPrimitive[],
  textItems: readonly TextItem[],
  pageWidth: number,
  pageHeight: number,
  clusterer: BboxClusterer
): Rect[] {
  if (graphics.length === 0 || pageWidth <= 0.0 || pageHeight <= 0.0) return [];

  // Pre-filter primitives.
  const hrMinWidth = f32(pageWidth * HR_MIN_WIDTH_FRACTION);
  const bboxes: Rect[] = [];
  for (const g of graphics) {
    const bbox = graphicBbox(g);
    // Drop full-page rects (page background paint).
    if (
      bbox.width >= f32(pageWidth * FIG_MAX_FRACTION) &&
      bbox.height >= f32(pageHeight * FIG_MAX_FRACTION)
    ) {
      continue;
    }
    if ("Stroke" in g) {
      const { x1, y1, x2, y2, width } = g.Stroke;
      const dx = Math.abs(f32(x2 - x1));
      const dy = Math.abs(f32(y2 - y1));
      // HR-like: long thin horizontal stroke, a section divider, not a figure.
      if (dy <= HR_MAX_THICKNESS_PT && width <= HR_MAX_THICKNESS_PT && dx >= hrMinWidth) continue;
      // Tiny strokes (glyph artifacts, sub-pixel cleanup).
      if (dx < 4.0 && dy < 4.0) continue;
    } else if (bbox.width < 2.0 && bbox.height < 2.0) {
      // Tiny rects also dropped to avoid pulling glyph artifacts in.
      continue;
    }
    bboxes.push(bbox);
  }
  if (bboxes.length === 0) return [];

  const parent = clusterer(bboxes, pageWidth, pageHeight);

  // Rust groups in a HashMap and reads `into_values()` in random order; the
  // final (y, x) sort below fixes the order except for clusters whose
  // top-left corners are equal, where upstream is nondeterministic. A Map
  // keeps first-seen order for those.
  const groups = new Map<number, [Rect, number]>();
  bboxes.forEach((bb, i) => {
    const r = ufFind(parent, i);
    const entry = groups.get(r);
    if (entry) {
      entry[0] = unionRect(entry[0], bb);
      entry[1] += 1;
    } else {
      groups.set(r, [{ ...bb }, 1]);
    }
  });

  const out: Rect[] = [];
  for (const [bbox, count] of groups.values()) {
    if (!isFigureCluster(bbox, count, pageWidth, pageHeight, textItems)) continue;
    out.push(bbox);
  }
  // Sort by y then x so callers see deterministic ordering.
  out.sort((a, b) => totalCmp(a.y, b.y) || totalCmp(a.x, b.x));
  return out;
}

export function isFigureCluster(
  bbox: Rect,
  primitiveCount: number,
  pageWidth: number,
  pageHeight: number,
  textItems: readonly TextItem[]
): boolean {
  if (bbox.width < FIG_MIN_EXTENT_PT || bbox.height < FIG_MIN_EXTENT_PT) return false;
  const area = f32(bbox.width * bbox.height);
  if (area < FIG_MIN_AREA_PT2) return false;
  if (
    bbox.width >= f32(pageWidth * FIG_MAX_FRACTION) &&
    bbox.height >= f32(pageHeight * FIG_MAX_FRACTION)
  ) {
    return false;
  }
  const ratio =
    bbox.width >= bbox.height
      ? f32(bbox.width / Math.max(bbox.height, f32(0.01)))
      : f32(bbox.height / Math.max(bbox.width, f32(0.01)));
  if (ratio > FIG_MAX_ASPECT_RATIO) return false;
  if (primitiveCount < 2 && area < FIG_LARGE_SOLO_AREA) return false;
  if (textCoverage(bbox, textItems) > FIG_MAX_TEXT_COVERAGE) return false;
  return true;
}
