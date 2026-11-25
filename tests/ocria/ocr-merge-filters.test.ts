// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of the filter and polygon tests in liteparse crates/liteparse/src/ocr_merge.rs (crates-v2.21.2, Apache-2.0).

import { describe, expect, test } from "bun:test";

import { polygonRotationDeg } from "../../src/ocria/ocr-merge/deskew.js";
import {
  cleanOcrTableArtifacts,
  isRuleArtifact,
  nativeWidthCoverage,
  overlapsExistingText,
} from "../../src/ocria/ocr-merge/filters.js";
import { scriptIntrusions } from "../../src/ocria/ocr-merge/garble-signals.js";
import { isUnusableNative } from "../../src/ocria/ocr-merge/native.js";
import { utf8Len } from "../../src/ocria/rust-extra.js";
import { scriptOf } from "../../src/ocria/ocr-merge/script-of.js";
import { makeItem } from "./ocr-merge-builders.test.js";

type Poly = Array<[number, number]>;

describe("isRuleArtifact", () => {
  test("catches bars and decoration", () => {
    // Tesseract reading a table border / hairline.
    expect(isRuleArtifact("|", 4.3, 12.5)).toBe(true);
    expect(isRuleArtifact("I", 1.0, 7.2)).toBe(true);
    expect(isRuleArtifact("|  |", 3.0, 12.0)).toBe(true);
    expect(isRuleArtifact("—", 20.0, 3.0)).toBe(true);
    expect(isRuleArtifact("  ", 1.0, 1.0)).toBe(true);
    // Real narrow glyphs sit well above the hairline aspect.
    expect(isRuleArtifact("1", 5.0, 12.0)).toBe(false);
    expect(isRuleArtifact("I", 4.0, 10.0)).toBe(false);
    // Anything with letters/digits and more than one char is text.
    expect(isRuleArtifact("If", 1.0, 12.0)).toBe(false);
    expect(isRuleArtifact("N/A", 12.0, 8.0)).toBe(false);
  });
});

describe("polygonRotationDeg", () => {
  test("horizontal", () => {
    const p: Poly = [
      [0, 0],
      [100, 0],
      [100, 20],
      [0, 20],
    ];
    expect(polygonRotationDeg(p)).toBe(0);
  });

  test("90 degrees CCW: the TL to TR edge points upward", () => {
    const p: Poly = [
      [10, 100],
      [10, 0],
      [30, 0],
      [30, 100],
    ];
    expect(polygonRotationDeg(p)).toBe(90);
  });

  test("270 degrees CCW: the TL to TR edge points downward", () => {
    const p: Poly = [
      [10, 0],
      [10, 100],
      [30, 100],
      [30, 0],
    ];
    expect(polygonRotationDeg(p)).toBe(270);
  });

  // PaddleOCR-style: tall, narrow polygon in screen-axis order. poly[0] to poly[1] is the
  // short horizontal edge, not the reading direction; the longer edge picks the rotation.
  test("screen-axis vertical", () => {
    const p: Poly = [
      [20, 50],
      [50, 50],
      [50, 750],
      [20, 750],
    ];
    expect([90, 270]).toContain(polygonRotationDeg(p));
  });

  // Single-char detections (CJK glyphs, etc.) have no reliable reading axis.
  test("near-square", () => {
    const p: Poly = [
      [0, 0],
      [20, 0],
      [20, 22],
      [0, 22],
    ];
    expect(polygonRotationDeg(p)).toBe(0);
  });

  test("180", () => {
    const p: Poly = [
      [100, 20],
      [0, 20],
      [0, 0],
      [100, 0],
    ];
    expect(polygonRotationDeg(p)).toBe(180);
  });
});

describe("cleanOcrTableArtifacts", () => {
  test("strips border misreads", () => {
    expect(cleanOcrTableArtifacts("44520]")).toBe("44520");
    expect(cleanOcrTableArtifacts("|123")).toBe("123");
    expect(cleanOcrTableArtifacts("0.3|")).toBe("0.3");
    expect(cleanOcrTableArtifacts("(note)")).toBe("(note)");
    expect(cleanOcrTableArtifacts("|hello|")).toBe("|hello|");
    expect(cleanOcrTableArtifacts("N/A")).toBe("N/A");
    expect(cleanOcrTableArtifacts("")).toBe("");
    expect(cleanOcrTableArtifacts("|||")).toBe("|||");
  });

  // Parentheses around a number mark it negative (issue #468).
  test("keeps accounting negatives", () => {
    expect(cleanOcrTableArtifacts("(78,939)")).toBe("(78,939)");
    expect(cleanOcrTableArtifacts("(12.5%)")).toBe("(12.5%)");
    // Border misreads next to them are still removed.
    expect(cleanOcrTableArtifacts("(78,939)|")).toBe("(78,939)");
    expect(cleanOcrTableArtifacts("|(78,939)]")).toBe("(78,939)");
    // A lone parenthesis is still treated as a border misread.
    expect(cleanOcrTableArtifacts("78,939)")).toBe("78,939");
    expect(cleanOcrTableArtifacts("(78,939")).toBe("78,939");
  });

  test("keeps whitespace trimmed", () => {
    expect(cleanOcrTableArtifacts("   ")).toBe("");
    expect(cleanOcrTableArtifacts(" 123 ")).toBe("123");
  });
});

describe("overlapsExistingText", () => {
  test("inside", () => {
    const items = [makeItem(10, 10, 20, 5)];
    expect(overlapsExistingText(items, 12, 11, 5, 2, 2)).toBe(true);
  });

  test("disjoint", () => {
    const items = [makeItem(10, 10, 20, 5)];
    expect(overlapsExistingText(items, 100, 100, 5, 5, 2)).toBe(false);
  });

  test("tolerance", () => {
    const items = [makeItem(10, 10, 20, 5)];
    // Just outside but within tolerance
    expect(overlapsExistingText(items, 31, 10, 5, 5, 2)).toBe(true);
    // Beyond tolerance
    expect(overlapsExistingText(items, 35, 10, 5, 5, 2)).toBe(false);
  });

  test("empty", () => {
    expect(overlapsExistingText([], 0, 0, 1, 1, 0)).toBe(false);
  });
});

describe("isUnusableNative", () => {
  test("a Unicode map error makes an item unusable", () => {
    const item = makeItem(0, 0, 10, 10);
    expect(isUnusableNative(item)).toBe(false);
    item.has_unicode_map_error = true;
    expect(isUnusableNative(item)).toBe(true);
  });
});

// Kept native glyphs inside an OCR line cover only a sliver of its width.
describe("nativeWidthCoverage", () => {
  test("merges overlapping spans", () => {
    const items = [makeItem(0, 0, 10, 10), makeItem(5, 0, 10, 10)];
    expect(Math.abs(nativeWidthCoverage(items, 0, 0, 100, 10) - 0.15)).toBeLessThan(1e-4);
    // a line above or below does not count
    expect(nativeWidthCoverage(items, 0, 20, 100, 10)).toBe(0);
  });

  test("a zero-width box counts as covered", () => {
    expect(nativeWidthCoverage([], 0, 0, 0, 10)).toBe(1);
  });
});

// Not in the Rust tests: these helpers back the garble checks, and no ported test reaches their edges.
describe("helpers", () => {
  test("utf8Len counts UTF-8 bytes, not UTF-16 units", () => {
    expect(utf8Len("a")).toBe(1);
    expect(utf8Len("\u00e9")).toBe(2);
    expect(utf8Len("\u20ac")).toBe(3);
    expect(utf8Len("\u{1F600}")).toBe(4);
    expect(utf8Len("")).toBe(0);
  });

  test("scriptIntrusions counts ASCII wedged between complex-script characters", () => {
    expect(scriptIntrusions("\u0622(\u06a9\u0627")).toEqual([3, 1]);
    expect(scriptIntrusions("\u0622 \u06a9")).toEqual([2, 0]);
  });

  test("scriptOf buckets", () => {
    expect(scriptOf("a")).toBe(0);
    expect(scriptOf("\u4e2d")).toBe(1);
    expect(scriptOf("\u03b1")).toBe(0x370);
    expect(scriptOf("\u0b95")).toBe(0xb80);
    expect(scriptOf("\u0e01")).toBe(0xe00);
    expect(scriptOf("\u0e81")).toBe(0xe80);
    expect(scriptOf("\u0f40")).toBe(0xf00);
    // unlisted scripts share one id
    expect(scriptOf("\u{1F600}")).toBe(2);
  });
});
