// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/headings.rs (crates-v2.21.2, Apache-2.0): bold body-size headings.

import {
  f32,
  charCount,
  isAlphabetic,
  isLowercase,
  isWhitespace,
  trim,
  trimEnd,
} from "../../rust.js";
import { isAsciiDigit, splitWhitespace } from "../../rust-extra.js";
import type { ProjectedLine } from "../../types/page.js";
import { lineAllBold } from "../inline/index.js";
import { continuesParagraph } from "../paragraphs/index.js";
import { TABLE_MIN_COLUMNS, splitCells } from "../tables/borderless/index.js";
import { isBoldItem, isMonoItem } from "../../projection/style.js";
import { BOLD_HEADING_MAX_CHARS } from "./constants.js";
import { isAttributionLine, isCaptionLine, isSectionNumberPrefix } from "./text-patterns.js";

/**
 * Fraction of non-whitespace characters in `text` that are alphabetic.
 * Returns 0.0 for an empty/all-whitespace string. The heading heuristics use
 * this to reject digit-dominated tabular rows ("47.5 14", "BLEU-1 25.87")
 * that would otherwise be promoted to headings.
 */
export function alphaRatio(text: string): number {
  let alpha = 0;
  let total = 0;
  for (const c of text) {
    if (isWhitespace(c)) continue;
    total += 1;
    if (isAlphabetic(c)) alpha += 1;
  }
  if (total === 0) return 0;
  return f32(f32(alpha) / f32(total));
}

function isAsciiUppercase(c: string): boolean {
  return c >= "A" && c <= "Z";
}

/**
 * A bold line whose first sentence ends in ". " (or ": ") followed by body
 * prose is a paragraph lead, not a section heading. Tight constraints keep
 * numbered subsection headings like "1.5. Migrant Workers" and "Sec. 2. Method".
 */
function isRunInLabel(text: string): boolean {
  const dot = text.indexOf(". ");
  const pos = dot >= 0 ? dot : text.indexOf(": ");
  if (pos < 0) return false;
  // Section-number prefix exemption: when the segment before ". " is a
  // numbered section identifier (e.g. "1", "1.5", "A.2", "Sec. 2",
  // "Ch. 3", "§4"), the period is part of the section number, not a
  // sentence terminator.
  if (isSectionNumberPrefix(text.slice(0, pos))) return false;
  const after = trim(text.slice(pos + 2));
  const first = Array.from(after)[0];
  const startsUpper = first !== undefined && isAsciiUppercase(first);
  const wordCount = splitWhitespace(after).length;
  const endsHyphen = trimEnd(text).endsWith("-");
  return (
    startsUpper && ((wordCount >= 2 && endsHyphen) || (wordCount >= 3 && charCount(text) > 50))
  );
}

/**
 * Returns true if `line` looks like a section heading rendered in body-size
 * bold text (a very common style for academic / technical PDFs where every
 * "real" heading uses the same font size as body, distinguished only by
 * weight). Requires:
 *   - uniformly bold across all spans
 *   - short (≤ `BOLD_HEADING_MAX_CHARS`)
 *   - paragraph-break gap above (or first line on the page)
 *   - paragraph-break gap below (or last line on the page)
 */
export function looksLikeBoldHeading(
  line: ProjectedLine,
  prev: ProjectedLine | null,
  next: ProjectedLine | null
): boolean {
  const text = trim(line.text);
  if (text === "" || charCount(text) > BOLD_HEADING_MAX_CHARS) return false;
  // Captions ("Figure 7", "Table 3.") are commonly bold body-sized lines
  // that would otherwise satisfy every other rule here.
  if (isCaptionLine(text)) return false;
  // Attribution lines ("Source: …", "Note: …", "Adapted from …") commonly
  // appear as isolated bold lines beneath charts/figures. Never headings.
  if (isAttributionLine(text)) return false;
  // Accept a line whose spans are all bold (italic may vary) and non-mono.
  if (!lineAllBold(line)) return false;
  // Run-in labels — a bold lead-in that ends in a period and flows straight
  // into the body sentence ("United Kingdom.", "Model merging.") — read as
  // emphasis, not block headings. ':' is deliberately allowed ("Reference frameworks:").
  if (text.endsWith(".")) return false;
  if (isRunInLabel(text)) return false;
  // Block headings are capitalized. A bold line starting lowercase is almost
  // always a stray bold word or a borderless table cell, not a heading.
  const c0 = Array.from(text)[0];
  if (c0 !== undefined && isLowercase(c0)) return false;
  // Reject bold-uniform lines dominated by digits / punctuation — these are
  // almost always cells inside a tabular layout the table detector didn't pick up.
  if (alphaRatio(text) < f32(0.5)) return false;
  // Tabular shape rejection. Two passes because the projection sometimes
  // collapses a wide multi-column line into a single span with column-
  // padding spaces — span-based detection misses those.
  if (splitCells(line).length >= TABLE_MIN_COLUMNS) return false;
  // Text-based fallback: ≥3 tokens separated by runs of 2+ spaces.
  const multiSpaceTokens = text
    .split("  ")
    .map((s) => trim(s))
    .filter((s) => s !== "").length;
  if (multiSpaceTokens >= TABLE_MIN_COLUMNS) return false;
  if (prev !== null && continuesParagraph(prev, line)) return false;
  if (next === null) return true;
  // A wrapped multi-line bold heading ("Cellular Cycle\nand Replication")
  // would otherwise be rejected here because line 1's next line continues
  // the paragraph. Accept the case where `next` is itself an all-bold
  // line — the `heading_run` merge in classify will absorb the continuation.
  return !continuesParagraph(line, next) || lineAllBold(next);
}

/** Marker characters of a numbered heading: digits, '.', ')' and '('. */
function isMarkerSpan(text: string): boolean {
  for (const c of text) {
    if (!isAsciiDigit(c) && c !== "." && c !== ")" && c !== "(") return false;
  }
  return true;
}

/**
 * Returns true if `line` is a numbered section heading like "1. **Foo**" —
 * `parse_list_marker` already matched the "N." / "N)" prefix; this checks
 * that the body after the marker is uniformly bold body-size text and that
 * the line has a paragraph break above it. When true the caller should emit a
 * Heading at `heading_map.len()+1` rather than a ListItem. Mirrors
 * `looksLikeBoldHeading`'s gating modulo the marker.
 */
export function looksLikeNumberedBoldHeading(
  line: ProjectedLine,
  rest: string,
  prev: ProjectedLine | null
): boolean {
  const restTrim = trim(rest);
  if (restTrim === "" || charCount(restTrim) > BOLD_HEADING_MAX_CHARS) return false;
  if (isCaptionLine(line.text)) return false;
  if (restTrim.endsWith(".")) {
    let stops = 0;
    for (const c of restTrim) if (c === "." || c === "?" || c === "!") stops += 1;
    // "1. Sentence one. Sentence two." → not a heading.
    if (stops >= 2) return false;
  }
  // The spans after the marker must all be bold and non-mono.
  let sawBoldBody = false;
  let sawNonBoldBody = false;
  for (const span of line.spans) {
    const text = trim(span.text);
    if (text === "") continue;
    if (isMarkerSpan(text)) continue;
    if (isMonoItem(span)) return false;
    if (isBoldItem(span)) sawBoldBody = true;
    else sawNonBoldBody = true;
  }
  if (!sawBoldBody || sawNonBoldBody) return false;
  // Mostly alphabetic — rejects tabular bold rows of digits.
  if (alphaRatio(restTrim) < f32(0.5)) return false;
  // Paragraph-break gap above. We deliberately don't require gap_below: a
  // numbered section heading is often followed by another bold body line
  // which would satisfy `continuesParagraph`.
  return prev === null || !continuesParagraph(prev, line);
}
