// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): CellGrid.

import { f32, totalCmp, trim } from "../../../rust.js";
import type { Cell } from "../../block-types.js";
import { cell } from "../../block-types.js";

/** Filter a vector down to the elements whose `keep` flag is set. `keep` must be at least as long as `items`. */
export function filterBy<T>(items: readonly T[], keep: readonly boolean[]): T[] {
  return items.filter((_, i) => keep[i]);
}

/** Append trimmed text and its source items to `cell`, space-separated. Returns whether anything was appended. */
export function pushCellText(c: Cell, txt: string, items: readonly number[]): boolean {
  const t = trim(txt);
  if (t === "") return false;
  if (c.text !== "") c.text += " ";
  c.text += t;
  c.text_item_indices.push(...items);
  return true;
}

/**
 * The per-cell grids `buildRuledTable` fills, collapses, and reads as one
 * unit. Bundling them lets the row/column-collapse passes filter every layer
 * through a single `cellGridRetainRows`/`cellGridRetainCols` call instead of
 * five parallel filter chains, which removes the "forgot to filter one array"
 * bug class.
 */
export type CellGrid = {
  /** Rendered cell text (each multi-column span whitespace-split at the crossed column boundaries), each carrying the ruled cell it occupies. */
  text: Cell[][];
  /** Per-cell bold flag: starts true, cleared when any non-bold span lands in the cell. */
  is_bold: boolean[][];
  /** Per-cell "carries text" flag. */
  has_text: boolean[][];
  /**
   * Colspan-semantics grid: a span crossing >= 2 column boundaries replicates
   * its FULL text into every covered cell instead of being split. Consulted
   * only for header-band flattening. Cells here carry text and source items
   * only, never a box.
   */
  repl: Cell[][];
  /** Per-row flag: the row contains an alpha-dominant multi-column span (a group-header label, as opposed to a mostly-digit merged data run). */
  row_alpha_spanner: boolean[];
  /** Per-cell flag: the rules say this cell is vertically merged with the one above it, so it is empty by construction. */
  spanned: boolean[][];
  /** Fraction of raw spans that cross an interior column boundary. */
  straddle_frac: number;
};

/**
 * `xs`/`ys` are the column/row boundaries (lengths `nCols + 1` / `nRows + 1`).
 * Unlike the borderless detectors, a ruled table has real drawn boundaries, so
 * every cell's box is known up front, before any text lands in it.
 */
export function cellGridNew(
  nRows: number,
  nCols: number,
  xs: readonly number[],
  ys: readonly number[]
): CellGrid {
  const grid = (): boolean[][] =>
    Array.from({ length: nRows }, () => Array.from({ length: nCols }, () => false));
  return {
    text: Array.from({ length: nRows }, (_, r) =>
      Array.from({ length: nCols }, (_, c) =>
        cell(
          "",
          {
            x: xs[c],
            y: ys[r],
            width: f32(xs[c + 1] - xs[c]),
            height: f32(ys[r + 1] - ys[r]),
          },
          []
        )
      )
    ),
    is_bold: Array.from({ length: nRows }, () => Array.from({ length: nCols }, () => true)),
    has_text: grid(),
    repl: Array.from({ length: nRows }, () => Array.from({ length: nCols }, () => cell(""))),
    row_alpha_spanner: Array.from({ length: nRows }, () => false),
    spanned: grid(),
    straddle_frac: 0,
  };
}

export function cellGridNRows(g: CellGrid): number {
  return g.text.length;
}

export function cellGridNCols(g: CellGrid): number {
  return g.text.length > 0 ? g.text[0].length : 0;
}

/** Append trimmed text (and its source items) to a cell, marking it as text-bearing. No-op for blank input. */
export function cellGridPushText(
  g: CellGrid,
  row: number,
  col: number,
  txt: string,
  items: readonly number[]
): void {
  if (pushCellText(g.text[row][col], txt, items)) g.has_text[row][col] = true;
}

/** Append trimmed text (and its source items) to the colspan-semantics (`repl`) cell. No-op for blank input. */
export function cellGridPushRepl(
  g: CellGrid,
  row: number,
  col: number,
  txt: string,
  items: readonly number[]
): void {
  pushCellText(g.repl[row][col], txt, items);
}

/** Keep only rows `r` where `keep[r]`; every layer filters identically. */
export function cellGridRetainRows(g: CellGrid, keep: readonly boolean[]): void {
  g.text = filterBy(g.text, keep);
  g.is_bold = filterBy(g.is_bold, keep);
  g.has_text = filterBy(g.has_text, keep);
  g.repl = filterBy(g.repl, keep);
  g.row_alpha_spanner = filterBy(g.row_alpha_spanner, keep);
  g.spanned = filterBy(g.spanned, keep);
}

/** Keep only columns `c` where `keep[c]`; the per-cell layers filter, the per-row `row_alpha_spanner` is unaffected. */
export function cellGridRetainCols(g: CellGrid, keep: readonly boolean[]): void {
  g.text = g.text.map((row) => filterBy(row, keep));
  g.is_bold = g.is_bold.map((row) => filterBy(row, keep));
  g.has_text = g.has_text.map((row) => filterBy(row, keep));
  g.repl = g.repl.map((row) => filterBy(row, keep));
  g.spanned = g.spanned.map((row) => filterBy(row, keep));
}

function median(values: readonly number[]): number {
  const s = [...values].sort(totalCmp);
  return s[Math.floor(s.length / 2)];
}

/**
 * Drop "phantom rows" produced by stacked thin border-strip rects (some
 * generators rule each visual row as top-strip ~1pt / body ~22pt /
 * bottom-strip ~5pt, each surviving the 2pt clustering as its own grid
 * row). A row is dropped iff it has no text in any cell AND its height is
 * < 80% of the median non-empty row height; the height gate preserves real
 * fill-in-the-blank forms whose empty body rows are full height. `ys` are the
 * row boundaries (length `nRows + 1`). Returns the kept rows' heights.
 */
export function cellGridCollapsePhantomRows(g: CellGrid, ys: readonly number[]): number[] {
  const nRows = cellGridNRows(g);
  const rowHeights = Array.from({ length: nRows }, (_, r) => f32(ys[r + 1] - ys[r]));
  const nonemptyHeights = rowHeights.filter((_, r) => g.has_text[r].some((t) => t));
  const medianH = median(nonemptyHeights.length > 0 ? nonemptyHeights : rowHeights);
  const keep = Array.from({ length: nRows }, (_, r) => {
    const hasText = g.has_text[r].some((t) => t);
    return hasText || rowHeights[r] >= f32(medianH * f32(0.8));
  });
  const kept = filterBy(rowHeights, keep);
  cellGridRetainRows(g, keep);
  return kept;
}

/**
 * Mirror `cellGridCollapsePhantomRows` on columns: some ruled tables draw
 * left/right borders as thin strip rects ~5pt wide, which become phantom
 * text-less columns. Drop a column iff it is both empty AND narrower than 30%
 * of the median text-bearing column. `xs` are the column boundaries (length
 * `nCols + 1`).
 */
export function cellGridCollapsePhantomCols(g: CellGrid, xs: readonly number[]): void {
  const nRows = cellGridNRows(g);
  const nCols = cellGridNCols(g);
  const colHasText = Array.from({ length: nCols }, (_, c) =>
    Array.from({ length: nRows }, (_, r) => g.has_text[r][c]).some((t) => t)
  );
  const colWidths = Array.from({ length: nCols }, (_, c) => f32(xs[c + 1] - xs[c]));
  const nonemptyWidths = colWidths.filter((_, c) => colHasText[c]);
  const medianW = median(nonemptyWidths.length > 0 ? nonemptyWidths : colWidths);
  const keepCol = colHasText.map((has, c) => has || colWidths[c] >= f32(medianW * f32(0.3)));
  cellGridRetainCols(g, keepCol);
}
