// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/ocr/ocria/page.rs (crates-v2.21.2, Apache-2.0).

// The reading filters: script characters, lookalike folding, short tokens and junk.

import {
  chars,
  charCount,
  cp,
  f32,
  isAlphabetic,
  isAlphanumeric,
  isLowercase,
  isUppercase,
  isWhitespace,
  trim,
} from "../rust.js";

const SCRIPT_RANGES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [
    [0x00c0, 0x024f],
    [0x0370, 0x04ff],
  ],
  [
    [0x3040, 0x30ff],
    [0x3400, 0x9fff],
    [0xac00, 0xd7af],
    [0xf900, 0xfaff],
  ],
  [
    [0x0590, 0x08ff],
    [0xfb1d, 0xfdff],
    [0xfe70, 0xfeff],
  ],
  [
    [0x0900, 0x0dff],
    [0x0e00, 0x0eff],
    [0x0f00, 0x109f],
    [0x10a0, 0x10ff],
    [0x0530, 0x058f],
    [0x1200, 0x139f],
    [0x1780, 0x17ff],
  ],
];

function inRanges(u: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  return ranges.some(([a, b]) => u >= a && u <= b);
}

function isAsciiAlphabetic(u: number): boolean {
  return (u >= 0x41 && u <= 0x5a) || (u >= 0x61 && u <= 0x7a);
}

/** Characters that show a reading really is in `group`'s script. */
export function scriptChars(group: number, text: string): number {
  // SAFETY: group is a GROUPS index (0..4); the last entry covers every other value.
  const ranges = SCRIPT_RANGES[Math.min(group, 3)];
  let n = 0;
  for (const c of text) {
    const u = cp(c);
    if ((group === 0 && isAsciiAlphabetic(u)) || inRanges(u, ranges)) n++;
  }
  return n;
}

/** First-match lookup table from two zipped strings (Rust `zip` stops at the shorter). */
function zipMap(pairs: ReadonlyArray<readonly [string, string]>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [from, to] of pairs) {
    const a = chars(from);
    const b = chars(to);
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (!m.has(a[i])) m.set(a[i], b[i]);
    }
  }
  return m;
}

/** Cyrillic / Greek lookalikes of Latin letters. */
const HOMO_FROM = "аеорсухкіјѕԁԛԝАВЕКМНОРСТХІЈЅΑΒΕΖΗΙΚΜΝΟΡΤΥΧοαν";
const HOMO_TO = "aeopcyxkijsdqwABEKMHOPCTXIJSABEZHIKMNOPTYXoav";
/**
 * Lookalikes from the other scripts a Latin line picks up: the Latin
 * recognizer's own foreign classes (Thai, Armenian) and the world recognizer
 * reading a Latin line. Zero digits that look like "o" count here: inside a
 * Latin word they are the letter.
 */
const HOMO_EXTRA_FROM = "ՍսՕօոհցզաԼՏนทรอบ๐ບນຣ໐၀ဝ";
const HOMO_EXTRA_TO = "UuOonhgqwLSunsououusooo";
const HOMO = zipMap([
  [HOMO_FROM, HOMO_TO],
  [HOMO_EXTRA_FROM, HOMO_EXTRA_TO],
]);

/** First code point of each run of decimal digits the recognizers can write besides ASCII. */
const DIGIT_ZEROS = [
  0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0de6,
  0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x1090, 0x17e0,
];

function isLatinLetter(c: string): boolean {
  const u = cp(c);
  return isAsciiAlphabetic(u) || (isAlphabetic(c) && u >= 0x00c0 && u <= 0x024f);
}

/** Latin letters in `text` (ASCII and Latin-1 / Extended-A/B; not Greek or Cyrillic). */
export function latinLetters(text: string): number {
  let n = 0;
  for (const c of text) if (isLatinLetter(c)) n++;
  return n;
}

/** Latin and Greek lookalikes of Cyrillic letters, for a Cyrillic word the Latin recognizer wrote partly in Latin. */
const CYR_FROM = "aceopxyiABCEHKMOPTXYIΑΒΓΕΗΚΜΟΠΡΤΧαο";
const CYR_TO = "асеорхуіАВСЕНКМОРТХУІАВГЕНКМОПРТХао";
const CYR = zipMap([[CYR_FROM, CYR_TO]]);

/**
 * The Latin letter a Cyrillic or other-script lookalike stands for in a Latin
 * word. Small-cap and italic Cyrillic forms only look Latin in context; т н м
 * take the word's case.
 */
function latinLookalike(c: string, upper: boolean): string | undefined {
  const h = HOMO.get(c);
  if (h !== undefined) return h;
  switch (c) {
    case "т":
      return upper ? "T" : "t";
    case "н":
      return upper ? "H" : "h";
    case "м":
      return upper ? "M" : "m";
    case "п":
    case "л":
      return "n";
    case "г":
      return "r";
    default:
      return undefined;
  }
}

function inRange(c: string, lo: number, hi: number): boolean {
  const u = cp(c);
  return u >= lo && u <= hi;
}

function countWhere(cs: readonly string[], pred: (c: string) => boolean): number {
  let n = 0;
  for (const c of cs) if (pred(c)) n++;
  return n;
}

const WHITESPACE_SPLIT = /\p{White_Space}/u;

/**
 * Clean a reading of other scripts' lookalike characters. In a line that is
 * mostly Latin, inside a word with at least as many Latin letters as other
 * letters, lookalikes become the Latin letter, a word of lookalikes alone does
 * too, and other scripts' digits become ASCII digits. Lines mostly in another
 * script are left alone.
 */
export function cleanLatin(text: string): string {
  const all = chars(text);
  const lat = latinLetters(text);
  const oth = countWhere(all, (c) => isAlphabetic(c) && !isLatinLetter(c));
  const latinLine = lat > 0 && lat >= 2 * oth;
  const cyrLine = countWhere(all, (c) => inRange(c, 0x0400, 0x04ff)) > lat;
  let out = "";
  text.split(WHITESPACE_SPLIT).forEach((word, k) => {
    // split() drops the separator; every separator here is one whitespace char
    if (k > 0) out += " ";
    const wc = chars(word);
    const wl = latinLetters(word);
    const wo = countWhere(wc, (c) => isAlphabetic(c) && !isLatinLetter(c));
    const upper = countWhere(wc, isUppercase) > countWhere(wc, isLowercase);
    // Greek letters standing alone are real ("α = 0.05"), never lookalikes
    const allLookalike =
      wo > 0 &&
      wc.every(
        (c) =>
          !isAlphabetic(c) ||
          isLatinLetter(c) ||
          (latinLookalike(c, upper) !== undefined && !inRange(c, 0x0370, 0x03ff))
      );
    // Cyrillic / Greek inside a Latin word fold anywhere; the other scripts'
    // lookalikes only in a Latin line, since Thai and Lao glue Latin words to
    // their own without a space
    const cg = countWhere(wc, (c) => inRange(c, 0x0370, 0x04ff));
    const foldCg = cg > 0 && wl >= cg;
    const fold = latinLine && wo > 0 && (wl >= wo || allLookalike);
    // the other way: a Cyrillic word with Latin / Greek lookalikes inside
    const cyr = countWhere(wc, (c) => inRange(c, 0x0400, 0x04ff));
    const lookalikesOnly = wc
      .filter((c) => isAlphabetic(c) && !inRange(c, 0x0400, 0x04ff))
      .every((c) => CYR_FROM.includes(c));
    const toCyr = (cyr >= 2 && cyr > wl + (cg - cyr)) || (cyr >= 1 && cyrLine && lookalikesOnly);
    for (const c0 of wc) {
      let c = c0;
      if (toCyr) c = CYR.get(c0) ?? c0;
      else if (fold || (foldCg && inRange(c0, 0x0370, 0x04ff))) c = latinLookalike(c0, upper) ?? c0;
      const u = cp(c);
      const z = DIGIT_ZEROS.find((d) => u >= d && u < d + 10);
      out += z !== undefined && latinLine ? String.fromCharCode(0x30 + (u - z)) : c;
    }
  });
  return out;
}

/** A single short token ("1", "12", "x3"): no space, a letter or digit, at most six characters. */
export function isShortToken(text: string): boolean {
  const t = trim(text);
  const cs = chars(t);
  return t !== "" && charCount(t) <= 6 && !cs.some(isWhitespace) && cs.some(isAlphanumeric);
}

const JUNK_CONF = f32(0.8);

/** A detector false positive on a picture: no letter or digit, or 1-2 unsure characters. */
export function isJunk(text: string, conf: number): boolean {
  const word = countWhere(chars(text), isAlphanumeric);
  return word === 0 || (word <= 2 && conf < JUNK_CONF);
}
