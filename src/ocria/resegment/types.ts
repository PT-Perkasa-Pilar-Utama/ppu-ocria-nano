// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/resegment.rs (crates-v2.21.2, Apache-2.0): constants and shared types.

import { f32 } from "../rust.js";
import { samePath } from "../table-model/signals.js";
import type { ProjectedLine } from "../types/page.js";

/**
 * Minimum horizontal gap between two spans, in multiples of the line's font size, for a block change
 * to count as a gutter (a word space is ~0.25-0.33 em).
 */
export const GUTTER_EM: number = f32(0.5);
/** Lines a model block must hold within one leaf to count as a column for reordering. */
export const MIN_COLUMN_LINES = 3;
/**
 * A block at most this share of the text's width whose words are this share numbers / times is a
 * margin of line numbers, schedule times or page numbers, not a column ("19 20 21 ...", "14:00-14:10").
 */
export const MARGINAL_MAX_WIDTH: number = f32(0.15);
export const MARGINAL_MIN_NUMERIC: number = f32(0.8);

/** `f32::MAX`. */
export const F32_MAX = 3.4028234663852886e38;

/** A line with the model block holding most of its spans (null: none). */
export type LineBlock = { line: ProjectedLine; block: number | null };

/** A leaf's lines `[from, to)` in a run of lines sharing one region path. */
export type LeafRun = { from: number; to: number };

/** The runs of consecutive lines with the same region path. */
export function leafRuns(out: readonly LineBlock[]): LeafRun[] {
  const runs: LeafRun[] = [];
  let i = 0;
  while (i < out.length) {
    const path = out[i].line.region_path;
    let j = i + 1;
    while (j < out.length && samePath(out[j].line.region_path, path)) j += 1;
    runs.push({ from: i, to: j });
    i = j;
  }
  return runs;
}
