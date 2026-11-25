// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): detect_table_rects.

import { f32 } from "../../rust.js";
import type { GraphicPrimitive, Rect } from "../../types/geometry.js";
import {
  TABLE_MAX_PAGE_COVERAGE,
  clusterHSegments,
  clusterVSegments,
  extractHVSegments,
  findGridComponents,
} from "./grid-segments.js";

/**
 * Detect candidate ruled-table bounding rectangles from page graphics alone.
 *
 * Unlike `detect_ruled_tables`, this runs before projection and ignores text
 * content entirely: its only job is to find the bbox of every H/V grid
 * component so the XY-cut layout pass can treat those regions as obstacles
 * and avoid slicing tables column-wise (the failure mode that produces
 * column-major reading order). Empty-cell-fraction and other quality filters
 * are deliberately skipped here: the obstacle machinery only cares about
 * geometry.
 */
export function detectTableRects(
  graphics: readonly GraphicPrimitive[],
  pageWidth: number,
  pageHeight: number
): Rect[] {
  const [hs0, vs0] = extractHVSegments(graphics);
  const hs = clusterHSegments(hs0);
  const vs = clusterVSegments(vs0);
  if (hs.length < 2 || vs.length < 2) return [];
  const out: Rect[] = [];
  for (const [hIdx, vIdx] of findGridComponents(hs, vs)) {
    const ys = hIdx.map((i) => hs[i].y);
    const xs = vIdx.map((i) => vs[i].x);
    const yMin = ys.reduce((a, b) => Math.min(a, b), Infinity);
    const yMax = ys.reduce((a, b) => Math.max(a, b), -Infinity);
    const xMin = xs.reduce((a, b) => Math.min(a, b), Infinity);
    const xMax = xs.reduce((a, b) => Math.max(a, b), -Infinity);
    const w = f32(xMax - xMin);
    const h = f32(yMax - yMin);
    if (w < 5.0 || h < 5.0) continue;
    // Skip whole-page borders, same rationale as `TABLE_MAX_PAGE_COVERAGE`
    // in the post-projection detector.
    if (
      pageWidth > 0.0 &&
      pageHeight > 0.0 &&
      f32(w / pageWidth) >= TABLE_MAX_PAGE_COVERAGE &&
      f32(h / pageHeight) >= TABLE_MAX_PAGE_COVERAGE
    ) {
      continue;
    }
    out.push({ x: xMin, y: yMin, width: w, height: h });
  }
  return out;
}
