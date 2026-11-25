// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Rust std semantics beyond rust.ts (string, ASCII and f32 math helpers), shared by every ported module.

import { f32, isWhitespace } from "./rust.js";

const CONTROL = /\p{Cc}/u;

/** `str::len`: the UTF-8 byte length of `s`. */
export function utf8Len(s: string): number {
  let n = 0;
  for (const c of s) {
    // SAFETY: `for..of` over a string yields one-code-point strings.
    const u = c.codePointAt(0) as number;
    if (u < 0x80) n += 1;
    else if (u < 0x800) n += 2;
    else if (u < 0x10000) n += 3;
    else n += 4;
  }
  return n;
}

/** `str::split_whitespace`: runs of non-White_Space characters. */
export function splitWhitespace(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const c of s) {
    if (isWhitespace(c)) {
      if (cur !== "") out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur !== "") out.push(cur);
  return out;
}

/** `str::trim_matches` with a character predicate. */
export function trimMatches(s: string, pred: (c: string) => boolean): string {
  const cs = Array.from(s);
  let a = 0;
  let b = cs.length;
  while (a < b && pred(cs[a])) a++;
  while (b > a && pred(cs[b - 1])) b--;
  return cs.slice(a, b).join("");
}

/** `str::trim_start_matches` / `trim_end_matches` with a char-set pattern. */
export function trimStartChars(s: string, set: string): string {
  const cs = Array.from(s);
  let a = 0;
  while (a < cs.length && set.includes(cs[a])) a++;
  return cs.slice(a).join("");
}

export function trimEndChars(s: string, set: string): string {
  const cs = Array.from(s);
  let b = cs.length;
  while (b > 0 && set.includes(cs[b - 1])) b--;
  return cs.slice(0, b).join("");
}

/** `char::is_control` (general category Cc). */
export function isControl(c: string): boolean {
  return CONTROL.test(c);
}

/** `char::is_ascii_alphabetic`. */
export function isAsciiAlphabetic(c: string): boolean {
  return /^[A-Za-z]$/.test(c);
}

/** `char::is_ascii_digit`. */
export function isAsciiDigit(c: string): boolean {
  return /^[0-9]$/.test(c);
}

/** `char::is_ascii_graphic`: U+0021 to U+007E. */
export function isAsciiGraphic(c: string): boolean {
  return /^[\x21-\x7e]$/.test(c);
}

/** `char::is_ascii`. */
export function isAscii(c: string): boolean {
  // SAFETY: callers pass one code point.
  return (c.codePointAt(0) as number) < 0x80;
}

/** `str::to_ascii_lowercase`: only A to Z change. */
export function toAsciiLowercase(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** `char::to_lowercase` on one code point (the full mapping, no string context). */
export function lowerChar(c: string): string {
  return c.toLowerCase();
}

/** `f32::round`: ties away from zero. */
export function roundF32(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v));
}

/**
 * `f32::hypot`. libm's hypotf computes in f64 and rounds once; sqrt of the f64
 * sum of squares of two f32 values matches that to the last f32 bit.
 */
export function hypotF32(x: number, y: number): number {
  return f32(Math.sqrt(x * x + y * y));
}

/** `f32::atan2` through f64 (libm's atan2f is within 1 ulp of it). */
export function atan2F32(y: number, x: number): number {
  return f32(Math.atan2(y, x));
}

const PIS_IN_180 = f32(57.29577951308232);
const RADS_PER_DEG = f32(f32(Math.PI) / 180);

/** `f32::to_degrees`: one f32 multiply by 180/PI as an f32 constant. */
export function toDegreesF32(rad: number): number {
  return f32(rad * PIS_IN_180);
}

/** `f32::to_radians`: one f32 multiply by `PI / 180` computed in f32. */
export function toRadiansF32(deg: number): number {
  return f32(deg * RADS_PER_DEG);
}

/** `f32::rem_euclid`. */
export function remEuclidF32(a: number, b: number): number {
  const r = a % b;
  return r < 0 ? f32(r + Math.abs(b)) : r;
}
