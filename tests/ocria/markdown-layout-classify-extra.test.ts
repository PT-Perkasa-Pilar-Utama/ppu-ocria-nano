// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Checks of classify.rs paths that no Rust unit test reaches (the goldens reach them only in part).
// Each expectation is derived from the Rust source by hand, not recorded from a run.

import { describe, expect, test } from "bun:test";

import type { Block } from "../../src/ocria/markdown-layout/block-types.js";
import {
  classifyPageWithFilters,
  framePageBox,
  isTocPage,
  linePageBoxes,
  pageBoxes,
  residualLine,
  tableBlockIsProse,
} from "../../src/ocria/markdown-layout/classify/index.js";
import { line, page } from "../../src/ocria/markdown-layout/test-helpers.js";
import type { Rect } from "../../src/ocria/types/geometry.js";
import { textItem } from "../../src/ocria/types/text-item.js";

function grid(rows: string[][]): Block {
  return {
    Table: {
      header: null,
      rows: rows.map((r) => r.map((text) => ({ text, bbox: null, text_item_indices: [] }))),
    },
  };
}

describe("tableBlockIsProse", () => {
  test("columns whose text runs on down each column are prose", () => {
    const rows = [
      ["the quick brown fox jumps", "over a lazy dog while"],
      ["running across the field", "and then it stops near"],
      ["a quiet river bank where", "the water is cold and"],
      ["fish swim past slowly", "under the old stone bridge"],
    ];
    expect(tableBlockIsProse(grid(rows))).toBe(true);
  });

  test("a table of numbers is not prose", () => {
    const rows = [
      ["Item", "2023", "2024"],
      ["Rent", "1,000", "1,100"],
      ["Food", "400", "450"],
      ["Fuel", "120", "130"],
    ];
    expect(tableBlockIsProse(grid(rows))).toBe(false);
  });

  test("fewer than six filled cells is not prose", () => {
    expect(tableBlockIsProse(grid([["one two three", "four five six"]]))).toBe(false);
  });

  test("blocks that are not tables are not prose", () => {
    expect(tableBlockIsProse("HorizontalRule")).toBe(false);
  });
});

describe("residualLine", () => {
  test("a rest of blank spans leaves no line", () => {
    expect(residualLine(line("x", 0, 0, 10, 10), [textItem({ text: "  " })])).toBeNull();
    expect(residualLine(line("x", 0, 0, 10, 10), [])).toBeNull();
  });

  test("text and box are rebuilt from the remaining spans", () => {
    const rest = [
      textItem({ text: " b ", x: 40, y: 12, width: 10, height: 8 }),
      textItem({ text: "c", x: 60, y: 10, width: 5, height: 10 }),
    ];
    const l = residualLine(line("a b c", 10, 10, 10, 10), rest);
    if (l === null) throw new Error("expected a line");
    expect(l.text).toBe("b c");
    expect(l.bbox).toEqual({ x: 40, y: 10, width: 25, height: 10 });
    expect(l.indent_x).toBe(40);
  });
});

describe("page boxes", () => {
  test("a line shifted by the projection is mapped back by its most common offset", () => {
    const orig = textItem({ text: "abc", x: 10, y: 100, width: 30, height: 10 });
    const moved = textItem({ text: "abc", x: 10, y: 500, width: 30, height: 10 });
    const p = page([]);
    p.text_items = [orig];
    const l = line("abc", 10, 500, 10, 10);
    l.spans = [moved];
    const [b] = pageBoxes(p, [l]);
    expect(b).toEqual({ x: 10, y: 100, width: l.bbox.width, height: 10 });
  });

  test("a line with no matching item keeps its box", () => {
    const p = page([]);
    p.text_items = [textItem({ text: "zzz", x: 1, y: 1, width: 5, height: 5 })];
    const l = line("abc", 10, 500, 10, 10);
    expect(pageBoxes(p, [l])[0].y).toBe(500);
  });

  test("projected item frames map a box back to the original item boxes", () => {
    const frames: Array<[Rect, Rect]> = [
      [
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 100, y: 200, width: 10, height: 10 },
      ],
      [
        { x: 50, y: 0, width: 10, height: 10 },
        { x: 300, y: 400, width: 5, height: 5 },
      ],
    ];
    expect(framePageBox({ x: 0, y: 0, width: 20, height: 10 }, frames)).toEqual({
      x: 100,
      y: 200,
      width: 10,
      height: 10,
    });
    expect(framePageBox({ x: 500, y: 500, width: 5, height: 5 }, frames)).toBeNull();
    const p = page([line("abc", 0, 0, 10, 10)]);
    p.projected_item_frames = frames;
    expect(linePageBoxes(p, p.projected_lines)[0].x).toBe(100);
  });
});

describe("table of contents pages", () => {
  test("a Contents title with no page numbers marks the page", () => {
    const p = page([
      line("Contents", 50, 50, 10, 10),
      line("Introduction to the subject", 50, 70, 10, 10),
      line("Methods and materials", 50, 90, 10, 10),
    ]);
    expect(isTocPage(p)).toBe(true);
  });

  test("three long body lines after the title mean a content page", () => {
    const body = "This sentence is long enough to count as a body paragraph line of the page text.";
    const p = page([
      line("Contents", 50, 50, 10, 10),
      line(body, 50, 70, 10, 10),
      line(body, 50, 90, 10, 10),
      line(body, 50, 110, 10, 10),
    ]);
    expect(isTocPage(p)).toBe(false);
  });
});

describe("stitch across regions", () => {
  test("a soft hyphen break across leaves drops the hyphen", () => {
    const a = line("hello super-", 50, 700, 10, 10);
    a.region_path = [0];
    const b = line("visor ends here.", 320, 50, 10, 10);
    b.region_path = [1];
    const blocks = classifyPageWithFilters(
      page([a, b]),
      [],
      new Set(),
      [],
      "placeholder",
      new Set()
    );
    expect(blocks.length).toBe(1);
    const para = blocks[0].block;
    if (typeof para === "string" || !("Paragraph" in para)) throw new Error("expected paragraph");
    expect(para.Paragraph.text).toBe("hello supervisor ends here.");
  });

  test("a sentence that ends keeps the next leaf's paragraph apart", () => {
    const a = line("The sentence ends here.", 50, 700, 10, 10);
    a.region_path = [0];
    const b = line("another leaf starts lowercase.", 320, 50, 10, 10);
    b.region_path = [1];
    const blocks = classifyPageWithFilters(
      page([a, b]),
      [],
      new Set(),
      [],
      "placeholder",
      new Set()
    );
    expect(blocks.length).toBe(2);
  });
});
