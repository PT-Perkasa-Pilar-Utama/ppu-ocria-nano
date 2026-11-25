// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): borderless table-detection constants.

import { f32 } from "../../../rust.js";

/** Minimum cells per row for a region to qualify as a table. */
export const TABLE_MIN_COLUMNS = 3;

/** Minimum consecutive rows for a region to qualify as a table. */
export const TABLE_MIN_ROWS = 2;

/** Gap between adjacent spans (multiples of the dominant font size) above which the gap is a cell boundary. */
export const TABLE_CELL_GAP_FONT_MULTIPLIER = 1.0;

/** Tolerance (points) for matching a cell's start-x to an existing column track. */
export const TABLE_TRACK_TOLERANCE_PT = 6.0;

/**
 * Minimum gap (multiples of the dominant font size) between two adjacent column tracks for them to
 * count as distinct columns. Inferred-track detection and the ruled-grid track derivation must use
 * the same value or one stage can fuse columns the other split.
 */
export const TABLE_MIN_TRACK_GAP_FONT_MULT = 1.5;
/** Absolute floor (points) on the inter-track gap, paired with `TABLE_MIN_TRACK_GAP_FONT_MULT`. */
export const TABLE_MIN_TRACK_GAP_FLOOR_PT = 12.0;

/** Minimum fraction of a row's cells that must carry text to anchor the header/body split in ruled-grid collapse. */
export const TABLE_ROW_MIN_FILL: number = f32(0.9);

/** Two horizontal rules closer than this bound a heading underline or a boxed caption, not a table body. */
export const RULE_BAND_MIN_HEIGHT_PT = 10.0;

/** A rule band with fewer lines than this is a rule under a heading or hyperlink underlines. */
export const RULE_BAND_MIN_LINES = 3;

/** Floor for the sparse-new-row path: a partial-cell line whose bottom-gap exceeds this fraction is a new row. */
export const TABLE_SPARSE_ROW_MIN_BOTTOM_GAP_FRAC: number = f32(0.5);

/** Maximum vertical gap between consecutive table rows, in multiples of the line height. */
export const TABLE_ROW_GAP_MULTIPLIER = 2.5;

/** Maximum coefficient-of-variation for row spacing within a confident table. */
export const TABLE_ROW_SPACING_MAX_CV: number = f32(0.5);

/** Minimum ratio between the smallest "wide" inter-word gap and the largest ordinary one. */
export const SPAN_GUTTER_MIN_RATIO = 2.5;

/** Absolute floor (points) on a gap treated as an in-span column gutter. */
export const SPAN_GUTTER_MIN_PT = 3.0;

/** Floor on the ordinary side of the bimodality ratio, as a fraction of the run's font size. */
export const SPAN_GUTTER_MIN_ORDINARY_EM: number = f32(0.2);

/** Maximum number of rows to walk forward when inferring tracks from raw item positions. */
export const TABLE_TRACK_INFERENCE_MAX_ROWS = 12;
