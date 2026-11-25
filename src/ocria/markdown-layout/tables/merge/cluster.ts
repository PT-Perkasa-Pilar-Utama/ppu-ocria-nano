// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): fragmented-cluster re-extraction.

// `try_detect_table` closes a run whenever the per-row cell count changes, so
// one real table with sparse rows (row-label column present on some rows only,
// empty value columns on others) fragments into several runs at different
// column counts, with stranded single rows between them. This pass re-derives
// the *union* column track set from the raw PDFium span positions across the
// whole cluster and re-extracts every line against those tracks. Sparse rows
// get empty cells, merged spans split at track anchors, and the cluster emits
// as one table.
//
// Only fires when >= 2 table runs are already y-adjacent: prose never enters
// this path, so the false-positive surface is limited to "two genuinely
// separate stacked tables", which the both-complete guard rejects.

import { f32, totalCmp, trim } from "../../../rust.js";
import type { ProjectedLine } from "../../../types/page.js";
import type { Cell } from "../../block-types.js";
import { cellSourced } from "../../blocks/positioned.js";
import { collapseWhitespace } from "../../paragraphs/index.js";
import {
  cellsFromRawItemsWithTracks,
  lineItemsInReadingOrder,
  linesBbox,
  locatedCell,
  splitCells,
  TABLE_MIN_COLUMNS,
  TABLE_MIN_ROWS,
  TABLE_MIN_TRACK_GAP_FLOOR_PT,
  TABLE_MIN_TRACK_GAP_FONT_MULT,
} from "../borderless/index.js";
import type { TableRun } from "../types.js";
import {
  TABLE_CLUSTER_MAX_FAILED_ROW_FRAC,
  TABLE_CLUSTER_MAX_INTERSTITIAL_LINES,
  TABLE_MERGE_MAX_Y_GAP_LINES,
  TABLE_SUBSET_TRACK_TOLERANCE_PT,
} from "./constants.js";
import { matchingTrackCount, runBodyTracks, runColumnCount } from "./track-match.js";
import { unionHeaderFromAbove } from "./union-header.js";

function emptyCell(): Cell {
  return { text: "", bbox: null, text_item_indices: [] };
}

/** `[header present, row count]` of a `Table` run, or null for any other block. */
function tableShape(run: TableRun): [boolean, number] | null {
  const b = run.block;
  if (typeof b === "string" || !("Table" in b)) return null;
  return [b.Table.header != null, b.Table.rows.length];
}

export function clusterAdjacent(a: TableRun, b: TableRun, lines: ProjectedLine[]): boolean {
  const aShape = tableShape(a);
  if (aShape == null) return false;
  const bShape = tableShape(b);
  if (bShape == null) return false;
  const [aHeader, aRowsLen] = aShape;
  const [bHeader, bRowsLen] = bShape;
  if (Math.max(b.start - a.end, 0) > TABLE_CLUSTER_MAX_INTERSTITIAL_LINES) return false;
  if (a.end === 0 || a.end > lines.length || b.start >= lines.length) return false;
  const aLast = lines[a.end - 1];
  const bFirst = lines[b.start];
  const lineHeight = Math.max(aLast.bbox.height, bFirst.bbox.height, 1.0);
  const gap = f32(bFirst.bbox.y - f32(aLast.bbox.y + aLast.bbox.height));
  if (gap > f32(lineHeight * TABLE_MERGE_MAX_Y_GAP_LINES) || gap < -lineHeight) return false;
  // Two complete-looking tables (both with explicit headers and real bodies)
  // separated by a visible gap are most likely genuinely separate tables.
  const bothComplete = aHeader && bHeader && aRowsLen >= 3 && bRowsLen >= 3;
  if (bothComplete && gap > lineHeight) return false;
  // Track compatibility: fragments of one table share column geometry (the
  // narrower fragment's tracks are a subset of the wider one's), while two
  // genuinely different stacked tables do not. Require >= 75% of the narrower
  // run's tracks to align to the wider run's tracks.
  const aTracks = runBodyTracks(a, lines);
  const bTracks = runBodyTracks(b, lines);
  // Inferred-path runs often have no line whose split_cells count matches the
  // declared column count, so tracks can't be re-derived. Stay permissive:
  // build_union_table's own soundness guards still gate the actual merge.
  if (aTracks == null || bTracks == null) return true;
  const [matched, total] = matchingTrackCount(aTracks, bTracks);
  return matched >= f32(total * f32(0.75));
}

/**
 * Union column tracks across a window: every row with >= 2 gap-split cells
 * contributes its cell start-x positions; positions cluster at the subset
 * tolerance. Cells (not raw spans) are the unit here: multi-word cell content
 * emits several PDFium spans whose x positions are word starts, not column
 * starts, and would shred the track set.
 */
export function unionTracksInWindow(
  lines: ProjectedLine[],
  start: number,
  end: number
): Array<[number, number]> {
  const xs: number[] = [];
  for (const line of lines.slice(start, Math.min(end, lines.length))) {
    const cells = splitCells(line);
    if (cells.length >= 2) xs.push(...cells.map((c) => c.start_x));
  }
  xs.sort(totalCmp);
  const clusters: Array<[number, number]> = [];
  let currentSum = 0.0;
  let currentCount = 0;
  let currentAnchor = -Infinity;
  for (const x of xs) {
    // Looser tolerance than the per-run paths: center-aligned columns jitter
    // their cell start-x by the half-width difference of their content (+-10pt
    // is routine); near-duplicate tracks get coalesced by the caller.
    if (currentCount === 0 || Math.abs(f32(x - currentAnchor)) <= TABLE_SUBSET_TRACK_TOLERANCE_PT) {
      currentSum = f32(currentSum + x);
      currentCount += 1;
      currentAnchor = f32(currentSum / f32(currentCount));
    } else {
      clusters.push([f32(currentSum / f32(currentCount)), currentCount]);
      currentSum = x;
      currentCount = 1;
      currentAnchor = x;
    }
  }
  if (currentCount > 0) clusters.push([f32(currentSum / f32(currentCount)), currentCount]);
  return clusters;
}

/**
 * Bin a line into the union tracks via its gap-split cells when the raw-span
 * path fails: each cell maps to the nearest track (by start-x, within the
 * loose subset tolerance) and all cells must map to distinct tracks. Unlike
 * the body-detection paths this accepts 1-cell rows: inside a confirmed table
 * cluster a lone label at a track is a sparse row, not prose.
 */
export function sparseRowViaCells(line: ProjectedLine, tracks: number[]): Cell[] | null {
  const cells = splitCells(line);
  if (cells.length === 0) return null;
  const tol = TABLE_SUBSET_TRACK_TOLERANCE_PT;
  const mapping: number[] = [];
  for (const c of cells) {
    let idx = -1;
    let dist = Infinity;
    tracks.forEach((t, i) => {
      const d = Math.abs(f32(c.start_x - t));
      if (idx < 0 || totalCmp(d, dist) < 0) {
        idx = i;
        dist = d;
      }
    });
    if (idx < 0) return null;
    if (dist > tol) return null;
    mapping.push(idx);
  }
  if (new Set(mapping).size !== mapping.length) return null;
  const row: Cell[] = Array.from({ length: tracks.length }, emptyCell);
  cells.forEach((c, i) => {
    row[mapping[i]] = locatedCell(c, line);
  });
  return row;
}

/** Union tracks of a window that carry enough support, coalesced across sub-gutter distances. */
function coalescedTracks(lines: ProjectedLine[], windowStart: number, windowEnd: number): number[] {
  const supported = unionTracksInWindow(lines, windowStart, windowEnd);
  // Drop low-support tracks: a column that only 1-2 cells across the whole
  // cluster ever start at is noise (wrapped-cell continuation indents,
  // intra-cell splits on widely-tracked text), not a real column.
  const windowLen = windowEnd - windowStart;
  const minSupport = Math.max(2, Math.floor(windowLen / 10));
  const kept = supported.filter(([, n]) => n >= minSupport);
  // Coalesce adjacent tracks closer than a real column gutter: these are
  // start-x jitter of one center-aligned column (content of different widths),
  // not two columns.
  const fontSizes = lines
    .slice(windowStart, windowEnd)
    .map((l) => (l.dominant_font_size > 0.0 ? l.dominant_font_size : Math.max(l.bbox.height, 1.0)));
  fontSizes.sort(totalCmp);
  const medianFont = fontSizes[Math.floor(fontSizes.length / 2)];
  const minTrackGap = Math.max(
    f32(medianFont * TABLE_MIN_TRACK_GAP_FONT_MULT),
    TABLE_MIN_TRACK_GAP_FLOOR_PT
  );
  const coalesced: Array<[number, number]> = [];
  for (const [t, n] of kept) {
    const last = coalesced[coalesced.length - 1];
    if (last != null && f32(t - last[0]) < minTrackGap) {
      // Support-weighted midpoint keeps the anchor near the dominant alignment.
      last[0] = f32(f32(f32(last[0] * f32(last[1])) + f32(t * f32(n))) / f32(last[1] + n));
      last[1] += n;
    } else {
      coalesced.push([t, n]);
    }
  }
  return coalesced.map(([t]) => t);
}

/**
 * Re-extract a cluster of adjacent table runs as one table against the union
 * track set. Returns null (leaving the original runs untouched) when the union
 * tracks are unsound or too many lines fail to bin.
 */
export function buildUnionTable(
  cluster: TableRun[],
  lines: ProjectedLine[],
  floor: number
): TableRun | null {
  if (cluster.length === 0) return null;
  const windowStart = cluster[0].body_start;
  const windowEnd = Math.min(cluster[cluster.length - 1].end, lines.length);
  if (windowStart >= windowEnd) return null;
  const tracks = coalescedTracks(lines, windowStart, windowEnd);
  if (tracks.length < TABLE_MIN_COLUMNS) return null;
  // The union must be at least as wide as the widest fragment: otherwise
  // re-extraction would lose columns the per-run detection already found (and a
  // word-gap prose union that coalesced to nothing lands here too).
  const runCols = cluster.map(runColumnCount).filter((n): n is number => n != null);
  if (runCols.length === 0) return null;
  if (tracks.length < Math.max(...runCols)) return null;

  // NOTE: no vertical wrap-merge here. Gap-based merging of multi-line cells
  // doesn't work: inside uniformly-leaded tables the gap between a wrapped cell
  // line and a genuine next row is identical. Re-extracted clusters keep one
  // row per line; multi-line-cell recovery needs a stronger signal.
  const rows: Cell[][] = [];
  let failedCount = 0;
  for (const line of lines.slice(windowStart, windowEnd)) {
    const cells = cellsFromRawItemsWithTracks(line, tracks);
    if (cells != null) {
      if (cells.some((c) => c.text !== "")) rows.push(cells.map((c) => locatedCell(c, line)));
      continue;
    }
    const sparse = sparseRowViaCells(line, tracks);
    if (sparse != null) {
      rows.push(sparse);
      continue;
    }
    // The line couldn't bin but still carries content: keep its full text as a
    // column-0 row rather than dropping it. Counted toward the abort threshold.
    failedCount += 1;
    const text = trim(line.text);
    if (text !== "") {
      // Kept whole in column 0; it occupies the entire line, so that is the cell's box.
      const row: Cell[] = Array.from({ length: tracks.length }, emptyCell);
      row[0] = cellSourced(collapseWhitespace(text), line.bbox, lineItemsInReadingOrder(line));
      rows.push(row);
    }
  }
  const windowLen = windowEnd - windowStart;
  if (failedCount > f32(windowLen * TABLE_CLUSTER_MAX_FAILED_ROW_FRAC)) return null;
  if (rows.length < TABLE_MIN_ROWS) return null;

  const trackRanges = tracks.map((t): [number, number] => [t, t]);
  const absorbed = unionHeaderFromAbove(lines, windowStart, floor, trackRanges, false);
  const [start, header, interstitials] = absorbed ?? [windowStart, null, []];
  return {
    start,
    end: windowEnd,
    body_start: windowStart,
    // Fragments' own interstitials are not carried over: the union span starts
    // at the first fragment's body and `union_header_from_above` stops at
    // prose, so any stepped-over line lands outside the new span and is
    // classified normally.
    interstitials,
    item_indices: [],
    bbox: linesBbox(lines, start, windowEnd),
    block: { Table: { header, rows } },
  };
}

export function mergeFragmentedTableClusters(runs: TableRun[], lines: ProjectedLine[]): TableRun[] {
  if (runs.length < 2) return runs;
  const out: TableRun[] = [];
  let i = 0;
  while (i < runs.length) {
    let j = i + 1;
    while (j < runs.length && clusterAdjacent(runs[j - 1], runs[j], lines)) j += 1;
    if (j - i >= 2) {
      const floor = out.length > 0 ? out[out.length - 1].end : 0;
      const merged = buildUnionTable(runs.slice(i, j), lines, floor);
      if (merged != null) {
        out.push(merged);
        i = j;
        continue;
      }
    }
    // `runs` is consumed by the caller, so the run moves rather than copies.
    out.push(runs[i]);
    i += 1;
  }
  return out;
}
