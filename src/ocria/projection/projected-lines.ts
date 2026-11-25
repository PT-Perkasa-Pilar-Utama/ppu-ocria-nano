// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): build_projected_lines, xy_walk_leaves.

import { clamp, f32, totalCmp } from "../rust.js";
import type { Rect, Region } from "../types/geometry.js";
import { emptyRegion } from "../types/geometry.js";
import type { ProjectedLine } from "../types/page.js";
import { buildOneLine } from "./projected-line-build.js";
import type { ProjectedTextItem } from "./types.js";
import { NUMERIC_FOOTER_PATH, isolatedNumericFooter, xyCut } from "./xy-cut.js";

/**
 * Pre-order walk of leaves. Each leaf yields its `region_path` (index trail
 * from the root) and item indices. Leaves with no items are skipped.
 */
export function xyWalkLeaves(
  region: Region,
  path: number[],
  out: Array<[number[], number[]]>
): void {
  if ("Leaf" in region.kind) {
    const idx = region.kind.Leaf.item_indices;
    if (idx.length > 0) out.push([[...path], [...idx]]);
  } else {
    region.kind.Split.children.forEach((child, i) => {
      path.push(i);
      xyWalkLeaves(child, path, out);
      path.pop();
    });
  }
}

/**
 * PDFium occasionally reports anomalously large item heights (e.g. 56pt for a
 * single-word run whose real glyph height is about 13pt) when the font's
 * bounding box / line-height is baked into the text-matrix scale. Without a
 * cap, the y-band tolerance `max(h) * 0.5` swallows multiple distinct baselines
 * into one projected line (fill-in-the-blank lab worksheets). Clamp at 24pt for
 * the banding decision; the actual stored line bbox is unchanged.
 */
const Y_BAND_HEIGHT_CAP = 24.0;

/**
 * Group `items` into per-leaf lines using the XY-cut region tree, then derive
 * per-line aggregates. Leaves are walked pre-order so reading order follows
 * the layout: top-to-bottom bands, left-to-right columns, recursively. Returns
 * the populated lines and the region tree so callers can persist it on
 * `ParsedPage`.
 */
export function buildProjectedLines(
  items: readonly ProjectedTextItem[],
  pageWidth: number,
  pageHeight: number,
  figures: readonly Rect[]
): [ProjectedLine[], Region] {
  if (items.length === 0) return [[], emptyRegion()];

  const region = xyCut(items, pageWidth, pageHeight, figures);
  const leaves: Array<[number[], number[]]> = [];
  xyWalkLeaves(region, [], leaves);

  // Figures used for the per-line `in_figure` heading-exclusion flag. Drop
  // page-dominating figures: on posters / slides / infographics the whole
  // page is one large graphic and its big text is the heading content, so
  // excluding it would demote real headings. A chart on an academic page
  // covers only a fraction of the page; that's the pollution we want out of
  // the heading histogram.
  const pageArea = f32(Math.max(pageWidth, 1.0) * Math.max(pageHeight, 1.0));
  const headingExclFigures = figures
    .filter((f) => f32(f.width * f.height) < f32(pageArea * f32(0.55)))
    .map((f) => ({ ...f }));
  // On a page with native text, OCR only enriches embedded figures (charts,
  // diagrams, formula images, logos). Lines built from that OCR text are
  // figure content whatever their box height says, so they are excluded from
  // heading candidacy like any other in-figure line. On a scanned page (no
  // native text) OCR is the text and headings must still come from it.
  const pageHasNativeText = items.some((p) => p.item.font_name !== "OCR");

  const out: ProjectedLine[] = [];
  const line = (idxs: readonly number[], path: number[]): void => {
    out.push(buildOneLine(items, idxs, [...path], headingExclFigures, pageHasNativeText));
  };
  for (const [path, indices] of leaves) {
    // Sort within the leaf by y, tie-break by x. `buildOneLine` re-sorts by x
    // for left-to-right concatenation; the y-banding loop here only needs y order.
    const sorted = [...indices];
    sorted.sort(
      (a, b) =>
        totalCmp(items[a].item.y, items[b].item.y) || totalCmp(items[a].item.x, items[b].item.x)
    );

    let current: number[] = [];
    let currentY = 0.0;
    let currentH = 0.0;
    for (const idx of sorted) {
      const y = items[idx].item.y;
      const rawH = items[idx].item.height;
      const h = clamp(rawH, 1.0, Y_BAND_HEIGHT_CAP);
      if (current.length === 0) {
        current.push(idx);
        currentY = y;
        currentH = h;
        continue;
      }
      // Use the SMALLER of the two heights for the y-band tolerance: matching
      // baselines (same row) differ by much less than either glyph height,
      // while the next-row-down baseline differs by about the smaller glyph's
      // full height. Using `max` here is fooled by matrix-inflated em-boxes: a
      // 16pt heading row "swallows" a 50pt-em-box body item on the row below
      // because the tolerance becomes 25pt.
      // When the incoming item's raw bbox is wildly taller than the current
      // line's anchor (over 2x and over Y_BAND_HEIGHT_CAP), this is an
      // em-box-inflated body item trying to crash into a heading row. Halve
      // the tolerance further so a small y-offset (4-7pt) doesn't fuse them.
      const heightMismatch = rawH > Y_BAND_HEIGHT_CAP && rawH > f32(currentH * 2.0);
      const tolFactor = heightMismatch ? f32(0.3) : f32(0.5);
      const same = Math.abs(f32(y - currentY)) < f32(Math.min(currentH, h) * tolFactor);
      if (same) {
        current.push(idx);
        currentY = Math.min(currentY, y);
        currentH = Math.max(currentH, h);
      } else {
        line(current, path);
        current = [idx];
        currentY = y;
        currentH = h;
      }
    }
    if (current.length > 0) line(current, path);
  }

  // Reuse the original item to preserve its text and word boxes. Its detached
  // path lets Markdown keep it outside global and cross-region table passes.
  for (let idx = 0; idx < items.length; idx++) {
    if (isolatedNumericFooter(items, idx, pageWidth, pageHeight)) {
      line([idx], [...NUMERIC_FOOTER_PATH]);
    }
  }

  // Normalize `indent_x` to be leaf-relative: subtract each leaf's minimum
  // line bbox.x from every line in that leaf. This way list-nesting and
  // paragraph-indent comparisons in markdown_layout use offsets from the
  // column's left edge rather than absolute page x. Multi-column pages would
  // otherwise see every column-2 line as "indented" relative to column-1 lines.
  const leafMin = new Map<string, number>();
  for (const l of out) {
    const key = l.region_path.join(",");
    const e = leafMin.get(key) ?? Infinity;
    if (l.indent_x < e) leafMin.set(key, l.indent_x);
    else if (!leafMin.has(key)) leafMin.set(key, e);
  }
  for (const l of out) {
    const min = leafMin.get(l.region_path.join(","));
    if (min !== undefined && Number.isFinite(min)) {
      l.indent_x = f32(l.indent_x - min);
      if (l.indent_x < 0.0) l.indent_x = 0.0;
    }
  }

  return [out, region];
}
