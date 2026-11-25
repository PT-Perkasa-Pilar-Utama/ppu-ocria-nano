// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): assign_cells.

import { clamp, f32, totalCmp, trim } from "../../../rust.js";
import type { ProjectedLine } from "../../../types/page.js";
import type { TextItem } from "../../../types/text-item.js";
import {
  isAlphaDominant,
  lineItemsInReadingOrder,
  splitSpanAtAnchors,
} from "../borderless/index.js";
import { bucketWordsIntoColumns, findBucket } from "./boundaries.js";
import { cellGridNew, cellGridPushRepl, cellGridPushText } from "./cell-grid.js";
import type { CellGrid } from "./cell-grid.js";
import { shouldStopAtRunningProse } from "./prose-stop.js";

const GRID_X_SLACK_PT = 6.0;
/**
 * Straddle census: spans that cross an interior column boundary by a clear
 * margin on both sides. A real ruled table keeps text inside cells (the
 * occasional PDFium merged run aside); decorative slide/layout boxes over
 * flowing prose slice through most runs.
 */
const STRADDLE_MARGIN_PT = 3.0;

function centreY(line: ProjectedLine): number {
  return f32(line.bbox.y + f32(line.bbox.height * 0.5));
}

/** Whether a span's interior (inset by the straddle margin) crosses a column boundary. */
function spanStraddles(span: TextItem, xs: readonly number[]): boolean {
  const lo = xs[0];
  const hi = xs[xs.length - 1];
  const m0 = clamp(f32(span.x + STRADDLE_MARGIN_PT), lo, hi);
  const m1 = clamp(f32(f32(span.x + span.width) - STRADDLE_MARGIN_PT), lo, hi);
  return m1 > m0 && findBucket(xs, m0) !== findBucket(xs, m1);
}

/**
 * A table row: text inside the grid, spread over 2+ columns, with no span
 * straddling an interior boundary. A prose line's runs cut through the
 * boundaries instead.
 */
function isCellAlignedRow(line: ProjectedLine, xs: readonly number[]): boolean {
  const lo = xs[0];
  const hi = xs[xs.length - 1];
  const lineX1 = f32(line.bbox.x + line.bbox.width);
  if (line.bbox.x < f32(lo - GRID_X_SLACK_PT) || lineX1 > f32(hi + GRID_X_SLACK_PT)) return false;
  const cols = new Set<number>();
  for (const span of line.spans.filter((s) => trim(s.text) !== "")) {
    if (spanStraddles(span, xs)) return false;
    const cx = clamp(f32(span.x + f32(span.width * 0.5)), lo, hi);
    const b = findBucket(xs, cx);
    if (b != null) cols.add(b);
  }
  return cols.size >= 2;
}

/**
 * Running prose ends the table, but a full-width merged note row inside a
 * ruled table ("(1) Amounts reflect the restatement described in Note 4,
 * ...") has the same shape and is followed by further cell-aligned rows;
 * stopping there would spill the rest of the table into loose lines. So a
 * single prose line only stops the table below the last cell-aligned rows.
 * Returns the index of the line the table stops at, or null.
 */
function runningProseStop(
  lines: readonly ProjectedLine[],
  lineOrder: readonly number[],
  xs: readonly number[],
  ys: readonly number[]
): number | null {
  const nRows = ys.length - 1;
  const eligible: number[] = [];
  for (const idx of lineOrder) {
    const line = lines[idx];
    const cy = centreY(line);
    if (cy < ys[0] || cy > ys[nRows] || trim(line.text) === "") continue;
    if (findBucket(ys, cy) != null) eligible.push(idx);
  }
  // Require two table rows below a candidate: a single trailing line in 2+
  // columns is as likely a page footer as a table row.
  let alignedSeen = 0;
  let firstCandidate = eligible.length;
  for (let pos = eligible.length - 1; pos >= 0; pos--) {
    if (isCellAlignedRow(lines[eligible[pos]], xs)) {
      alignedSeen += 1;
      if (alignedSeen >= 2) break;
    }
    firstCandidate = pos;
  }
  // Above that cutoff, still stop when a second prose line follows: a
  // paragraph between two tables sharing one ruled grid, or a form page
  // interleaving prose with checkbox rows. A lone note row has neither.
  const prosePositions: number[] = [];
  for (let pos = 0; pos < eligible.length && prosePositions.length < 2; pos++) {
    if (shouldStopAtRunningProse(lines[eligible[pos]], xs)) prosePositions.push(pos);
  }
  if (prosePositions.length === 2) return eligible[prosePositions[0]];
  if (prosePositions.length === 1 && prosePositions[0] >= firstCandidate) {
    return eligible[prosePositions[0]];
  }
  return null;
}

type Census = { total: number; straddle: number };

/** Bin one raw span of `line` into the grid (splitting a multi-column span at the crossed boundaries). */
function assignSpan(
  grid: CellGrid,
  line: ProjectedLine,
  span: TextItem,
  items: readonly number[],
  lineRow: number,
  xs: readonly number[],
  ys: readonly number[],
  census: Census
): void {
  const nRows = ys.length - 1;
  const nCols = xs.length - 1;
  // Per-span row: a span carries its own baseline y, which may sit in a
  // different ruled row than the line centroid.
  const spanCy = f32(span.y + f32(span.height * 0.5));
  const row = findBucket(ys, clamp(spanCy, ys[0], ys[nRows])) ?? lineRow;
  const sx0 = clamp(span.x, xs[0], xs[nCols]);
  const sx1 = clamp(f32(span.x + span.width), xs[0], xs[nCols]);
  const cLo = findBucket(xs, sx0) ?? 0;
  const cHi = findBucket(xs, sx1) ?? nCols - 1;
  census.total += 1;
  if (spanStraddles(span, xs)) census.straddle += 1;
  const clearBold = (col: number): void => {
    if (!line.all_bold) grid.is_bold[row][col] = false;
  };
  if (cLo === cHi) {
    cellGridPushText(grid, row, cLo, span.text, items);
    cellGridPushRepl(grid, row, cLo, span.text, items);
    clearBold(cLo);
    return;
  }
  // Multi-column span: replicate the full text into every covered cell of the
  // colspan-semantics grid, and flag the row when the label is alpha-dominant
  // (group headers are words; merged data runs are mostly digits).
  for (let col = cLo; col <= cHi; col++) cellGridPushRepl(grid, row, col, span.text, items);
  if (isAlphaDominant(span.text)) grid.row_alpha_spanner[row] = true;
  // Span crosses interior boundaries: split at the whitespace nearest each
  // crossed boundary x (xs[k] is column k's left boundary, which is exactly
  // the split target).
  const covered: number[] = [];
  for (let c = cLo; c <= cHi; c++) covered.push(c);
  // Prefer real word geometry: each word lands in the ruled column its own
  // centre falls in, which is exact. `splitSpanAtAnchors` has to guess an x
  // from a character index, so on a proportional font it can cut a word or
  // two off from the true boundary.
  const byWord = bucketWordsIntoColumns(span, xs);
  if (byWord != null) {
    for (const [col, text] of byWord) {
      cellGridPushText(grid, row, col, text, items);
      clearBold(col);
    }
    return;
  }
  const pieces = splitSpanAtAnchors(span, covered, xs);
  if (pieces != null) {
    pieces.forEach((piece, k) => {
      cellGridPushText(grid, row, cLo + k, piece, items);
      clearBold(cLo + k);
    });
    return;
  }
  // No whitespace to split on: assign whole span by center.
  const cx = clamp(f32(span.x + f32(span.width * 0.5)), xs[0], xs[nCols]);
  const col = findBucket(xs, cx);
  if (col != null) {
    cellGridPushText(grid, row, col, span.text, items);
    clearBold(col);
  }
}

/**
 * Bin each line's text into the grid cells defined by column boundaries `xs`
 * and row boundaries `ys`. A projected line frequently spans several ruled
 * columns (one baseline = one line), so binning whole lines by centroid would
 * lump an entire row into one cell and leave the rest empty. Instead bin each
 * line's raw spans by span center; spans whose x-extent crosses one or more
 * interior column boundaries are split at the whitespace nearest each crossed
 * boundary. Returns the filled grid and the consumed line indices, or null if
 * no line landed inside the grid or too many spans straddle interior
 * boundaries (a decorative box over prose, not a table).
 */
export function assignCells(
  lines: readonly ProjectedLine[],
  xs: readonly number[],
  ys: readonly number[],
  stopAtRunningProse: boolean
): [CellGrid, number[]] | null {
  const nRows = ys.length - 1;
  const nCols = xs.length - 1;
  const grid = cellGridNew(nRows, nCols, xs, ys);
  const consumed: number[] = [];
  const census: Census = { total: 0, straddle: 0 };

  // Iterate lines top-to-bottom. The global pass receives lines in xy_cut
  // leaf order (column-by-column), which scrambles a multi-line cell's text
  // when concatenated in array order; y-sorted iteration restores reading
  // order within each cell. Per-region lines are already y-ordered, so this
  // is a no-op there.
  const lineOrder = lines
    .map((_, i) => i)
    .sort((a, b) => totalCmp(lines[a].bbox.y, lines[b].bbox.y));
  const proseStop = stopAtRunningProse ? runningProseStop(lines, lineOrder, xs, ys) : null;

  for (const idx of lineOrder) {
    const line = lines[idx];
    const cy = centreY(line);
    if (cy < ys[0] || cy > ys[nRows]) continue;
    // Line-level row bucket. Used by the no-spans fallback and as the default
    // when a span's own y doesn't resolve. Spans bin by their own baseline
    // below: a projected line can merge text from several ruled rows.
    const row = findBucket(ys, cy);
    if (row == null) continue;
    if (trim(line.text) === "") continue;
    if (proseStop === idx) break;

    // Only consume the line when its text sits inside the grid horizontally:
    // a line poking past the grid edge belongs (at least partly) to
    // surrounding prose, and consuming it would lose text.
    const lineX1 = f32(line.bbox.x + line.bbox.width);
    if (line.bbox.x < f32(xs[0] - GRID_X_SLACK_PT) || lineX1 > f32(xs[nCols] + GRID_X_SLACK_PT)) {
      continue;
    }

    const textSpans: Array<[TextItem, number | null]> = [];
    line.spans.forEach((s, i) => {
      if (trim(s.text) !== "") textSpans.push([s, line.span_item_indices[i] ?? null]);
    });
    textSpans.sort((a, b) => totalCmp(a[0].x, b[0].x));

    if (textSpans.length === 0) {
      // No raw text spans (synthetic/OCR lines): old whole-line centroid path.
      const cx = f32(line.bbox.x + f32(line.bbox.width * 0.5));
      const col = findBucket(xs, clamp(cx, xs[0], xs[nCols]));
      if (col != null) {
        const items = lineItemsInReadingOrder(line);
        cellGridPushText(grid, row, col, line.text, items);
        cellGridPushRepl(grid, row, col, line.text, items);
        if (!line.all_bold) grid.is_bold[row][col] = false;
        consumed.push(idx);
      }
      continue;
    }

    for (const [span, itemIndex] of textSpans) {
      assignSpan(grid, line, span, itemIndex == null ? [] : [itemIndex], row, xs, ys, census);
    }
    consumed.push(idx);
  }

  if (consumed.length === 0) return null;

  const straddleFrac = census.total > 0 ? f32(census.straddle / census.total) : 0;
  if (census.total >= 6 && straddleFrac > f32(0.45)) return null;
  grid.straddle_frac = straddleFrac;
  return [grid, consumed];
}
