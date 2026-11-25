// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// projection.rs projected-line building. The Rust file tests these only
// through the whole projection (the goldens cover that in projection.test.ts),
// so each case here calls the function directly.

import { describe, expect, test } from "bun:test";

import { buildOneLine } from "../../src/ocria/projection/projected-line-build.js";
import { buildProjectedLines, xyWalkLeaves } from "../../src/ocria/projection/projected-lines.js";
import type { ProjectedTextItem } from "../../src/ocria/projection/types.js";
import { f32 } from "../../src/ocria/rust.js";
import type { Anchor, Rect, Region } from "../../src/ocria/types/geometry.js";
import { textItem } from "../../src/ocria/types/text-item.js";

function itemAt(text: string, x: number, y: number, w: number, h: number): ProjectedTextItem {
  return {
    item: textItem({ text, x, y, width: w, height: h }),
    snap: "Left",
    anchor: "Left",
    is_dup: false,
    rendered: false,
    num_spaces: 0,
    force_unsnapped: false,
    is_margin_line_number: false,
    rotated: false,
    d: 0,
    orig_x: x,
    orig_y: y,
    orig_width: w,
    orig_height: h,
    orig_rotation: 0,
  };
}

describe("buildOneLine", () => {
  const line = (items: ProjectedTextItem[], figures: Rect[] = [], native = true) =>
    buildOneLine(
      items,
      items.map((_, i) => i),
      [3, 1],
      figures,
      native
    );

  test("joins items left to right, keeps spans in x order and the original rotation", () => {
    const a = itemAt("world", 60, 100, 30, 10);
    const b = itemAt("hello", 10, 100, 30, 10);
    a.orig_rotation = 90;
    const l = line([a, b]);
    expect(l.text).toBe("hello world");
    expect(l.span_item_indices).toEqual([1, 0]);
    expect(l.spans.map((s) => s.rotation)).toEqual([0, 90]);
    expect(l.spans[1]).not.toBe(a.item);
    expect(l.bbox).toEqual({ x: 10, y: 100, width: 80, height: 10 });
    expect(l.indent_x).toBe(10);
    expect(l.region_path).toEqual([3, 1]);
    expect(l.rtl).toBe(false);
  });

  test("does not add a space after a trailing space", () => {
    expect(line([itemAt("a ", 0, 0, 5, 10), itemAt("b", 6, 0, 5, 10)]).text).toBe("a b");
  });

  test("walks a right-to-left line from the right", () => {
    const l = line([itemAt("אב", 0, 0, 10, 10), itemAt("גד", 20, 0, 10, 10)]);
    expect(l.rtl).toBe(true);
    expect(l.text).toBe("גד אב");
  });

  test("takes the dominant real font size, name, mcid and style majorities", () => {
    const a = itemAt("aaaa", 0, 0, 20, 12);
    const b = itemAt("bb", 30, 0, 10, 12);
    a.item.font_size = 10;
    a.item.font_name = "Arial-Bold";
    a.item.mcid = 7;
    b.item.font_size = 12;
    b.item.font_name = "Courier";
    b.item.mcid = 9;
    const l = line([a, b]);
    expect(l.dominant_font_size).toBe(10);
    expect(l.font_size_is_estimated).toBe(false);
    expect(l.heading_font_size).toBeNull();
    expect(l.dominant_font_name).toBe("Arial-Bold");
    expect(l.mcid).toBe(7);
    expect(l.all_bold).toBe(true);
    expect(l.all_mono).toBe(false);
    expect(l.all_italic).toBe(false);
  });

  test("breaks equal weights toward the larger size bucket and the larger name", () => {
    const a = itemAt("aa", 0, 0, 20, 12);
    const b = itemAt("bb", 30, 0, 10, 12);
    a.item.font_size = 10;
    b.item.font_size = 12;
    a.item.font_name = "Zed";
    b.item.font_name = "Arial";
    const l = line([a, b]);
    expect(l.dominant_font_size).toBe(12);
    expect(l.dominant_font_name).toBe("Zed");
  });

  test("a font name that extends another with equal weight wins the tie", () => {
    const a = itemAt("aa", 0, 0, 10, 10);
    const b = itemAt("bb", 20, 0, 10, 10);
    a.item.font_name = "Arial";
    b.item.font_name = "Arial-Bold";
    expect(line([a, b]).dominant_font_name).toBe("Arial-Bold");
  });

  test("falls back to bbox height and the matrix size when the font size is baked", () => {
    const a = itemAt("abc", 0, 0, 20, 11);
    a.item.font_size = 1;
    a.item.font_height = f32(10.5);
    const l = line([a]);
    expect(l.dominant_font_size).toBe(11);
    expect(l.font_size_is_estimated).toBe(true);
    expect(l.heading_font_size).toBe(f32(10.5));
  });

  test("an OCR-dominated line is estimated, and an in-figure candidate when native text exists", () => {
    const a = itemAt("scan", 0, 0, 20, 10);
    a.item.font_name = "OCR";
    a.item.font_size = 10;
    expect(line([a], [], false).font_size_is_estimated).toBe(true);
    expect(line([a], [], false).in_figure).toBe(false);
    expect(line([a], [], true).in_figure).toBe(true);
  });

  test("the dominant anchor wins and ties go to the larger key", () => {
    const a = itemAt("aa", 0, 0, 10, 10);
    const b = itemAt("bb", 20, 0, 10, 10);
    a.anchor = "Left";
    b.anchor = "Center";
    expect(line([a, b]).anchor).toBe("Center");
    const cases: Anchor[] = ["Right", "Floating"];
    for (const anchor of cases) {
      const c = itemAt("cc", 0, 0, 10, 10);
      c.anchor = anchor;
      expect(line([c]).anchor).toBe(anchor);
    }
  });

  test("marks a line inside a tall figure", () => {
    const a = itemAt("axis", 100, 100, 20, 10);
    const figure = { x: 50, y: 50, width: 200, height: 200 };
    expect(line([a], [figure]).in_figure).toBe(true);
    expect(line([a], [{ ...figure, height: 20 }]).in_figure).toBe(false);
    expect(line([a], [{ ...figure, x: 500 }]).in_figure).toBe(false);
  });

  test("an empty text line has a zero box", () => {
    const l = buildOneLine([], [], [], [], true);
    expect(l.bbox).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(l.all_bold).toBe(false);
    expect(l.dominant_font_name).toBeNull();
  });
});

describe("buildProjectedLines", () => {
  test("an empty page has no lines and an empty region", () => {
    const [lines, region] = buildProjectedLines([], 612, 792, []);
    expect(lines).toEqual([]);
    expect(region.kind).toEqual({ Leaf: { item_indices: [] } });
  });

  test("items on one baseline form one line and the next row forms another", () => {
    const items = [
      itemAt("left", 50, 100, 40, 10),
      itemAt("right", 100, 101, 40, 10),
      itemAt("below", 50, 130, 40, 10),
    ];
    const [lines] = buildProjectedLines(items, 612, 792, []);
    expect(lines.map((l) => l.text)).toEqual(["left right", "below"]);
    expect(lines.map((l) => l.span_item_indices)).toEqual([[0, 1], [2]]);
  });

  test("an inflated em-box item below a row does not fuse into it", () => {
    const items = [itemAt("head", 50, 100, 40, 10), itemAt("tall", 100, f32(103.5), 40, 56)];
    const [lines] = buildProjectedLines(items, 612, 792, []);
    expect(lines.map((l) => l.text)).toEqual(["head", "tall"]);
  });

  test("indent_x is relative to the leaf's leftmost line", () => {
    const items = [itemAt("flush", 100, 100, 40, 10), itemAt("indented", 130, 120, 40, 10)];
    const [lines] = buildProjectedLines(items, 612, 792, []);
    expect(lines.map((l) => l.indent_x)).toEqual([0, 30]);
    expect(lines.map((l) => l.bbox.x)).toEqual([100, 130]);
  });

  test("a line inside a tall figure is flagged unless the figure fills the page", () => {
    const items = [itemAt("axis", 100, 100, 20, 10)];
    const figure = { x: 50, y: 50, width: 200, height: 200 };
    expect(buildProjectedLines(items, 612, 792, [figure])[0][0].in_figure).toBe(true);
    const page = { x: 0, y: 0, width: 600, height: 780 };
    expect(buildProjectedLines(items, 612, 792, [page])[0][0].in_figure).toBe(false);
  });

  test("the region tree's leaves hold every item once", () => {
    const items = [
      itemAt("a", 50, 100, 40, 10),
      itemAt("b", 50, 120, 40, 10),
      itemAt("c", 50, 140, 40, 10),
    ];
    const [lines, region] = buildProjectedLines(items, 612, 792, []);
    const leaves: Array<[number[], number[]]> = [];
    xyWalkLeaves(region, [], leaves);
    const held = leaves.flatMap(([, idx]) => idx).sort((a, b) => a - b);
    expect(held).toEqual([0, 1, 2]);
    expect(lines.length).toBe(3);
  });
});

describe("xyWalkLeaves", () => {
  test("lists the leaves with items in pre-order with their index trails", () => {
    const leaf = (idx: number[]): Region => ({
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      kind: { Leaf: { item_indices: idx } },
    });
    const tree: Region = {
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      kind: {
        Split: {
          axis: "Horizontal",
          children: [
            leaf([0]),
            leaf([]),
            {
              bbox: { x: 0, y: 0, width: 1, height: 1 },
              kind: { Split: { axis: "Vertical", children: [leaf([1, 2]), leaf([3])] } },
            },
          ],
        },
      },
    };
    const out: Array<[number[], number[]]> = [];
    xyWalkLeaves(tree, [], out);
    expect(out).toEqual([
      [[0], [0]],
      [
        [2, 0],
        [1, 2],
      ],
      [[2, 1], [3]],
    ]);
  });
});
