// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): ruled-table detection over a page's rule segments.

import { f32, totalCmp } from "../../../rust.js";
import type { ProjectedLine } from "../../../types/page.js";
import { TABLE_CROSS_TOLERANCE_PT, findGridComponents } from "../grid-segments.js";
import type { HSeg, VSeg } from "../grid-segments.js";
import type { TableRun } from "../types.js";
import { buildRuledTable } from "./build-ruled-table.js";
import type { RuledPass } from "./constants.js";
import type { RuleSegments } from "./rule-segments.js";

/** One band of a grid component after splitting, with the vertical rules clipped to the band's own y-range. */
export type GridBand = {
  h_idx: number[];
  v_idx: number[];
  /**
   * A copy of the page's `vs` whose y-extents are clamped to this band, so the
   * shared spine rule cannot carry the neighbouring table's height into
   * `filterShortVlines` or `extendToPerpendicularExtent`.
   */
  vs: VSeg[];
};

/** Row pitch below this means the component is decoration, not a table: vector-drawn maths glyphs make components with a 3-4pt pitch. */
const MIN_PITCH_PT = 8.0;
/** A gap must dwarf the component's own row pitch *and* clear an absolute floor, so ordinary row-height variation never cuts. */
const GAP_PITCH_MULT = 2.5;
const GAP_MIN_PT = 30.0;
/** Each side must keep a real table: 3 boundaries is 2 rows, the minimum `buildRuledTable` will look at. */
const MIN_BAND_HLINES = 3;

/**
 * Split one grid component at row bands that no vertical rule actually spans.
 *
 * `clusterVSegments` merges same-x verticals by taking the *union* of their
 * y-ranges with no gap check, so two tables stacked in one column, each drawing
 * its own short strokes at the same left edge, fuse into a single component.
 * Each table is then evaluated with all of the other's rows empty and dies on
 * `TABLE_MAX_EMPTY_CELL_FRACTION`, and when the two tables have different
 * layouts their column sets are unioned too, over-segmenting both.
 *
 * The cut signal is geometric and needs no threshold on emptiness: a band
 * between consecutive horizontals that **no raw, pre-cluster `VSeg` spans**.
 * That is strictly stronger than "a big gap", and it distinguishes this from a
 * rowspan, where the vertical does continue through the boundary.
 */
export function splitComponentAtGridGaps(
  hs: readonly HSeg[],
  vs: readonly VSeg[],
  rawVs: readonly VSeg[],
  hIdx: readonly number[],
  vIdx: readonly number[]
): GridBand[] {
  const whole = (): GridBand[] => [
    { h_idx: [...hIdx], v_idx: [...vIdx], vs: vs.map((v) => ({ ...v })) },
  ];
  const sorted = [...hIdx].sort((a, b) => totalCmp(hs[a].y, hs[b].y));
  if (sorted.length < MIN_BAND_HLINES * 2) return whole();
  const pitches: number[] = [];
  for (let i = 0; i + 1 < sorted.length; i++)
    pitches.push(f32(hs[sorted[i + 1]].y - hs[sorted[i]].y));
  pitches.sort(totalCmp);
  const pitch = pitches[Math.floor(pitches.length / 2)];
  if (pitch < MIN_PITCH_PT) return whole();
  const minGap = Math.max(f32(pitch * GAP_PITCH_MULT), GAP_MIN_PT);

  const tol = TABLE_CROSS_TOLERANCE_PT;
  const cuts: number[] = []; // index into `sorted`: cut after this line
  for (let i = 0; i + 1 < sorted.length; i++) {
    const lo = hs[sorted[i]].y;
    const hi = hs[sorted[i + 1]].y;
    if (f32(hi - lo) < minGap) continue;
    const spanned = rawVs.some((v) => v.y_min <= f32(lo + tol) && v.y_max >= f32(hi - tol));
    if (!spanned) cuts.push(i + 1);
  }
  if (cuts.length === 0) return whole();

  const bounds = [0, ...cuts, sorted.length];
  for (let i = 0; i + 1 < bounds.length; i++) {
    // A sliver on one side: the cut is not describing two tables.
    if (bounds[i + 1] - bounds[i] < MIN_BAND_HLINES) return whole();
  }

  const bands: GridBand[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const band = sorted.slice(bounds[i], bounds[i + 1]);
    const yLo = hs[band[0]].y;
    const yHi = hs[band[band.length - 1]].y;
    bands.push({
      h_idx: band,
      v_idx: vIdx.filter((j) => vs[j].y_max > f32(yLo + tol) && vs[j].y_min < f32(yHi - tol)),
      vs: vs.map((v) => ({ x: v.x, y_min: Math.max(v.y_min, yLo), y_max: Math.min(v.y_max, yHi) })),
    });
  }
  return bands;
}

/** Detect ruled-grid tables on a page from its vector graphics. Returns runs in document order (sorted by `start`). */
export function detectRuledTablesImpl(
  lines: readonly ProjectedLine[],
  segs: RuleSegments,
  pageWidth: number,
  pageHeight: number,
  pass: RuledPass
): Array<[TableRun, number[]]> {
  const { hs, raw_vs: rawVs, vs } = segs;
  if (hs.length < 2 || vs.length < 2) return [];
  const out: Array<[TableRun, number[]]> = [];
  for (const [hIdx, vIdx] of findGridComponents(hs, vs)) {
    for (const band of splitComponentAtGridGaps(hs, vs, rawVs, hIdx, vIdx)) {
      const run = buildRuledTable(
        hs,
        band.vs,
        band.h_idx,
        band.v_idx,
        lines,
        pageWidth,
        pageHeight,
        pass
      );
      if (run != null) out.push(run);
    }
  }
  out.sort((a, b) => a[0].start - b[0].start);
  return out;
}

/** Per-region ruled-table detection. Drops the consumed-line bookkeeping the global pass needs. */
export function detectRuledTables(
  lines: readonly ProjectedLine[],
  segs: RuleSegments,
  pageWidth: number,
  pageHeight: number
): TableRun[] {
  return detectRuledTablesImpl(lines, segs, pageWidth, pageHeight, "PerRegion").map(([r]) => r);
}

/**
 * Page-level ruled-table detection over *all* lines. A table whose rows scatter
 * across several xy_cut leaves never has its full text in any single leaf, so
 * per-region detection rejects it as mostly-empty; running once globally
 * reassembles it. Returns each run with the set of line indices it consumed so
 * the caller can pull them out of the region pipeline.
 */
export function detectRuledTablesGlobal(
  lines: readonly ProjectedLine[],
  segs: RuleSegments,
  pageWidth: number,
  pageHeight: number
): Array<[TableRun, number[]]> {
  return detectRuledTablesImpl(lines, segs, pageWidth, pageHeight, "Global");
}
