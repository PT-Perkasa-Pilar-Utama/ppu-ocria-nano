// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/figure_cluster.rs (crates-v2.21.2, Apache-2.0): thresholds.

import { f32 } from "../rust.js";

/** Min figure dimension on each axis (points). */
export const FIG_MIN_EXTENT_PT = 30.0;
/** Min figure area (points squared). */
export const FIG_MIN_AREA_PT2 = 1500.0;
/**
 * Max figure dimension as a fraction of the page (drop full-page backgrounds
 * and any cluster that has grown to consume virtually the whole page).
 */
export const FIG_MAX_FRACTION: number = f32(0.95);
/** Cluster two primitives when their bboxes overlap or are within this gap on both axes. */
export const FIG_CLUSTER_GAP_PT = 10.0;
export const FIG_GRID_CELL_PT = 64.0;
/**
 * Drop horizontal-rule-like strokes (long thin horizontal) before clustering
 * so a section divider doesn't become a degenerate "figure".
 */
export const HR_MIN_WIDTH_FRACTION: number = f32(0.3);
export const HR_MAX_THICKNESS_PT = 2.0;
/**
 * Aspect ratio threshold above which a cluster is considered "linear" (e.g. a
 * single rule, an underline cluster) rather than a figure.
 */
export const FIG_MAX_ASPECT_RATIO = 15.0;
/** Min primitives in a cluster unless any single primitive is itself large. */
export const FIG_LARGE_SOLO_AREA = 5000.0;
/**
 * Fraction of a cluster's area that may be covered by text before we treat
 * the cluster as a text background rather than a figure.
 */
export const FIG_MAX_TEXT_COVERAGE: number = f32(0.55);
