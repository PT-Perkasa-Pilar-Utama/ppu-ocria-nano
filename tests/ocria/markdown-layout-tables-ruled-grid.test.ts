// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The #[cfg(test)] tests of liteparse markdown_layout/tables.rs for the ruled-grid
// boundary helpers, rule bands and rowspan mask (crates-v2.21.2).

import { describe, expect, test } from "bun:test";

import { ruleBands } from "../../src/ocria/markdown-layout/tables/borderless/index.js";
import type { HSeg, VSeg } from "../../src/ocria/markdown-layout/tables/grid-segments.js";
import {
  collapseGutterColumns,
  extendToPerpendicularExtent,
  extractRuleSegments,
  filterShortVlines,
  rowspanMask,
} from "../../src/ocria/markdown-layout/tables/ruled/index.js";
import { lineWithSpans } from "../../src/ocria/markdown-layout/test-helpers.js";
import { f32 } from "../../src/ocria/rust.js";
import type { GraphicPrimitive } from "../../src/ocria/types/geometry.js";

describe("gutter columns and boundaries", () => {
  test("gutter_columns_fused_but_narrow_real_column_kept", () => {
    // Padded cell borders: real columns 40..140, 160..260, 280..380 with 20pt
    // gutters between them. Text sits inside the real columns only.
    const first = [
      lineWithSpans(
        [
          ["alpha", 45],
          ["beta", 165],
          ["gamma", 285],
        ],
        100,
        10
      ),
      lineWithSpans(
        [
          ["delta", 45],
          ["eps", 165],
          ["zeta", 285],
        ],
        120,
        10
      ),
    ];
    const xs = [40, 140, 160, 260, 280, 380];
    collapseGutterColumns(xs, first);
    expect(xs.length).toBe(4);

    // A genuinely narrow but *occupied* column must survive, even though it is
    // the same width as the gutters above.
    const second = [
      lineWithSpans(
        [
          ["1", 45],
          ["desc", 65],
          ["more text", 205],
        ],
        100,
        10
      ),
      lineWithSpans(
        [
          ["2", 45],
          ["desc two", 65],
          ["text here", 205],
        ],
        120,
        10
      ),
    ];
    const xs2 = [40, 60, 200, 380];
    collapseGutterColumns(xs2, second);
    expect(xs2).toEqual([40, 60, 200, 380]);
  });

  test("blank_worksheet_column_survives_gutter_collapse", () => {
    const rowsIn = [lineWithSpans([["K+", 45]], 100, 10), lineWithSpans([["Na+", 45]], 120, 10)];
    const xs = [40, 240, 440, 640];
    collapseGutterColumns(xs, rowsIn);
    expect(xs).toEqual([40, 240, 440, 640]);
  });

  test("unruled_outer_column_is_recovered_from_the_horizontals", () => {
    const xs = [123.8, 382.9, 652.1].map(f32);
    extendToPerpendicularExtent(
      xs,
      [29.7, 29.7, 29.8].map(f32),
      [930.3, 930.3, 930.2].map(f32),
      0,
      () => true
    );
    expect(xs).toEqual([29.7, 123.8, 382.9, 652.1, 930.3].map(f32));
  });

  test("outer_band_shorter_than_any_row_is_rule_overshoot", () => {
    const ys = [181.4, 207.8, 234.2].map(f32);
    extendToPerpendicularExtent(ys, [f32(181.4)], [f32(249.7)], f32(26.4), () => true);
    expect(ys).toEqual([181.4, 207.8, 234.2].map(f32));
  });

  test("empty_outer_band_is_not_a_column", () => {
    const xs = [123.8, 382.9, 652.1].map(f32);
    extendToPerpendicularExtent(xs, [f32(29.7)], [f32(930.3)], 0, () => false);
    expect(xs).toEqual([123.8, 382.9, 652.1].map(f32));
  });

  test("one_overshooting_rule_does_not_widen_the_grid", () => {
    // Median, not min: a single stroke reaching to 29.7 is noise.
    const xs = [123.8, 382.9, 652.1].map(f32);
    extendToPerpendicularExtent(
      xs,
      [29.7, 124.0, 123.9].map(f32),
      [652.0, 652.2, 930.3].map(f32),
      0,
      () => true
    );
    expect(xs).toEqual([123.8, 382.9, 652.1].map(f32));
  });
});

function hairline(y: number, x: number, w: number): GraphicPrimitive {
  return {
    Rect: { bbox: { x, y, width: w, height: f32(0.8) }, fill: null, stroke: "#000" },
  };
}

function vlinesWithIntruder(): [HSeg[], VSeg[]] {
  const hs: HSeg[] = [0, 1, 2, 3, 4].map((r) => ({ x_min: 0, x_max: 300, y: f32(r * 25) }));
  const vs: VSeg[] = [0, 100, 200, 300].map((x) => ({ y_min: 0, y_max: 100, x }));
  vs.push({ y_min: 40, y_max: 49, x: 140 });
  vs.push({ y_min: 40, y_max: 49, x: 162 });
  return [hs, vs];
}

describe("rule bands and short vertical rules", () => {
  test("booktabs_rule_pair_is_a_band", () => {
    // doc 165: the whole table is two hairlines 98pt apart, no verticals.
    const g = [
      hairline(f32(139.5), f32(56.7), f32(225.9)),
      hairline(f32(237.4), f32(56.7), f32(225.9)),
    ];
    expect(ruleBands(extractRuleSegments(g), 792)).toEqual([[f32(139.5), f32(237.4)]]);
  });

  test("ruled_grid_is_not_a_band", () => {
    const g = [
      hairline(f32(139.5), f32(56.7), f32(225.9)),
      hairline(f32(237.4), f32(56.7), f32(225.9)),
    ];
    g.push({
      Rect: {
        bbox: { x: 150, y: f32(139.5), width: f32(0.8), height: f32(97.9) },
        fill: null,
        stroke: "#000",
      },
    });
    expect(ruleBands(extractRuleSegments(g), 792)).toEqual([]);
  });

  test("heading_underline_pair_is_not_a_band", () => {
    const g = [hairline(100, f32(56.7), f32(225.9)), hairline(106, f32(56.7), f32(225.9))];
    expect(ruleBands(extractRuleSegments(g), 792)).toEqual([]);
  });

  test("in_cell_highlight_box_does_not_become_a_column", () => {
    const [hs, vs] = vlinesWithIntruder();
    expect(filterShortVlines(hs, [0, 1, 2, 3, 4], vs, [0, 1, 2, 3, 4, 5])).toEqual([0, 1, 2, 3]);
  });

  test("filter_never_leaves_fewer_than_three_columns", () => {
    // Only two dividers reach full height; filtering would leave a 1-column
    // grid, so the raw set survives and the usual gates decide.
    const [hs, vs] = vlinesWithIntruder();
    vs[2].y_min = 40;
    vs[2].y_max = 49;
    vs[3].y_min = 40;
    vs[3].y_max = 49;
    expect(filterShortVlines(hs, [0, 1, 2, 3, 4], vs, [0, 1, 2, 3, 4, 5])).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });

  test("rowspan_mask_marks_unruled_cell_boundaries", () => {
    // Two columns; the boundary at y=20 is ruled only across column 1, so
    // column 0's cell there is merged with the one above it.
    const hs: HSeg[] = [
      { x_min: 0, x_max: 100, y: 0 },
      { x_min: 50, x_max: 100, y: 20 },
      { x_min: 0, x_max: 100, y: 40 },
    ];
    const vs: VSeg[] = [{ y_min: 0, y_max: 40, x: 50 }];
    expect(rowspanMask(hs, [0, 1, 2], vs, [0], [0, 50, 100], [0, 20, 40])).toEqual([
      [false, false],
      [true, false],
    ]);
  });

  test("rowspan_mask_ignores_boundary_where_grid_ends", () => {
    // No vertical crosses y=20, so the grid simply stops there: nothing is
    // merged, and forgiving these empties would let a page frame shred prose
    // into columns.
    const hs: HSeg[] = [
      { x_min: 0, x_max: 10, y: 0 },
      { x_min: 0, x_max: 10, y: 20 },
      { x_min: 0, x_max: 10, y: 40 },
    ];
    const vs: VSeg[] = [{ y_min: 0, y_max: 15, x: 50 }];
    const mask = rowspanMask(hs, [0, 1, 2], vs, [0], [0, 50, 100], [0, 20, 40]);
    expect(mask.flat().every((m) => !m)).toBe(true);
  });
});
