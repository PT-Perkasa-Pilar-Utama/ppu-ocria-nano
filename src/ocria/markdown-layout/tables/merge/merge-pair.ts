// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): cross-run merging (post-pass over `detect_tables` output).

// `try_detect_table` walks lines top-to-bottom and breaks the run whenever the
// column count or track alignment changes. That breaks two common shapes into
// separate runs:
//
//   B1: multi-line header with row-label column missing. The header rows have
//       N cells aligned to body tracks 2..N+1; the body rows have N+1 cells
//       including a leading row-label.
//   B4: a single table interrupted by a category divider that fragments it
//       into two sibling runs with identical column structure.
//
// The pass walks adjacent run pairs and merges them when they're vertically
// immediate, reasonably close in y, and share either identical tracks (Case
// Same) or A's tracks are a 1-column-shorter subset of B's tracks (Case
// Subset). Subset merges fold A into B's header.
//
// Guards:
//   - Only merge `Table` pairs (skip `GridFallback`).
//   - A's body row count is capped (`TABLE_HEADER_MAX_ABSORB_ROWS`).
//   - Vertical gap between A's last line and B's first line is capped by a
//     small multiple of the line height.

import { utf8Len } from "../../../rust-extra.js";
import { chars, f32, trim } from "../../../rust.js";
import { rectExtend } from "../../../types/geometry.js";
import type { Rect } from "../../../types/geometry.js";
import type { ProjectedLine } from "../../../types/page.js";
import type { Cell } from "../../block-types.js";
import { lineCell, linesBbox, splitCells } from "../borderless/index.js";
import type { TableRun } from "../types.js";
import {
  TABLE_HEADER_MAX_ABSORB_ROWS,
  TABLE_MERGE_MAX_INTERSTITIAL,
  TABLE_MERGE_MAX_INTERSTITIAL_CHARS,
  TABLE_MERGE_MAX_Y_GAP_LINES,
} from "./constants.js";
import {
  padRowToLayout,
  runBodyTracks,
  runColumnCount,
  subsetMapping,
  tracksAlignSame,
} from "./track-match.js";

function emptyCell(): Cell {
  return { text: "", bbox: null, text_item_indices: [] };
}

export function isAbsorbableInterstitial(line: ProjectedLine): boolean {
  const cells = splitCells(line);
  if (cells.length > 1) return false;
  const text = trim(line.text);
  const len = utf8Len(text);
  if (len > TABLE_MERGE_MAX_INTERSTITIAL_CHARS) return false;
  // Reject sentence-shaped prose: ends in . ! ? (a real label rarely does).
  const cs = chars(text);
  const last = cs[cs.length - 1];
  if ((last === "." || last === "!" || last === "?") && len > 6) return false;
  return true;
}

/** The table block of a run, or null for any other block kind. */
function tableParts(run: TableRun): { header: Cell[] | null; rows: Cell[][] } | null {
  const b = run.block;
  if (typeof b === "string" || !("Table" in b)) return null;
  return structuredClone(b.Table);
}

/** One header cell per column, built by stacking `layers` top to bottom. */
function stackHeader(layers: Cell[][], cols: number): Cell[] {
  const header: Cell[] = [];
  for (let col = 0; col < cols; col++) {
    const parts: string[] = [];
    let bbox: Rect | null = null;
    const textItemIndices: number[] = [];
    for (const layer of layers) {
      const cell = layer[col];
      if (cell == null) continue;
      // Union every contributing layer's box, including ones whose text
      // de-duplicates away, so the merged header cell still covers the full
      // stacked band it was built from.
      if (cell.bbox != null) bbox = rectExtend(bbox ?? undefined, cell.bbox);
      textItemIndices.push(...cell.text_item_indices);
      const s = cell.text;
      if (s === "" || parts[parts.length - 1] === s) continue;
      parts.push(s);
    }
    header.push({ text: parts.join(" "), bbox, text_item_indices: textItemIndices });
  }
  return header;
}

export function tryMergePair(a: TableRun, b: TableRun, lines: ProjectedLine[]): TableRun | null {
  // Allow up to `TABLE_MERGE_MAX_INTERSTITIAL` short label lines between A's
  // end and B's start. Each interstitial gets preserved as a body row of the
  // merged table so no content is dropped.
  const interstitial = Math.max(b.start - a.end, 0);
  if (interstitial > TABLE_MERGE_MAX_INTERSTITIAL) return null;
  // Absorbed label lines become single-cell body rows; each keeps the box of
  // the line it came from so the merged table's geometry stays complete.
  let interstitialTexts: Cell[] = [];
  if (interstitial !== 0) {
    const slice = lines.slice(a.end, b.start);
    if (!slice.every(isAbsorbableInterstitial)) return null;
    interstitialTexts = slice.map(lineCell);
  }
  const aParts = tableParts(a);
  if (aParts == null) return null;
  const bParts = tableParts(b);
  if (bParts == null) return null;
  const { header: aHeader, rows: aRows } = aParts;
  const { header: bHeader, rows: bRows } = bParts;
  const aCols = runColumnCount(a);
  const bCols = runColumnCount(b);
  if (aCols == null || bCols == null) return null;
  const aTracks = runBodyTracks(a, lines);
  const bTracks = runBodyTracks(b, lines);
  if (aTracks == null || bTracks == null) return null;

  if (a.end === 0 || a.end > lines.length || b.start >= lines.length) return null;
  const aLast = lines[a.end - 1];
  const bFirst = lines[b.start];
  const lineHeight = Math.max(aLast.bbox.height, bFirst.bbox.height, 1.0);
  const gap = f32(bFirst.bbox.y - f32(aLast.bbox.y + aLast.bbox.height));
  if (gap > f32(lineHeight * TABLE_MERGE_MAX_Y_GAP_LINES)) return null;
  if (gap < -lineHeight) return null;

  // Case Same: identical tracks, concat rows.
  if (aCols === bCols && tracksAlignSame(aTracks, bTracks)) {
    // Don't merge two complete-looking tables across a noticeable gap.
    const bothComplete =
      aHeader != null && bHeader != null && aRows.length >= 3 && bRows.length >= 3;
    if (bothComplete && gap > f32(lineHeight * 1.0)) return null;
    const header = aHeader ?? bHeader;
    const rows = [...aRows];
    // Preserve interstitial label lines as body rows, content in col 0.
    for (const text of interstitialTexts) {
      const row = Array.from({ length: bCols }, emptyCell);
      row[0] = structuredClone(text);
      rows.push(row);
    }
    // If both runs had explicit headers, we kept A's; preserve B's header text
    // as a body row so its content isn't dropped.
    if (aHeader != null && bHeader != null) rows.push(structuredClone(bHeader));
    rows.push(...bRows);
    return {
      start: a.start,
      end: b.end,
      body_start: a.body_start,
      // The merged run spans both source runs and anything absorbed between them.
      bbox: linesBbox(lines, a.start, b.end),
      block: { Table: { header, rows } },
      interstitials: structuredClone([...a.interstitials, ...b.interstitials]),
      item_indices: [],
    };
  }

  // Case Subset: A has 1 fewer column; fold A into B's header.
  if (aCols + 1 === bCols && aRows.length <= TABLE_HEADER_MAX_ABSORB_ROWS) {
    const mapping = subsetMapping(aTracks, bTracks);
    if (mapping == null) return null;

    // Compose header rows top-to-bottom: A.header -> A.rows -> B.header.
    const headerLayers: Cell[][] = [];
    if (aHeader != null) headerLayers.push(padRowToLayout(aHeader, mapping, bCols));
    for (const row of aRows) headerLayers.push(padRowToLayout(row, mapping, bCols));
    if (bHeader != null) headerLayers.push(bHeader);
    if (headerLayers.length === 0) return null;
    const mergedHeader = stackHeader(headerLayers, bCols);
    // Preserve interstitial label lines as body rows ahead of B's rows.
    const mergedRows: Cell[][] = [];
    for (const text of interstitialTexts) {
      const row = Array.from({ length: bCols }, emptyCell);
      row[0] = structuredClone(text);
      mergedRows.push(row);
    }
    mergedRows.push(...bRows);
    return {
      start: a.start,
      end: b.end,
      bbox: linesBbox(lines, a.start, b.end),
      // A was folded into B's header, so the merged table's body begins where
      // B's body did.
      body_start: b.body_start,
      block: { Table: { header: mergedHeader, rows: mergedRows } },
      interstitials: structuredClone([...a.interstitials, ...b.interstitials]),
      item_indices: [],
    };
  }

  return null;
}

export function mergeConsecutiveTableRuns(runs: TableRun[], lines: ProjectedLine[]): TableRun[] {
  if (runs.length < 2) return runs;
  const out: TableRun[] = [];
  for (const run of runs) {
    const prev = out[out.length - 1];
    if (prev != null) {
      const merged = tryMergePair(prev, run, lines);
      if (merged != null) {
        out.pop();
        out.push(merged);
        continue;
      }
    }
    out.push(run);
  }
  return out;
}
