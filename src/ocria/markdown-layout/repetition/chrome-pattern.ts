// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/repetition.rs (crates-v2.21.2, Apache-2.0): running-chrome text signatures.

import { isAsciiDigit, utf8Len } from "../../rust-extra.js";
import { trim } from "../../rust.js";

const UTF8 = new TextEncoder();

/** `u8::is_ascii_digit`. */
function isDigitByte(b: number): boolean {
  return b >= 0x30 && b <= 0x39;
}

/** `u8::is_ascii_alphanumeric`. */
function isAlnumByte(b: number): boolean {
  return isDigitByte(b) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a);
}

const V = 0x76;
const O = 0x6f;
const L = 0x6c;
const DOT = 0x2e;
const SPACE = 0x20;
const COMMA = 0x2c;

/** A "vol" marker (`Vol. 24`, `Vol 24`, `vol,24`) at a word start with a digit later in the line. */
function hasVolumeMarker(lower: string): boolean {
  const lb = UTF8.encode(lower);
  // ASCII-only check: the prefix we look for ("vol") is pure ASCII and we test bytes one at a time.
  for (let i = 0; i < Math.max(lb.length - 4, 0); i++) {
    const startsWord = i === 0 || !isAlnumByte(lb[i - 1]);
    if (!startsWord) continue;
    if (lb[i] === V && lb[i + 1] === O && lb[i + 2] === L) {
      const sep = lb[i + 3];
      if (sep === DOT || sep === SPACE || sep === COMMA) {
        // any digit later in the line is enough
        for (let j = i + 4; j < lb.length; j++) if (isDigitByte(lb[j])) return true;
      }
    }
  }
  return false;
}

/** A 4-digit year (19xx or 20xx) standing as its own word. */
export function hasYear(lower: string): boolean {
  const bytes = UTF8.encode(lower);
  for (let i = 0; i < Math.max(bytes.length - 3, 0); i++) {
    const startsWord = i === 0 || !isAlnumByte(bytes[i - 1]);
    if (!startsWord) continue;
    const one9 = bytes[i] === 0x31 && bytes[i + 1] === 0x39;
    const two0 = bytes[i] === 0x32 && bytes[i + 1] === 0x30;
    if ((one9 || two0) && isDigitByte(bytes[i + 2]) && isDigitByte(bytes[i + 3])) {
      const endsWord = i + 4 >= bytes.length || !isAlnumByte(bytes[i + 4]);
      if (endsWord) return true;
    }
  }
  return false;
}

/** Digit, optional spaces, '-' or '–' or '—', optional spaces, digit: a numeric page range. */
export function hasDigitRange(t: string): boolean {
  const chars = Array.from(t);
  let i = 0;
  while (i < chars.length) {
    if (!isAsciiDigit(chars[i])) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < chars.length && isAsciiDigit(chars[j])) j += 1;
    const g1Len = j - i;
    let k = j;
    while (k < chars.length && chars[k] === " ") k += 1;
    if (k < chars.length && (chars[k] === "-" || chars[k] === "–" || chars[k] === "—")) {
      let m = k + 1;
      while (m < chars.length && chars[m] === " ") m += 1;
      if (m < chars.length && isAsciiDigit(chars[m])) {
        let n = m + 1;
        while (n < chars.length && isAsciiDigit(chars[n])) n += 1;
        const g2Len = n - m;
        // A `YYYY-MM` / `YYYY-MM-DD` date is not a page range. A real
        // citation page range never starts with a 4-digit calendar
        // year whose second component is a 1-2 digit month — that
        // pattern is an administrative date (e.g. a "MS-2024-07"
        // tracking number), so skip it and keep scanning for a
        // genuine range elsewhere on the line.
        const g1IsYear =
          g1Len === 4 &&
          ((chars[i] === "1" && chars[i + 1] === "9") ||
            (chars[i] === "2" && chars[i + 1] === "0"));
        if (!(g1IsYear && g2Len <= 2)) return true;
        i = n;
        continue;
      }
    }
    i = j;
  }
  return false;
}

/**
 * Heuristic check: does the line text match a known running-chrome
 * signature? URLs/DOIs, journal-article preamble ("Please cite this
 * article…"), `Page N of M`, copyright marks, volume/issue markers, and
 * journal citation lines (year + page range + ≤ ~120 chars).
 *
 * Returns true only for unambiguous chrome patterns — false-positive
 * recall on body prose is the main risk to guard.
 */
export function matchesChromePattern(text: string): boolean {
  const t = trim(text);
  if (t === "") return false;
  const lower = t.toLowerCase();

  // URL / DOI prefixes — chrome lines are very often a citation URL.
  if (
    lower.includes("http://") ||
    lower.includes("https://") ||
    lower.startsWith("www.") ||
    lower.includes(" www.") ||
    lower.includes("doi:") ||
    lower.includes("doi.org/") ||
    lower.includes("dx.doi.org")
  ) {
    return true;
  }

  // Common journal-paper top-banner phrases.
  if (
    lower.includes("please cite this article") ||
    lower.includes("contents lists available at") ||
    lower.includes("available online at") ||
    lower.includes("downloaded from")
  ) {
    return true;
  }

  // Copyright / trademark chrome.
  if (t.includes("©") || lower.includes("copyright ") || lower.includes("all rights reserved")) {
    return true;
  }

  // "Page N", "Page N of M", standalone page numbers.
  if (lower.startsWith("page ") && isAsciiDigit(Array.from(lower.slice(5))[0] ?? "")) return true;
  // Lone page number (≤4 digits).
  if (Array.from(t).every(isAsciiDigit) && utf8Len(t) <= 4) return true;

  // Volume / Issue markers ("Vol. 24" / "Vol 24" / "No. 3").
  if (hasVolumeMarker(lower)) return true;
  // Journal-cite-style: contains a 4-digit year (19xx/20xx) AND a numeric
  // page range (digits[-–]digits) AND short enough to plausibly be chrome.
  return utf8Len(t) <= 120 && hasYear(lower) && hasDigitRange(t);
}
