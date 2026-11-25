// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The #[cfg(test)] tests of liteparse markdown_layout/hr.rs (crates-v2.21.2), ported.

import { describe, expect, test } from "bun:test";

import { detectHorizontalRules } from "../../src/ocria/markdown-layout/hr/index.js";
import { line, pageWithGraphics, stroke } from "../../src/ocria/markdown-layout/test-helpers.js";

describe("hr", () => {
  test("hr_long_thin_horizontal_stroke_detected", () => {
    const p = pageWithGraphics([], [stroke(50, 200, 450, 200.5, 0.5)]);
    const rules = detectHorizontalRules(p);
    expect(rules.map((r) => r.y)).toEqual([200.25]);
    expect(rules[0].x).toBe(50);
    expect(rules[0].width).toBe(400);
  });

  test("hr_short_stroke_rejected", () => {
    const p = pageWithGraphics([], [stroke(50, 200, 100, 200, 0.5)]);
    expect(detectHorizontalRules(p)).toEqual([]);
  });

  test("hr_vertical_stroke_rejected", () => {
    const p = pageWithGraphics([], [stroke(50, 50, 50, 500, 0.5)]);
    expect(detectHorizontalRules(p)).toEqual([]);
  });

  test("hr_thick_stroke_rejected", () => {
    const p = pageWithGraphics([], [stroke(50, 200, 450, 200, 4)]);
    expect(detectHorizontalRules(p)).toEqual([]);
  });

  test("hr_underline_at_text_baseline_dropped", () => {
    const textLine = line("Some underlined heading text on the page", 50, 100, 10, 10);
    const bottom = textLine.bbox.y + textLine.bbox.height;
    const p = pageWithGraphics(
      [textLine],
      [stroke(50, bottom + 1, 50 + textLine.bbox.width, bottom + 1, 0.5)]
    );
    expect(detectHorizontalRules(p)).toEqual([]);
  });

  test("hr sorts by y and drops a duplicate drawn within a point", () => {
    const p = pageWithGraphics(
      [],
      [
        stroke(50, 300, 450, 300, 0.5),
        stroke(50, 100, 450, 100, 0.5),
        stroke(50, 100.5, 450, 100.5, 0.5),
      ]
    );
    expect(detectHorizontalRules(p).map((r) => r.y)).toEqual([100, 300]);
  });
});
