// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/lists.rs (crates-v2.21.2, Apache-2.0): list markers.

import { chars, f32, isWhitespace, trimStart } from "../../rust.js";

/**
 * Roughly one indent step in PDF points. Used to bucket list items into
 * nesting levels relative to the first item of the list.
 */
export const LIST_INDENT_STEP_PT: number = f32(12.0);

/**
 * Characters recognized as bullet markers when followed by whitespace.
 * Limited to glyphs that are unlikely to appear at line-start in normal prose.
 * `\u{f0b7}` is the Symbol-font bullet (0xB7) that Word/Adobe emit into the
 * Private Use Area; it isn't remapped to `•` during extraction, so recognize
 * it here rather than let it read as an undecodable label.
 * `-`, `–` (en dash), `—` (em dash) cover dash bullets (LNCS style uses en
 * dashes; PDFium normalizes them to `-`): a line starting with a dash
 * followed by whitespace is a Markdown bullet, not prose (#488). A bare
 * hyphen without trailing space (e.g. `-5`, hyphenated words) does not match.
 */
const BULLET_CHARS: ReadonlySet<string> = new Set([
  "•",
  "·",
  "◦",
  "▪",
  "▸",
  "▶",
  "●",
  "○",
  "■",
  "□",
  "\u{f0b7}",
  "-",
  "–",
  "—",
]);

/** `s.strip_prefix(char::is_whitespace)`: drop one leading whitespace character, or null. */
function stripOneWhitespace(s: string): string | null {
  const first = chars(s)[0];
  return first !== undefined && isWhitespace(first) ? s.slice(first.length) : null;
}

/**
 * Detect a list marker at the start of `text`. Returns `[ordered, marker, remainder]`
 * when matched; otherwise null.
 *
 * Recognizes:
 * - Unicode bullet characters (`BULLET_CHARS`) followed by whitespace.
 * - Decimal-prefix markers like `1.` / `1)` / `12.` / `12)` followed by
 *   whitespace, kept strict (digits only) so things like footnote callers
 *   (`1` alone) and section refs (`A.1`) don't match.
 */
export function parseListMarker(text: string): [boolean, string, string] | null {
  const trimmed = trimStart(text);
  if (trimmed === "") return null;
  const first = chars(trimmed)[0];

  // Unicode bullet
  if (BULLET_CHARS.has(first)) {
    const restTrim = stripOneWhitespace(trimmed.slice(first.length));
    if (restTrim !== null) return [false, first, trimStart(restTrim)];
  }

  // Decimal: 1. / 1) / 12. / 12)
  if (first >= "0" && first <= "9") {
    let digitEnd = 1;
    while (digitEnd < trimmed.length && trimmed[digitEnd] >= "0" && trimmed[digitEnd] <= "9") {
      digitEnd++;
    }
    // Cap to keep us from matching page-number-like prefixes
    if (digitEnd <= 3) {
      const punct = chars(trimmed.slice(digitEnd))[0];
      if (punct === "." || punct === ")") {
        const restTrim = stripOneWhitespace(trimmed.slice(digitEnd + 1));
        if (restTrim !== null) {
          return [true, `${trimmed.slice(0, digitEnd)}${punct}`, trimStart(restTrim)];
        }
      }
    }
  }
  return null;
}

/**
 * Split a leading ordered-marker token (`a.`, `iv)`, `(a)`) off `text`,
 * returning `[body, marker, rest]` where `body` is the inner letters, `marker`
 * is the full token as written, and `rest` is the trimmed remainder. Requires
 * whitespace after the marker and a non-empty remainder. Does *not* validate
 * that `body` is a real letter/roman marker: the caller does that via
 * `markerInterpretations`.
 */
export function splitOrderedMarker(text: string): [string, string, string] | null {
  const t = trimStart(text);
  const cs = chars(t);
  if (cs.length === 0) return null;
  // Paren-wrapped: "(a)" / "(iv)"
  if (cs[0] === "(") {
    const close = cs.indexOf(")");
    if (close === -1) return null;
    if (close < 2) return null; // "()"
    const afterParen = cs.slice(close + 1).join("");
    const rest0 = stripOneWhitespace(afterParen);
    if (rest0 === null) return null;
    const rest = trimStart(rest0);
    if (rest === "") return null;
    const body = cs.slice(1, close).join("");
    return [body, `(${body})`, rest];
  }
  // Suffix form: letters followed by '.' or ')'
  let letterChars = 0;
  while (letterChars < cs.length && /^[A-Za-z]$/.test(cs[letterChars])) letterChars++;
  if (letterChars === 0 || letterChars > 7) return null;
  const punct = cs[letterChars];
  if (punct !== "." && punct !== ")") return null;
  const rest0 = stripOneWhitespace(cs.slice(letterChars + 1).join(""));
  if (rest0 === null) return null;
  const rest = trimStart(rest0);
  if (rest === "") return null;
  const body = cs.slice(0, letterChars).join("");
  return [body, `${body}${punct}`, rest];
}

/** For a line already confirmed as an ordered-list member, extract `[marker, rest]` for emission. */
export function splitOrderedMarkerForEmit(text: string): [string, string] | null {
  const parts = splitOrderedMarker(text);
  if (parts === null) return null;
  return [parts[1], parts[2]];
}
