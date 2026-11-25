// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/paragraphs.rs (crates-v2.21.2, Apache-2.0): text helpers.

import {
  chars,
  isAlphabetic,
  isAlphanumeric,
  isLowercase,
  isWhitespace,
  trimEnd,
  trimStart,
} from "../../rust.js";
import { trimEndChars } from "../../rust-extra.js";

/** The last `n`-th code point from the end of `s` (`s.chars().rev().nth(n)`). */
function nthFromEnd(s: string, n: number): string | undefined {
  const cs = chars(s);
  return cs[cs.length - 1 - n];
}

/** `s.trim_start().chars().next().is_some_and(char::is_lowercase)`. */
export function startsLowercase(s: string): boolean {
  const c = chars(trimStart(s))[0];
  return c !== undefined && isLowercase(c);
}

/**
 * Collapse runs of whitespace into single spaces. The projected text from
 * `projection.rs` pads with column-alignment spaces (e.g. `for    instance`)
 * which look fine as a layout grid but are wrong for prose.
 */
export function collapseWhitespace(s: string): string {
  let out = "";
  let prevSpace = false;
  for (const c of s) {
    if (isWhitespace(c)) {
      if (!prevSpace && out !== "") out += " ";
      prevSpace = true;
    } else {
      out += c;
      prevSpace = false;
    }
  }
  return out.endsWith(" ") ? out.slice(0, -1) : out;
}

/**
 * True when `text` ends with a mid-word soft hyphen: a trailing `-` whose
 * preceding character is a letter. Distinguishes a wrapped word (`architec-`)
 * from a dangling list marker (`-`) or a numeric range (`5-`), neither of
 * which should be rejoined. Unicode-aware, so accented stems (`café-`)
 * qualify. Trims trailing whitespace first.
 *
 * Single source of truth for the "ends open on a hyphen" test; the heading
 * continuation guard, region stitching, and block joining all key off this.
 */
export function endsHyphenated(text: string): boolean {
  const t = trimEnd(text);
  const c = nthFromEnd(t, 1);
  return t.endsWith("-") && c !== undefined && isAlphabetic(c);
}

/**
 * True when `text` ends with a hyphen attached to a letter or digit (`architec-`,
 * `pyridine-3-`, `Billion-`): the token continues on the next line. A detached ` -`
 * (a dash, a list marker) does not.
 */
export function endsOpenHyphen(text: string): boolean {
  const t = trimEnd(text);
  const c = nthFromEnd(t, 1);
  return t.endsWith("-") && c !== undefined && isAlphanumeric(c);
}

/**
 * True when `text` ends a sentence: its last non-space character (ignoring a
 * trailing closing quote / bracket) is `.`, `!`, or `?`. The heading
 * lowercase-continuation guard uses the negation: a previous line that does
 * *not* end a sentence is an open clause that a following lowercase line
 * continues, even when its left-edge indent defeats `continuesParagraph`.
 */
export function endsSentenceFinal(text: string): boolean {
  const t = trimEndChars(trimEnd(text), "\"')]»”’");
  const last = chars(t).pop();
  return last === "." || last === "!" || last === "?";
}

/**
 * True when `prev` ends with a soft hyphen (see `endsHyphenated`) and
 * `next` begins with a lowercase letter: the signal that a single word was
 * split across a line / block / region break and should be rejoined with the
 * hyphen dropped and no separator (`architec-` + `ture` becomes `architecture`). A
 * capitalized continuation (`well-` + `Known`) is left as a real compound.
 */
export function isSoftHyphenBreak(prev: string, next: string): boolean {
  return endsHyphenated(prev) && startsLowercase(next);
}

/**
 * Append `toAppend` onto `prev`, de-hyphenating across the boundary. When
 * the boundary is a soft hyphen break (see `isSoftHyphenBreak`, tested
 * against `check`, the plain text of the continuation), the trailing hyphen
 * is dropped and the text concatenated directly (`co-` + `operate` becomes
 * `cooperate`); otherwise the join is a single space.
 *
 * `check` and `toAppend` are separate so a caller tracking a styled `inline`
 * representation can test the condition against the raw text while appending
 * the inline-rendered chunk. Plain-text callers pass the same string twice.
 *
 * Rust mutates `prev`; a JS string cannot be, so this returns the new `prev`.
 */
export function dehyphenateJoin(prev: string, check: string, toAppend: string): string {
  if (check === "") return prev;
  if (prev === "") return toAppend;
  if (isSoftHyphenBreak(prev, check)) {
    // drop trailing whitespace, then the soft hyphen (an ASCII `-`)
    return trimEnd(prev).slice(0, -1) + trimStart(toAppend);
  }
  if (endsOpenHyphen(prev)) {
    // a hard hyphen at the break (`pyridine-3-` + `carbonitrile`, `well-` + `Known`): one
    // token, hyphen kept, no space
    return trimEnd(prev) + trimStart(toAppend);
  }
  return `${prev} ${toAppend}`;
}
