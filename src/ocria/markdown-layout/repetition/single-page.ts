// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/repetition.rs (crates-v2.21.2, Apache-2.0): single-page chrome detector.

import { charCount, f32, totalCmp, trim } from "../../rust.js";
import type { ParsedPage } from "../../types/page.js";
import { isRotatedLine } from "../classify/index.js";
import { matchesChromePattern } from "./chrome-pattern.js";

/**
 * Fraction of page height treated as the top band for the single-page
 * chrome detector (slightly wider than the cross-page band — single-page
 * chrome can sit a bit deeper, e.g. a citation block above a paper title).
 */
const SP_TOP_BAND_FRACTION: number = f32(0.15);
/** Fraction of page height for the bottom band of the single-page detector. */
const SP_BOTTOM_BAND_FRACTION: number = f32(0.15);
/**
 * Minimum gap (in multiples of body line height) between candidate chrome
 * and the rest of the page content. A real header/footer is visually
 * separated; body lines that happen to sit near the top/bottom are not.
 */
const SP_ISOLATION_GAP_RATIO = 1;

/** The smallest gap in `gaps` (by `total_cmp`), or null when there is none. */
function minGap(gaps: number[]): number | null {
  let min: number | null = null;
  for (const g of gaps) if (min === null || totalCmp(g, min) < 0) min = g;
  return min;
}

/**
 * Detect running header/footer chrome on a single page using position +
 * isolation + (pattern hint OR font-size delta from body). Returns the set
 * of `projected_lines` indices to strip before classification.
 *
 * Designed to complement `computeHeaderFooterSet`: the cross-page
 * detector needs ≥2 pages and matching repetition; this one fires on
 * single-page docs or on multi-page docs where chrome doesn't repeat
 * consistently (e.g. per-page citation tags). Conservative by design —
 * requires a strong signature (pattern OR clear size delta) plus an
 * isolation gap, so real titles and section headings are preserved.
 */
export function detectSinglePageChrome(page: ParsedPage, bodySize: number): Set<number> {
  const out = new Set<number>();
  const lines = page.projected_lines;
  if (lines.length === 0) return out;
  const h = page.page_height;
  if (h <= 0) return out;
  const topCutoff = f32(h * SP_TOP_BAND_FRACTION);
  const bottomCutoff = f32(h * f32(1 - SP_BOTTOM_BAND_FRACTION));

  // Cache line top/bottom so isolation checks are straightforward.
  const tops = lines.map((l) => l.bbox.y);
  const bots = lines.map((l) => f32(l.bbox.y + l.bbox.height));

  lines.forEach((line, idx) => {
    const text = trim(line.text);
    // Running chrome is horizontal text; a rotated line (a sideways table, which projection
    // sets upright in a frame taller than the page) would otherwise sit in the "bottom band"
    // and its year-led rows match the date pattern.
    if (text === "" || isRotatedLine(line)) return;
    const inTop = bots[idx] <= topCutoff;
    const inBottom = tops[idx] >= bottomCutoff;
    if (!(inTop || inBottom)) return;

    // Isolation: gap to the nearest non-band neighbor must be ≥ the
    // configured ratio of body line height. For a top header we look
    // *down*; for a bottom footer we look *up*. Use body size as the gap
    // reference when known; otherwise fall back to the line's own height.
    const gapRef = bodySize > 0 ? bodySize : Math.max(line.bbox.height, 1);
    const requiredGap = f32(SP_ISOLATION_GAP_RATIO * gapRef);
    // Isolation: gap to the nearest neighbor line (by y) on the body
    // side must be ≥ requiredGap. As a simple proxy, look at the nearest
    // line in y-order whose pattern doesn't match.
    const gaps: number[] = [];
    lines.forEach((l, j) => {
      if (j === idx || matchesChromePattern(trim(l.text))) return;
      if (inTop && tops[j] > bots[idx]) gaps.push(f32(tops[j] - bots[idx]));
      if (!inTop && bots[j] < tops[idx]) gaps.push(f32(tops[idx] - bots[j]));
    });
    const nearest = minGap(gaps);
    const isolated = nearest === null || nearest >= requiredGap;
    if (!isolated) return;

    // Require a chrome pattern signature — drops the false-positive risk
    // of nuking real titles/headings that happen to sit in the band.
    // Font-size delta alone is too coarse: section titles routinely
    // differ from body by ≥15% but are not chrome.
    if (!matchesChromePattern(text)) return;

    // Length guard: avoid stripping long paragraphs that happen to sit in
    // the band and start with a URL — chrome lines are short. 200 char
    // ceiling accommodates the 'Please cite' preamble (often 100-150
    // chars) without admitting body paragraphs.
    if (charCount(text) > 200) return;

    out.add(idx);
  });

  return out;
}
