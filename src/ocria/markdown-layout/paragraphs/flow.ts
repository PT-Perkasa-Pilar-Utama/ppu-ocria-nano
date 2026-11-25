// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/paragraphs.rs (crates-v2.21.2, Apache-2.0): continuation rules.

import { chars, f32, trimEnd } from "../../rust.js";
import type { ProjectedLine } from "../../types/page.js";
import { lineAllBold, lineUniformStyle } from "../inline/index.js";
import { endsOpenHyphen, startsLowercase } from "./text.js";

/** Multiplier on line height used as the paragraph-break threshold. */
const PARAGRAPH_GAP_MULTIPLIER = f32(1.5);

/**
 * Tolerance for treating two font sizes as "the same" when grouping
 * paragraph lines, when at least one side falls back to a bbox-height
 * estimate. Set above descender-driven jitter (~1pt) but below a
 * 12 to 14pt section-heading step that often follows a smaller caption
 * line with the same bold style.
 */
const FONT_SIZE_PARAGRAPH_TOLERANCE = f32(1.5);
/**
 * Tolerance when both lines report real Tf-set sizes. Tight, so a
 * 12pt-bold caption line directly above a 14pt-bold section heading
 * doesn't accidentally merge them into a single paragraph that swallows
 * the heading.
 */
const FONT_SIZE_PARAGRAPH_TOLERANCE_REAL = f32(0.5);

/** Largest font-size ratio a mid-sentence line break may span within one paragraph. */
const MID_SENTENCE_SIZE_RATIO = f32(1.35);

/** Tolerance in points for treating two indent positions as "the same column". */
const INDENT_TOLERANCE = f32(6.0);

/** Sentence-terminal characters (and closers) after which a line does not run on. */
const SENTENCE_END = new Set([".", "!", "?", ":", ";", "”", '"', ")", "]", "。", "』", "」"]);

/** The previous text does not end in terminal punctuation. */
function endsOpen(text: string): boolean {
  const last = chars(trimEnd(text)).pop();
  return last === undefined || !SENTENCE_END.has(last);
}

/** The previous line breaks mid-sentence (no terminal punctuation) and the next starts lowercase. */
export function runsOn(prev: ProjectedLine, cur: ProjectedLine): boolean {
  return endsOpen(prev.text) && startsLowercase(cur.text);
}

/** Pick the right size-equality tolerance depending on whether either side has an estimated font size. */
export function fontSizeParagraphTolerance(prev: ProjectedLine, cur: ProjectedLine): number {
  return prev.font_size_is_estimated || cur.font_size_is_estimated
    ? FONT_SIZE_PARAGRAPH_TOLERANCE
    : FONT_SIZE_PARAGRAPH_TOLERANCE_REAL;
}

/**
 * A token broken over a line end (`…pyridine-3-` / `carbonitrile 4a …`): `prev` ends in an
 * attached hyphen and `cur` starts lowercase, in the same region, no more than two line
 * heights below. The token joins whatever the indent or gap says about paragraphs, since
 * a break there would split one word or identifier into two.
 */
export function continuesHyphenWrap(prev: ProjectedLine, cur: ProjectedLine): boolean {
  if (!endsOpenHyphen(prev.text) || !samePath(prev, cur)) return false;
  if (!startsLowercase(cur.text)) return false;
  const gap = f32(cur.bbox.y - f32(prev.bbox.y + prev.bbox.height));
  const lineHeight = Math.max(Math.max(prev.bbox.height, cur.bbox.height), 1);
  return gap >= f32(-0.5 * lineHeight) && gap <= f32(2 * lineHeight);
}

function samePath(a: ProjectedLine, b: ProjectedLine): boolean {
  return (
    a.region_path.length === b.region_path.length &&
    a.region_path.every((v, i) => v === b.region_path[i])
  );
}

/**
 * Decide whether `cur` is a wrapped continuation of a heading line `prev`.
 * Looser than `continuesParagraph`: drops the indent-shift check, because
 * a centered wrapped heading has shifting left edges by line (the second
 * line is shorter, so its left edge is further right than the first), and
 * the projection's anchor classifier often labels short heading lines as
 * `Left` rather than `Center` since they don't anchor to a column-center
 * cluster. Without this relaxation, multi-line wrapped headings fail the
 * merge check and emit as two separate `#` blocks.
 */
export function continuesHeading(prev: ProjectedLine, cur: ProjectedLine): boolean {
  if ((prev.anchor === "Center") !== (cur.anchor === "Center")) return false;
  if (
    Math.abs(f32(prev.dominant_font_size - cur.dominant_font_size)) >
    fontSizeParagraphTolerance(prev, cur)
  ) {
    return false;
  }
  const p = lineUniformStyle(prev);
  const c = lineUniformStyle(cur);
  if (p !== null && c !== null && p.bold !== c.bold) return false;
  if (lineAllBold(prev) !== lineAllBold(cur)) return false;
  if (!samePath(prev, cur)) return false;
  const gap = f32(cur.bbox.y - f32(prev.bbox.y + prev.bbox.height));
  const lineHeight = Math.max(Math.max(prev.bbox.height, cur.bbox.height), 1);
  return gap <= f32(lineHeight * PARAGRAPH_GAP_MULTIPLIER);
}

/** Decide whether `cur` continues the paragraph started by `prev`. */
export function continuesParagraph(prev: ProjectedLine, cur: ProjectedLine): boolean {
  return paragraphFlow(prev, cur, false);
}

/**
 * List-item continuation: like `continuesParagraph`, but tolerant of a
 * hanging indent. A wrapped list-item body commonly aligns under the marker's
 * *text* (indented to the right of the marker line), which
 * `continuesParagraph` would read as a new indented block.
 */
export function continuesListItem(prev: ProjectedLine, cur: ProjectedLine): boolean {
  return paragraphFlow(prev, cur, true);
}

export function paragraphFlow(
  prev: ProjectedLine,
  cur: ProjectedLine,
  allowHangingIndent: boolean
): boolean {
  // Anchor only signals a paragraph break when one of the lines is clearly
  // centered while the other isn't: justified prose routinely alternates
  // between Left / Right / Floating dominant anchors as line widths flex,
  // and treating those as paragraph breaks shreds normal text.
  if ((prev.anchor === "Center") !== (cur.anchor === "Center")) return false;
  // A sentence that clearly runs on (no terminal punctuation, next line lowercase) within one region tolerates a
  // size jump of up to MID_SENTENCE_SIZE_RATIO: OCR text layers fit each line's font size separately, so one
  // paragraph reads 12.4 / 9.9 / 12.4 pt and the size check alone broke it after every line. A real heading
  // rarely ends mid-sentence with a lowercase line below it.
  const sizeJump =
    Math.abs(f32(prev.dominant_font_size - cur.dominant_font_size)) >
    fontSizeParagraphTolerance(prev, cur);
  if (sizeJump) {
    const a = prev.dominant_font_size;
    const b = cur.dominant_font_size;
    const ratio = f32(Math.max(a, b) / Math.max(Math.min(a, b), f32(0.1)));
    if (!(samePath(prev, cur) && ratio <= MID_SENTENCE_SIZE_RATIO && runsOn(prev, cur))) {
      return false;
    }
  }
  // Uniform-bold to non-bold transition is a paragraph break. Catches
  // body-size headings that share font size with the surrounding prose but
  // are emitted in a bold variant (e.g. Brill-Bold over Brill-Roman). Both
  // sides must have a uniform style for this to fire; mid-line emphasis
  // (null style) falls through to the gap/indent checks so prose with
  // mid-paragraph bold spans doesn't get fragmented.
  const p = lineUniformStyle(prev);
  const c = lineUniformStyle(cur);
  if (p !== null && c !== null && p.bold !== c.bold) return false;
  // Same intent, but italic-tolerant: an all-bold line (which may mix bold
  // and bold-italic spans, so `lineUniformStyle` yields null) adjacent to
  // a non-all-bold line is a paragraph break. Catches a bold section heading
  // hugging the body paragraph below it.
  if (lineAllBold(prev) !== lineAllBold(cur)) return false;
  if (!samePath(prev, cur)) {
    // Cross-region continuation: the same paragraph can wrap from the
    // bottom of one column into the top of the next. Only bridge regions
    // when the previous line clearly breaks mid-sentence (no terminal
    // punctuation) AND the next line starts with a lowercase letter: a
    // strict signal that catches the column-wrap case while rejecting
    // unrelated paragraphs that happen to sit in adjacent leaves.
    return endsOpen(prev.text) && startsLowercase(cur.text);
  }
  if (
    !allowHangingIndent &&
    Math.abs(f32(prev.indent_x - cur.indent_x)) > INDENT_TOLERANCE &&
    cur.anchor === "Left"
  ) {
    // Indent change on a left-aligned block usually means a new paragraph
    // (block-quote, list, indented passage, etc.). Allow first-line indent
    // by checking only when the *next* line shifts right relative to prev.
    if (cur.indent_x > f32(prev.indent_x + INDENT_TOLERANCE)) return false;
  }
  // Vertical gap check.
  const gap = f32(cur.bbox.y - f32(prev.bbox.y + prev.bbox.height));
  const lineHeight = Math.max(Math.max(prev.bbox.height, cur.bbox.height), 1);
  return gap <= f32(lineHeight * PARAGRAPH_GAP_MULTIPLIER);
}
