// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): ruled header bands and rowspan mask.

import { f32, totalCmp } from "../../../rust.js";
import { rectExtend } from "../../../types/geometry.js";
import type { Rect } from "../../../types/geometry.js";
import type { Cell } from "../../block-types.js";
import { cell } from "../../block-types.js";
import { TABLE_ROW_MIN_FILL, isAlphaDominant, isValueLike } from "../borderless/index.js";
import { TABLE_GRID_CLUSTER_PT } from "../grid-segments.js";
import type { HSeg, VSeg } from "../grid-segments.js";

function countTrue(flags: readonly boolean[]): number {
  return flags.filter((t) => t).length;
}

/**
 * Colspan header-band flattening: a sparse top row whose alpha spanning label
 * covers several columns ("North America" over its Revenue/Units sub-columns)
 * followed by a dense label row is a stacked header. Flatten rows `0..=b` from
 * the colspan-semantics (`repl`) grid into one header row (per-column
 * top-to-bottom join), so each column carries its full layer chain ("North
 * America Revenue"): that chain is what header-keyed consumers (and readers)
 * need. Returns `[header_row, body_start]` or null.
 */
export function flattenHeaderBand(
  cells: readonly Cell[][],
  cellHasText: readonly boolean[][],
  cellsRepl: readonly Cell[][],
  rowAlphaSpanner: readonly boolean[],
  nRows: number,
  nCols: number
): [Cell[], number] | null {
  const rowFill = (r: number): number => f32(countTrue(cellHasText[r]) / nCols);
  let b = -1;
  for (let r = 0; r < nRows; r++) {
    if (rowFill(r) >= TABLE_ROW_MIN_FILL) {
      b = r;
      break;
    }
  }
  if (b < 0) return null;
  const nonempty = countTrue(cellHasText[b]);
  let alphaCells = 0;
  for (let c = 0; c < nCols; c++) {
    if (cellHasText[b][c] && isAlphaDominant(cells[b][c].text)) alphaCells++;
  }
  // The bottom header layer may carry digit labels (years like "2024") but
  // never measurement values. A decimal / % / $ / dash-placeholder /
  // comma-grouped number in the anchor row means it's the first DATA row of a
  // table whose real header just missed the 0.9-fill anchor (colspan header
  // covering <90% of columns); folding it would eat a data row.
  let hasValueCell = false;
  for (let c = 0; c < nCols; c++) {
    if (cellHasText[b][c] && isValueLike(cells[b][c].text)) hasValueCell = true;
  }
  const hasAlphaSpanner = rowAlphaSpanner.slice(0, b).some((t) => t);
  const qualifies =
    b >= 1 &&
    b <= 3 &&
    b + 1 < nRows &&
    hasAlphaSpanner &&
    alphaCells * 2 >= nonempty &&
    !hasValueCell;
  if (!qualifies) return null;
  // Text comes from the colspan-replicated grid, but geometry comes from the
  // real cell grid: the flattened header cell covers every band row 0..=b it
  // was folded from.
  const header: Cell[] = [];
  for (let c = 0; c < nCols; c++) {
    const parts: string[] = [];
    const textItemIndices: number[] = [];
    for (const row of cellsRepl.slice(0, b + 1)) {
      const s = row[c].text;
      textItemIndices.push(...row[c].text_item_indices);
      if (s === "" || parts[parts.length - 1] === s) continue;
      parts.push(s);
    }
    let bbox: Rect | undefined;
    for (const row of cells.slice(0, b + 1)) {
      const rect = row[c].bbox;
      if (rect != null) bbox = rectExtend(bbox, rect);
    }
    header.push(cell(parts.join(" "), bbox ?? null, textItemIndices));
  }
  if (header.every((h) => h.text === "")) return null;
  return [header, b + 1];
}

/**
 * Stacked-header merge: some generators rule every text baseline of a wrapped
 * header cell, slicing one logical header row into several thin sparse rows
 * ("Rated" / "Voltage" / "(VDC)" each in its own band). When the top `k >= 2`
 * rows are individually sparse but their union covers most columns AND a dense
 * data row follows, collapse them into a single header row (per-column
 * top-to-bottom join). `flattened` is whether `flattenHeaderBand` already
 * fired (the two are mutually exclusive). Returns the possibly-merged grid
 * plus a flag for whether the merge happened.
 */
export function mergeStackedHeader(
  cells: Cell[][],
  cellHasText: boolean[][],
  cellIsBold: boolean[][],
  nRows: number,
  nCols: number,
  keptRowHeights: readonly number[],
  flattened: boolean
): [Cell[][], boolean[][], boolean[][], number, boolean] {
  // Anchor on the first fully-dense row (the first real data row).
  let k = 0;
  for (let r = 0; r < nRows; r++) {
    if (f32(countTrue(cellHasText[r]) / nCols) >= TABLE_ROW_MIN_FILL) {
      k = r;
      break;
    }
  }
  let unionCols = 0;
  for (let c = 0; c < nCols; c++) {
    for (let r = 0; r < k; r++) {
      if (cellHasText[r][c]) {
        unionCols++;
        break;
      }
    }
  }
  // Tightness: the band rows must be noticeably shorter than the data rows
  // below: ruled-per-baseline header bands sit at text leading (~7pt) while
  // real rows carry cell padding. Without this, a table whose first body rows
  // are legitimately sparse would get merged.
  let bandTight = false;
  if (k >= 2 && k < keptRowHeights.length) {
    const below = keptRowHeights.slice(k).sort(totalCmp);
    const medianBelow = below[Math.floor(below.length / 2)];
    bandTight = keptRowHeights.slice(0, k).every((h) => h <= f32(f32(0.75) * medianBelow));
  }
  if (flattened || k < 2 || k >= nRows || !bandTight || unionCols < f32(f32(0.7) * nCols)) {
    return [cells, cellHasText, cellIsBold, nRows, false];
  }
  const mergedRow: Cell[] = Array.from({ length: nCols }, () => cell(""));
  const mergedHas: boolean[] = Array.from({ length: nCols }, () => false);
  const mergedBold: boolean[] = Array.from({ length: nCols }, () => true);
  for (let r = 0; r < k; r++) {
    for (let c = 0; c < nCols; c++) {
      // Every folded band row grows the merged cell's box, including the
      // text-less ones: the logical header cell spans the whole band the
      // generator sliced it into, not just the rows that carried glyphs.
      const rect = cells[r][c].bbox;
      if (rect != null) mergedRow[c].bbox = rectExtend(mergedRow[c].bbox ?? undefined, rect);
      if (cellHasText[r][c]) {
        if (mergedRow[c].text !== "") mergedRow[c].text += " ";
        mergedRow[c].text += cells[r][c].text;
        mergedRow[c].text_item_indices.push(...cells[r][c].text_item_indices);
        mergedHas[c] = true;
        if (!cellIsBold[r][c]) mergedBold[c] = false;
      }
    }
  }
  const newCells = [mergedRow, ...cells.slice(k)];
  const newHas = [mergedHas, ...cellHasText.slice(k)];
  const newBold = [mergedBold, ...cellIsBold.slice(k)];
  return [newCells, newHas, newBold, newCells.length, true];
}

/**
 * Mark the grid cells that are *vertically merged* with the cell above them,
 * read straight off the rules: a cell whose top boundary carries no horizontal
 * stroke across its own column is the continuation of a rowspan.
 *
 * This is the geometric explanation for legitimately-empty cells. Every
 * interior `ys` boundary exists because *some* horizontal segment sits there,
 * so a column only scores when that particular rule stops short of it, which is
 * exactly how a PDF draws a merged cell. A fully-ruled grid scores zero.
 */
export function rowspanMask(
  hs: readonly HSeg[],
  hIndices: readonly number[],
  vs: readonly VSeg[],
  vIndices: readonly number[],
  xs: readonly number[],
  ys: readonly number[]
): boolean[][] {
  const tol = TABLE_GRID_CLUSTER_PT;
  const mask: boolean[][] = Array.from({ length: ys.length - 1 }, () =>
    Array.from({ length: xs.length - 1 }, () => false)
  );
  for (let r = 0; r + 2 < ys.length; r++) {
    const y = ys[r + 1];
    // Row `r + 1` is the one below boundary `ys[r + 1]`.
    const row = r + 1;
    // Some vertical rule must run *through* the boundary. That is what
    // distinguishes "the grid continues, this one cell is merged" from "the
    // grid ended here": a page-frame component whose stray rules cross
    // unruled prose has no vertical continuing past them, and forgiving its
    // empties would turn body text into a two-column table.
    const gridContinues = vIndices.some((i) => {
      const v = vs[i];
      return v.y_min <= f32(y - tol) && v.y_max >= f32(y + tol);
    });
    if (!gridContinues) continue;
    const atY = hIndices.map((i) => hs[i]).filter((h) => Math.abs(f32(h.y - y)) <= tol);
    for (let c = 0; c < xs.length - 1; c++) {
      // Test the column's *centre*, not containment of the whole column: `xs`
      // comes from clustered and gutter-collapsed boundaries, so the outer
      // ones can sit tens of points off the drawn border, and cell rules are
      // inset by their padding. The centre is the one point that is
      // unambiguously inside this cell.
      const cx = f32(f32(xs[c] + xs[c + 1]) * 0.5);
      if (!atY.some((h) => h.x_min <= cx && h.x_max >= cx)) mask[row][c] = true;
    }
  }
  return mask;
}
