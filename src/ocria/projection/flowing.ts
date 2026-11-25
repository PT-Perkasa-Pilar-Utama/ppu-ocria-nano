// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/projection.rs (crates-v2.21.2, Apache-2.0): block segmentation and flowing text.

import { roundF32 } from "../rust-extra.js";
import { asUsize, chars, f32, isWhitespace, totalCmp } from "../rust.js";
import type { Snap } from "../types/geometry.js";
import type { LineRange } from "./anchors.js";
import type { AnchorMap, ProjectedTextItem } from "./types.js";

// Flowing text detection constants
const FLOWING_MAX_TOTAL_ANCHORS = 4;
const FLOWING_MAX_LEFT_ANCHORS = 3;
const FLOWING_MIN_LINES = 3;
const FLOWING_WIDE_LINE_RATIO = 0.5;
const FLOWING_WIDE_LINE_THRESHOLD = f32(0.6);
const FLOWING_COLUMN_GAP_MULTIPLIER = 4.0;
const FLOWING_MIN_LINE_ITEMS = 3;
const FLOWING_SPACE_HEIGHT_RATIO = f32(0.15);
const FLOWING_SPACE_MIN_THRESHOLD = f32(0.3);
// Space threshold as a fraction of the line's median character advance
// (horizontal em proxy), used to bound the height-based threshold from above.
// `height*0.15` over-estimates the inter-word gap for tall display/heading
// fonts (their ascender+leading make them ~2.7x their advance vs ~2x for body
// text), so it sits above the genuine word gaps and swallows the spaces
// ("WhichJournalistsdoPeople"). 0.30 is the body-text crossover: body height is
// about 2x advance, so `advance*0.30` is about `height*0.15`; taking the
// smaller of the two leaves body text unchanged and only bites tall fonts.
const FLOWING_SPACE_ADV_RATIO = f32(0.3);
const FLOWING_MAX_INDENT = 8;

/** The per-item working state of grid projection (Rust `BoxMeta`). */
export type BoxMeta = {
  left_anchor: number | null;
  right_anchor: number | null;
  center_anchor: number | null;
  snap: Snap | null;
  should_space: number;
  force_unsnapped: boolean;
  rendered: boolean;
  projected_x: number;
  // Recorded only when projection signals are collected: which block the item sits in,
  // whether that block rendered as flowing prose, and how many items share each of its
  // anchors (0 = no anchor of that kind).
  block_idx: number;
  flowing: boolean;
  left_count: number;
  right_count: number;
  center_count: number;
};

export function newBoxMeta(): BoxMeta {
  return {
    left_anchor: null,
    right_anchor: null,
    center_anchor: null,
    snap: null,
    should_space: 0,
    force_unsnapped: false,
    rendered: false,
    projected_x: 0,
    block_idx: 0,
    flowing: false,
    left_count: 0,
    right_count: 0,
    center_count: 0,
  };
}

/** Segments page lines into blocks separated by double blank lines. */
export function segmentBlocks(lines: ReadonlyArray<readonly ProjectedTextItem[]>): LineRange[] {
  const blocks: LineRange[] = [];
  let emptyCount = 0;
  let start: number | null = null;

  lines.forEach((line, lineIdx) => {
    if (line.length === 0) {
      emptyCount++;
      if (emptyCount > 1) {
        // Include the trailing double-blank at the end of the block
        if (start !== null) blocks.push({ start, end: lineIdx + 1 });
        start = null;
      }
    } else {
      emptyCount = 0;
      if (start === null) start = lineIdx;
    }
  });

  if (start !== null) blocks.push({ start, end: lines.length });

  // If no blocks found, treat entire page as one block
  if (blocks.length === 0 && lines.length > 0) blocks.push({ start: 0, end: lines.length });
  return blocks;
}

/** Maximum horizontal gap between consecutive items on a line. */
export function lineMaxGap(line: readonly ProjectedTextItem[]): number {
  let maxGap = 0;
  for (let i = 1; i < line.length; i++) {
    const gap = f32(line[i].item.x - f32(line[i - 1].item.x + line[i - 1].item.width));
    if (gap > maxGap) maxGap = gap;
  }
  return maxGap;
}

/**
 * Check if a line has a column-like gap: one gap that is much larger than
 * the typical inter-word gaps on the same line. This catches two-column
 * layouts where the absolute column gap is below the threshold but is
 * clearly an outlier relative to other gaps on the line.
 */
export function lineHasColumnGap(
  line: readonly ProjectedTextItem[],
  medianWidth: number,
  pageWidth: number
): boolean {
  if (line.length < 2) return false;
  const midpoint = f32(pageWidth * 0.5);
  for (let i = 1; i < line.length; i++) {
    const prevEnd = f32(line[i - 1].item.x + line[i - 1].item.width);
    const curStart = line[i].item.x;
    const gap = f32(curStart - prevEnd);
    // A gap is a column separator if it's large enough (>2x median char width)
    // AND items on either side span across the page midpoint.
    if (gap > f32(medianWidth * 2) && prevEnd < midpoint && curStart > midpoint) return true;
  }
  return false;
}

function lastRight(line: readonly ProjectedTextItem[]): number {
  const b = line[line.length - 1];
  return b ? f32(b.item.x + b.item.width) : 0;
}

/** Check if a block of lines is flowing paragraph text (vs structured/tabular). */
export function isFlowingTextBlock(
  lines: ReadonlyArray<readonly ProjectedTextItem[]>,
  block: LineRange,
  anchorLeft: AnchorMap,
  anchorRight: AnchorMap,
  anchorCenter: AnchorMap,
  pageWidth: number,
  medianWidth: number
): boolean {
  const totalAnchors = anchorLeft.size + anchorRight.size + anchorCenter.size;
  if (totalAnchors > FLOWING_MAX_TOTAL_ANCHORS) return false;
  if (anchorLeft.size > FLOWING_MAX_LEFT_ANCHORS) return false;

  let nonEmptyLines = 0;
  let wideLines = 0;
  let columnGapLines = 0;

  for (let i = block.start; i < Math.min(block.end, lines.length); i++) {
    const line = lines[i];
    if (line.length === 0) continue;
    nonEmptyLines++;

    const lineStart = line[0].item.x;
    const lineEnd = lastRight(line);
    if (f32(lineEnd - lineStart) > f32(pageWidth * FLOWING_WIDE_LINE_RATIO)) wideLines++;
    if (lineHasColumnGap(line, medianWidth, pageWidth)) columnGapLines++;
  }

  if (nonEmptyLines < FLOWING_MIN_LINES) return false;

  // If multiple lines have column gaps, this is a multi-column block,
  // not flowing text.
  if (columnGapLines >= 2) return false;

  return f32(wideLines / nonEmptyLines) > FLOWING_WIDE_LINE_THRESHOLD;
}

/** Render a single line as flowing text with indentation. */
export function renderLineAsFlowingText(
  line: ProjectedTextItem[],
  minX: number,
  medianWidth: number,
  metaLine: BoxMeta[]
): string {
  if (line.length === 0) return "";

  const indent = asUsize(
    Math.min(
      Math.max(roundF32(f32(f32(line[0].item.x - minX) / medianWidth)), 0),
      FLOWING_MAX_INDENT
    )
  );

  let result = " ".repeat(indent);

  // Median per-glyph advance across the line, used to bound the space
  // threshold so tall display fonts don't get a threshold above their real
  // word gaps. `+inf` (no bound) when the line has no measurable advances.
  const advs: number[] = [];
  for (const it of line) {
    let n = 0;
    for (const c of chars(it.item.text)) if (!isWhitespace(c)) n++;
    if (n > 0 && it.item.width > 0) advs.push(f32(it.item.width / n));
  }
  let advThreshold = Infinity;
  if (advs.length > 0) {
    advs.sort(totalCmp);
    advThreshold = f32(advs[Math.floor(advs.length / 2)] * FLOWING_SPACE_ADV_RATIO);
  }

  for (let i = 0; i < line.length; i++) {
    if (i > 0) {
      const prev = line[i - 1].item;
      const cur = line[i].item;
      const gap = f32(cur.x - f32(prev.x + prev.width));
      const spaceThreshold = Math.max(
        Math.min(f32(cur.height * FLOWING_SPACE_HEIGHT_RATIO), advThreshold),
        FLOWING_SPACE_MIN_THRESHOLD
      );
      if (gap > spaceThreshold && !result.endsWith(" ")) result += " ";
    }
    result += line[i].item.text;
    metaLine[i].rendered = true;
    line[i].rendered = true;
  }
  return result;
}

/** Left edge of the first item of the first non-empty line in the block; 0 when all lines are empty. */
function blockMinX(lines: ReadonlyArray<readonly ProjectedTextItem[]>, block: LineRange): number {
  let minX = Infinity;
  for (let i = block.start; i < Math.min(block.end, lines.length); i++) {
    if (lines[i].length > 0) minX = Math.min(minX, lines[i][0].item.x);
  }
  return minX === Infinity ? 0 : minX;
}

/** Render an entire block as flowing text (all lines). */
export function renderFlowingBlock(
  lines: ProjectedTextItem[][],
  block: LineRange,
  rawLines: string[],
  meta: BoxMeta[][],
  medianWidth: number
): void {
  const minX = blockMinX(lines, block);
  for (let lineIdx = block.start; lineIdx < block.end; lineIdx++) {
    if (lines[lineIdx].length === 0) continue;
    rawLines[lineIdx] = renderLineAsFlowingText(lines[lineIdx], minX, medianWidth, meta[lineIdx]);
  }
}

/**
 * Skip lines where items belong to multiple different snap groups (e.g.,
 * left-column and right-column items on the same line bridged by a margin
 * line number).
 */
function hasMixedSnaps(metaLine: readonly BoxMeta[]): boolean {
  let first: Snap | null = null;
  for (const m of metaLine) {
    if (m.snap === null) continue;
    if (first === null) first = m.snap;
    else if (first !== m.snap) return true;
  }
  return false;
}

/**
 * Per-line flowing detection within structured blocks. Identifies individual
 * lines that should be rendered as flowing text.
 */
export function detectAndRenderFlowingLines(
  lines: ProjectedTextItem[][],
  block: LineRange,
  rawLines: string[],
  meta: BoxMeta[][],
  medianWidth: number,
  pageWidth: number
): void {
  const columnGapThreshold = f32(medianWidth * FLOWING_COLUMN_GAP_MULTIPLIER);
  const blockMin = blockMinX(lines, block);
  const flowingLines = new Set<number>();
  const looksFlowing = (line: readonly ProjectedTextItem[]): boolean =>
    lineMaxGap(line) < columnGapThreshold && !lineHasColumnGap(line, medianWidth, pageWidth);

  // First pass: detect clearly flowing lines (wide span, no column gaps, enough items)
  for (let lineIdx = block.start; lineIdx < block.end; lineIdx++) {
    const line = lines[lineIdx];
    if (line.length < FLOWING_MIN_LINE_ITEMS) continue;
    const lineSpan = f32(lastRight(line) - line[0].item.x);
    if (
      !hasMixedSnaps(meta[lineIdx]) &&
      lineSpan > f32(pageWidth * FLOWING_WIDE_LINE_RATIO) &&
      looksFlowing(line)
    ) {
      flowingLines.add(lineIdx);
    }
  }

  // Forward sweep: propagate flowing status downward
  for (let lineIdx = block.start; lineIdx < block.end; lineIdx++) {
    const line = lines[lineIdx];
    if (flowingLines.has(lineIdx) || line.length === 0) continue;
    if (
      !hasMixedSnaps(meta[lineIdx]) &&
      lineIdx > block.start &&
      flowingLines.has(lineIdx - 1) &&
      looksFlowing(line)
    ) {
      flowingLines.add(lineIdx);
    }
  }

  // Backward sweep: propagate flowing status upward
  for (let lineIdx = block.end - 1; lineIdx >= block.start; lineIdx--) {
    if (flowingLines.has(lineIdx) || lines[lineIdx].length === 0) continue;
    if (
      !hasMixedSnaps(meta[lineIdx]) &&
      lineIdx + 1 < block.end &&
      flowingLines.has(lineIdx + 1) &&
      looksFlowing(lines[lineIdx])
    ) {
      flowingLines.add(lineIdx);
    }
  }

  // Render flowing lines. The Rust visits a HashSet; each line writes only its own
  // `raw_lines` and `meta` entries, so the visiting order does not reach the output.
  for (const lineIdx of flowingLines) {
    rawLines[lineIdx] = renderLineAsFlowingText(
      lines[lineIdx],
      blockMin,
      medianWidth,
      meta[lineIdx]
    );
  }
}
