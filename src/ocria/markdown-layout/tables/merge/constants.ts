// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): description-list and run-merge constants.

import { f32 } from "../../../rust.js";

export const DESC_LIST_MIN_ROWS = 2;
export const DESC_LIST_LABEL_MAX_CHARS = 40;
export const DESC_LIST_LABEL_MAX_WORDS = 4;
export const DESC_LIST_TRACK_TOL_PT = 8.0;
export const DESC_LIST_MIN_COL_GAP_PT = 12.0;

/**
 * A run with this many or fewer body rows can be folded as header content of
 * a following table. Above this we treat A as its own complete table.
 */
export const TABLE_HEADER_MAX_ABSORB_ROWS = 3;

/**
 * Cap on the y-gap between two consecutive runs for them to be merge
 * candidates, in multiples of line height. Larger gaps mean visually
 * distinct tables.
 */
export const TABLE_MERGE_MAX_Y_GAP_LINES = 2.0;

/** Max non-table lines between two runs for them to join one cluster. */
export const TABLE_CLUSTER_MAX_INTERSTITIAL_LINES = 2;

/** Abort the cluster merge when more than this fraction of the window's lines can't be binned. */
export const TABLE_CLUSTER_MAX_FAILED_ROW_FRAC: number = f32(0.3);

/** Max header lines walked above the cluster body by the union header pass. */
export const TABLE_CLUSTER_MAX_HEADER_LINES = 4;

/**
 * Looser tolerance for cross-run subset matching. Header cells and body
 * cells often have different content widths (e.g. `(percent)` header is
 * 65pt wide while the body's `12` is 10pt wide), so the per-row track
 * tolerance is too tight here. Combined with the interior-only center
 * check in `subset_match_score`, this stays conservative.
 */
export const TABLE_SUBSET_TRACK_TOLERANCE_PT = 12.0;

/**
 * Maximum number of non-table lines allowed between two runs being merged.
 * Each interstitial line must be a short single-cell label (category
 * divider, group header) to qualify.
 */
export const TABLE_MERGE_MAX_INTERSTITIAL = 1;

/** Cap on the character count of an interstitial label line that the merge will absorb as a body row. */
export const TABLE_MERGE_MAX_INTERSTITIAL_CHARS = 60;
