// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): running-prose stop for ruled rows.

import { f32, isAlphabetic, isWhitespace, totalCmp, trim } from "../../../rust.js";
import type { ProjectedLine } from "../../../types/page.js";
import { splitWhitespace } from "../../../rust-extra.js";
import { verifiedWords } from "../borderless/index.js";

export type ProseBoundaryCrossing = { crossed: boolean; via: string; gap_width: number | null };

export type ProseXRange = [number, number];

export function runningProseSentenceShape(line: ProjectedLine): boolean {
  const text = trim(line.text);
  const cs = Array.from(text);
  const charCount = cs.length;
  const wordCount = splitWhitespace(text).length;
  const nonSpaceCount = cs.filter((ch) => !isWhitespace(ch)).length;
  const alphaCount = cs.filter((ch) => isAlphabetic(ch)).length;
  return (
    charCount >= 90 &&
    wordCount >= 12 &&
    nonSpaceCount > 0 &&
    alphaCount >= f32(nonSpaceCount * f32(0.6)) &&
    cs.some((ch) => ch === "." || ch === "!" || ch === "?")
  );
}

export function proseLineXRanges(line: ProjectedLine): [ProseXRange[], ProseXRange[]] {
  const words: ProseXRange[] = [];
  const itemOnly: ProseXRange[] = [];
  for (const span of line.spans.filter((s) => trim(s.text) !== "")) {
    const spanWords = verifiedWords(span);
    if (spanWords != null) {
      for (const word of spanWords) {
        const x1 = f32(word.x + word.width);
        if (word.width > 0 && Number.isFinite(x1)) words.push([word.x, x1]);
      }
    } else if (span.width > 0) {
      itemOnly.push([span.x, f32(span.x + span.width)]);
    }
  }
  words.sort((a, b) => totalCmp(a[0], b[0]));
  return [words, itemOnly];
}

const EDGE_MARGIN_PT = 1.5;

export function proseBoundaryCrossing(
  boundary: number,
  wordRanges: readonly ProseXRange[],
  itemOnlyRanges: readonly ProseXRange[],
  gapLimit: number
): ProseBoundaryCrossing {
  const insideMargin = ([x0, x1]: ProseXRange): boolean =>
    boundary >= f32(x0 + EDGE_MARGIN_PT) && boundary <= f32(x1 - EDGE_MARGIN_PT);
  const insideEdges = ([x0, x1]: ProseXRange): boolean => boundary > x0 && boundary < x1;
  if (wordRanges.some(insideMargin)) return { crossed: true, via: "word-box", gap_width: null };
  for (let i = 0; i + 1 < wordRanges.length; i++) {
    const a = wordRanges[i];
    const b = wordRanges[i + 1];
    const gapWidth = f32(b[0] - a[1]);
    if (gapWidth >= 0 && boundary >= a[1] && boundary <= b[0]) {
      const crossed = gapWidth < gapLimit;
      return { crossed, via: crossed ? "inter-word-gap" : "wide-gap", gap_width: gapWidth };
    }
  }
  if (wordRanges.some(insideEdges))
    return { crossed: false, via: "word-edge-margin", gap_width: null };
  if (itemOnlyRanges.some(insideMargin)) return { crossed: true, via: "item-box", gap_width: null };
  if (itemOnlyRanges.some(insideEdges))
    return { crossed: false, via: "item-edge-margin", gap_width: null };
  return { crossed: false, via: "none", gap_width: null };
}

export function proseLineFontHeight(line: ProjectedLine): number {
  const heights: number[] = [];
  for (const span of line.spans) {
    const h = span.font_height ?? span.font_size;
    if (h != null && Number.isFinite(h) && h > 0) heights.push(h);
  }
  heights.sort(totalCmp);
  const mid = heights[Math.floor(heights.length / 2)];
  if (mid !== undefined) return mid;
  const d = line.dominant_font_size;
  if (Number.isFinite(d) && d > 0) return d;
  return Math.max(line.bbox.height, 1);
}

// The Rust also takes the row and line index, which only feed its debug log.
export function shouldStopAtRunningProse(line: ProjectedLine, xs: readonly number[]): boolean {
  if (!runningProseSentenceShape(line)) return false;
  const boundaries = xs.slice(1, 1 + Math.max(xs.length - 2, 0));
  const [wordRanges, itemOnlyRanges] = proseLineXRanges(line);
  const lineX0 = line.bbox.x;
  const lineX1 = f32(line.bbox.x + line.bbox.width);
  const gapLimit = f32(proseLineFontHeight(line) * f32(0.5));
  if (boundaries.length === 0) return false;
  let inExtent = 0;
  let crossed = 0;
  for (const boundary of boundaries) {
    if (boundary >= lineX0 && boundary <= lineX1) {
      inExtent++;
      if (proseBoundaryCrossing(boundary, wordRanges, itemOnlyRanges, gapLimit).crossed) crossed++;
    }
  }
  const ratio = inExtent === 0 ? 0 : f32(crossed / inExtent);
  return inExtent >= 2 && crossed >= 2 && ratio >= f32(0.67);
}
