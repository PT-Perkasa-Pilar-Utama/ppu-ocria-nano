// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): build_ruled_table.

import { f32 } from "../../../rust.js";
import type { Rect } from "../../../types/geometry.js";
import type { ProjectedLine } from "../../../types/page.js";
import type { Cell } from "../../block-types.js";
import { TABLE_MAX_PAGE_COVERAGE } from "../grid-segments.js";
import type { HSeg, VSeg } from "../grid-segments.js";
import type { TableRun } from "../types.js";
import { assignCells } from "./assign-cells.js";
import {
  cellGridCollapsePhantomCols,
  cellGridCollapsePhantomRows,
  cellGridNCols,
  cellGridNRows,
} from "./cell-grid.js";
import type { RuledPass } from "./constants.js";
import { columnBoundaries, rowBoundaries } from "./grid-axes.js";
import { filterShortVlines, passesDensityGate } from "./grid-filters.js";
import { flattenHeaderBand, mergeStackedHeader, rowspanMask } from "./header-band.js";

/**
 * How much the straddle fraction must fall for the short-vline refinement to
 * be worth taking. Removing a genuine phantom column drops it by an order of
 * magnitude; a stub on a real column edge leaves it flat.
 */
export const STRADDLE_IMPROVEMENT: number = f32(0.05);

/** A built run, the line indices it consumed, and its straddle fraction. */
type Built = [TableRun, number[], number];

export function buildRuledTableFrom(
  hs: readonly HSeg[],
  vs: readonly VSeg[],
  hIndices: readonly number[],
  vKept: readonly number[],
  lines: readonly ProjectedLine[],
  pageWidth: number,
  pageHeight: number,
  pass: RuledPass
): Built | null {
  const xs = columnBoundaries(hs, vs, hIndices, vKept, lines);
  const ys = rowBoundaries(hs, vs, hIndices, vKept, lines, xs, pass);

  // Need >=2 row boundaries (1 row) and >=2 column boundaries (1 col); but a
  // 1x1 grid is just a callout box, so also require >=1 inner divider (i.e.
  // ys.len() >= 3 for >=2 rows). Single-column tables (`xs.len() == 2`) are
  // accepted when row evidence is strong enough: extra guards apply below
  // after the empty-row collapse.
  if (ys.length < 3 || xs.length < 2) return null;

  const nRows0 = ys.length - 1;
  const nCols0 = xs.length - 1;
  const bbox: Rect = {
    x: xs[0],
    y: ys[0],
    width: f32(xs[nCols0] - xs[0]),
    height: f32(ys[nRows0] - ys[0]),
  };

  // Reject page-border-as-table.
  if (pageWidth > 0 && pageHeight > 0) {
    const coverage = f32(f32(bbox.width / pageWidth) * f32(bbox.height / pageHeight));
    if (coverage > TABLE_MAX_PAGE_COVERAGE) return null;
  }

  // Assign text to cells, then reject if no lines landed inside the grid or
  // too many spans straddle interior column boundaries (decorative box, not a
  // table).
  const assigned = assignCells(lines, xs, ys, pass === "Global");
  if (assigned == null) return null;
  const [grid, consumedIndices] = assigned;
  const straddleFrac = grid.straddle_frac;
  grid.spanned = rowspanMask(hs, hIndices, vs, vKept, xs, ys);

  // Collapse phantom rows (text-less thin border-strip rects) then phantom
  // columns (text-less narrow border strips). A real table with one phantom
  // border-strip column drops exactly one; a chart whose vertical grid-lines
  // merged with text data collapses to 1 col and is rejected below, letting
  // the borderless detector handle it.
  const keptRowHeights = cellGridCollapsePhantomRows(grid, ys);
  const collapsedRows = cellGridNRows(grid);
  if (collapsedRows < 2) return null;
  cellGridCollapsePhantomCols(grid, xs);
  const nCols = cellGridNCols(grid);
  if (nCols === 0) return null;
  // Single-column tables are ambiguous (could be a captioned card): require
  // >=3 rows of geometric + textual evidence.
  if (nCols === 1 && collapsedRows < 3) return null;

  const flattenedHeader = flattenHeaderBand(
    grid.text,
    grid.has_text,
    grid.repl,
    grid.row_alpha_spanner,
    collapsedRows,
    nCols
  );
  const [cells, cellHasText, cellIsBold, nRows, mergedStackedHeader] = mergeStackedHeader(
    grid.text,
    grid.has_text,
    grid.is_bold,
    collapsedRows,
    nCols,
    keptRowHeights,
    flattenedHeader != null
  );

  // `mergeStackedHeader` folds the top `k` rows into one, so realign the
  // rowspan mask: the new first row is the merged header (never a rowspan
  // continuation), and every later row keeps its own mask.
  let spanned = grid.spanned;
  if (spanned.length > nRows) {
    const dropped = spanned.length - nRows;
    spanned = [Array.from({ length: nCols }, () => false), ...spanned.slice(dropped + 1)];
  }

  if (
    !passesDensityGate(
      cells,
      cellHasText,
      cellIsBold,
      nRows,
      nCols,
      flattenedHeader != null,
      spanned
    )
  ) {
    return null;
  }

  // Header preference order: flattened colspan band (carries the full
  // per-column layer chain) > merged stacked-header band > bold first row.
  const headerQualifies =
    mergedStackedHeader ||
    (cellHasText[0].every((has, c) => !has || cellIsBold[0][c]) &&
      cellHasText[0].some((has) => has));
  let header: Cell[] | null = null;
  let bodyStart = 0;
  if (flattenedHeader != null) {
    header = flattenedHeader[0];
    bodyStart = flattenedHeader[1];
  } else if (headerQualifies) {
    header = cells[0];
    bodyStart = 1;
  }
  const bodyRows = cells.slice(bodyStart);
  if (bodyRows.length === 0) return null;

  // Line index span this table covers.
  const start = Math.min(...consumedIndices);
  const end = Math.max(...consumedIndices) + 1;

  const run: TableRun = {
    start,
    end,
    body_start: start,
    interstitials: [],
    item_indices: [],
    // A ruled table's region is the grid the generator actually drew.
    bbox,
    block: { Table: { header, rows: bodyRows } },
  };
  return [run, consumedIndices, straddleFrac];
}

/**
 * Build a ruled table from one grid component.
 *
 * Runs `buildRuledTableFrom` twice when short vertical rules are present: once
 * on the rules as drawn, once with the stubs filtered out. The unfiltered build
 * is the gatekeeper: **the filtered result is only ever allowed to replace a
 * table that would have been produced anyway**. Filtering first instead lets
 * the filter *remove the evidence the gates reject junk on*: a chart loses the
 * very rules that made it too sparse or too small to pass, and a rejected
 * component flips into an accepted junk table.
 */
export function buildRuledTable(
  hs: readonly HSeg[],
  vs: readonly VSeg[],
  hIndices: readonly number[],
  vIndices: readonly number[],
  lines: readonly ProjectedLine[],
  pageWidth: number,
  pageHeight: number,
  pass: RuledPass
): [TableRun, number[]] | null {
  const base = buildRuledTableFrom(hs, vs, hIndices, vIndices, lines, pageWidth, pageHeight, pass);
  if (base == null) return null;
  const vKept = filterShortVlines(hs, hIndices, vs, vIndices);
  if (vKept.length === vIndices.length) return [base[0], base[1]];
  const retry = buildRuledTableFrom(hs, vs, hIndices, vKept, lines, pageWidth, pageHeight, pass);
  // Take the refined grid only when dropping the stubs measurably stopped the
  // boundaries cutting through text. A stub that sits on a *real* column edge
  // is the common case in dense financial tables; there the straddle census is
  // unchanged, and dropping a rule that was the only evidence for its boundary
  // just merges a real column away.
  if (retry != null && retry[2] < f32(base[2] - STRADDLE_IMPROVEMENT)) return [retry[0], retry[1]];
  return [base[0], base[1]];
}
