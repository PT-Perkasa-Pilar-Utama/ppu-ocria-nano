// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): ruled-grid constants.

import { f32 } from "../../../rust.js";

/**
 * Cluster tolerance for ruled column boundaries. Wider than
 * `TABLE_GRID_CLUSTER_PT` because adjacent cell-border rects draw paired
 * edges 4-6pt apart; real columns are >= ~10pt wide so the mean-centered
 * merge cannot eat a genuine narrow column.
 */
export const TABLE_COL_BOUNDARY_CLUSTER_PT = 6.0;

/**
 * Reject ruled-table candidates whose empty-cell fraction exceeds this.
 * This can't be loosened to recover blank worksheets/forms: a real sparse
 * table (e.g. a 4-col version history, ~75% empty) and a spurious grid from
 * decorative layout boxes (e.g. a TOC, also ~75% empty) are indistinguishable
 * on empty-fraction, and relaxing it surfaces more false tables than real
 * forms recovered.
 */
export const TABLE_MAX_EMPTY_CELL_FRACTION: number = f32(0.3);

/**
 * Fraction of a row or column that must be populated to qualify the grid as
 * a structural fill-in form (e.g. comparison charts with row labels + header
 * row but otherwise empty cells). When this signature is met, the empty-cell
 * fraction filter relaxes to `TABLE_MAX_EMPTY_CELL_FRACTION_WITH_SPINE`.
 */
export const TABLE_SPINE_FILL_FRACTION: number = f32(0.7);

/**
 * Max characters in any single col-0 or row-0 cell when applying the spine
 * bypass. Real labels and headers are short (1-5 words ~ 50 chars); a column
 * of multi-sentence prose triggers `col0_fill` but isn't a structural label
 * column.
 */
export const TABLE_SPINE_MAX_CELL_CHARS = 60;

/**
 * Ceiling on empty-cell fraction even when a spine is detected. Caps how
 * aggressively the fill-in-form bypass can override the base filter: past
 * 75% empty, even a strong spine isn't enough to distinguish from decorative
 * page chrome.
 */
export const TABLE_MAX_EMPTY_CELL_FRACTION_WITH_SPINE: number = f32(0.75);

/**
 * Global-pass only: minimum fraction of the column extent a horizontal rule
 * must span to count as a row boundary. A full-height left/right border can
 * union a stray box (logo, sidebar) into a grid component through the shared
 * vertical line; that box's short rules would otherwise become phantom top
 * rows that vacuum surrounding prose into the table. Real row boundaries span
 * most of the table width.
 */
export const RULED_HLINE_MIN_COVERAGE: number = f32(0.5);

/**
 * Minimum fraction of the component's row extent a vertical rule must span to
 * count as a column boundary, the mirror image of `RULED_HLINE_MIN_COVERAGE`.
 *
 * Slide decks routinely draw a table as one stroked rect per cell, so a single
 * decorative highlight box behind a phrase *inside* a cell contributes a pair
 * of vertical edges that split that column in two for the whole table.
 * `collapseGutterColumns` can't fuse the sliver back because text centres do
 * land inside it.
 *
 * Kept well below the horizontal counterpart: a genuine divider that rules only
 * the header band of an otherwise open table is a real layout, and must survive.
 */
export const RULED_VLINE_MIN_COVERAGE: number = f32(0.2);

/** Which ruled-table pass is running (the global pass applies extra filtering). */
export type RuledPass = "PerRegion" | "Global";
