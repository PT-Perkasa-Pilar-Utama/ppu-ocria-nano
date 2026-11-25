// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Ports the buggy-font tests of the `#[cfg(test)]` module of liteparse
// crates/liteparse/src/extract.rs (crates-v2.21.2) against src/pdf/extract/font-flags.ts.

import { describe, expect, test } from "bun:test";

import { isBuggyCodepoint, isBuggyFont } from "../src/pdf/extract/font-flags.js";

describe("extract font flags", () => {
  test("buggy_font_truetype_subset_prefix", () => {
    expect(isBuggyFont("TTFoo", "TrueType")).toBe(true);
    expect(isBuggyFont("ABCDEF+TTBar", "TrueType")).toBe(true);
    expect(isBuggyFont("Arial", "TrueType")).toBe(false);
  });

  test("buggy_font_type1_underscore", () => {
    expect(isBuggyFont("ABCDEF_Foo", "Type1")).toBe(true);
    expect(isBuggyFont("ABCDEF_Foo", "TrueType")).toBe(false);
    expect(isBuggyFont("Short", "Type1")).toBe(false);
  });

  test("buggy_codepoint_ranges", () => {
    expect(isBuggyCodepoint(0x00)).toBe(true);
    expect(isBuggyCodepoint(0x1f)).toBe(true);
    expect(isBuggyCodepoint(0x20)).toBe(false);
    expect(isBuggyCodepoint(0xe001)).toBe(true);
    expect(isBuggyCodepoint(0xf8ff)).toBe(true);
    expect(isBuggyCodepoint(0xe000)).toBe(false);
    expect(isBuggyCodepoint(0xf900)).toBe(false);
    // DEL + C1 controls (0x7F-0x9F): mangled-ToUnicode signature.
    expect(isBuggyCodepoint(0x7f)).toBe(true);
    expect(isBuggyCodepoint(0x80)).toBe(true);
    expect(isBuggyCodepoint(0x9f)).toBe(true);
    expect(isBuggyCodepoint(0xa0)).toBe(false);
  });
});
