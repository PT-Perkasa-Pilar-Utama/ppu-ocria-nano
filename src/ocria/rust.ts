// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Rust semantics the LiteParse port depends on. JavaScript's Math, String and
// RegExp differ from Rust's std in rounding, casts, Unicode classes and trim;
// every ported file uses these helpers so its results match the Rust bit for
// bit (f32 arithmetic through Math.fround).

/** Round to f32, as Rust's `as f32` and every f32 operation do. */
export const f32: (x: number) => number = Math.fround;

/** `f64::round_ties_even` (also OpenCV's cvRound in the default FP mode). */
export function roundTiesEven(v: number): number {
  if (Math.abs(v % 1) === 0.5) return 2 * Math.round(v / 2);
  return Math.round(v);
}

/** `v as usize`: truncate toward zero, saturating at 0; NaN is 0. */
export function asUsize(v: number): number {
  return v > 0 ? Math.trunc(v) : 0;
}

/** `v as i64` (and `as i32` for values the code keeps in range): truncate toward zero; NaN is 0. */
export function asInt(v: number): number {
  return Number.isNaN(v) ? 0 : Math.trunc(v);
}

/** `a.clamp(lo, hi)` for numbers. */
export function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** `f32::rem_euclid` / `f64::rem_euclid`. */
export function remEuclid(a: number, b: number): number {
  const r = a % b;
  return r < 0 ? r + Math.abs(b) : r;
}

/**
 * `f64::total_cmp` as a sort comparator. Rust orders -0 before +0 and NaN
 * after every number; the pipeline never sorts NaN, so only the zero sign is
 * kept.
 */
export function totalCmp(a: number, b: number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  if (a === 0 && b === 0) {
    const sa = Object.is(a, -0) ? -1 : 0;
    const sb = Object.is(b, -0) ? -1 : 0;
    return sa - sb;
  }
  return 0;
}

const ALPHABETIC = /\p{Alphabetic}/u;
const NUMERIC = /\p{N}/u;
const WHITESPACE = /\p{White_Space}/u;
const UPPERCASE = /\p{Uppercase}/u;
const LOWERCASE = /\p{Lowercase}/u;
const TRIM = /^\p{White_Space}+|\p{White_Space}+$/gu;
const TRIM_START = /^\p{White_Space}+/u;
const TRIM_END = /\p{White_Space}+$/u;

/** `char::is_alphabetic` (the Alphabetic property). `c` is one code point. */
export function isAlphabetic(c: string): boolean {
  return ALPHABETIC.test(c);
}

/** `char::is_numeric` (general categories Nd, Nl, No). */
export function isNumeric(c: string): boolean {
  return NUMERIC.test(c);
}

/** `char::is_alphanumeric`. */
export function isAlphanumeric(c: string): boolean {
  return ALPHABETIC.test(c) || NUMERIC.test(c);
}

/** `char::is_whitespace` (the White_Space property; JS `\s` differs). */
export function isWhitespace(c: string): boolean {
  return WHITESPACE.test(c);
}

/** `char::is_uppercase` (the Uppercase property). */
export function isUppercase(c: string): boolean {
  return UPPERCASE.test(c);
}

/** `char::is_lowercase` (the Lowercase property). */
export function isLowercase(c: string): boolean {
  return LOWERCASE.test(c);
}

/** `str::trim`: White_Space at both ends. JS `trim()` also strips U+FEFF and keeps U+0085. */
export function trim(s: string): string {
  return s.replace(TRIM, "");
}

/** `str::trim_start`. */
export function trimStart(s: string): string {
  return s.replace(TRIM_START, "");
}

/** `str::trim_end`. */
export function trimEnd(s: string): string {
  return s.replace(TRIM_END, "");
}

/** `s.chars()`: the code points of `s`. */
export function chars(s: string): string[] {
  return Array.from(s);
}

/** `s.chars().count()`. */
export function charCount(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** The code point of a one-character string (`c as u32`). */
export function cp(c: string): number {
  // SAFETY: callers pass one code point from `chars()` or a `for..of` over a string.
  return c.codePointAt(0) as number;
}
