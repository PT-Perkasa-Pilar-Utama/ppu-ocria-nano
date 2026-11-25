// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/headings.rs (crates-v2.21.2, Apache-2.0): thresholds.

import { f32 } from "../../rust.js";

/** Tolerance in points for "is this size larger than the body size". */
export const HEADING_SIZE_EPSILON: number = f32(0.5);

/**
 * Margin (points) a *height-estimated* size must clear over body before it
 * counts as a heading size. When PDFium bakes the font size into the text
 * matrix, `dominant_font_size` falls back to bbox height, which jitters ±1pt
 * line-to-line (descenders, parens, capitals). The small `HEADING_SIZE_EPSILON`
 * then admits jittered body lines as a bogus heading level (e.g. 10pt over a
 * 9pt body), promoting every tall-glyph body line to a heading. Real headings
 * in these docs are ≥2pt over body, so a wider margin filters the jitter while
 * keeping genuine headings.
 */
export const ESTIMATED_HEADING_SIZE_MARGIN: number = f32(1.5);

/** Cap on heading levels (matches plan: H1..H6). */
export const MAX_HEADING_LEVELS = 6;

/**
 * A normalized line text that recurs at least this many times among
 * heading-candidate lines (size > body) is treated as chart/figure label
 * spam, not a heading, and is excluded from the heading-size map. Example:
 * the "Input-Input Layer5" attention-plot labels in academic papers render
 * at 23–28pt (far above body) and would otherwise hijack H1..H3, demoting the
 * real title and section headings. Genuine headings are not byte-identical
 * across the document, so this never drops a real heading size *unless* that
 * size is occupied solely by the repeated string — and the exclusion is
 * per-line, so a repeated string sharing a font size with real headings
 * leaves that level intact.
 */
export const REPEATED_HEADING_LINE_MIN = 3;

/**
 * Tighter tolerance for matching against the heading-size map. Keeps the
 * heading detector strict so descender-induced height jitter doesn't promote
 * regular body lines to headings.
 */
export const FONT_SIZE_HEADING_TOLERANCE: number = f32(0.6);

/**
 * Maximum characters in a "bold body-size heading" candidate. Section
 * headings like "Abstract", "1 Introduction", "2.1 Related Work" are short;
 * a bold body-size line longer than this is almost always a bold *sentence*
 * inside a paragraph, not a heading.
 */
export const BOLD_HEADING_MAX_CHARS = 80;

/**
 * Maximum length for a font-size-promoted heading. Looser than
 * `BOLD_HEADING_MAX_CHARS` (which gates the bold-detection path) because
 * genuine title lines can run long. Tight enough to reject footnotes
 * and citations that score slightly above body size — those are
 * multi-clause sentences that exceed any reasonable label length.
 */
export const HEADING_MAX_TEXT_CHARS = 140;
