// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Ruled-grid helpers of markdown_layout/tables.rs. Upstream has no unit test
// that targets them directly (they run inside `detect_ruled_tables` tests), so
// these tests pin the behavior the Rust code documents.

import { describe, expect, test } from "bun:test";

import { detectTableRects } from "../../src/ocria/markdown-layout/tables/detect-table-rects.js";
import {
  clusterHSegments,
  clusterVSegments,
  extractHVSegments,
  findGridComponents,
} from "../../src/ocria/markdown-layout/tables/grid-segments.js";
import type { GraphicPrimitive } from "../../src/ocria/types/geometry.js";

const stroke = (x1: number, y1: number, x2: number, y2: number): GraphicPrimitive => ({
  Stroke: { x1, y1, x2, y2, color: null, width: 1 },
});

/** A 3-row, 3-column ruled grid from (100, 100) to (400, 300). */
function grid(x0 = 100, y0 = 100): GraphicPrimitive[] {
  const out: GraphicPrimitive[] = [];
  for (const y of [0, 100, 200]) out.push(stroke(x0, y0 + y, x0 + 300, y0 + y));
  for (const x of [0, 150, 300]) out.push(stroke(x0 + x, y0, x0 + x, y0 + 200));
  return out;
}

describe("extractHVSegments", () => {
  test("strokes become H or V segments by orientation; slanted and short strokes are dropped", () => {
    const [hs, vs] = extractHVSegments([
      stroke(10, 50, 110, 50.5),
      stroke(20, 10, 20.5, 90),
      stroke(0, 0, 50, 50),
      stroke(0, 0, 0.5, 0.5),
    ]);
    expect(hs).toEqual([{ x_min: 10, x_max: 110, y: 50.25 }]);
    expect(vs).toEqual([{ y_min: 10, y_max: 90, x: 20.25 }]);
  });

  test("a stroked rect contributes four edges; an unstroked rect none", () => {
    const rect = (stroke: string | null): GraphicPrimitive => ({
      Rect: { bbox: { x: 10, y: 20, width: 100, height: 50 }, fill: null, stroke },
    });
    const [hs, vs] = extractHVSegments([rect("ff000000")]);
    expect(hs).toEqual([
      { x_min: 10, x_max: 110, y: 20 },
      { x_min: 10, x_max: 110, y: 70 },
    ]);
    expect(vs).toEqual([
      { y_min: 20, y_max: 70, x: 10 },
      { y_min: 20, y_max: 70, x: 110 },
    ]);
    expect(extractHVSegments([rect(null)])).toEqual([[], []]);
  });

  test("a rect no wider than a point has no horizontal edges", () => {
    const [hs, vs] = extractHVSegments([
      { Rect: { bbox: { x: 10, y: 20, width: 1, height: 50 }, fill: null, stroke: "ff000000" } },
    ]);
    expect(hs).toEqual([]);
    expect(vs.length).toBe(2);
  });
});

describe("clusterHSegments / clusterVSegments", () => {
  test("rules within 2 pt merge and union their extents", () => {
    const hs = clusterHSegments([
      { x_min: 50, x_max: 60, y: 101.5 },
      { x_min: 0, x_max: 20, y: 100 },
      { x_min: 0, x_max: 10, y: 110 },
    ]);
    expect(hs).toEqual([
      { x_min: 0, x_max: 60, y: 100 },
      { x_min: 0, x_max: 10, y: 110 },
    ]);
  });

  test("the input segments stay as extracted", () => {
    const raw = [
      { y_min: 0, y_max: 10, x: 5 },
      { y_min: 90, y_max: 100, x: 5.5 },
    ];
    const vs = clusterVSegments(raw);
    expect(vs).toEqual([{ y_min: 0, y_max: 100, x: 5 }]);
    expect(raw[0]).toEqual({ y_min: 0, y_max: 10, x: 5 });
  });

  test("an empty list stays empty", () => {
    expect(clusterHSegments([])).toEqual([]);
    expect(clusterVSegments([])).toEqual([]);
  });
});

describe("findGridComponents", () => {
  test("two separate grids give two components ordered by their first H index", () => {
    const [hs0, vs0] = extractHVSegments([...grid(500, 400), ...grid(100, 100)]);
    const hs = clusterHSegments(hs0);
    const vs = clusterVSegments(vs0);
    const comps = findGridComponents(hs, vs);
    expect(comps.length).toBe(2);
    expect(comps[0][0]).toEqual([0, 1, 2]);
    expect(comps[1][0]).toEqual([3, 4, 5]);
    expect(hs[comps[0][0][0]].y).toBe(100);
    expect(hs[comps[1][0][0]].y).toBe(400);
  });

  test("fewer than two H or V lines gives nothing", () => {
    expect(findGridComponents([{ x_min: 0, x_max: 9, y: 1 }], [])).toEqual([]);
  });

  test("an L shape is not a table", () => {
    const [hs, vs] = extractHVSegments([stroke(0, 0, 100, 0), stroke(0, 0, 0, 100)]);
    expect(findGridComponents(hs, vs)).toEqual([]);
  });

  test("rules that miss each other by more than 3 pt do not connect", () => {
    const [hs, vs] = extractHVSegments([
      stroke(0, 0, 100, 0),
      stroke(0, 50, 100, 50),
      stroke(110, -10, 110, 60),
      stroke(120, -10, 120, 60),
    ]);
    expect(findGridComponents(hs, vs)).toEqual([]);
  });
});

describe("detectTableRects", () => {
  test("returns the box of each grid", () => {
    expect(detectTableRects(grid(), 612, 792)).toEqual([
      { x: 100, y: 100, width: 300, height: 200 },
    ]);
  });

  test("no graphics, or too few rules, gives nothing", () => {
    expect(detectTableRects([], 612, 792)).toEqual([]);
    expect(detectTableRects([stroke(0, 0, 100, 0)], 612, 792)).toEqual([]);
  });

  test("a grid smaller than 5 pt is dropped", () => {
    const tiny: GraphicPrimitive[] = [
      stroke(0, 0, 4, 0),
      stroke(0, 3, 4, 3),
      stroke(0, 0, 0, 3),
      stroke(4, 0, 4, 3),
    ];
    // Strokes of 3 or 4 pt pass the 1 pt axis test but the grid is under 5 pt.
    expect(detectTableRects(tiny, 612, 792)).toEqual([]);
  });

  test("a grid that covers the whole page is a border, not a table", () => {
    const border: GraphicPrimitive[] = [
      { Rect: { bbox: { x: 0, y: 0, width: 612, height: 792 }, fill: null, stroke: "ff000000" } },
      stroke(0, 400, 612, 400),
      stroke(300, 0, 300, 792),
    ];
    expect(detectTableRects(border, 612, 792)).toEqual([]);
    // A zero page size disables the guard, as in the Rust.
    expect(detectTableRects(border, 0, 0).length).toBe(1);
  });
});
