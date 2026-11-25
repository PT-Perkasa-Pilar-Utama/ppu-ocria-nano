// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Ports the strikethrough tests of the `#[cfg(test)]` module of liteparse
// crates/liteparse/src/extract.rs (crates-v2.21.2) against src/pdf/extract/annotate.ts.

import { describe, expect, test } from "bun:test";

import type { GraphicPrimitive } from "../src/ocria/types/geometry.js";
import type { TextItem } from "../src/ocria/types/text-item.js";
import { textItem } from "../src/ocria/types/text-item.js";
import { assignStrikethrough } from "../src/pdf/extract/annotate.js";

function strikeItem(): TextItem {
  return textItem({ text: "word", x: 100, y: 100, width: 40, height: 10 });
}

function hStroke(x1: number, x2: number, y: number): GraphicPrimitive {
  return { Stroke: { x1, y1: y, x2, y2: y, color: null, width: 0.5 } };
}

describe("extract strikethrough", () => {
  test("strike_midline_stroke_detected", () => {
    const items = [strikeItem()];
    // Line through the vertical middle (y=105) spanning the item width.
    assignStrikethrough(items, [hStroke(100, 140, 105)]);
    expect(items[0].strike).toBe(true);
  });

  test("strike_underline_not_detected", () => {
    const items = [strikeItem()];
    // Line near the baseline (bottom, y=110) is an underline, not a strike.
    assignStrikethrough(items, [hStroke(100, 140, 110)]);
    expect(items[0].strike).toBe(false);
  });

  test("strike_short_line_not_detected", () => {
    const items = [strikeItem()];
    // Mid-band but only covers ~25% of the item width.
    assignStrikethrough(items, [hStroke(100, 110, 105)]);
    expect(items[0].strike).toBe(false);
  });
});
