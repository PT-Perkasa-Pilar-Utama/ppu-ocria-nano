// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Ports the `SegmentBuilder`, `counts_as_unmapped` and `clamped_vertical_bounds` tests of the
// `#[cfg(test)]` module of liteparse crates/liteparse/src/extract.rs (crates-v2.21.2) against
// src/pdf/extract/segment-builder.ts, segment-bounds.ts, segment-words.ts and segment-item.ts.

import { describe, expect, test } from "bun:test";

import { f32 } from "../src/ocria/rust.js";
import type { TextItem } from "../src/ocria/types/text-item.js";
import { clampedVerticalBounds, countsAsUnmapped } from "../src/pdf/extract/segment-bounds.js";
import { SegmentBuilder } from "../src/pdf/extract/segment-builder.js";

function rect(left: number, top: number, right: number, bottom: number) {
  return { left: f32(left), top: f32(top), right: f32(right), bottom: f32(bottom) };
}

function segmentWithOneChar(extractTextMetadata: boolean): SegmentBuilder {
  const segment = new SegmentBuilder(false, extractTextMetadata);
  segment.text = "A";
  segment.vpLeft = 1;
  segment.vpRight = 7;
  segment.vpTop = 2;
  segment.vpBottom = 12;
  segment.charCount = 1;
  segment.hasContent = true;
  segment.charCodes = [65];
  return segment;
}

describe("extract segment", () => {
  // A glyph PDFium flags with a raw /ToUnicode map error normally counts toward the item's
  // unmapped tally...
  test("unrecovered_map_error_counts_as_unmapped", () => {
    expect(countsAsUnmapped(false, true)).toBe(true);
  });

  // ...but once the decoder recovers it (glyph-name / reverse-cmap / outline-hash resolver) the
  // text is correct, so it must NOT count: this stops the OCR merge from discarding
  // fully-recovered buggy-font items as "unusable native".
  test("recovered_map_error_does_not_count_as_unmapped", () => {
    expect(countsAsUnmapped(true, true)).toBe(false);
  });

  // A cleanly-mapped glyph never counts, recovered or not.
  test("cleanly_mapped_glyph_never_counts_as_unmapped", () => {
    expect(countsAsUnmapped(false, false)).toBe(false);
    expect(countsAsUnmapped(true, false)).toBe(false);
  });

  test("generated_trailing_space_is_exposed_without_changing_trimmed_text", () => {
    const segment = segmentWithOneChar(true);
    segment.markPendingSpace(true, 32);
    const items: TextItem[] = [];
    segment.flush(items);

    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("A");
    expect(items[0].char_codes).toEqual([65, 32]);
    expect(items[0].trailing_space_generated).toBe(true);
  });

  test("real_trailing_space_is_not_marked_as_generated", () => {
    const segment = segmentWithOneChar(true);
    segment.markPendingSpace(false, 32);
    const items: TextItem[] = [];
    segment.flush(items);

    expect(items[0].char_codes).toEqual([65, 32]);
    expect(items[0].trailing_space_generated).toBe(false);
  });

  test("disabled_text_metadata_does_not_accumulate_source_codes", () => {
    // The Rust builds this segment without `char_codes`.
    const segment = new SegmentBuilder(false, false);
    segment.text = "A";
    segment.vpLeft = 1;
    segment.vpRight = 7;
    segment.vpTop = 2;
    segment.vpBottom = 12;
    segment.charCount = 1;
    segment.hasContent = true;
    segment.markPendingSpace(true, 32);
    const items: TextItem[] = [];
    segment.flush(items);

    expect(items[0].char_codes).toEqual([]);
    expect(items[0].trailing_space_generated).toBe(false);
  });

  test("clamped_vertical_bounds_uses_ink_for_pathological_loose", () => {
    // #486 hyphen: 50.2pt loose box, ~0.6pt ink (~84x disproportion).
    expect(clampedVerticalBounds(rect(0, 74.4, 10, 124.6), rect(0, 90, 10, 90.6))).toEqual([
      f32(90),
      f32(90.6),
    ]);
    // Normal 10pt line (10pt loose, 3pt ink: 3.3x) is untouched.
    expect(clampedVerticalBounds(rect(0, 83.9, 10, 93.9), rect(0, 90, 10, 93))).toEqual([
      f32(83.9),
      f32(93.9),
    ]);
    // Hairline punctuation (12.3pt loose, 0.6pt ink: ~20x) is untouched: clamping it would detach
    // periods from their words.
    expect(clampedVerticalBounds(rect(0, 119, 10, 131.3), rect(0, 130, 10, 130.6))).toEqual([
      f32(119),
      f32(131.3),
    ]);
    // Display math (39.9pt loose, 9.9pt ink: 4x) is untouched.
    expect(clampedVerticalBounds(rect(0, 79, 10, 118.9), rect(0, 90, 10, 99.9))).toEqual([
      f32(79),
      f32(118.9),
    ]);
  });
});
