// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): try_detect_table_inferred.

import { f32, isUppercase, trim } from "../../../rust.js";
import { isAsciiDigit } from "../../../rust-extra.js";
import type { ProjectedLine } from "../../../types/page.js";
import type { SpanPiece, TableCell, TableRun } from "../types.js";
import { lineCell, splitCells } from "./cells.js";
import {
  TABLE_MIN_COLUMNS,
  TABLE_MIN_ROWS,
  TABLE_MIN_TRACK_GAP_FLOOR_PT,
  TABLE_MIN_TRACK_GAP_FONT_MULT,
  TABLE_ROW_SPACING_MAX_CV,
  TABLE_TRACK_INFERENCE_MAX_ROWS,
  TABLE_TRACK_TOLERANCE_PT,
} from "./constants.js";
import { finalizeTableRun } from "./finalize-table-run.js";
import type { CandidateRow, SteppedOver } from "./row-types.js";
import { trimSteppedOverTail } from "./stepped-over.js";
import {
  cellsFromPieces,
  inferTracksFromRawItems,
  rowSpacingCv,
  tableRowsAdjacent,
} from "./tracks.js";

/**
 * Plausibility gates for a header + single-data-row run.
 *
 * Two rows is the weakest possible structural signal, and there is one thing
 * that reliably counterfeits it: fully-justified prose. Justification
 * stretches inter-word spaces until they read as column gutters, so any two
 * consecutive lines of a justified paragraph infer clean tracks and shred into
 * `| when travelling | to | conflict | zones, | more |`.
 *
 * Two signals separate the real thing from the counterfeit:
 *
 * 1. Isolation. A real 2-row table is surrounded by whitespace. A prose pair
 *    is mid-paragraph, so its neighbours are table-adjacent lines.
 * 2. Header shape. Header cells are labels: they start with a capital or a
 *    digit and don't trail mid-sentence punctuation. Prose "headers" are
 *    lowercase words, often ending in a comma.
 */
export function twoRowRunPlausible(lines: ProjectedLine[], run: TableRun): boolean {
  const b = run.block;
  if (typeof b === "string" || !("Table" in b) || b.Table.header === null) return false;
  const header = b.Table.header;

  if (run.start > 0 && tableRowsAdjacent(lines[run.start - 1], lines[run.start])) return false;
  if (run.end < lines.length && tableRowsAdjacent(lines[run.end - 1], lines[run.end])) {
    return false;
  }

  let nonEmpty = 0;
  for (const cell of header) {
    const t = trim(cell.text);
    if (t === "") continue;
    nonEmpty += 1;
    const first = Array.from(t)[0];
    if (!(isUppercase(first) || isAsciiDigit(first))) return false;
    if (t.endsWith(",") || t.endsWith(";")) return false;
  }
  return nonEmpty >= TABLE_MIN_COLUMNS;
}

/**
 * Like `tryDetectTable` but seeds column tracks from the union of raw item
 * start-x positions across the candidate window rather than from the first
 * row's `splitCells` output. Use this first to unlock tables where the
 * cell-gap heuristic collapses adjacent numeric columns into one cell in every
 * row. Returns null when (a) inferred tracks are no richer than per-row
 * bucketing (no win to be had), or (b) the inferred-track candidate fails any
 * soundness check - in which case `tryDetectTable`'s existing logic should run.
 *
 * `allowTwoRow` relaxes the two body-length gates below so a header row plus a
 * single data row can form a table. Only ever set by the last-resort second
 * pass in `detectTablesWithPieces`, which runs exclusively in regions where
 * the normal pass found no table at all - see the comment there for why
 * relaxing these gates globally is unsafe.
 */
export function tryDetectTableInferred(
  lines: ProjectedLine[],
  pieces: SpanPiece[][],
  startIdx: number,
  floor: number,
  allowTwoRow: boolean,
  allowTwoCol: boolean
): TableRun | null {
  const minColumns = allowTwoCol ? 2 : TABLE_MIN_COLUMNS;
  const baselineCells = splitCells(lines[startIdx]);
  const tracks = inferTracksFromRawItems(lines, pieces, startIdx);
  if (tracks.length < minColumns) return null;
  // Only bother if we'd actually unlock more columns than the default path.
  if (tracks.length <= baselineCells.length) return null;
  // Reject "tracks" that are really inter-word positions in prose. Real table
  // columns are separated by visible whitespace gutters wider than the body
  // font; word positions in running prose cluster at less than 1x font size
  // apart. Threshold at 1.5x the seed line's dominant font size, with a 12pt
  // absolute floor for small fonts.
  const fontSize =
    lines[startIdx].dominant_font_size > 0
      ? lines[startIdx].dominant_font_size
      : Math.max(lines[startIdx].bbox.height, 1);
  const minTrackGap = Math.max(
    f32(fontSize * TABLE_MIN_TRACK_GAP_FONT_MULT),
    TABLE_MIN_TRACK_GAP_FLOOR_PT
  );
  let minGap = Infinity;
  for (let i = 0; i + 1 < tracks.length; i++) {
    minGap = Math.min(minGap, f32(tracks[i + 1] - tracks[i]));
  }
  if (minGap < minTrackGap) return null;
  const columnCount = tracks.length;
  const trackRanges = tracks.map((t): [number, number] => [t, t]);
  const tracksRightEdge = f32(tracks[tracks.length - 1] + Math.max(TABLE_TRACK_TOLERANCE_PT, 8));

  // Seed row: require a strong structural signal - its raw PDFium span count
  // must be at least tracks.length AND each span must single-cover (no
  // multi-track splits in the seeding row). This rejects prose lines where 2-3
  // spans happen to anchor at inferred tracks but actually each span's x-extent
  // covers multiple tracks, which would produce a shred-on-whitespace seed
  // that's indistinguishable from a real table. Subsequent rows can still have
  // merged spans recovered via the multi-cover split path.
  //
  // The strong row need not be `startIdx` itself: a stacked or partial header
  // (a centered "Number of" above a right-aligned numeric column, fewer cells
  // than the body) legitimately leads the table. Scan forward for the first
  // strong row and seed the body there; `finalizeTableRun` absorbs the header
  // lines above it. Without this the body would be seeded on the header, the
  // run would break at the first unalignable header cell, and the table would
  // fall to the header-seeded path that drops a column.
  const tol = TABLE_TRACK_TOLERANCE_PT;
  const isStrongRow = (idx: number): boolean => {
    const spans = pieces[idx];
    if (spans.length < tracks.length) return false;
    return spans.every((s) => {
      const x0 = s.x;
      const x1 = s.end_x;
      return tracks.filter((t) => t >= f32(x0 - tol) && t <= f32(x1 + tol)).length === 1;
    });
  };
  let bodyStart: number | null = null;
  {
    let k = startIdx;
    let used = 0;
    while (k < lines.length && used < TABLE_TRACK_INFERENCE_MAX_ROWS) {
      if (k > startIdx && !tableRowsAdjacent(lines[k - 1], lines[k])) break;
      if (isStrongRow(k)) {
        bodyStart = k;
        break;
      }
      k += 1;
      used += 1;
    }
  }
  if (bodyStart === null) return null;
  const first = cellsFromPieces(pieces[bodyStart], tracks, allowTwoCol);
  if (first === null) return null;
  if (first.filter((c) => c.text !== "").length < minColumns) return null;
  const rows: CandidateRow[] = [[bodyStart, lines[bodyStart], first]];

  // See `tryDetectTable`: stepped-over lines go back as interstitials.
  const steppedOver: SteppedOver[] = [];
  let j = bodyStart + 1;
  while (j < lines.length) {
    if (lines[j].bbox.x > tracksRightEdge) {
      steppedOver.push([j, true, lineCell(lines[j])]);
      j += 1;
      continue;
    }
    if (!tableRowsAdjacent(rows[rows.length - 1][1], lines[j])) break;
    const cells: TableCell[] | null = cellsFromPieces(pieces[j], tracks, allowTwoCol);
    if (cells === null) break;
    // Drop rows that contribute zero populated cells (all out-of-band or empty
    // after splitting) - they'd add noise without content.
    if (cells.every((c) => c.text === "")) break;
    rows.push([j, lines[j], cells]);
    j += 1;
  }
  const minRows = allowTwoRow ? 1 : TABLE_MIN_ROWS;
  if (rows.length < minRows) return null;
  // When the body was seeded below `startIdx` (the lead line was a header we
  // skipped over to find a strong row), demand a clearly multi-row body before
  // committing. A strong row found inside a header band can otherwise anchor a
  // 2-row pseudo-table that consumes the lead lines and starves the
  // header-seeded path of the real table below it. Already-strong seeds
  // (bodyStart === startIdx) keep the standard MIN_ROWS threshold and are
  // unaffected.
  if (bodyStart > startIdx && rows.length < 3 && !allowTwoRow) return null;
  const cv = rowSpacingCv(rows);
  // Defer to the existing path, which can fall back to GridFallback.
  if (cv > TABLE_ROW_SPACING_MAX_CV) return null;
  const end = trimSteppedOverTail(j, bodyStart, steppedOver);

  const boldEligible = rows[0][2].every((c) => c.bold && c.text !== "");
  const run = finalizeTableRun(
    lines,
    bodyStart,
    floor,
    rows,
    trackRanges,
    columnCount,
    end,
    boldEligible
  );
  if (run === null) return null;
  // Runs that exist *only* because the relaxation fired must clear the extra
  // content gates. Runs that would have passed the normal floor anyway are
  // untouched, so this can never reject something the normal pass accepted.
  if (allowTwoRow && rows.length < TABLE_MIN_ROWS && !twoRowRunPlausible(lines, run)) return null;
  run.interstitials.push(...steppedOver.map(([, , cell]) => cell));
  return run;
}
