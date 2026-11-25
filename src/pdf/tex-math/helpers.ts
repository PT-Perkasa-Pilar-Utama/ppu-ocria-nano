// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/tex_math/mod.rs (crates-v2.21.2, Apache-2.0).

// Small numeric and text helpers shared by the math pass.

import { f32, isAlphabetic, totalCmp } from "../../ocria/rust.js";
import type { G } from "./types.js";

/** `f32::MAX` and `f32::MIN` (the most negative finite f32), the seeds of the min / max folds. */
export const F32_MAX = 3.4028234663852886e38;
export const F32_MIN = -3.4028234663852886e38;

/** `f32::max`: a NaN operand yields the other operand. */
export function fmax(a: number, b: number): number {
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return a > b ? a : b;
}

/** `f32::min`: a NaN operand yields the other operand. */
export function fmin(a: number, b: number): number {
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return a < b ? a : b;
}

/** `iter.fold(f32::MAX, f32::min)`. */
export function foldMin(values: Iterable<number>): number {
  let acc = F32_MAX;
  for (const v of values) acc = fmin(acc, v);
  return acc;
}

/** `iter.fold(f32::MIN, f32::max)`. */
export function foldMax(values: Iterable<number>): number {
  let acc = F32_MIN;
  for (const v of values) acc = fmax(acc, v);
  return acc;
}

/** Python `str.isalpha` on a glyph text. */
export function isAlpha(t: string): boolean {
  if (t === "") return false;
  for (const c of t) if (!isAlphabetic(c)) return false;
  return true;
}

/** Whether `t` is ASCII with an upper-case letter and no lower-case letter. */
export function isAsciiUpper(t: string): boolean {
  if (t === "") return false;
  let upper = false;
  for (const c of t) {
    if (c > "\x7f") return false;
    if (c >= "A" && c <= "Z") upper = true;
    if (c >= "a" && c <= "z") return false;
  }
  return upper;
}

/** Python `statistics.median`. */
export function median(v: readonly number[]): number {
  const s = [...v].sort(totalCmp);
  const n = s.length;
  if (n === 0) return 0;
  if (n % 2 === 1) return s[Math.floor(n / 2)];
  return f32(f32(s[n / 2 - 1] + s[n / 2]) / 2);
}

export function maxSize(gs: readonly G[], idx: readonly number[]): number {
  return foldMax(idx.map((i) => gs[i].size));
}
