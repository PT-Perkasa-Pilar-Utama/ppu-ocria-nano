// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): ruled-grid density gate and boundary refinement.

import { utf8Len } from "../../../rust-extra.js";
import { f32, totalCmp, trim } from "../../../rust.js";
import type { ProjectedLine } from "../../../types/page.js";
import type { Cell } from "../../block-types.js";
import type { HSeg, VSeg } from "../grid-segments.js";
import {
  RULED_VLINE_MIN_COVERAGE,
  TABLE_COL_BOUNDARY_CLUSTER_PT,
  TABLE_MAX_EMPTY_CELL_FRACTION,
  TABLE_MAX_EMPTY_CELL_FRACTION_WITH_SPINE,
  TABLE_SPINE_FILL_FRACTION,
  TABLE_SPINE_MAX_CELL_CHARS,
} from "./constants.js";

const F32_MAX = 3.4028234663852886e38;

function countTrue(flags: readonly boolean[]): number {
  return flags.filter((t) => t).length;
}

/**
 * Density gate: a grid that is mostly empty cells is rejected unless it shows
 * strong table evidence. Cells the rules say are vertically merged into the
 * cell above (`spanned`) don't count as empty at all: they are empty by
 * construction, and a rowspan label column ("1. Embodying sustainability
 * values" beside three competence rows) otherwise reads as a sparse grid and
 * dies here. Beyond that, three escape hatches keep real tables:
 * - **col0 spine**: a filled, short-text first column (a label column).
 * - **long-prose table**: a large (>=5x3) grid with a bold header band covering
 *   >=3 columns and a dense (>=70%-fill) inner description column, a
 *   multi-line legal/reference table whose description wraps over many empty
 *   continuation rows.
 * - **flattened header**: a fired colspan header flatten is table evidence on
 *   par with a spine.
 *
 * With a spine but above the higher WITH_SPINE ceiling, still reject (unless a
 * long-prose table). `flattened` is whether `flattenHeaderBand` fired.
 *
 * Returns true to keep the table, false to reject it.
 */
export function passesDensityGate(
  cells: readonly Cell[][],
  cellHasText: readonly boolean[][],
  cellIsBold: readonly boolean[][],
  nRows: number,
  nCols: number,
  flattened: boolean,
  spanned: readonly boolean[][]
): boolean {
  const total = nRows * nCols;
  // A spanned cell only excuses itself when the cell it is merged into
  // actually holds text. Walk up the run of merged cells to its head: an empty
  // head means nothing was merged here, just an unruled hole, the shape a
  // chart's vertical gridlines make, where forgiving the empties would turn a
  // plot into a 27-column table.
  const mergedIntoText = (r: number, c: number): boolean => {
    let i = r;
    while (i > 0 && spanned[i][c]) i--;
    return cellHasText[i][c];
  };
  let emptyCount = 0;
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      if (!cellHasText[r][c] && !(spanned[r][c] && mergedIntoText(r, c))) emptyCount++;
    }
  }
  const emptyFrac = f32(emptyCount / total);
  if (emptyFrac <= TABLE_MAX_EMPTY_CELL_FRACTION) return true;
  const colFill = (c: number): number => {
    let n = 0;
    for (let r = 0; r < nRows; r++) if (cellHasText[r][c]) n++;
    return f32(n / nRows);
  };
  const col0Fill = colFill(0);
  let col0MaxChars = 0;
  for (let r = 0; r < nRows; r++) {
    if (cellHasText[r][0]) col0MaxChars = Math.max(col0MaxChars, utf8Len(cells[r][0].text));
  }
  const col0Spine =
    col0Fill >= TABLE_SPINE_FILL_FRACTION && col0MaxChars <= TABLE_SPINE_MAX_CELL_CHARS;
  // Header may span multiple visual rows (the grid detector slices on each
  // text baseline). Treat the first <=4 rows as the header band and require
  // their *union* to cover most columns AND be all-bold.
  const headerBand = Math.min(nRows, 4);
  const headerColsCovered: boolean[] = Array.from({ length: nCols }, () => false);
  let headerAllBold = true;
  for (let r = 0; r < headerBand; r++) {
    for (let c = 0; c < nCols; c++) {
      if (cellHasText[r][c]) {
        headerColsCovered[c] = true;
        if (!cellIsBold[r][c]) headerAllBold = false;
      }
    }
  }
  const headerCoverage = countTrue(headerColsCovered);
  let denseInnerCol = false;
  for (let c = 1; c < nCols; c++) if (colFill(c) >= TABLE_SPINE_FILL_FRACTION) denseInnerCol = true;
  // Header coverage doesn't need to span every column: wide-cell legal tables
  // often spread the header across many visual baselines and only a few
  // columns land in the top-4-rows band. Require >=3 columns covered as
  // evidence of a real header, not just a title.
  const longProseTable =
    nRows >= 5 && nCols >= 3 && headerCoverage >= 3 && headerAllBold && denseInnerCol;
  if (!col0Spine && !longProseTable && !flattened) return false;
  if (emptyFrac > TABLE_MAX_EMPTY_CELL_FRACTION_WITH_SPINE && !longProseTable) return false;
  return true;
}

/** A sliver must be at most this fraction of the median *content-bearing* column width. Blank-but-full-width cells (worksheets, forms) sit well above it and are preserved. */
const GUTTER_MAX_WIDTH_FRAC = 0.5;

/**
 * Fuse "gutter" column boundaries left behind by paired cell-border edges.
 *
 * A bordered cell contributes two vertical edges (its own right edge and the
 * next cell's left edge) separated by the table's inter-cell padding.
 * `TABLE_COL_BOUNDARY_CLUSTER_PT` fuses the tight pairs (4-6pt), but a
 * generously padded table puts 15-25pt between them, leaving a sliver column
 * between every real column. Those slivers double the column count, and
 * because `splitSpanAtAnchors` shreds text into them they are *not* empty, so
 * `cellGridCollapsePhantomCols` can't remove them; the grid then fails the
 * empty-cell gate and a perfectly good table is thrown away.
 *
 * Width alone can't identify them: plenty of real tables carry a genuinely
 * narrow column (a `#` or `No.` column beside a wide description). What marks
 * a sliver is that **no text center ever lands inside it**: text steps over a
 * gutter, but a narrow real column still holds its own values. So fuse a
 * column only when it holds no span center *and* is far narrower than the
 * columns that do hold text. Span centers are read straight off the raw spans,
 * before `splitSpanAtAnchors` runs, so shredded fragments can't disguise a
 * sliver as occupied.
 *
 * The width guard matters independently: a worksheet's blank answer column is
 * also centerless, but it is as wide as its neighbours and must survive.
 * Mutates `xs`.
 */
export function collapseGutterColumns(xs: number[], lines: readonly ProjectedLine[]): void {
  if (xs.length < 4) return; // fewer than 3 columns: nothing to fuse without destroying the table
  const centers: number[] = [];
  for (const l of lines) {
    for (const s of l.spans) {
      if (trim(s.text) !== "") centers.push(f32(s.x + f32(s.width * 0.5)));
    }
  }
  const hasCenter = (lo: number, hi: number): boolean => centers.some((c) => c >= lo && c < hi);

  while (xs.length > 3) {
    // Median width of the columns that actually hold text.
    const occupied: number[] = [];
    for (let i = 0; i + 1 < xs.length; i++) {
      if (hasCenter(xs[i], xs[i + 1])) occupied.push(f32(xs[i + 1] - xs[i]));
    }
    if (occupied.length === 0) break;
    occupied.sort(totalCmp);
    const median = occupied[Math.floor(occupied.length / 2)];
    const maxSliver = f32(median * GUTTER_MAX_WIDTH_FRAC);

    // Narrowest centerless column, if any is slim enough to be a gutter.
    let victim = -1;
    let victimWidth = 0;
    for (let i = 0; i + 1 < xs.length; i++) {
      if (hasCenter(xs[i], xs[i + 1])) continue;
      const width = f32(xs[i + 1] - xs[i]);
      if (width < maxSliver && (victim < 0 || totalCmp(width, victimWidth) < 0)) {
        victim = i;
        victimWidth = width;
      }
    }
    if (victim < 0) break;
    xs[victim] = f32(f32(xs[victim] + xs[victim + 1]) * 0.5);
    xs.splice(victim + 1, 1);
  }
}

/**
 * Drop vertical rules too short to be column boundaries (see
 * `RULED_VLINE_MIN_COVERAGE`). Coverage is measured against the row extent the
 * horizontals describe, since that is the height a real divider has to reach.
 */
export function filterShortVlines(
  hs: readonly HSeg[],
  hIndices: readonly number[],
  vs: readonly VSeg[],
  vIndices: readonly number[]
): number[] {
  let yLo = F32_MAX;
  let yHi = -F32_MAX;
  for (const i of hIndices) {
    yLo = Math.min(yLo, hs[i].y);
    yHi = Math.max(yHi, hs[i].y);
  }
  const extent = Math.max(f32(yHi - yLo), 1);
  const kept = vIndices.filter(
    (i) => f32(f32(vs[i].y_max - vs[i].y_min) / extent) >= RULED_VLINE_MIN_COVERAGE
  );
  // Two boundaries is one column, which is not a grid; below that the caller
  // has nothing to refine and keeps the raw set.
  return kept.length >= 3 ? kept : [...vIndices];
}

function medianOf(v: readonly number[]): number | undefined {
  const s = [...v].sort(totalCmp);
  return s[Math.floor(s.length / 2)];
}

/**
 * Widen a boundary list to the extent the *perpendicular* rules imply.
 *
 * A table drawn with interior dividers but no outer frame gives `xs` that stop
 * at the first and last vertical rule, so its outermost columns are missing
 * entirely: every line in them reads as overhang and the component collapses.
 * The evidence is already on the page: the horizontal rules know how wide the
 * table is, and the verticals know how tall.
 *
 * Three guards:
 *   - **median, not min/max** of the perpendicular rules, so one overshooting
 *     stroke cannot widen the grid;
 *   - **the new outer band must hold text**, the same idiom
 *     `collapseGutterColumns` uses; otherwise a pen-cap overshoot or a
 *     full-width section rule manufactures an empty outer column;
 *   - **the band must be at least `minBand` wide/tall.** Callers pass the
 *     smallest existing row height for the row axis: verticals routinely
 *     overrun the last horizontal by a few points, and a band shorter than any
 *     real row is that overshoot, not a row. A phantom row here is enough for
 *     the ruled grid to outrank a better borderless table. The column axis
 *     passes only the clustering tolerance, because an unruled *label* column
 *     is both common and legitimately much narrower than the ruled data
 *     columns it sits beside.
 * Mutates `axis`.
 */
export function extendToPerpendicularExtent(
  axis: number[],
  perpLos: readonly number[],
  perpHis: readonly number[],
  minBand: number,
  hasContent: (lo: number, hi: number) => boolean
): void {
  const minExtension = Math.max(minBand, TABLE_COL_BOUNDARY_CLUSTER_PT);
  const lo = medianOf(perpLos);
  const hi = medianOf(perpHis);
  if (lo === undefined || hi === undefined) return;
  if (axis.length === 0) return;
  if (lo < f32(axis[0] - minExtension) && hasContent(lo, axis[0])) axis.unshift(lo);
  const last = axis[axis.length - 1];
  if (hi > f32(last + minExtension) && hasContent(last, hi)) axis.push(hi);
}
