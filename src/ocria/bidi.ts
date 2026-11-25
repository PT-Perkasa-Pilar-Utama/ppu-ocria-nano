// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/bidi.rs (crates-v2.21.2, Apache-2.0).

// PDF content streams store right-to-left text in logical order already, so
// liteparse never reverses characters; it only stops assuming that "left to
// right on the page" means "first to last in reading order".

import { cp, isAlphabetic } from "./rust.js";

/** Strong right-to-left character (Unicode bidi class R or AL) by block. */
export function isRtlChar(c: string): boolean {
  const u = cp(c);
  return (
    (u >= 0x0590 && u <= 0x05ff) ||
    (u >= 0x0600 && u <= 0x07bf) ||
    (u >= 0x0800 && u <= 0x085f) ||
    (u >= 0x08a0 && u <= 0x08ff) ||
    (u >= 0xfb1d && u <= 0xfdff) ||
    (u >= 0xfe70 && u <= 0xfeff) ||
    (u >= 0x10800 && u <= 0x10fff) ||
    (u >= 0x1e800 && u <= 0x1efff)
  );
}

/** Strong left-to-right character; digits, punctuation and whitespace are neutral. */
function isStrongLtrChar(c: string): boolean {
  return isAlphabetic(c) && !isRtlChar(c);
}

/** Base direction of a run of characters, by majority of strong-direction characters. */
function isRtlChars(cs: Iterable<string>): boolean {
  let rtl = 0;
  let ltr = 0;
  for (const c of cs) {
    if (isRtlChar(c)) rtl++;
    else if (isStrongLtrChar(c)) ltr++;
  }
  return rtl > ltr;
}

/** `str::is_ascii`. */
function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x7f) return false;
  return true;
}

/** Base direction of a line of text. */
export function isRtlText(s: string): boolean {
  return !isAscii(s) && isRtlChars(s);
}

/** Base direction of a line still held as separate pieces. */
export function isRtlPieces(pieces: readonly string[]): boolean {
  if (pieces.every(isAscii)) return false;
  return isRtlChars(pieces.join(""));
}
