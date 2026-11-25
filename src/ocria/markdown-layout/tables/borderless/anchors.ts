// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): splitting a run at column anchors.

import { chars, f32, isWhitespace, totalCmp, trim } from "../../../rust.js";
import type { TextItem, WordBox } from "../../../types/text-item.js";
import { collapseWhitespace } from "../../paragraphs/index.js";

/**
 * Split a word sequence into `anchors.length + 1` pieces using the words' own
 * x positions: each anchor picks the inter-word boundary whose following word
 * starts closest to it.
 *
 * This is the geometric counterpart of `splitTextAtXAnchors`, which can only
 * interpolate an x from a character index and so assumes every glyph is the
 * same width - false for any proportional font, and the reason a split can
 * land one character off (`10 .1%`). Prefer this whenever the piece carries
 * verified word boxes.
 *
 * Returns null when there are too few words to host every anchor, when two
 * anchors want the same boundary, or when an anchor's nearest boundary is
 * further away than the track tolerance - a miss that large means no word
 * actually starts at this column. The caller can then reject the candidate or
 * use a different representation, depending on its detection context.
 */
export function splitWordsAtXAnchors(
  words: readonly WordBox[],
  anchors: readonly number[],
  tolerance: number
): string[] | null {
  if (anchors.length === 0 || words.length < anchors.length + 1) return null;
  const cuts: number[] = [];
  for (const target of anchors) {
    let best: [number, number] | null = null;
    for (let k = 1; k < words.length; k++) {
      if (cuts.includes(k)) continue;
      const dist = Math.abs(f32(words[k].x - target));
      // `min_by` keeps the first of equal minima.
      if (best === null || totalCmp(dist, best[1]) < 0) best = [k, dist];
    }
    if (best === null) return null;
    if (best[1] > tolerance) return null;
    cuts.push(best[0]);
  }
  cuts.sort((a, b) => a - b);
  const pieces: string[] = [];
  let prev = 0;
  for (const k of [...cuts, words.length]) {
    pieces.push(
      collapseWhitespace(
        words
          .slice(prev, k)
          .map((w) => trim(w.text))
          .join(" ")
      )
    );
    prev = k;
  }
  return pieces;
}

/**
 * Split `text` (treated as occupying `[x0, x0 + width]`) into
 * `anchors.length + 1` trimmed pieces by mapping each anchor x to the
 * whitespace boundary whose linearly-interpolated x is closest. Returns null
 * if the text is empty, there are no anchors, or any anchor has no usable
 * whitespace boundary (e.g. unbroken text like a long hex string). Pieces may
 * be empty strings: callers that require non-empty pieces must check.
 */
export function splitTextAtXAnchors(
  text: string,
  x0: number,
  width: number,
  anchors: readonly number[]
): string[] | null {
  const cs = chars(text);
  const n = cs.length;
  if (n === 0 || anchors.length === 0) return null;
  const w = Math.max(width, 1);
  const splitIndices: number[] = [];
  for (const target of anchors) {
    let best: [number, number] | null = null;
    for (let k = 0; k < n; k++) {
      if (!isWhitespace(cs[k]) || splitIndices.includes(k)) continue;
      const x = f32(x0 + f32(f32(k / n) * w));
      const d = Math.abs(f32(x - target));
      if (best === null || d < best[1]) best = [k, d];
    }
    if (best === null) return null;
    splitIndices.push(best[0]);
  }
  splitIndices.sort((a, b) => a - b);
  const pieces: string[] = [];
  let prev = 0;
  for (const k of splitIndices) {
    pieces.push(trim(cs.slice(prev, k).join("")));
    prev = k;
  }
  pieces.push(trim(cs.slice(prev).join("")));
  return pieces;
}

/**
 * Split a multi-track-spanning span's text into one piece per covered track by
 * picking whitespace positions whose linearly-interpolated x is closest to
 * each subsequent anchor. Returns pieces of length `covered.length` when every
 * split lands on a real whitespace boundary; null if no usable boundary exists
 * (e.g. unbroken text like a long hex string).
 */
export function splitSpanAtAnchors(
  span: TextItem,
  covered: readonly number[],
  tracks: readonly number[]
): string[] | null {
  if (covered.length < 2) return null;
  const anchors = covered.slice(1).map((idx) => tracks[idx]);
  return splitTextAtXAnchors(span.text, span.x, span.width, anchors);
}
