// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/tables.rs (crates-v2.21.2, Apache-2.0): description-list text predicates.

import { charCount, chars, isAlphabetic, trim, trimStart } from "../../../rust.js";
import {
  isAsciiAlphabetic,
  isAsciiDigit,
  splitWhitespace,
  toAsciiLowercase,
} from "../../../rust-extra.js";
import { DESC_LIST_LABEL_MAX_CHARS, DESC_LIST_LABEL_MAX_WORDS } from "./constants.js";

const BULLET_GLYPHS = new Set([
  "•",
  "●",
  "○",
  "◦",
  "▪",
  "■",
  "□",
  "‣",
  "⁃",
  "*",
  "-",
  "–",
  "—",
  "⮚",
  "►",
  "▶",
  // Symbol-font bullet in the Private Use Area (undecoded 0xB7).
  "\u{f0b7}",
]);
const ROMAN_PAGE_LETTERS = new Set(["i", "v", "x", "l", "c", "d", "m"]);
const ROMAN_MARKER_LETTERS = new Set(["i", "v", "x", "I", "V", "X"]);
const CAPTION_PREFIXES = ["figure ", "fig. ", "fig ", "table ", "tab. ", "tab "];
const ASCII_UPPERCASE = /^[A-Z]$/;

/**
 * Discriminates "label-like" col-0 text from prose fragments. Real
 * description-list labels are short noun-phrases (1-4 words, no terminal
 * sentence punctuation, no internal sentence boundary). Body prose that
 * happens to be projection-merged with a right-column line tends to fail at
 * least one of these.
 */
export function isLabelLike(text: string): boolean {
  const trimmed = trim(text);
  if (trimmed === "") return false;
  if (charCount(trimmed) > DESC_LIST_LABEL_MAX_CHARS) return false;
  // Pure bullet glyph (or bullet+digit like "1.") is not a label: that's a
  // list item, which the list classifier handles.
  if (isBulletOnly(trimmed)) return false;
  const wordCount = splitWhitespace(trimmed).length;
  if (wordCount === 0 || wordCount > DESC_LIST_LABEL_MAX_WORDS) return false;
  // Internal sentence boundary ("foo. Bar") = prose, not a label. A trailing
  // period is fine ("Item.") and a trailing colon is fine ("Note:").
  for (let i = 0; i + 2 < trimmed.length; i++) {
    if (trimmed[i] === "." && trimmed[i + 1] === " " && ASCII_UPPERCASE.test(trimmed[i + 2])) {
      return false;
    }
  }
  return true;
}

/**
 * Cell text reads as a page number reference: pure digits, pure roman
 * numerals (i, ii, iv, ..., IX, X), or a digit followed by trivial punctuation.
 */
export function isPageRef(text: string): boolean {
  const t = trim(text);
  if (t === "") return false;
  if (chars(t).every(isAsciiDigit)) return true;
  const lower = toAsciiLowercase(t);
  if (chars(lower).every((c) => ROMAN_PAGE_LETTERS.has(c))) {
    // Cap length so multi-word lowercase Latin words don't pass (e.g.
    // "mix", "civil" would all be made of roman-numeral letters).
    if (charCount(t) <= 6) return true;
  }
  return false;
}

export function isBulletOnly(text: string): boolean {
  const t = trim(text);
  if (t === "") return false;
  const cs = chars(t);
  if (cs.every((c) => BULLET_GLYPHS.has(c))) return true;
  // Numeric list marker: "1.", "1)", "(1)", "i.", "ii.", "a.", "(a)" etc.:
  // all are list markers, not table labels.
  const isParenMarker =
    cs[0] === "(" &&
    cs[cs.length - 1] === ")" &&
    (() => {
      const inner = cs.slice(1, cs.length - 1);
      return inner.every(isAsciiDigit) || (inner.length === 1 && isAsciiAlphabetic(inner[0]));
    })();
  if (isParenMarker && cs.length <= 5) return true;
  const trailing = cs[cs.length - 1];
  if (trailing === "." || trailing === ")") {
    const body = cs.slice(0, cs.length - 1);
    if (
      body.length > 0 &&
      (body.every(isAsciiDigit) ||
        body.every((c) => ROMAN_MARKER_LETTERS.has(c)) ||
        // Single-letter lettered-list marker: "a.", "b)", "A.": a short marker
        // column beside wrapped body text is a nested ordered list, not a
        // 2-column description table.
        (body.length === 1 && isAsciiAlphabetic(body[0])))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Heuristic: line text reads like a figure or table caption. Used to break a
 * description-list run before absorbing a caption that happens to straddle the
 * table's column anchors.
 */
export function looksLikeCaption(text: string): boolean {
  const lower = toAsciiLowercase(trimStart(text));
  for (const prefix of CAPTION_PREFIXES) {
    if (lower.startsWith(prefix)) {
      // Require a digit right after to avoid matching prose sentences that
      // happen to start with "Table" / "Figure".
      const rest = chars(lower.slice(prefix.length));
      if (rest.length > 0 && isAsciiDigit(rest[0])) return true;
    }
  }
  return false;
}

/** `chars().any(is_alphabetic)`. */
export function hasAlphabetic(text: string): boolean {
  return chars(text).some(isAlphabetic);
}
