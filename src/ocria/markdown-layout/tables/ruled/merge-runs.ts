// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): merging ruled runs with borderless runs.

import { isAlphabetic, isUppercase, trim, trimEnd, trimStart } from "../../../rust.js";
import { rectExtend } from "../../../types/geometry.js";
import type { Cell } from "../../block-types.js";
import { isValueLike } from "../borderless/index.js";
import type { TableRun } from "../types.js";

/** Count filled (non-empty) cells in a TableRun. GridFallback returns 0 so it never beats a real Table in density comparisons. */
export function runFilledCells(run: TableRun): number {
  const b = run.block;
  if (typeof b === "string" || !("Table" in b)) return 0;
  const filled = (cells: readonly Cell[]): number =>
    cells.filter((c) => trim(c.text) !== "").length;
  const headerFilled = b.Table.header == null ? 0 : filled(b.Table.header);
  return headerFilled + b.Table.rows.reduce((n, r) => n + filled(r), 0);
}

function firstRowLen(run: TableRun): number | null {
  const b = run.block;
  if (typeof b === "string" || !("Table" in b)) return null;
  return b.Table.rows[0]?.length ?? 0;
}

const overlaps = (a: TableRun, b: TableRun): boolean => !(b.end <= a.start || b.start >= a.end);

/**
 * Merge ruled-grid runs with borderless runs into a single sorted list. When
 * ranges overlap the ruled run normally wins (path-based geometry is a stronger
 * signal than text-alignment heuristics), with two exceptions:
 *   1. A single-column ruled run yields to a multi-column borderless run
 *      covering the same range (vertical separators may be implicit).
 *   2. A sparse ruled run yields to a denser borderless run: decorative vector
 *      boxes around titles / callout banners produce ruled "tables" with few
 *      filled cells; when a borderless detector finds a much denser real table
 *      in the same region, prefer it.
 */
export function mergeTableRuns(ruled: TableRun[], borderless: TableRun[]): TableRun[] {
  const kept: TableRun[] = [];
  for (const r of ruled) {
    const rLen = firstRowLen(r);
    if (rLen != null && rLen <= 1) {
      const beaten = borderless.some((b) => {
        if (!overlaps(r, b)) return false;
        const bLen = firstRowLen(b);
        return bLen != null && bLen >= 2;
      });
      if (beaten) continue;
    }
    // Density check: if a borderless run overlaps and carries substantially
    // more filled cells, the ruled run is most likely a decorative grid (page
    // chrome, title banner) wrapping the real table the borderless detector
    // already found.
    const ruledDensity = runFilledCells(r);
    const beatenByDensity = borderless.some(
      (b) => overlaps(r, b) && runFilledCells(b) >= ruledDensity * 2 + 4
    );
    if (beatenByDensity) continue;
    kept.push(r);
  }
  for (const b of borderless) {
    if (!kept.some((r) => overlaps(r, b))) kept.push(b);
  }
  kept.sort((a, b) => a.start - b.start);
  for (const run of kept) {
    const blk = run.block;
    if (typeof blk !== "string" && "Table" in blk) mergeContinuationRows(blk.Table.rows);
  }
  return kept;
}

/**
 * Fold soft-wrapped cell continuations back into the row they belong to.
 *
 * A table cell holding a sentence wraps across several projected lines, and
 * every one of those lines becomes its own grid row:
 *
 * ```text
 * | Knowledge |  | * To understand the meaning of reducing, reusing and recycling |
 * |           |  | and how they connect * To understand the importance of the 3 Rs |
 * ```
 *
 * As geometry this is unsolvable: the gap between a wrapped line and a genuine
 * next row is the same gap. But once the grid exists it is tractable from the
 * text alone.
 *
 * A row is a continuation of its predecessor when all of these hold:
 *
 * - it has the same width and an **empty first cell** (the row label lives on
 *   the first line of the row and is never repeated);
 * - its filled columns are a **subset** of the predecessor's filled columns: a
 *   continuation can only extend cells that already have text;
 * - it carries **no value-like cell**; numbers don't soft-wrap, so a
 *   blank-label row holding one is a real data row (typically a `Total`);
 * - at least one extended cell reads as a soft wrap rather than a fresh
 *   sentence after a completed one.
 *
 * Mutates `rows`.
 */
export function mergeContinuationRows(rows: Cell[][]): void {
  if (rows.length < 2) return;
  // The whole rule keys off "empty first cell", which only means "wrapped line"
  // when the first column is a *label* column. Plenty of tables just have a
  // sparse first column: a timetable whose `Notes` column is blank on every
  // run, a size chart, a hierarchical header. There, every row looks like a
  // continuation and the table collapses into a single row. Requiring the
  // first column to be populated in at least half the rows separates the two.
  const firstColFilled = rows.filter((r) => r.length > 0 && trim(r[0].text) !== "").length;
  if (firstColFilled * 2 < rows.length) return;
  const out: Cell[][] = [];
  for (const row of rows) {
    const prev = out[out.length - 1];
    if (prev !== undefined && isContinuationRow(prev, row)) {
      row.forEach((c, i) => {
        const t = trim(c.text);
        if (t === "") return;
        // `prev[i]` is non-empty for every filled column of `row`; that is the
        // subset rule `isContinuationRow` enforces.
        prev[i].text += ` ${t}`;
        // The wrapped line is part of the same logical cell, so it grows that
        // cell's box down to cover the continuation.
        if (c.bbox != null) prev[i].bbox = rectExtend(prev[i].bbox ?? undefined, c.bbox);
        prev[i].text_item_indices.push(...c.text_item_indices);
      });
      continue;
    }
    out.push(row);
  }
  rows.splice(0, rows.length, ...out);
}

export function isContinuationRow(prev: readonly Cell[], cur: readonly Cell[]): boolean {
  if (cur.length !== prev.length || cur.length < 2) return false;
  // The row label is never repeated on a wrapped line.
  if (trim(cur[0].text) !== "" || trim(prev[0].text) === "") return false;
  const filled: number[] = [];
  for (let i = 0; i < cur.length; i++) if (trim(cur[i].text) !== "") filled.push(i);
  if (filled.length === 0) return false;
  // A continuation extends existing text; it cannot introduce a new column.
  if (filled.some((i) => trim(prev[i].text) === "")) return false;
  // Numbers never soft-wrap. A blank-label row carrying any value-like cell is
  // a real data row, most often a `Total` line, whose label column is blank
  // precisely because it isn't the row's own label. Vetoing on *any* value
  // (not all of them) is what separates it from a genuine wrap, since such
  // rows pair a short summary word with the figures.
  if (filled.some((i) => isValueLike(trim(cur[i].text)))) return false;
  return filled.some((i) => cellContinues(trimEnd(prev[i].text), trimStart(cur[i].text)));
}

/**
 * Whether `cur` reads as the tail of `prev` rather than a new statement. The
 * only shape we reject is a fresh capitalised sentence following a cell that
 * already closed with terminal punctuation: that is a sub-row, not a wrap.
 */
export function cellContinues(prev: string, cur: string): boolean {
  const firstAlpha = Array.from(cur).find((c) => isAlphabetic(c));
  const startsNewSentence = firstAlpha !== undefined && isUppercase(firstAlpha);
  const prevClosed = prev.endsWith(".") || prev.endsWith("!") || prev.endsWith("?");
  return !(startsNewSentence && prevClosed);
}
