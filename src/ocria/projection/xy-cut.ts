// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): XY-cut entry point and footer detection.

import { f32, trim } from "../rust.js";
import type { Rect, Region } from "../types/geometry.js";
import type { ProjectedTextItem } from "./types.js";
import { xyMedianLineHeight, xyRootBbox } from "./xy-bbox.js";
import { xyCutRec } from "./xy-cut-rec.js";

export { isEquationNumber, isFormulaFragment, xyBucketPt } from "./xy-consts.js";

/**
 * Reserved path for footer lines outside the XY-cut tree. Normal paths contain
 * child indices; `u16::MAX` marks a detached line while preserving every body
 * path. Markdown classification recognizes this marker and emits the line last.
 */
export const NUMERIC_FOOTER_PATH: readonly number[] = [65535];

const ONE_TO_THREE_DIGITS = /^[0-9]{1,3}$/;

/**
 * A footer is a centered one- to three-digit item below every other text item.
 * Use original glyph geometry so grid snapping cannot change this decision.
 *
 * The lower half limits the search to the page end. In the bottom tenth, the
 * half-height gap only requires a distinct baseline. Above that band, require
 * two smaller-glyph heights, leaving a blank line between body and footer.
 * This stronger gap handles large blank bottom margins without detaching a
 * nearby numeric table value. These fractions are conservative layout rules.
 */
export function isolatedNumericFooter(
  items: readonly ProjectedTextItem[],
  idx: number,
  pageWidth: number,
  pageHeight: number
): boolean {
  const item = items[idx];
  const text = trim(item.item.text);
  const center = f32(item.orig_x + f32(item.orig_width * 0.5));
  if (
    item.is_margin_line_number ||
    // One to three ASCII digits: the UTF-8 byte length of such text equals its length.
    !ONE_TO_THREE_DIGITS.test(text) ||
    item.orig_y < f32(pageHeight * 0.5) ||
    center <= f32(f32(pageWidth * 0.5) - 5.0) ||
    center >= f32(f32(pageWidth * 0.5) + 20.0)
  ) {
    return false;
  }
  const gapRatio = item.orig_y < f32(pageHeight * 0.9) ? 2.0 : 0.5;
  return items.every(
    (other, otherIdx) =>
      otherIdx === idx ||
      trim(other.item.text) === "" ||
      f32(other.orig_y + f32(Math.min(item.orig_height, other.orig_height) * gapRatio)) <
        item.orig_y
  );
}

/**
 * Build the page's XY-cut body region tree.
 *
 * Exclude isolated footer numbers from both density/banner cuts and the root
 * bounds. One extra bottom line can change which column split is accepted and
 * alter reading order. Retain the original items for a detached footer line.
 *
 * `figures` is an optional set of figure-region bounding rectangles (from
 * `detectFigureRects`); pass `[]` to disable obstacle seeding. Figures cause
 * the recursion to favor cuts around them.
 */
export function xyCut(
  items: readonly ProjectedTextItem[],
  pageWidth: number,
  pageHeight: number,
  figures: readonly Rect[]
): Region {
  const all: number[] = [];
  items.forEach((it, i) => {
    if (it.item.text !== "" && !isolatedNumericFooter(items, i, pageWidth, pageHeight)) all.push(i);
  });
  if (all.length === 0) {
    return {
      bbox: { x: 0.0, y: 0.0, width: Math.max(pageWidth, 1.0), height: Math.max(pageHeight, 1.0) },
      kind: { Leaf: { item_indices: [] } },
    };
  }
  const bbox = xyRootBbox(items, all, pageWidth, pageHeight);
  const medianH = xyMedianLineHeight(items, all);
  return xyCutRec(items, all, bbox, 0, false, medianH, figures);
}
