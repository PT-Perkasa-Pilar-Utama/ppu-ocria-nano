// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// layout.rs against LiteParse's own values: `layout.input` pages and the
// recorded `layout.blocks` give the pages' `blocks` of `layout.pages`. The unit
// tests are the `#[cfg(test)]` tests of layout.rs and stages.rs.

import { describe, expect, test } from "bun:test";

import {
  blocksForPage,
  clipToPage,
  layoutBlockFromPositioned,
  layoutBlockOf,
  layoutCellFromCell,
  layoutCellFromSpanCell,
  remapToPageFrame,
  withModelBlocks,
  xyCutOrder,
} from "../../src/ocria/layout/index.js";
import type { LayoutBlock, LayoutCell } from "../../src/ocria/layout/types.js";
import type { Block, PositionedBlock } from "../../src/ocria/markdown-layout/block-types.js";
import { cell, spanCell } from "../../src/ocria/markdown-layout/block-types.js";
import { positionedBlockFromJson } from "../../src/ocria/markdown-layout/render/index.js";
import { layoutBlocks } from "../../src/ocria/stages/layout-blocks.js";
import type { Rect } from "../../src/ocria/types/geometry.js";
import type { ParsedPage } from "../../src/ocria/types/page.js";
import type { TextItem } from "../../src/ocria/types/text-item.js";
import { textItem } from "../../src/ocria/types/text-item.js";
import {
  canon,
  loadParseGolden,
  parsedPageFromJson,
  parseGoldenNames,
  stage,
} from "./parse-golden.js";

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

/** `ParsedPage` with every field at its empty value. */
function emptyPage(over: Partial<ParsedPage> = {}): ParsedPage {
  return parsedPageFromJson({
    page_number: 1,
    page_width: 612,
    page_height: 792,
    text: "",
    text_items: [],
    ...over,
  });
}

const para = (bbox: Rect): LayoutBlock => ({ ...layoutBlockOf("paragraph", bbox), text: "t" });

const item = (r: Rect): TextItem => textItem({ x: r.x, y: r.y, width: r.width, height: r.height });

const paragraph = (text: string): Block => ({ Paragraph: { text, bold: false, italic: false } });

describe.each(parseGoldenNames())("%s", (name) => {
  test("layout.input and layout.blocks to the pages' blocks", () => {
    const g = loadParseGolden(name);
    // SAFETY: the recorder writes layout.input as ParsedPage[] and layout.blocks per page.
    const pages = (stage(g, "layout.input") as unknown[]).map(parsedPageFromJson);
    const recorded = g.stages.get("layout.blocks") ?? [];
    expect(recorded.length).toBe(pages.length);
    pages.forEach((page, i) => {
      const raw = recorded[i];
      const blocks: PositionedBlock[] = Array.isArray(raw) ? raw.map(positionedBlockFromJson) : [];
      const heuristic = layoutBlocks(page, blocks);
      page.blocks = page.model_blocks.length === 0 ? heuristic : withModelBlocks(page, heuristic);
    });
    // SAFETY: layout.pages is the ParsedPage[] after apply_layout.
    const expected = (stage(g, "layout.pages") as Array<{ blocks?: unknown }>).map((p) => p.blocks);
    expect(canon(pages.map((p) => p.blocks))).toEqual(canon(expected));
  });
});

describe("layout.rs unit tests", () => {
  test("remap unions the rects of the items read", () => {
    const items = [
      // Body text displaced one page-height (792pt) down by rotation
      // handling; the page-frame rects are the items' own.
      item(rect(50, 100, 100, 10)),
      item(rect(50, 112, 120, 10)),
      // A rotated sidebar, unrotated in the projection frame.
      item(rect(14, 300, 12, 200)),
    ];
    const blocks = [
      { ...para(rect(50, 892, 120, 22)), text_item_indices: [0, 1] },
      { ...para(rect(20, 30, 200, 12)), text_item_indices: [2] },
      layoutBlockOf("figure", rect(300, 300, 50, 50)),
    ];
    remapToPageFrame(blocks, items);
    expect(blocks[0].bbox).toEqual(rect(50, 100, 120, 22));
    expect(blocks[1].bbox).toEqual(rect(14, 300, 12, 200));
    // Graphics-derived boxes are already in page space.
    expect(blocks[2].bbox).toEqual(rect(300, 300, 50, 50));
  });

  test("clip_to_page clips offpage cells", () => {
    const mk = (text: string, bbox: Rect): LayoutCell => ({ text, bbox, text_item_indices: [] });
    // A ruled column whose right boundary came from a path drawn far past
    // the 595pt page edge.
    const blocks: LayoutBlock[] = [
      {
        ...layoutBlockOf("table", rect(160, 650, 5362, 14)),
        header: [mk("h", rect(-20, -5, 200, 20))],
        rows: [[mk("a", rect(160, 650, 274, 14)), mk("", rect(434, 650, 5088, 14))]],
      },
      para(rect(-10, 10, 100, 10)),
    ];
    clipToPage(blocks, 595, 842);
    expect(blocks[0].bbox).toEqual(rect(160, 650, 435, 14));
    expect(blocks[0].header?.[0].bbox).toEqual(rect(0, 0, 180, 15));
    const row = blocks[0].rows?.[0] ?? [];
    expect(row[0].bbox).toEqual(rect(160, 650, 274, 14));
    expect(row[1].bbox).toEqual(rect(434, 650, 161, 14));
    // Every block is clipped, not only tables.
    expect(blocks[1].bbox).toEqual(rect(0, 10, 90, 10));
  });

  test("clip_to_page leaves non-finite geometry alone", () => {
    const nan = rect(Number.NaN, 10, 50, 10);
    let blocks = [layoutBlockOf("table", nan)];
    clipToPage(blocks, 595, 842);
    expect(Number.isNaN(blocks[0].bbox?.x)).toBe(true);
    const inf = rect(Number.NEGATIVE_INFINITY, 10, Number.POSITIVE_INFINITY, 10);
    blocks = [layoutBlockOf("table", { ...inf })];
    clipToPage(blocks, 595, 842);
    expect(blocks[0].bbox).toEqual(inf);
    blocks = [layoutBlockOf("table", rect(0, 0, 900, 10))];
    clipToPage(blocks, Number.NaN, 842);
    expect(blocks[0].bbox).toEqual(rect(0, 0, 900, 10));
  });

  test("remap leaves boxes with no items untouched", () => {
    const blocks = [para(rect(200, 200, 50, 10))];
    remapToPageFrame(blocks, [item(rect(0, 100, 10, 10))]);
    expect(blocks[0].bbox).toEqual(rect(200, 200, 50, 10));
  });

  test("block items are sorted and deduplicated", () => {
    const pb: PositionedBlock = {
      block: paragraph("x"),
      bbox: null,
      text_item_indices: [5, 2, 5, 9, 2],
    };
    expect(layoutBlockFromPositioned(pb).text_item_indices).toEqual([2, 5, 9]);
  });

  test("table block items are the union of its cells", () => {
    const withItems = (items: number[]) => cell("x", null, items);
    // The block's own list is ignored: only the cells say what was read.
    const pb: PositionedBlock = {
      block: {
        Table: {
          header: [withItems([3])],
          rows: [[withItems([1]), withItems([2, 1])]],
        },
      },
      bbox: null,
      text_item_indices: [9],
    };
    expect(layoutBlockFromPositioned(pb).text_item_indices).toEqual([1, 2, 3]);
  });

  test("cell items keep reading order", () => {
    expect(layoutCellFromCell(cell("a b", null, [9, 3, 9, 7])).text_item_indices).toEqual([
      9, 3, 7,
    ]);
    const span = { ...spanCell("wide", 2, 1), text_item_indices: [4, 4, 1] };
    const out = layoutCellFromSpanCell(span);
    expect(out.text_item_indices).toEqual([4, 1]);
    expect(out.colspan).toBe(2);
    expect(out.rowspan).toBeUndefined();
  });

  test("out-of-range items are dropped at the boundary", () => {
    const page = emptyPage({ text_items: [textItem({}), textItem({})] });
    const p: PositionedBlock = {
      block: paragraph("p"),
      bbox: null,
      text_item_indices: [0, 1, 2, 7],
    };
    const table: PositionedBlock = {
      block: { Table: { header: null, rows: [[cell("c", null, [1, 2])]] } },
      bbox: null,
      text_item_indices: [],
    };
    const out = blocksForPage(page, [p, table]);
    expect(out[0].text_item_indices).toEqual([0, 1]);
    expect(out[1].text_item_indices).toEqual([1]);
    expect(out[1].rows?.[0][0].text_item_indices).toEqual([1]);
  });

  test("stages.rs layout_blocks keeps caller-supplied items", () => {
    const block: PositionedBlock = {
      block: {
        MergedTable: {
          rows: [
            [spanCell("wide", 2, 1)],
            [
              { ...spanCell("a"), text_item_indices: [0] },
              { ...spanCell("b"), text_item_indices: [1, 1] },
            ],
          ],
          header_rows: 1,
        },
      },
      bbox: null,
      text_item_indices: [],
    };
    const page = emptyPage({ text_items: [textItem({}), textItem({})] });
    const out = layoutBlocks(page, [block]);
    expect(out[0].text_item_indices).toEqual([0, 1]);
    const rows = out[0].rows ?? [];
    expect(rows[0][0].text_item_indices).toEqual([]);
    expect(rows[1][1].text_item_indices).toEqual([1]);
  });
});

describe("layout blocks by kind", () => {
  const pb = (block: Block, bbox: Rect | null = null): PositionedBlock => ({
    block,
    bbox,
    text_item_indices: [],
  });

  test("each Block variant maps to its kind and fields", () => {
    const out = [
      pb({ Heading: { level: 2, text: "H" } }),
      pb({
        ListItem: { ordered: true, marker: "1.", level: 1, text: "li", bold: true, italic: true },
      }),
      pb({ CodeBlock: { lines: ["a"], lang: "py" } }),
      pb({ CodeBlock: { lines: ["b"], lang: null } }),
      pb({ GridFallback: { lines: ["g"] } }),
      pb("HorizontalRule", rect(1, 2, 3, 4)),
      pb({ Figure: { id: "p1_1", format: "png" } }),
    ].map(layoutBlockFromPositioned);
    expect(out.map((b) => b.kind)).toEqual([
      "heading",
      "list_item",
      "code",
      "code",
      "grid_fallback",
      "rule",
      "figure",
    ]);
    expect(out[0]).toMatchObject({ text: "H", level: 2 });
    expect(out[1]).toMatchObject({
      ordered: true,
      marker: "1.",
      level: 1,
      bold: true,
      italic: true,
    });
    expect(out[2].lang).toBe("py");
    expect(out[3].lang).toBeUndefined();
    expect(out[5].bbox).toEqual(rect(1, 2, 3, 4));
    expect(out[6]).toMatchObject({ id: "p1_1", format: "png" });
  });
});

describe("with_model_blocks and the XY-cut order", () => {
  const model = (r: Rect, cls: number, text: string): ParsedPage["model_blocks"][number] => ({
    bbox: r,
    class: cls,
    text,
  });

  test("model blocks replace text blocks, a kept table keeps its items, columns read left to right", () => {
    const items = [
      textItem({ text: "left", x: 10, y: 100, width: 100, height: 10 }),
      textItem({ text: "right", x: 300, y: 100, width: 100, height: 10 }),
      textItem({ text: "cell", x: 10, y: 500, width: 50, height: 10 }),
    ];
    const page = emptyPage({
      text_items: items,
      model_blocks: [
        // class 5 = List, 0 = Text, 1 = Heading, 2 = Title, 6 = Table, 11 = FigureText
        model(rect(300, 95, 150, 20), 0, "right col"),
        model(rect(10, 95, 150, 20), 5, "left col"),
        model(rect(10, 10, 400, 20), 2, "Title"),
        model(rect(10, 495, 60, 20), 0, "inside the table"),
        model(rect(10, 300, 60, 20), 6, "table class"),
        model(rect(10, 330, 60, 20), 11, "figure text"),
        model(rect(10, 360, 60, 20), 10, "code()"),
        model(rect(10, 400, 60, 20), 0, "   "),
      ],
    });
    const table: LayoutBlock = {
      ...layoutBlockOf("table", rect(5, 490, 100, 30)),
      text_item_indices: [2],
    };
    const dropped = para(rect(0, 0, 10, 10));
    const out = withModelBlocks(page, [dropped, table]);
    expect(out.map((b) => b.kind)).toEqual(["heading", "list_item", "code", "table", "paragraph"]);
    expect(out[0]).toMatchObject({ level: 1, text: "Title" });
    expect(out[1]).toMatchObject({ text: "left col", text_item_indices: [0] });
    // The title band reads first, then the left column top to bottom, then the right column.
    expect(out[2].lines).toEqual(["code()"]);
    expect(out[3].text_item_indices).toEqual([2]);
    expect(out[4]).toMatchObject({ text: "right col", text_item_indices: [1] });
  });

  test("xy_cut_order puts full-bleed blocks first and splits at the widest gutter", () => {
    const blocks = [
      para(rect(300, 10, 100, 100)),
      para(rect(10, 10, 100, 100)),
      para(rect(0, 0, 400, 400)),
      para(rect(10, 200, 100, 20)),
    ];
    // Block 2 covers half the page or more; then the left column (1, 3) before the right (0).
    expect(xyCutOrder(blocks, 400 * 400)).toEqual([2, 1, 3, 0]);
  });

  test("a region with neither gutter nor gap reads top to bottom, then left to right", () => {
    const blocks = [
      para(rect(10, 10, 100, 100)),
      para(rect(50, 10, 100, 50)),
      para(rect(0, 5, 80, 100)),
    ];
    // Same top edge order: y 5 (block 2), then y 10 with the lower x (block 0), then block 1.
    expect(xyCutOrder(blocks, 1_000_000)).toEqual([2, 0, 1]);
  });
});
