// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/extract.rs (crates-v2.21.2, Apache-2.0): small pure helpers.

import { f32, remEuclid } from "../../ocria/rust.js";
import type { Color, Matrix } from "../pdfium/types.js";

/** `std::f32::consts::PI`. */
export const PI32: number = f32(Math.PI);

/** `f32::to_degrees`: multiplies by the f32 constant 180/pi. */
export function toDegrees(rad: number): number {
  return f32(rad * f32(57.29577951308232));
}

/** `is_combining_mark`: combining diacritical marks, which PDFs often draw as their own glyph over the base letter. */
export function isCombiningMark(c: string): boolean {
  const u = c.codePointAt(0) ?? 0;
  return (
    (u >= 0x0300 && u <= 0x036f) ||
    (u >= 0x1ab0 && u <= 0x1aff) ||
    (u >= 0x1dc0 && u <= 0x1dff) ||
    (u >= 0x20d0 && u <= 0x20ff) ||
    (u >= 0xfe20 && u <= 0xfe2f)
  );
}

/**
 * `normalize_punct`: fold typographic punctuation to its ASCII equivalent so extracted text
 * matches plain-ASCII transcriptions: curly quotes to `'` and `"`, the dash family to `-`.
 */
export function normalizePunct(c: string): string {
  switch (c) {
    case "‘":
    case "’":
    case "‚":
    case "′":
      return "'";
    case "“":
    case "”":
    case "„":
    case "″":
      return '"';
    case "‐":
    case "‑":
    case "‒":
    case "–":
    case "—":
    case "―":
    case "−":
      return "-";
    default:
      return c;
  }
}

/** `is_rtl_combining_mark`: combining marks of the Hebrew and Arabic blocks (points, cantillation, harakat). */
export function isRtlCombiningMark(c: string): boolean {
  const u = c.codePointAt(0) ?? 0;
  return (
    (u >= 0x0591 && u <= 0x05bd) ||
    u === 0x05bf ||
    (u >= 0x05c1 && u <= 0x05c2) ||
    (u >= 0x05c4 && u <= 0x05c5) ||
    u === 0x05c7 ||
    (u >= 0x0610 && u <= 0x061a) ||
    (u >= 0x064b && u <= 0x065f) ||
    u === 0x0670 ||
    (u >= 0x06d6 && u <= 0x06dc) ||
    (u >= 0x06df && u <= 0x06e4) ||
    (u >= 0x06e7 && u <= 0x06e8) ||
    (u >= 0x06ea && u <= 0x06ed)
  );
}

/**
 * `adjust_angle_for_rotation`: PDFium returns the counter-clockwise angle in PDF space; the page
 * /Rotate is clockwise.
 */
export function adjustAngleForRotation(angleRad: number, pageRotation: number): number {
  let a = angleRad;
  if (pageRotation === 1) a = f32(a - f32(f32(3 * PI32) / 2));
  else if (pageRotation === 2) a = f32(a - PI32);
  else if (pageRotation === 3) a = f32(a - f32(PI32 / 2));
  a = f32(remEuclid(a, f32(2 * PI32)));
  // Float error can leave a full turn a hair under 2pi (PI + PDFium's 3.1415925): 359.99998 instead of 0.
  if (f32(f32(2 * PI32) - a) < f32(1e-4)) a = 0;
  return a;
}

/** `decompose_scale`: the scale factors of a 2D affine matrix, the square roots of the eigenvalues of M^T M. */
export function decomposeScale(m: Matrix): [number, number] {
  const [a, b, c, d] = [m.a, m.b, m.c, m.d];
  const mtA = a * a + b * b;
  const mtB = a * c + b * d;
  const mtD = c * c + d * d;
  const first = (mtA + mtD) / 2;
  const disc = Math.sqrt((mtA + mtD) ** 2 - 4 * (mtA * mtD - mtB * mtB)) / 2;
  let sx = Math.sqrt(first + disc);
  let sy = Math.sqrt(first - disc);
  if (Number.isNaN(sx)) sx = 1;
  if (Number.isNaN(sy)) sy = 1;
  return [f32(sx), f32(sy)];
}

/** `median_f32`: median of a slice of finite non-negative values; null when empty. */
export function medianF32(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  if (v.length % 2 === 0) return f32(f32(v[mid - 1] + v[mid]) / 2);
  return v[mid];
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, "0");
}

/** `color_to_argb_hex`. */
export function colorToArgbHex(c: Color): string {
  return `${hex2(c.a)}${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
}
