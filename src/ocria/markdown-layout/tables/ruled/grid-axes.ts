// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): build_ruled_table_from, column and row boundaries.

import { f32, totalCmp, trim } from "../../../rust.js";
import type { ProjectedLine } from "../../../types/page.js";
import { TABLE_GRID_CLUSTER_PT } from "../grid-segments.js";
import type { HSeg, VSeg } from "../grid-segments.js";
import { clusterBoundaries, dedupClose } from "./boundaries.js";
import { RULED_HLINE_MIN_COVERAGE, TABLE_COL_BOUNDARY_CLUSTER_PT } from "./constants.js";
import type { RuledPass } from "./constants.js";
import { collapseGutterColumns, extendToPerpendicularExtent } from "./grid-filters.js";

const F32_MAX = 3.4028234663852886e38;

function textSpans(lines: readonly ProjectedLine[]): ProjectedLine["spans"] {
  return lines.flatMap((l) => l.spans).filter((s) => trim(s.text) !== "");
}

/** The sorted, widened, clustered and gutter-collapsed column boundaries of one component. */
export function columnBoundaries(
  hs: readonly HSeg[],
  vs: readonly VSeg[],
  hIndices: readonly number[],
  vKept: readonly number[],
  lines: readonly ProjectedLine[]
): number[] {
  const xs = vKept.map((i) => vs[i].x).sort(totalCmp);
  const spans = textSpans(lines);
  extendToPerpendicularExtent(
    xs,
    hIndices.map((i) => hs[i].x_min),
    hIndices.map((i) => hs[i].x_max),
    0,
    (lo, hi) =>
      spans.some((s) => {
        const c = f32(s.x + f32(s.width * 0.5));
        return c >= lo && c < hi;
      })
  );
  // Coarser, mean-centered clustering for column boundaries: cell-border rects
  // contribute paired edges 4-6pt apart that would otherwise become phantom 5pt
  // "columns" the span splitter then shreds text into.
  clusterBoundaries(xs, TABLE_COL_BOUNDARY_CLUSTER_PT);
  collapseGutterColumns(xs, lines);
  return xs;
}

/** Distinct sorted row y-coordinates of the horizontals `idxs`, near-duplicates collapsed. */
function rawYs(hs: readonly HSeg[], idxs: readonly number[]): number[] {
  const v = idxs.map((i) => hs[i].y).sort(totalCmp);
  dedupClose(v, TABLE_GRID_CLUSTER_PT);
  return v;
}

/**
 * The row boundaries of one component. In the global pass, first drop
 * horizontal rules that span only a small fraction of the column extent (see
 * `RULED_HLINE_MIN_COVERAGE`).
 */
export function rowBoundaries(
  hs: readonly HSeg[],
  vs: readonly VSeg[],
  hIndices: readonly number[],
  vKept: readonly number[],
  lines: readonly ProjectedLine[],
  xs: readonly number[],
  pass: RuledPass
): number[] {
  let ys: number[];
  if (pass === "Global" && xs.length >= 2) {
    const colLo = xs[0];
    const colHi = xs[xs.length - 1];
    const extent = Math.max(f32(colHi - colLo), 1);
    const kept = hIndices.filter((i) => {
      const h = hs[i];
      const ov = Math.max(f32(Math.min(h.x_max, colHi) - Math.max(h.x_min, colLo)), 0);
      return f32(ov / extent) >= RULED_HLINE_MIN_COVERAGE;
    });
    const filtered = rawYs(hs, kept);
    ys = filtered.length >= 3 ? filtered : rawYs(hs, hIndices);
  } else {
    ys = rawYs(hs, hIndices);
  }
  let minRowBand = F32_MAX;
  for (let i = 0; i + 1 < ys.length; i++) minRowBand = Math.min(minRowBand, f32(ys[i + 1] - ys[i]));
  const spans = textSpans(lines);
  extendToPerpendicularExtent(
    ys,
    vKept.map((i) => vs[i].y_min),
    vKept.map((i) => vs[i].y_max),
    minRowBand,
    (lo, hi) =>
      spans.some((s) => {
        const c = f32(s.y + f32(s.height * 0.5));
        return c >= lo && c < hi;
      })
  );
  dedupClose(ys, TABLE_GRID_CLUSTER_PT);
  return ys;
}
