// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Rust numeric helpers the PDF path needs beyond src/ocria/rust.ts.

/** `f32::round` / `f64::round`: ties away from zero (JS `Math.round` rounds ties up). */
export function roundAway(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v));
}

/** `v as i32` for a float: truncate toward zero, saturate at the i32 range, NaN is 0. */
export function asI32(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(-2147483648, Math.min(2147483647, Math.trunc(v)));
}
