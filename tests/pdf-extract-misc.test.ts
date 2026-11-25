// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Ports the helper tests of the `#[cfg(test)]` module of liteparse crates/liteparse/src/extract.rs
// (crates-v2.21.2) against src/pdf/extract/misc.ts.

import { describe, expect, test } from "bun:test";

import { f32 } from "../src/ocria/rust.js";
import { adjustAngleForRotation, colorToArgbHex, decomposeScale } from "../src/pdf/extract/misc.js";

const PI = f32(Math.PI);

describe("extract misc", () => {
  test("adjust_angle_no_rotation", () => {
    expect(Math.abs(adjustAngleForRotation(f32(0.5), 0) - 0.5)).toBeLessThan(1e-6);
  });

  test("adjust_angle_180", () => {
    const r = adjustAngleForRotation(PI, 2);
    expect(Math.abs(r) < 1e-5 || Math.abs(r - f32(2 * PI)) < 1e-5).toBe(true);
  });

  test("adjust_angle_wraps_into_0_2pi", () => {
    const r = adjustAngleForRotation(0, 1);
    expect(r >= 0 && r < f32(2 * PI)).toBe(true);
  });

  test("decompose_scale_identity", () => {
    const [sx, sy] = decomposeScale({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    expect(Math.abs(sx - 1)).toBeLessThan(1e-5);
    expect(Math.abs(sy - 1)).toBeLessThan(1e-5);
  });

  test("decompose_scale_uniform", () => {
    const [sx, sy] = decomposeScale({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
    expect(Math.abs(sx - 2)).toBeLessThan(1e-4);
    expect(Math.abs(sy - 2)).toBeLessThan(1e-4);
  });

  test("color_to_argb_hex_formats", () => {
    expect(colorToArgbHex({ r: 0xab, g: 0xcd, b: 0xef, a: 0x12 })).toBe("12abcdef");
    expect(colorToArgbHex({ r: 0, g: 0, b: 0, a: 0 })).toBe("00000000");
  });
});
