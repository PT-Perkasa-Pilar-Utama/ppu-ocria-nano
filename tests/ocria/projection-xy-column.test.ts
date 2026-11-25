// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Tests for the XY-cut's column-start histogram cut and geometry helpers.
// Upstream has no unit test for these: it reaches them only through whole-page
// runs, which the projection golden test covers here.

import { describe, expect, test } from "bun:test";

import { newProjectedItem } from "../../src/ocria/projection/projected-item.js";
import type { ProjectedTextItem } from "../../src/ocria/projection/types.js";
import { xyFindBannerCut } from "../../src/ocria/projection/xy-banner-cut.js";
import { xExtent, xyMedianLineHeight, xyRootBbox } from "../../src/ocria/projection/xy-bbox.js";
import { xyFindColumnCut } from "../../src/ocria/projection/xy-column-cut.js";
import { partitionHistogramVCut } from "../../src/ocria/projection/xy-cut-rec.js";
import { xyCut } from "../../src/ocria/projection/xy-cut.js";
import { cutLinePassesThroughObstacle } from "../../src/ocria/projection/xy-find-cut.js";
import type { Rect } from "../../src/ocria/types/geometry.js";
import { textItem } from "../../src/ocria/types/text-item.js";

function itemAt(text: string, x: number, y: number, w: number, h: number): ProjectedTextItem {
  return newProjectedItem(textItem({ text, x, y, width: w, height: h }));
}

describe("column-start histogram cut (no Rust test; reached only through full-page goldens upstream)", () => {
  /** Two columns whose gutter a bridge item fills, so no density valley exists. */
  function bridgedColumns(rows: number): ProjectedTextItem[] {
    const items: ProjectedTextItem[] = [];
    for (let row = 0; row < rows; row++) {
      const y = 100 + row * 14;
      items.push(itemAt("left column text", 50, y, 200, 10));
      items.push(itemAt("bridge", 255, y, 90, 10));
      items.push(itemAt("right column text", 360, y, 200, 10));
    }
    return items;
  }

  test("cuts at the gutter between the line-start peaks when density finds no valley", () => {
    const items = bridgedColumns(5);
    const all = items.map((_, i) => i);
    const bbox = xyRootBbox(items, all, 612, 792);
    const cut = xyFindColumnCut(items, all, bbox, xyMedianLineHeight(items, all), {
      tabular: false,
    });
    expect(cut).toEqual({ axis: "Vertical", position: 352.5, score: 1.0e9 });
    const region = xyCut(items, 612, 792, []);
    if (!("Split" in region.kind)) throw new Error("expected a split");
    expect(region.kind.Split.axis).toBe("Vertical");
    const [left, right] = region.kind.Split.children;
    expect("Leaf" in left.kind && left.kind.Leaf.item_indices.length).toBe(10);
    expect("Leaf" in right.kind && right.kind.Leaf.item_indices.length).toBe(5);
  });

  test("keeps a wrapped line whole when few rows straddle the cut", () => {
    const items: ProjectedTextItem[] = [];
    for (let row = 0; row < 8; row++) items.push(itemAt("text", 50, 100 + row * 14, 100, 10));
    // One line continues past the cut in a late fragment (1 of 8 rows straddles).
    items.push(itemAt("tail", 400, 100, 40, 10));
    const idxs = items.map((_, i) => i);
    const cut = { axis: "Vertical" as const, position: 300, score: 1.0e9 };
    const [left, right] = partitionHistogramVCut(items, idxs, cut, 10);
    expect(left.length).toBe(9);
    expect(right.length).toBe(0);
    // With a far fragment in every row the cut partitions item by item.
    const far = items.slice(0, 8).map((it) => itemAt("far", 400, it.item.y, 40, 10));
    const all = [...items.slice(0, 8), ...far];
    const [l2, r2] = partitionHistogramVCut(
      all,
      all.map((_, i) => i),
      cut,
      10
    );
    expect([l2.length, r2.length]).toEqual([8, 8]);
  });

  test("three comparable peaks of prose keep every column", () => {
    const items: ProjectedTextItem[] = [];
    for (let row = 0; row < 6; row++) {
      for (const x of [50, 250, 450])
        items.push(itemAt("column prose text", x, 100 + row * 14, 180, 10));
    }
    const all = items.map((_, i) => i);
    const cut = xyFindColumnCut(items, all, xyRootBbox(items, all, 612, 792), 10, {
      tabular: false,
    });
    expect(cut?.axis).toBe("Vertical");
    expect(cut?.position).toBeLessThan(250);
  });

  test("two dominant peaks outweigh a weak third", () => {
    const items: ProjectedTextItem[] = [];
    for (let row = 0; row < 12; row++) {
      for (const x of row < 4 ? [50, 250, 450] : [50, 250]) {
        items.push(itemAt("column prose text", x, 100 + row * 14, 180, 10));
      }
    }
    const all = items.map((_, i) => i);
    const cut = xyFindColumnCut(items, all, xyRootBbox(items, all, 612, 792), 10, {
      tabular: false,
    });
    expect(cut?.axis).toBe("Vertical");
  });

  test("sparse raw peaks under the strong-peak floor are tabular; filled ones are not", () => {
    const grid = (width: number): ProjectedTextItem[] => {
      const items: ProjectedTextItem[] = [];
      for (let row = 0; row < 3; row++) {
        for (const x of [50, 250, 450]) items.push(itemAt("cell", x, 100 + row * 14, width, 10));
      }
      return items;
    };
    for (const [width, tabular] of [
      [20, true],
      [180, false],
    ] as const) {
      const items = grid(width);
      const all = items.map((_, i) => i);
      const flag = { tabular: false };
      const cut = xyFindColumnCut(items, all, xyRootBbox(items, all, 612, 792), 10, flag);
      expect(cut).toBeNull();
      expect(flag.tabular).toBe(tabular);
    }
  });

  test("a near-gap start aligned with strict starts is rescued into its column peak", () => {
    const items: ProjectedTextItem[] = [];
    for (let row = 0; row < 12; row++) {
      // Rows 0-5 leave a wide gap (strict start at 258); rows 6-11 leave 8pt (a near start).
      items.push(itemAt("left column text", 50, 100 + row * 14, row < 6 ? 150 : 200, 10));
      items.push(itemAt("right column text", 258, 100 + row * 14, 200, 10));
    }
    const all = items.map((_, i) => i);
    const cut = xyFindColumnCut(items, all, xyRootBbox(items, all, 612, 792), 10, {
      tabular: false,
    });
    expect(cut?.axis).toBe("Vertical");
  });

  test("too few items, too narrow a region or too few line starts give no cut", () => {
    const items = bridgedColumns(2);
    const all = items.map((_, i) => i);
    const bbox = xyRootBbox(items, all, 612, 792);
    expect(xyFindColumnCut(items, all, bbox, 10, { tabular: false })).toBeNull();
    expect(xyFindColumnCut(items, all, { ...bbox, width: 1 }, 10, { tabular: false })).toBeNull();
    const few = bridgedColumns(3).slice(0, 7);
    expect(
      xyFindColumnCut(
        few,
        few.map((_, i) => i),
        bbox,
        10,
        { tabular: false }
      )
    ).toBeNull();
  });
});

describe("geometry helpers", () => {
  test("xExtent spans the union of item extents", () => {
    const items = [itemAt("a", 10, 0, 20, 5), itemAt("b", 50, 0, -5, 5)];
    expect(xExtent(items, [0, 1])).toEqual([10, 50]);
  });

  test("xyMedianLineHeight falls back to 10 when no item is taller than half a point", () => {
    expect(xyMedianLineHeight([itemAt("a", 0, 0, 5, 0.5)], [0])).toBe(10);
  });

  test("cutLinePassesThroughObstacle checks the cut axis, with a 1pt edge tolerance", () => {
    const bbox: Rect = { x: 0, y: 0, width: 600, height: 800 };
    const ob: Rect = { x: 100, y: 200, width: 200, height: 100 };
    expect(cutLinePassesThroughObstacle("Vertical", 200, bbox, [ob])).toBe(true);
    expect(cutLinePassesThroughObstacle("Vertical", 100.5, bbox, [ob])).toBe(false);
    expect(cutLinePassesThroughObstacle("Horizontal", 250, bbox, [ob])).toBe(true);
    expect(cutLinePassesThroughObstacle("Horizontal", 250, bbox, [{ ...ob, y: 900 }])).toBe(false);
  });

  test("a banner spanning the whole region gives no cut", () => {
    const items = [itemAt("wide", 50, 100, 400, 10), itemAt("wider", 60, 102, 380, 10)];
    expect(
      xyFindBannerCut(items, [0, 1], { x: 50, y: 100, width: 400, height: 12 }, 10)
    ).toBeNull();
  });
});
