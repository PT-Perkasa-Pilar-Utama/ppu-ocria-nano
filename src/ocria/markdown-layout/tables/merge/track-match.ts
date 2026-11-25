// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): column-track derivation and matching across runs.

import { f32, trim } from "../../../rust.js";
import type { ProjectedLine } from "../../../types/page.js";
import type { Cell } from "../../block-types.js";
import { splitCells, TABLE_TRACK_TOLERANCE_PT } from "../borderless/index.js";
import type { TableRun } from "../types.js";
import { TABLE_SUBSET_TRACK_TOLERANCE_PT } from "./constants.js";

/** A column track: `[start_x, end_x]`. */
export type Track = [number, number];

export function runColumnCount(run: TableRun): number | null {
  const b = run.block;
  if (typeof b === "string" || !("Table" in b)) return null;
  const { header, rows } = b.Table;
  if (header != null) return header.length;
  return rows.length > 0 ? rows[0].length : null;
}

/** Re-derive column tracks from source lines for adjacency and table merging. */
export function runBodyTracks(run: TableRun, lines: ProjectedLine[]): Track[] | null {
  const nCols = runColumnCount(run);
  if (nCols == null) return null;
  let acc: Track[] | null = null;
  for (const line of lines.slice(run.start, Math.min(run.end, lines.length))) {
    const cells = splitCells(line);
    if (cells.length !== nCols) continue;
    const row: Track[] = cells.map((c) => [c.start_x, c.end_x]);
    acc =
      acc == null
        ? row
        : acc.map(([ps, pe], i): Track => [Math.min(ps, row[i][0]), Math.max(pe, row[i][1])]);
  }
  return acc;
}

function widen(range: Track | null, add: Track): Track {
  if (range == null) return add;
  return [Math.min(range[0], add[0]), Math.max(range[1], add[1])];
}

/**
 * Re-derive cross-region header tracks from located body cells where possible,
 * falling back to source lines.
 */
export function crossRegionHeaderTracks(run: TableRun, lines: ProjectedLine[]): Track[] | null {
  const nCols = runColumnCount(run);
  if (nCols == null) return null;
  const acc: Array<Track | null> = Array.from({ length: nCols }, () => null);
  const b = run.block;
  if (typeof b !== "string" && "Table" in b) {
    for (const row of b.Table.rows.filter((r) => r.length === nCols)) {
      row.forEach((cell: Cell, idx) => {
        if (trim(cell.text) === "") return;
        const bbox = cell.bbox;
        if (bbox == null) return;
        acc[idx] = widen(acc[idx], [bbox.x, f32(bbox.x + bbox.width)]);
      });
    }
  }
  for (const line of lines.slice(run.body_start, Math.min(run.end, lines.length))) {
    const cells = splitCells(line);
    if (cells.length !== nCols) continue;
    cells.forEach((cell, idx) => {
      acc[idx] = widen(acc[idx], [cell.start_x, cell.end_x]);
    });
  }
  if (!acc.some((r) => r != null)) return null;
  return acc.map((r): Track => r ?? [Infinity, -Infinity]);
}

/**
 * Score the alignment between two tracks. Returns null if they don't align.
 * Distance is `min(start_diff, end_diff, center_interior_match)` so a header
 * cell sitting at the edge of a wide body cell doesn't spuriously match.
 */
export function subsetMatchScore(ta: Track, tb: Track, tol: number): number | null {
  const dStart = Math.abs(f32(ta[0] - tb[0]));
  const dEnd = Math.abs(f32(ta[1] - tb[1]));
  const ca = f32(f32(ta[0] + ta[1]) * 0.5);
  // Center-in-range only counts when a's center falls in b's interior half:
  // guards against a narrow header touching the edge of a wide row-label cell.
  const interiorLo = f32(tb[0] + f32(f32(tb[1] - tb[0]) * 0.25));
  const interiorHi = f32(tb[1] - f32(f32(tb[1] - tb[0]) * 0.25));
  const dCenter = ca >= interiorLo && ca <= interiorHi ? 0.0 : Infinity;
  const d = Math.min(dStart, dEnd, dCenter);
  return d <= tol ? d : null;
}

export function matchingTrackCount(a: Track[], b: Track[]): [number, number] {
  const [narrow, wide] = a.length <= b.length ? [a, b] : [b, a];
  const matched = narrow.filter((track) =>
    wide.some((other) => subsetMatchScore(track, other, TABLE_SUBSET_TRACK_TOLERANCE_PT) != null)
  ).length;
  return [matched, narrow.length];
}

export function tracksAlignSame(a: Track[], b: Track[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((ta, i) => {
    const tb = b[i];
    const ca = f32(f32(ta[0] + ta[1]) * 0.5);
    const cb = f32(f32(tb[0] + tb[1]) * 0.5);
    return Math.abs(f32(ca - cb)) <= TABLE_TRACK_TOLERANCE_PT;
  });
}

/**
 * Map A's tracks to B's tracks (requires `|A| + 1 == |B|`). Tries every
 * possible "skip one B column" assignment and picks the lowest-total-error
 * option. Returns null when no skip yields a fully-aligned mapping.
 */
export function subsetMapping(a: Track[], b: Track[]): number[] | null {
  if (a.length + 1 !== b.length) return null;
  const tol = TABLE_SUBSET_TRACK_TOLERANCE_PT;
  let best: [number[], number] | null = null;
  for (let skip = 0; skip < b.length; skip++) {
    const mapping: number[] = [];
    let total = 0.0;
    let ok = true;
    for (let i = 0; i < a.length; i++) {
      const bi = i < skip ? i : i + 1;
      const d = subsetMatchScore(a[i], b[bi], tol);
      if (d == null) {
        ok = false;
        break;
      }
      mapping.push(bi);
      total = f32(total + d);
    }
    if (ok && (best == null || total < best[1])) best = [mapping, total];
  }
  return best == null ? null : best[0];
}

/**
 * Insert empty strings into `row` so that its content lands at the mapped
 * columns in a `targetLen`-wide row. Padding cells are pure layout filler and
 * stay geometry-less; the real cells carry their boxes across into the new
 * column positions.
 */
export function padRowToLayout(row: Cell[], mapping: number[], targetLen: number): Cell[] {
  const out: Cell[] = Array.from({ length: targetLen }, () => ({
    text: "",
    bbox: null,
    text_item_indices: [],
  }));
  mapping.forEach((bIdx, aIdx) => {
    if (bIdx < targetLen && aIdx < row.length) out[bIdx] = structuredClone(row[aIdx]);
  });
  return out;
}
