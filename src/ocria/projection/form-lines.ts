// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): form_lines.

// Upstream's `LITEPARSE_DEBUG_LINES` stderr dump is not ported: it is a debug
// aid that does not change the result.

import { roundF32 } from "../rust-extra.js";
import { asInt, asUsize, f32, totalCmp } from "../rust.js";
import { markMarginLineNumbers } from "./gutter.js";
import { mergeContinuousItems, mergeWordsInLine, usesNativeGaps } from "./form-lines-merge.js";
import { markScriptItems } from "./script-style.js";
import { representativeLineMetrics } from "./textbox-metrics.js";
import type { ProjectedTextItem } from "./types.js";

/**
 * Group items into lines. Items on one visual line share a y band; the
 * collision, margin-number and line-height guards stop two rows or two columns
 * from fusing into one line.
 */
function groupIntoLines(
  items: readonly ProjectedTextItem[],
  medianWidth: number,
  medianHeight: number
): ProjectedTextItem[][] {
  const lines: ProjectedTextItem[][] = [];
  let currentLine: ProjectedTextItem[] = [];
  let curMinY = Infinity;
  let curMaxY = -Infinity;
  for (const item of items) {
    if (currentLine.length === 0) {
      curMinY = item.item.y;
      curMaxY = f32(item.item.y + item.item.height);
      currentLine.push(item);
      continue;
    }
    let lineCollide = false;
    for (const lineItem of currentLine) {
      const overlapLength = f32(
        Math.min(f32(lineItem.item.x + lineItem.item.width), f32(item.item.x + item.item.width)) -
          Math.max(lineItem.item.x, item.item.x)
      );
      if (overlapLength > Math.max(5, f32(medianWidth / 3))) {
        lineCollide = true;
        break;
      }
    }

    // Don't merge margin line numbers with regular content
    const curLineHasMargin = currentLine.some((i) => i.is_margin_line_number);
    const marginMismatch = curLineHasMargin !== item.is_margin_line_number;

    // For rotated text, use y-tolerance based merging since heights may be inconsistent
    const yToleranceMerge = item.rotated ? Math.max(f32(medianHeight * 2), 20) : 0;
    const yWithinTolerance = item.rotated && Math.abs(f32(item.item.y - curMinY)) < yToleranceMerge;

    // Prevent "snowball" effect: when two columns have slightly offset
    // y-values, the line range keeps expanding as items from alternating
    // columns are added, merging multiple visual rows into one mega-line.
    // Cap the line height to a reasonable multiple of median text height.
    const itemBottom = f32(item.item.y + item.item.height);
    const proposedMinY = Math.min(curMinY, item.item.y);
    const proposedMaxY = Math.max(curMaxY, itemBottom);
    // too_tall threshold: prefer the smallest *trusted* item height already in the
    // current line as the line-height baseline. PDFium reports inflated em-box
    // heights for items with matrix-baked sizing (fs=1.0); using the global
    // `median_height` then permits a real heading row to absorb the next visual
    // row below it. Falls back to median_height when no smaller anchor is available.
    let lineAnchorH = Infinity;
    for (const i of currentLine) {
      const fs = i.item.font_size;
      if ((fs != null && fs > 1.5) || i.item.height < medianHeight) {
        lineAnchorH = Math.min(lineAnchorH, i.item.height);
      }
    }
    const tooTallThreshold = Number.isFinite(lineAnchorH)
      ? Math.max(f32(lineAnchorH * f32(1.8)), f32(medianHeight * f32(0.6)))
      : f32(medianHeight * f32(1.8));
    const tooTall = f32(proposedMaxY - proposedMinY) > tooTallThreshold;

    const mid = f32(item.item.y + f32(item.item.height * 0.5));
    if (
      !lineCollide &&
      !marginMismatch &&
      !tooTall &&
      (yWithinTolerance ||
        (mid >= curMinY && mid <= curMaxY) ||
        (item.item.y >= curMinY && item.item.y <= curMaxY))
    ) {
      curMinY = Math.min(curMinY, item.item.y);
      curMaxY = Math.max(curMaxY, itemBottom);
      currentLine.push(item);
    } else {
      lines.push(currentLine);
      currentLine = [item];
      curMinY = item.item.y;
      curMaxY = itemBottom;
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);
  return lines;
}

/**
 * Merge overlapping lines when there is no horizontal bbox overlap, folding
 * into an accumulator whose last line keeps absorbing successors. Ribbon pages
 * reach 10^5+ lines, so this must stay linear: the x-sort of a merged line is
 * deferred until it stops absorbing (no check here depends on item order) and
 * its y-range is maintained incrementally.
 */
function mergeOverlappingLines(lines: ProjectedTextItem[][]): ProjectedTextItem[][] {
  const yRange = (line: readonly ProjectedTextItem[]): [number, number] => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of line) {
      lo = Math.min(lo, v.item.y);
      hi = Math.max(hi, f32(v.item.y + v.item.height));
    }
    return [lo, hi];
  };
  const byX = (a: ProjectedTextItem, b: ProjectedTextItem): number => totalCmp(a.item.x, b.item.x);
  const merged: ProjectedTextItem[][] = [];
  let prevRange: [number, number] = [Infinity, -Infinity];
  let prevAbsorbed = false;
  for (const current of lines) {
    const [curMin, curMax] = yRange(current);
    const previous = merged[merged.length - 1];
    if (previous) {
      const [prevMin, prevMax] = prevRange;
      // Do the two lines overlap vertically?
      if (prevMax > curMin && prevMin < curMax) {
        const bboxOverlap = current.some((bbox) =>
          previous.some(
            (p) =>
              (bbox.item.x >= p.item.x && bbox.item.x <= f32(p.item.x + p.item.width)) ||
              (p.item.x >= bbox.item.x && p.item.x <= f32(bbox.item.x + bbox.item.width))
          )
        );
        if (!bboxOverlap) {
          for (const c of current) previous.push(c);
          prevRange = [Math.min(prevMin, curMin), Math.max(prevMax, curMax)];
          prevAbsorbed = true;
          continue;
        }
      }
      if (prevAbsorbed) previous.sort(byX);
    }
    merged.push(current);
    prevRange = [curMin, curMax];
    prevAbsorbed = false;
  }
  const last = merged[merged.length - 1];
  if (prevAbsorbed && last) last.sort(byX);
  return merged;
}

/**
 * Insert blank lines for vertical gaps between lines. Gaps are measured
 * between consecutive content lines only; inserted blanks never participate.
 */
function insertBlankLines(
  lines: ProjectedTextItem[][],
  medianHeight: number
): ProjectedTextItem[][] {
  const withBlanks: ProjectedTextItem[][] = [];
  let prevMetrics: [number, number, number] | null = null;
  for (const line of lines) {
    const cur = representativeLineMetrics(line, medianHeight);
    if (prevMetrics) {
      const yDelta = f32(cur[0] - prevMetrics[1]); // cur_top - prev_bottom
      const referenceHeight = Math.max(medianHeight, Math.min(prevMetrics[2], cur[2]));
      if (yDelta > referenceHeight) {
        const rounded = asUsize(roundF32(f32(yDelta / referenceHeight)));
        const numBlank = Math.max(rounded - 1, 0);
        const count = Math.min(Math.max(numBlank, 1), 10);
        for (let k = 0; k < count; k++) withBlanks.push([]);
      }
    }
    prevMetrics = cur;
    withBlanks.push(line);
  }
  return withBlanks;
}

/**
 * Sort items into reading rows, merge touching items, group them into lines,
 * and insert blank lines for vertical gaps. Empties `items`' role: callers use
 * the returned lines only.
 */
export function formLines(
  items: ProjectedTextItem[],
  medianWidth: number,
  medianHeight: number,
  pageWidth: number,
  pageHeight: number,
  styleRuns: boolean
): ProjectedTextItem[][] {
  // Y-tolerance for sorting: items within this threshold are considered same line
  const ySortTolerance = Math.max(f32(medianHeight * 0.5), 5);

  if (pageWidth > 0) markMarginLineNumbers(items, pageWidth, pageHeight);

  // Sort by y then x. Snap y to a grid so items on the same visual line
  // get identical keys; this keeps the comparator transitive (total order).
  const snapY = (y: number): number =>
    ySortTolerance > 0 ? asInt(roundF32(f32(y / ySortTolerance))) : asInt(roundF32(f32(y * 1000)));
  items.sort((a, b) => snapY(a.item.y) - snapY(b.item.y) || totalCmp(a.item.x, b.item.x));

  const useNativeGaps = usesNativeGaps(items);
  const merged = mergeContinuousItems(items, useNativeGaps);

  // try to find the bounding box that forms a line and group items by line
  const lines = groupIntoLines(merged, medianWidth, medianHeight);
  for (const line of lines) line.sort((a, b) => totalCmp(a.item.x, b.item.x));
  for (const line of lines) markScriptItems(line);

  // sort lines by y
  lines.sort((a, b) => totalCmp(a[0]?.item.y ?? Infinity, b[0]?.item.y ?? Infinity));

  // merge 'words'
  const wordMerged = lines.map((line) => mergeWordsInLine(line, styleRuns, useNativeGaps));
  return insertBlankLines(mergeOverlappingLines(wordMerged), medianHeight);
}
