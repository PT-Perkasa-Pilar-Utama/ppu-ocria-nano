// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/headings.rs (crates-v2.21.2, Apache-2.0): body size and heading-size map.

import { asUsize, charCount, f32, isAlphabetic, isWhitespace, totalCmp } from "../../rust.js";
import { roundF32, splitWhitespace } from "../../rust-extra.js";
import type { ParsedPage, ProjectedLine } from "../../types/page.js";
import { isRotatedLine } from "../classify/index.js";
import {
  ESTIMATED_HEADING_SIZE_MARGIN,
  FONT_SIZE_HEADING_TOLERANCE,
  HEADING_SIZE_EPSILON,
  MAX_HEADING_LEVELS,
  REPEATED_HEADING_LINE_MIN,
} from "./constants.js";
import { isCaptionLine } from "./text-patterns.js";

/**
 * A size whose char-weight is at least this fraction of the top size's weight
 * is considered a co-dominant body block. When two sizes are co-dominant, the
 * larger one is the body: dense small-print blocks (references,
 * acknowledgments, footnotes) routinely out-weigh the main narrative by raw
 * char count, but the body is never *smaller* than its own footnotes.
 */
const BODY_CODOMINANT_FRACTION: number = f32(0.5);

/**
 * Minimum total non-whitespace characters across all occurrences at a font
 * size for it to qualify as a heading level. Low floor — just a noise guard
 * against 1-2 char artifacts.
 */
const MIN_HEADING_TOTAL_CHARS = 10;

/**
 * Minimum average non-whitespace characters *per line* at a font size for it
 * to qualify as a heading. This is what separates a real heading (a coherent
 * line like "Annual Events" = 12 chars/line, or "A-MEM: Agentic Memory for
 * LLM Agents" = 31) from scattered chart-legend tokens at a one-off display
 * size (~4-5 chars/line).
 */
const MIN_HEADING_AVG_LINE_CHARS = 8;

/**
 * Maximum average characters per line for a size to qualify as a heading.
 * A "size larger than body" with very long lines is almost always a
 * large-print body block (callouts, footnotes-as-display, intro paragraph),
 * not a real heading.
 */
const MAX_HEADING_AVG_LINE_CHARS = 200;

/**
 * Minimum fraction of non-whitespace chars at a size that must be alphabetic
 * for it to qualify as a heading. Drops sizes dominated by digits (graph
 * axes, results tables, math display) which otherwise pollute the top
 * heading slots.
 */
const MIN_HEADING_ALPHA_RATIO: number = f32(0.5);

/**
 * Size a line presents to heading detection: the precise matrix-derived
 * `heading_font_size` when available (matrix-baked-size lines), else the
 * `dominant_font_size`. Used by `computeBodySize`, `buildHeadingMap`, and
 * the per-line heading-level lookup — NOT by table/paragraph grouping.
 */
export function headingSizeOf(line: ProjectedLine): number {
  return line.heading_font_size ?? line.dominant_font_size;
}

/** The size bucket of a font size: hundredths of a point (`(size * 100.0).round() as u32`). */
function sizeKey(size: number): number {
  return asUsize(roundF32(f32(size * 100)));
}

/**
 * Normalize a line's text for repeat-detection: collapse internal whitespace
 * and lowercase, so trivially-different renderings of the same label string
 * still hash together.
 */
export function normalizeRepeatKey(text: string): string {
  return splitWhitespace(text).join(" ").toLowerCase();
}

/**
 * Compute the body font size as the char-weighted mode across all lines in
 * all pages. Rotated lines are excluded so a long rotated sidebar can't
 * pull the body estimate. Falls back to `0.0` when no font-size info is
 * available.
 */
export function computeBodySize(pages: readonly ParsedPage[]): number {
  // size key -> [first size seen at the key, char weight]. Nothing depends on the map's order:
  // the maximum weight and the largest size above the threshold are order-free.
  const weights = new Map<number, [number, number]>();
  for (const page of pages) {
    for (const line of page.projected_lines) {
      if (isRotatedLine(line)) continue;
      const size = headingSizeOf(line);
      if (size <= 0) continue;
      const chars = Math.max(charCount(line.text), 1);
      const key = sizeKey(size);
      const entry = weights.get(key) ?? [size, 0];
      entry[1] += chars;
      weights.set(key, entry);
    }
  }
  let maxWeight = 0;
  for (const [, n] of weights.values()) maxWeight = Math.max(maxWeight, n);
  if (maxWeight === 0) return 0;
  const threshold = asUsize(f32(f32(maxWeight) * BODY_CODOMINANT_FRACTION));
  // Among sizes that are co-dominant with the heaviest size, pick the
  // largest. This rescues the true body when a dense references/footnote
  // block at a smaller size would otherwise win the raw char-weight vote.
  let body = 0;
  for (const [s, n] of weights.values()) {
    if (n >= threshold) body = Math.max(body, s);
  }
  return body;
}

function headingMargin(line: ProjectedLine): number {
  return line.font_size_is_estimated ? ESTIMATED_HEADING_SIZE_MARGIN : HEADING_SIZE_EPSILON;
}

/** Per size: the first size seen, line count, non-whitespace chars, alphabetic chars. */
type SizeStats = { size: number; lines: number; chars: number; alpha: number };

/**
 * Build a heading-size → level map: sizes strictly larger than `bodySize`,
 * filtered by the quality guards (total-char floor, average-line cap and
 * alpha-ratio floor; they drop one-off equation / figure-label / legend
 * artifacts), sorted descending, mapped to levels 1..=MAX_HEADING_LEVELS.
 */
export function buildHeadingMap(
  pages: readonly ParsedPage[],
  bodySize: number
): Array<[number, number]> {
  // First pass: frequency of each normalized candidate-line text. A string
  // that recurs ≥ REPEATED_HEADING_LINE_MIN times is chart/figure label spam
  // (e.g. repeated attention-plot labels at 23–28pt), not a heading.
  const textFreq = new Map<string, number>();
  for (const page of pages) {
    for (const line of page.projected_lines) {
      if (isRotatedLine(line) || isCaptionLine(line.text) || line.in_figure) continue;
      if (headingSizeOf(line) > f32(bodySize + headingMargin(line))) {
        const key = normalizeRepeatKey(line.text);
        textFreq.set(key, (textFreq.get(key) ?? 0) + 1);
      }
    }
  }
  const sizes = new Map<number, SizeStats>();
  for (const page of pages) {
    for (const line of page.projected_lines) {
      if (isRotatedLine(line) || line.in_figure) continue;
      // Captions ("Figure 7", "Table 3.") often render slightly larger
      // than body and would otherwise inflate / hijack the heading map.
      if (isCaptionLine(line.text)) continue;
      // Exclude repeated chart/figure labels (per-line, so a repeated
      // string sharing a size with real headings still leaves that level).
      if ((textFreq.get(normalizeRepeatKey(line.text)) ?? 0) >= REPEATED_HEADING_LINE_MIN) continue;
      const size = headingSizeOf(line);
      if (size > f32(bodySize + headingMargin(line))) {
        const key = sizeKey(size);
        const entry = sizes.get(key) ?? { size, lines: 0, chars: 0, alpha: 0 };
        entry.lines += 1;
        for (const c of line.text) {
          if (isWhitespace(c)) continue;
          entry.chars += 1;
          if (isAlphabetic(c)) entry.alpha += 1;
        }
        sizes.set(key, entry);
      }
    }
  }
  // Always apply quality filters: total-char floor, average-line cap, and
  // alpha-ratio floor. The total-char floor (rather than a line-count one)
  // lets one-off titles survive while still rejecting chart-legend tokens.
  // The Rust collects these from a HashMap in random order; the sort below
  // gives the result a total order because distinct keys hold distinct sizes.
  const kept: number[] = [];
  for (const { size, lines, chars, alpha } of sizes.values()) {
    const alphaRatio = chars === 0 ? 0 : f32(f32(alpha) / f32(chars));
    const avgLineChars = f32(f32(chars) / f32(Math.max(lines, 1)));
    if (
      chars >= MIN_HEADING_TOTAL_CHARS &&
      avgLineChars >= MIN_HEADING_AVG_LINE_CHARS &&
      avgLineChars <= MAX_HEADING_AVG_LINE_CHARS &&
      alphaRatio >= MIN_HEADING_ALPHA_RATIO
    ) {
      kept.push(size);
    }
  }
  kept.sort((a, b) => totalCmp(b, a));
  kept.length = Math.min(kept.length, MAX_HEADING_LEVELS);
  return kept.map((s, i): [number, number] => [s, i + 1]);
}

export function headingLevelFor(
  size: number,
  headingMap: ReadonlyArray<[number, number]>
): number | null {
  for (const [s, level] of headingMap) {
    if (Math.abs(f32(size - s)) < FONT_SIZE_HEADING_TOLERANCE) return level;
  }
  return null;
}
