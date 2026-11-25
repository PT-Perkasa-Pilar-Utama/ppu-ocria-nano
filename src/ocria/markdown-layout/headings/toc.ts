// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/headings.rs (crates-v2.21.2, Apache-2.0): table-of-contents detection.

import { f32, isAlphabetic, isWhitespace, trim } from "../../rust.js";
import { isAsciiDigit, toAsciiLowercase, trimEndChars } from "../../rust-extra.js";
import type { ParsedPage } from "../../types/page.js";
import { isRotatedLine } from "../classify/index.js";

const ROMAN_DIGITS = "ivxlcdmIVXLCDM";

/** Index where the separator before a TOC page number starts, and whether it held whitespace. */
type Separator = { sepEnd: number; sawWs: boolean };

function separatorBefore(chars: string[], tailStart: number): Separator {
  let sepEnd = tailStart;
  let sawWs = false;
  while (sepEnd > 0) {
    const c = chars[sepEnd - 1];
    if (isWhitespace(c)) {
      sepEnd -= 1;
      sawWs = true;
    } else if (c === ".") {
      sepEnd -= 1;
    } else {
      break;
    }
  }
  return { sepEnd, sawWs };
}

/**
 * Trailing page-number extractor for TOC-entry shaped lines. Returns the
 * numeric value of the trailing page number when the line looks like a TOC
 * entry: alphabetic body, separator that *includes whitespace* (to reject
 * decimals like "94.2"), then a trailing arabic 1–4 digit number. Roman
 * numerals are accepted in `looksLikeTocEntry` but not returned for the
 * monotonic-sequence check.
 */
export function tocEntryArabicNumber(text: string): number | null {
  const s = trim(text);
  if (s === "") return null;
  const chars = Array.from(s);
  const n = chars.length;
  let tailStart = n;
  while (tailStart > 0 && isAsciiDigit(chars[tailStart - 1])) tailStart -= 1;
  const tailLen = n - tailStart;
  if (tailLen === 0 || tailLen > 4) return null;
  // The mandatory whitespace rules out decimals ("94.2") and inline number
  // suffixes ("Recall3 7 94.2") that aren't TOC entries.
  const { sepEnd, sawWs } = separatorBefore(chars, tailStart);
  if (!sawWs) return null;
  // Body must (a) carry meaningful alpha content and (b) NOT end with a
  // digit — that would mean we sliced a multi-part number ("vol 5 12").
  const body = chars.slice(0, sepEnd);
  const alpha = body.filter(isAlphabetic).length;
  // Require ≥8 alpha chars in the body. This keeps real one-word headings
  // like "Chapter 7" / "Section 4" out of the TOC bucket while still
  // accepting typical TOC entries ("Introduction 7", "Conclusion 127", ...).
  if (alpha < 8) return null;
  const lastNonWs = body.findLast((c) => !isWhitespace(c));
  if (lastNonWs !== undefined && isAsciiDigit(lastNonWs)) return null;
  return Number.parseInt(chars.slice(tailStart).join(""), 10);
}

/**
 * Roman-or-arabic TOC-entry detector — used by tests and the TOC-page
 * detector to count TOC-shaped lines that the strict arabic extractor
 * above misses (e.g. "Author's Note ... ix").
 */
export function looksLikeTocEntry(text: string): boolean {
  if (tocEntryArabicNumber(text) !== null) return true;
  // Try Roman numerals at the tail.
  const chars = Array.from(trim(text));
  const n = chars.length;
  let tailStart = n;
  while (tailStart > 0 && ROMAN_DIGITS.includes(chars[tailStart - 1])) tailStart -= 1;
  const tailLen = n - tailStart;
  if (tailLen < 2 || tailLen > 6) return false;
  const { sepEnd, sawWs } = separatorBefore(chars, tailStart);
  if (!sawWs) return false;
  return chars.slice(0, sepEnd).filter(isAlphabetic).length >= 5;
}

const TOC_TITLES = new Set([
  "contents",
  "table of contents",
  "table of content",
  "index",
  "list of figures",
  "list of tables",
  "table of figures",
  "toc",
]);

/**
 * Returns true if `text` is the canonical title of a TOC page: "Contents",
 * "Table of Contents", "Index", etc. We use this to let the TOC's own title
 * through the heading promotion that's otherwise suppressed on TOC pages.
 */
export function isTocTitle(text: string): boolean {
  return TOC_TITLES.has(toAsciiLowercase(trimEndChars(trim(text), ":")));
}

/**
 * TOC-page detection. A page is a TOC iff it carries ≥4 arabic-trailing
 * TOC-entry lines whose page numbers form a *mostly non-decreasing*
 * sequence (≥70% of adjacent pairs satisfy `next >= prev`). The
 * monotonicity check is what separates real TOCs from chart/graph pages
 * with random axis-value tails. Lines whose tail isn't arabic but matches
 * the looser `looksLikeTocEntry` (e.g. roman numerals "ix", "xi") still
 * count toward the row floor — they just don't participate in the
 * monotonicity check.
 */
export function pageIsToc(page: ParsedPage): boolean {
  const nums: number[] = [];
  let totalTocLike = 0;
  for (const line of page.projected_lines) {
    if (isRotatedLine(line)) continue;
    const n = tocEntryArabicNumber(line.text);
    if (n !== null) {
      nums.push(n);
      totalTocLike += 1;
    } else if (looksLikeTocEntry(line.text)) {
      totalTocLike += 1;
    }
  }
  if (totalTocLike < 4 || nums.length < 3) return false;
  let nondec = 0;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] >= nums[i - 1]) nondec += 1;
  }
  const frac = f32(f32(nondec) / f32(nums.length - 1));
  return frac >= f32(0.7);
}
