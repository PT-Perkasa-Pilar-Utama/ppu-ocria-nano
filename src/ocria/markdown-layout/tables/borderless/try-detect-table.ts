// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): try_detect_table.

import { charCount, chars, f32, isWhitespace, trim, trimEnd } from "../../../rust.js";
import type { ProjectedLine } from "../../../types/page.js";
import type { Cell } from "../../block-types.js";
import type { TableCell, TableRun } from "../types.js";
import { lineCell, linesBbox, locatedCell, recoverMergedCell, splitCells } from "./cells.js";
import {
  TABLE_MIN_COLUMNS,
  TABLE_MIN_ROWS,
  TABLE_ROW_SPACING_MAX_CV,
  TABLE_SPARSE_ROW_MIN_BOTTOM_GAP_FRAC,
  TABLE_TRACK_TOLERANCE_PT,
} from "./constants.js";
import { finalizeTableRun } from "./finalize-table-run.js";
import type { CandidateRow, SteppedOver } from "./row-types.js";
import { trimSteppedOverTail } from "./stepped-over.js";
import {
  cellAlignsTrack,
  isLabelFragment,
  matchTrackIdx,
  rowSpacingCv,
  tableRowsAdjacent,
} from "./tracks.js";

function cloneTableCell(c: TableCell): TableCell {
  return {
    ...c,
    text_item_indices: [...c.text_item_indices],
    item_x_ranges: c.item_x_ranges.map(([a, b]): [number, number] => [a, b]),
  };
}

function emptyTableCell(x: number): TableCell {
  return {
    start_x: x,
    end_x: x,
    text: "",
    bold: false,
    text_item_indices: [],
    item_x_ranges: [],
  };
}

/**
 * Whether the line at `j` is the leading half of a row label wrapped onto its
 * own line (#487): a first-column line followed by a full row whose label is
 * one short word ("Exportaciones totales" over "pesqueras|895|...").
 */
function isLeadingLabel(
  lines: ProjectedLine[],
  j: number,
  cells: TableCell[],
  mapping: number[],
  pendingPrefix: TableCell[],
  columnCount: number
): boolean {
  if (!(cells.length === 1 && mapping[0] === 0 && pendingPrefix.length < 2)) return false;
  if (!(j + 1 < lines.length)) return false;
  const nextCells = splitCells(lines[j + 1]);
  const curText = trim(cells[0].text);
  const nextFirst = nextCells.length > 0 ? trim(nextCells[0].text) : "";
  return (
    nextCells.length === columnCount &&
    tableRowsAdjacent(lines[j], lines[j + 1]) &&
    !chars(nextFirst).some(isWhitespace) &&
    charCount(nextFirst) <= 12 &&
    charCount(curText) > charCount(nextFirst) &&
    isLabelFragment(curText) &&
    isLabelFragment(nextFirst)
  );
}

/**
 * Try to extend a candidate table starting at `startIdx`. On success returns a
 * `TableRun` with `Block::Table` or `Block::GridFallback`; on failure returns
 * null (and the caller should fall through to per-line classification).
 */
export function tryDetectTable(
  lines: ProjectedLine[],
  startIdx: number,
  floor: number
): TableRun | null {
  const firstCells = splitCells(lines[startIdx]);
  if (firstCells.length < TABLE_MIN_COLUMNS) return null;

  const rows: CandidateRow[] = [[startIdx, lines[startIdx], firstCells.map(cloneTableCell)]];
  const columnCount = firstCells.length;
  const tracks = firstCells.map((c) => c.start_x);
  const trackRanges = firstCells.map((c): [number, number] => [c.start_x, c.end_x]);

  // Right edge of the established column tracks (last track + a track-width
  // worth of slack). Used to identify lines that sit entirely in a different
  // page column and should be skipped over rather than breaking the run -
  // common on two-column pages where the projection interleaves left and right
  // column lines in y-order.
  let trackMaxX = -Infinity;
  for (const c of firstCells) trackMaxX = Math.max(trackMaxX, Math.max(c.end_x, c.start_x));
  const tracksRightEdge = f32(trackMaxX + Math.max(TABLE_TRACK_TOLERANCE_PT, 8));

  // Lines and cells the run steps over. They sit inside `start..end`, which the
  // classifier skips, so they're handed back as interstitials rather than
  // dropped; `true` marks a whole stepped-over line.
  const steppedOver: SteppedOver[] = [];
  let j = startIdx + 1;
  // Leading half of the next row's wrapped label, prepended when that row is
  // pushed (see the wrap path below).
  let pendingPrefix: TableCell[] = [];
  while (j < lines.length) {
    // Skip lines that sit entirely to the right of the table's column tracks -
    // almost certainly content from a different page column. Use the line's
    // leftmost span x; if it's past the table's right edge we won't break the
    // run, just step over.
    if (lines[j].bbox.x > tracksRightEdge) {
      steppedOver.push([j, true, lineCell(lines[j])]);
      j += 1;
      continue;
    }
    if (!tableRowsAdjacent(rows[rows.length - 1][1], lines[j])) {
      pendingPrefix = [];
      break;
    }
    let cells = splitCells(lines[j]);
    if (cells.length < columnCount && cells.length >= TABLE_MIN_COLUMNS) {
      // PDFium occasionally merges two (or more) adjacent words into one text
      // run when inter-word kerning is tighter than the gap threshold - common
      // in tightly-set numeric tables (e.g. the "MEMORYBANK 5.00 4.77" case on
      // page 6 of the AMEM paper). Recover by splitting straddling cells on
      // internal whitespace.
      const patched = recoverMergedCell([...cells], tracks);
      if (patched !== null) cells = patched;
    }
    // Partial-cell line handling: when a line has *fewer* cells than the
    // established column count, decide between (a) wrap of prior row's
    // multi-line cell, (b) sparse new row (some columns just empty), (c)
    // break-run. Order matters - the wrap path runs first so tightly-stacked
    // continuation baselines fold into the prior row; the sparse-row path only
    // triggers when there's a clear inter-row gap AND every cell maps to a
    // distinct column track.
    if (cells.length < columnCount && cells.length > 0) {
      const prevLine = rows[rows.length - 1][1];
      const prevYTop = prevLine.bbox.y;
      const prevBottom = f32(prevLine.bbox.y + prevLine.bbox.height);
      const lineHeight = Math.max(Math.max(prevLine.bbox.height, lines[j].bbox.height), 1);
      const centroidDy = f32(lines[j].bbox.y - prevYTop);
      const bottomGap = f32(lines[j].bbox.y - prevBottom);
      // Map each cell to its column track once. `matchTrackIdx` returns a
      // value exactly when `cellAlignsTrack` would return true, so
      // `mapping.length === cells.length` is the same "every cell aligns to a
      // track" predicate - and the mapping is already in hand for the paths
      // below.
      const mapping: number[] = [];
      for (const c of cells) {
        const idx = matchTrackIdx(c, trackRanges);
        if (idx !== null) mapping.push(idx);
      }
      const allAlignTrack = mapping.length === cells.length;
      // Sparse-new-row path runs FIRST. When the line sits a clear inter-row
      // gap below the previous row AND its cells map to distinct tracks, treat
      // it as a new row with empty cells at the missing tracks. This catches a
      // sparse data row following a wide header (e.g. `"1.0 April 30,
      // Original"` under a 5-column header), which a naive wrap path would
      // merge into the header.
      if (
        allAlignTrack &&
        cells.length >= 2 &&
        bottomGap >= f32(lineHeight * TABLE_SPARSE_ROW_MIN_BOTTOM_GAP_FRAC)
      ) {
        if (new Set(mapping).size === mapping.length) {
          const padded = Array.from({ length: columnCount }, (_, i) => emptyTableCell(tracks[i]));
          cells.forEach((c, k) => {
            padded[mapping[k]] = cloneTableCell(c);
          });
          rows.push([j, lines[j], padded]);
          j += 1;
          continue;
        }
      }
      // Wrap path: tight stack against prior row, multi-line cell
      // continuation. Exception (#487): a first-column line followed by a full
      // row whose label is one short word is the leading half of the next
      // row's label, so it's buffered rather than appended here.
      if (centroidDy <= f32(lineHeight * 1.5) && allAlignTrack) {
        if (isLeadingLabel(lines, j, cells, mapping, pendingPrefix, columnCount)) {
          pendingPrefix.push(cloneTableCell(cells[0]));
          j += 1;
          continue;
        }
        const prevCells = rows[rows.length - 1][2];
        cells.forEach((c, k) => {
          const dst = prevCells[mapping[k]];
          if (dst.text !== "" && c.text !== "") dst.text += " ";
          dst.text += c.text;
          dst.text_item_indices.push(...c.text_item_indices);
        });
        j += 1;
        continue;
      }
    }
    // If the row has *more* cells than columnCount, it likely picked up content
    // from an adjacent page column that the projection placed on the same line
    // (e.g. left-table-row + right-column body text). Try to recover by keeping
    // only the cells whose center lands inside one of our established column
    // tracks; drop the rest. Cells trimmed off this row as foreign-column bleed
    // are handed back only once the row is accepted: a rejected row ends the
    // run outside it, and the classifier emits that whole line itself.
    let trimmed: Cell[] = [];
    if (cells.length > columnCount) {
      const kept = cells.filter((c) => matchTrackIdx(c, trackRanges) !== null);
      // Only cells sitting entirely outside the table's x-extent can be foreign
      // page-column bleed. A cell that lands *between* two established tracks
      // is in-table content, so discarding it would silently lose document text
      // - break the run instead and let the wider row seed its own table.
      const firstTrackX = trackRanges.length > 0 ? trackRanges[0][0] : -Infinity;
      const extras = cells.filter((c) => matchTrackIdx(c, trackRanges) === null);
      const extrasAllOutside = extras.every(
        (c) => c.end_x < firstTrackX || c.start_x > tracksRightEdge
      );
      if (kept.length === columnCount && extrasAllOutside) {
        trimmed = extras.map((c) => locatedCell(c, lines[j]));
        cells = kept;
      } else {
        break;
      }
    }
    if (cells.length !== columnCount) break;
    // Allow at most one column track to drift out of tolerance, which lets
    // grouped row-labels in academic tables (e.g. an indented "MEMORYBANK" row
    // whose label column shifts right by ~30pt while the numeric columns stay
    // aligned) stay in the same run. Without this slack a single indented label
    // fragments a 6-row table into three 2-row chunks.
    let misaligned = 0;
    cells.forEach((c, k) => {
      if (k < trackRanges.length && !cellAlignsTrack(c, trackRanges[k])) misaligned += 1;
    });
    if (misaligned > 1) {
      pendingPrefix = [];
      break;
    }
    if (pendingPrefix.length > 0) {
      const prefix = pendingPrefix
        .map((c) => trim(c.text))
        .filter((t) => t !== "")
        .join(" ");
      if (prefix !== "" && cells.length > 0) {
        cells[0].text = cells[0].text !== "" ? `${prefix} ${cells[0].text}` : prefix;
        cells[0].text_item_indices.unshift(...pendingPrefix.flatMap((c) => c.text_item_indices));
      }
      pendingPrefix = [];
    }
    rows.push([j, lines[j], cells]);
    for (const cell of trimmed) steppedOver.push([j, false, cell]);
    j += 1;
  }

  if (rows.length < TABLE_MIN_ROWS) return null;

  const cv = rowSpacingCv(rows);
  const end = trimSteppedOverTail(j, startIdx, steppedOver);

  if (cv > TABLE_ROW_SPACING_MAX_CV) {
    // Suggestive layout but the row cadence is too irregular to trust as a
    // clean table - surface as a fenced fallback so the structure is at least
    // preserved. Every line the run consumes, not only the rows: lines folded
    // into a row's cells and stepped-over lines are inside `start..end` too.
    const consumed = lines.slice(startIdx, end);
    return {
      start: startIdx,
      end,
      body_start: startIdx,
      bbox: linesBbox(lines, startIdx, end),
      block: { GridFallback: { lines: consumed.map((line) => trimEnd(line.text)) } },
      interstitials: [],
      item_indices: consumed.flatMap((line) => line.span_item_indices),
    };
  }

  // Promote the first body row to header iff every cell in it is bold (a
  // bold-or-filled heuristic; fills require fork data). Skipped inside
  // `finalizeTableRun` when a header was absorbed.
  const boldEligible = rows[0][2].every((c) => c.bold);
  const run = finalizeTableRun(
    lines,
    startIdx,
    floor,
    rows,
    trackRanges,
    columnCount,
    end,
    boldEligible
  );
  if (run === null) return null;
  run.interstitials.push(...steppedOver.map(([, , cell]) => cell));
  return run;
}
