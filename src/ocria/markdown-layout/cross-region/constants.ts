// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/cross_region.rs (crates-v2.21.2, Apache-2.0): thresholds.

import { f32 } from "../../rust.js";

/**
 * Minimum fraction of the smaller side's y-band that must overlap the other
 * side's. Side-by-side table halves overlap almost fully; a sidebar next to
 * the tail of a column does not.
 */
export const CR_MIN_Y_OVERLAP_FRAC = 0.5;
/** Minimum horizontal gap between the two sides (the sliced gutter). */
export const CR_MIN_COL_GAP_PT = 8.0;
/** Baseline-cluster tolerance as a fraction of the median line height. */
export const CR_ROW_TOL_FACTOR: number = f32(0.6);
/** At least this many baselines must align across the cut. */
export const CR_MIN_ALIGNED_ROWS = 3;
/** ...and they must account for this fraction of the sparser side's lines. */
export const CR_MIN_ALIGNED_FRAC: number = f32(0.4);
/** A side "looks like prose" when it has at least this many lines... */
export const CR_PROSE_MIN_LINES = 3;
/** ...whose median width fills this fraction of the side's width... */
export const CR_PROSE_WIDTH_FRAC: number = f32(0.7);
/** ...and whose summed line heights fill this fraction of the y-band. */
export const CR_PROSE_VFILL: number = f32(0.55);
/**
 * A single leaf judged as prose (see the per-leaf gate) needs a median line of
 * this many characters: table cells ("1,644,143", "Rooms Occupied") stay under
 * it, a narrow newsletter column's lines run 20 and more.
 */
export const CR_PROSE_LEAF_MIN_CHARS = 16.0;
/**
 * A prose side is dominated by single-cell lines: when this fraction or more of
 * a side's lines split into >= 2 cells, it's a sliced table half (row
 * fragments with internal column gaps), not flowing text.
 */
export const CR_PROSE_MAX_MULTI_CELL_FRAC: number = f32(0.3);
/** Validation A: the detected table run(s) must cover this fraction of the fused lines. */
export const CR_VALIDATE_MIN_COVERAGE: number = f32(0.6);
/**
 * Validation A: reject a detected run when more than this fraction of its
 * non-empty cells run >= `CR_LONG_CELL_WORDS` words. Fused newspaper /
 * reference columns align into convincing grids, but their "cells" are
 * sentence fragments; real table cells are short.
 */
export const CR_VALIDATE_MAX_LONG_CELL_FRAC: number = f32(0.3);
export const CR_LONG_CELL_WORDS = 5;
/** Direct 2-col path: max chars for a left-column label cell. */
export const CR_LABEL_MAX_CHARS = 60;
/** Direct 2-col path: minimum row count. */
export const CR_TWO_COL_MIN_ROWS = 3;
/**
 * A left-side line continues the previous row's label when its top is within
 * this multiple of line height of the previous label line's bottom.
 */
export const CR_LABEL_WRAP_GAP_FACTOR = 1.5;
/** Maximum x-overlap between sibling V-cut slices, as a fraction of the narrower side's width. */
export const CR_SIBLING_MAX_X_OVERLAP_FRAC: number = f32(0.4);
