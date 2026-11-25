// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): gutter line numbers.

import { roundF32 } from "../rust-extra.js";
import { asInt, chars, f32, trim } from "../rust.js";
import type { ProjectedTextItem } from "./types.js";
import { isolatedNumericFooter } from "./xy-cut.js";

// Three distinct baselines support native gutter numbering. This recurrence
// threshold is a layout heuristic. Isolated footers are exempted independently.
export const MIN_GUTTER_ROWS = 3;

const ASCII_DIGIT = /^[0-9]$/;

/**
 * Candidate numbers use the existing two-column gutter tolerances: their center
 * is strictly between 5 pt left and 20 pt right of the page midpoint, and their
 * width is below 15 pt. These are layout heuristics, not PDF format limits.
 *
 * Keep one or two ASCII digits, optionally followed by an OCR `O` for zero.
 * The three-character limit allows that suffix after two digits. Footer
 * detection requires actual digits in the same horizontal band.
 */
export function isGutterNumberCandidate(item: ProjectedTextItem, pageWidth: number): boolean {
  const center = f32(item.item.x + f32(item.item.width * 0.5));
  const cs = chars(trim(item.item.text));
  if (
    !(
      center > f32(f32(pageWidth * 0.5) - 5) &&
      center < f32(f32(pageWidth * 0.5) + 20) &&
      item.item.width < 15
    ) ||
    cs.length === 0 ||
    cs.length > 3
  ) {
    return false;
  }
  let digits = 0;
  for (let idx = 0; idx < cs.length; idx++) {
    if (ASCII_DIGIT.test(cs[idx])) digits++;
    else if (cs[idx] !== "O" || idx !== cs.length - 1) return false;
  }
  return digits >= 1 && digits <= 2;
}

/**
 * Text on both sides of a separated number is direct evidence that it occupies
 * the space between columns, even without a repeated vertical sequence.
 * Half the smaller glyph height is the existing same-baseline tolerance; using
 * the smaller height prevents a tall font box from spanning adjacent rows.
 */
export function betweenTextOnBaseline(items: readonly ProjectedTextItem[], idx: number): boolean {
  const number = items[idx].item;
  let left = false;
  let right = false;
  for (let j = 0; j < items.length; j++) {
    const text = items[j].item;
    if (
      j === idx ||
      trim(text.text) === "" ||
      Math.abs(f32(text.y - number.y)) > f32(Math.min(number.height, text.height) * 0.5)
    ) {
      continue;
    }
    left = left || f32(text.x + text.width) <= number.x;
    right = right || text.x >= f32(number.x + number.width);
  }
  return left && right;
}

/**
 * A real gutter line number is isolated on its baseline. An item that abuts a
 * neighbour is a fragment of a larger token, e.g. the "7" of a table cell
 * PDFium emits as "7" + ".7" (issue #465).
 *
 * Preserve the existing token-fragment guard: a quarter glyph height admits a
 * tight join, and half a height restricts it to one baseline. The 0.5 pt
 * overlap tolerance accommodates rounded box widths.
 */
function abutsNeighbour(items: readonly ProjectedTextItem[], idx: number): boolean {
  const it = items[idx].item;
  const maxGap = f32(it.height * 0.25);
  return items.some((other, j) => {
    if (j === idx) return false;
    const o = other.item;
    if (Math.abs(f32(o.y - it.y)) > f32(it.height * 0.5)) return false;
    const gapRight = f32(o.x - f32(it.x + it.width));
    const gapLeft = f32(it.x - f32(o.x + o.width));
    return (gapRight >= -0.5 && gapRight <= maxGap) || (gapLeft >= -0.5 && gapLeft <= maxGap);
  });
}

/**
 * Flag gutter line numbers (`is_margin_line_number`). A lone centered footer
 * has the same shape as a gutter number, so it needs a repeated column or text
 * on both sides before it is marked for removal.
 */
export function markMarginLineNumbers(
  items: ProjectedTextItem[],
  pageWidth: number,
  pageHeight: number
): void {
  const marginIdxs: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isGutterNumberCandidate(items[i], pageWidth) && !abutsNeighbour(items, i)) {
      marginIdxs.push(i);
    }
  }
  const rows = new Set(marginIdxs.map((i) => asInt(roundF32(items[i].item.y))));
  for (const i of marginIdxs) {
    // Exempt the footer before flagging. Preserve existing OCR gutter
    // filtering: short OCR numerals may be recognition noise. Native
    // digits need repeated rows or text on both sides.
    if (
      !isolatedNumericFooter(items, i, pageWidth, pageHeight) &&
      (items[i].item.confidence != null ||
        rows.size >= MIN_GUTTER_ROWS ||
        betweenTextOnBaseline(items, i))
    ) {
      items[i].is_margin_line_number = true;
    }
  }
}

/** Drop gutter line numbers that the recurrence rules confirm, keeping isolated footers. */
export function cleanProjectedItems(
  items: ProjectedTextItem[],
  pageWidth: number,
  pageHeight: number
): ProjectedTextItem[] {
  // Apply the native recurrence requirement after grid rendering. Preserve
  // the earlier OCR/baseline flags and the existing same-line body-text guard.
  const hasNonMarginByLine = new Set<number>();
  for (const item of items) {
    if (!item.is_margin_line_number) hasNonMarginByLine.add(asInt(roundF32(item.item.y)));
  }

  const likelyMargin = (item: ProjectedTextItem): boolean =>
    item.is_margin_line_number || isGutterNumberCandidate(item, pageWidth);
  // Keep the gutter heuristic's row count unchanged for body numbers.
  // Isolated footers are exempted at removal, regardless of that count.
  const rows = new Set<number>();
  for (const item of items) if (likelyMargin(item)) rows.add(asInt(roundF32(item.item.y)));
  const footers = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    if (isolatedNumericFooter(items, i, pageWidth, pageHeight)) footers.add(i);
  }
  return items.filter((item, idx) => {
    const lineHasContent = hasNonMarginByLine.has(asInt(roundF32(item.item.y)));
    return (
      footers.has(idx) ||
      (rows.size < MIN_GUTTER_ROWS && !item.is_margin_line_number) ||
      !likelyMargin(item) ||
      lineHasContent
    );
  });
}
