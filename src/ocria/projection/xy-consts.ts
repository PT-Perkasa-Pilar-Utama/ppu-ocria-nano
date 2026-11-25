// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): XY-cut constants and small predicates.

import { f32, isAlphabetic, trim, charCount } from "../rust.js";
import type { CutAxis } from "../types/geometry.js";
import type { TextItem } from "../types/text-item.js";

// XY-cut (top to bottom, left to right) including nested layouts (banded
// splits with sub-columns).
//
// Threshold is min-density relative to the local content's median: a cut is
// valid if the projection density in the valley stays below T_DENS x median
// for at least MIN_VALLEY_PT continuous units. Auto-scales to page content so
// dense vs. sparse pages need no per-doc tuning. Conservative defaults: we'd
// rather under-cut (merge columns) than shred a paragraph with wide
// inter-word gaps.

/** Bucket size for the 1D density projection (points). */
export const XY_BUCKET_PT = 2.0;
/**
 * Upper bound on density-histogram buckets per axis; longer extents get wider
 * buckets instead of a multi-GB histogram.
 */
export const XY_MAX_BUCKETS: number = 1 << 16;

/** Bucket width for an axis of `length` points, capped at `XY_MAX_BUCKETS` buckets. */
export function xyBucketPt(length: number): number {
  return Math.max(XY_BUCKET_PT, f32(length / XY_MAX_BUCKETS));
}
/** Density threshold for a "valley", as a fraction of the local median non-zero bucket density. */
export const XY_T_DENS: number = f32(0.1);
/** Minimum vertical-cut (column gutter) valley width. */
export const XY_MIN_V_VALLEY_PT = 8.0;
/** Minimum horizontal-cut (row gap) valley width, as a multiple of the median line height. */
export const XY_MIN_H_VALLEY_FACTOR: number = f32(1.4);
/**
 * Hard recursion cap.
 * Backstop only: every cut still passes the banner/density/histogram gates.
 * 6 starved pages with several stacked floats (tables + captions above a
 * 2-col body): each banner peel burns a level, and the body band leafs out
 * un-split at the cap.
 */
export const XY_MAX_DEPTH = 12;
/** Below this item count we stop trying to cut. */
export const XY_MIN_ITEMS_TO_CUT = 4;
/**
 * A horizontal cut must leave at least this many distinct text lines on each
 * side; otherwise we don't slice prose into sliver bands.
 */
export const XY_MIN_LINES_PER_H_SIDE = 2;
/**
 * Vertical-cut score must beat the horizontal score by this factor to be
 * chosen. Tie-breaks in favor of horizontal so pages are sliced into bands
 * before columns, which matches natural reading order.
 */
export const XY_V_PREFERENCE_MARGIN: number = f32(1.1);

/**
 * Bucket width used by the column-start histogram fallback. 5pt is finer
 * than typical inter-column gutters (8-20pt) and coarser than baseline
 * noise / kerning drift, so column edges land in distinct buckets.
 */
export const XY_COLUMN_BUCKET_PT = 5.0;
/**
 * Minimum lines stacked at the same left-edge cluster for the cluster to
 * count as a column peak. A real column has many lines at one x (15+);
 * indented paragraph-starts and footnote markers produce a handful (3-6).
 */
export const XY_COLUMN_MIN_LINES_PER_PEAK = 10;
/**
 * Minimum horizontal distance between two column peaks, as a fraction of
 * `bbox.width`. Sub-paragraph indents and list nesting produce
 * closely-spaced peaks; a real column gutter is much further out.
 */
export const XY_COLUMN_MIN_GAP_FRACTION: number = f32(0.25);
/**
 * Minimum fraction of items that must start at one of the two detected
 * column peaks. Real 2-column layouts cluster nearly every line at one of
 * two left edges; tables, lists, and scattered prose don't.
 */
export const XY_COLUMN_PEAK_DOMINANCE: number = f32(0.55);
/**
 * Minimum smaller/larger ratio between the two column peaks' line counts.
 * Balanced 2-column layouts have ~equal line counts in each column; a
 * 90/10 split is almost certainly a single column with one off-x bullet
 * stack, not a real two-column structure.
 */
export const XY_COLUMN_PEAK_BALANCE_RATIO: number = f32(0.4);
/**
 * Minimum per-column horizontal fill for an N-column (3+ peak) split.
 * Genuine N-column prose fills each inter-peak slot nearly edge-to-edge
 * with text; a data table leaves wide intra-row whitespace.
 */
export const XY_COLUMN_MIN_FILL: number = f32(0.55);
/**
 * A peak whose band count is below this fraction of the most-banded column's
 * is treated as a figure-scatter "phantom" (axis tick labels, a point cloud
 * spread across x) rather than a real column. See the phantom-drop in
 * `xyFindColumnCut`.
 */
export const XY_COLUMN_PHANTOM_BAND_FRACTION: number = f32(0.25);

/** Minimum fraction of region width a banner band must cover. */
export const XY_BANNER_WIDTH_FRACTION: number = f32(0.6);
/** Banner clearance gap above/below in multiples of median line height. */
export const XY_BANNER_CLEARANCE_FACTOR: number = f32(1.5);

/** Score of a column-histogram V-cut: beats every density cut but stays below banner's infinity. */
export const XY_HISTOGRAM_CUT_SCORE = 1.0e9;

const EQUATION_INNER = /^[A-Za-z0-9.]+$/;
const ASCII_DIGIT = /[0-9]/;

export type CutCandidate = {
  axis: CutAxis;
  /** Coordinate of the split (y for horizontal cut, x for vertical). */
  position: number;
  score: number;
};

/** An equation number set at a column edge: "(22)", "(3.14)", "(A.2)". */
export function isEquationNumber(text: string): boolean {
  const t = trim(text);
  if (!t.startsWith("(")) return false;
  const rest = t.slice(1);
  if (!rest.endsWith(")")) return false;
  const inner = rest.slice(0, -1);
  // Every accepted character is ASCII, so the UTF-16 length is the byte length `inner.len()`.
  return (
    inner.length > 0 && inner.length <= 6 && ASCII_DIGIT.test(inner) && EQUATION_INNER.test(inner)
  );
}

/**
 * Text with no run of three letters: a matrix entry, a bracket piece or an
 * accent the math pass left behind ("0", "¯", ", B =").
 */
export function isFormulaFragment(text: string): boolean {
  let run = 0;
  for (const c of text) {
    run = isAlphabetic(c) ? run + 1 : 0;
    if (run >= 3) return false;
  }
  return trim(text) !== "";
}

/**
 * Character-weighted contribution of an item to the projection. Headings get
 * roughly the same weight as the body text they're competing with, instead of
 * being amplified by their bbox area.
 */
export function xyItemWeight(it: TextItem): number {
  return Math.max(charCount(it.text), 1);
}
