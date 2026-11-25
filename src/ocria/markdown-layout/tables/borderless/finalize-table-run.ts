// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): finalize_table_run.

import { f32, trim } from "../../../rust.js";
import { rectExtend } from "../../../types/geometry.js";
import type { ProjectedLine } from "../../../types/page.js";
import type { Cell } from "../../block-types.js";
import type { TableRun } from "../types.js";
import { absorbHeaderLines } from "./absorb-header-lines.js";
import { linesBbox, locatedCell } from "./cells.js";
import { TABLE_MIN_ROWS, TABLE_TRACK_TOLERANCE_PT } from "./constants.js";
import type { CandidateRow } from "./row-types.js";
import { isLabelFragment } from "./tracks.js";

/**
 * Shared epilogue for the table detectors. Given the accumulated `rows`, walk
 * back to absorb wrapped header lines, optionally promote a bold first row to
 * the header (only when `boldFirstRowEligible` and no header was absorbed),
 * build the body, and construct the `TableRun`. The bold-eligibility predicate
 * differs between callers (the inferred path additionally requires non-empty
 * cells), so it's computed at the call site and passed in.
 */
export function finalizeTableRun(
  lines: ProjectedLine[],
  startIdx: number,
  floor: number,
  rows: CandidateRow[],
  trackRanges: Array<[number, number]>,
  columnCount: number,
  end: number,
  boldFirstRowEligible: boolean
): TableRun | null {
  // Walk back above the detected body and absorb header lines that align to
  // the same column tracks but weren't includable as body rows (merged /
  // partial header cells). Multiple wrapped header lines collapse into one
  // markdown header row, joined per-column top-to-bottom.
  const absorbed = absorbHeaderLines(lines, startIdx, trackRanges, columnCount, floor);

  // Promote the first body row to header iff it qualifies and we didn't
  // already absorb an explicit header above. `rowStart` is the index of the
  // first body row within `rows`: 0 when the header came from absorbed lines,
  // 1 when the bold-first-row promotion consumes rows[0].
  const firstRow = rows[0][2];
  const boldHeaderQualifies = absorbed === null && boldFirstRowEligible;
  let runStart = startIdx;
  let header: Cell[] | null = null;
  let rowStart = 0;
  let interstitials: Cell[] = [];
  if (absorbed !== null) {
    [runStart, header, interstitials] = [absorbed[0], absorbed[1], absorbed[2]];
  } else if (boldHeaderQualifies) {
    header = firstRow.map((c) => locatedCell(c, rows[0][1]));
    rowStart = 1;
  }
  const bodyRows: Cell[][] = rows
    .slice(rowStart)
    .map(([, line, cells]) => cells.map((c) => locatedCell(c, line)));
  // A first-column interstitial right above the body is the wrapped first half
  // of the first row's label, not a note (#487): "Productos primarios" over
  // "pesqueros|663|..." reads "Productos primarios pesqueros".
  const firstTrackX = trackRanges.length > 0 ? trackRanges[0][0] : 0;
  const inter = interstitials[0];
  const wrappedLabel =
    inter !== undefined &&
    isLabelFragment(trim(inter.text)) &&
    inter.bbox != null &&
    Math.abs(f32(inter.bbox.x - firstTrackX)) <= Math.max(TABLE_TRACK_TOLERANCE_PT, 8);
  const firstCell = bodyRows[0]?.[0];
  if (wrappedLabel && firstCell !== undefined) {
    const prefix = trim(inter.text);
    firstCell.text = firstCell.text === "" ? prefix : `${prefix} ${firstCell.text}`;
    if (inter.bbox != null) firstCell.bbox = rectExtend(firstCell.bbox ?? undefined, inter.bbox);
    firstCell.text_item_indices.unshift(...inter.text_item_indices);
    interstitials.shift();
  }
  if (header === null && bodyRows.length < TABLE_MIN_ROWS) return null;
  // A header with no body is not a table. Reachable only via the bold-first-row
  // promotion, which consumes rows[0] - harmless before the two-row relaxation,
  // but with it rows[0] can be the *only* row.
  if (bodyRows.length === 0) return null;

  return {
    start: runStart,
    end,
    body_start: startIdx,
    bbox: linesBbox(lines, runStart, end),
    block: { Table: { header, rows: bodyRows } },
    interstitials,
    item_indices: [],
  };
}
