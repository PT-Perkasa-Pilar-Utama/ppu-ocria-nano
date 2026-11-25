// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The #[cfg(test)] tests of liteparse markdown_layout/tables.rs that run the whole
// ruled-grid detector (crates-v2.21.2).

import { describe, expect, test } from "bun:test";

import type { Block, Cell } from "../../src/ocria/markdown-layout/block-types.js";
import { cell } from "../../src/ocria/markdown-layout/block-types.js";
import {
  detectRuledTables,
  extractRuleSegments,
  mergeTableRuns,
} from "../../src/ocria/markdown-layout/tables/ruled/index.js";
import type { TableRun } from "../../src/ocria/markdown-layout/tables/types.js";
import {
  line,
  lineWithSpans,
  rectBorders,
  rowTexts,
  stroke,
} from "../../src/ocria/markdown-layout/test-helpers.js";
import type { GraphicPrimitive } from "../../src/ocria/types/geometry.js";
import type { ProjectedLine } from "../../src/ocria/types/page.js";

function grid2x2(): GraphicPrimitive[] {
  const g: GraphicPrimitive[] = [];
  for (const y of [100, 140, 180]) g.push(stroke(50, y, 250, y, 0.5));
  for (const x of [50, 150, 250]) g.push(stroke(x, 100, x, 180, 0.5));
  return g;
}

function fourCellLines(): ProjectedLine[] {
  return [
    line("a", 90, 115, 10, 10),
    line("b", 190, 115, 10, 10),
    line("c", 90, 155, 10, 10),
    line("d", 190, 155, 10, 10),
  ];
}

function tableOf(run: TableRun): { header: Cell[] | null; rows: Cell[][] } {
  const b = run.block;
  if (typeof b === "string" || !("Table" in b)) throw new Error("expected Block::Table");
  return b.Table;
}

describe("detectRuledTables", () => {
  test("ruled_table_2x2_detected", () => {
    const runs = detectRuledTables(fourCellLines(), extractRuleSegments(grid2x2()), 612, 792);
    expect(runs.length).toBe(1);
    const { header, rows: body } = tableOf(runs[0]);
    expect(header).toBeNull();
    expect(rowTexts(body)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  test("ruled_table_cells_carry_their_grid_rect", () => {
    const runs = detectRuledTables(fourCellLines(), extractRuleSegments(grid2x2()), 612, 792);
    const { rows: body } = tableOf(runs[0]);
    const rect = (r: number, c: number): [number, number, number, number] => {
      const b = body[r][c].bbox;
      if (b == null) throw new Error("ruled cell must be located");
      return [b.x, b.y, b.width, b.height];
    };
    expect(body[0][0].text).toBe("a");
    expect(rect(0, 0)).toEqual([50, 100, 100, 40]);
    expect(rect(0, 1)).toEqual([150, 100, 100, 40]);
    expect(rect(1, 0)).toEqual([50, 140, 100, 40]);
    expect(rect(1, 1)).toEqual([150, 140, 100, 40]);
  });

  test("ruled_table_rect_borders_detected", () => {
    const g = [
      ...rectBorders(50, 100, 100, 40),
      ...rectBorders(150, 100, 100, 40),
      ...rectBorders(50, 140, 100, 40),
      ...rectBorders(150, 140, 100, 40),
    ];
    expect(detectRuledTables(fourCellLines(), extractRuleSegments(g), 612, 792).length).toBe(1);
  });

  test("ruled_table_page_border_rejected", () => {
    const g = rectBorders(10, 10, 590, 770);
    const lines = [line("body text", 50, 400, 10, 10)];
    expect(detectRuledTables(lines, extractRuleSegments(g), 612, 792)).toEqual([]);
  });

  test("ruled_table_mostly_empty_rejected", () => {
    // 3x3 grid with text in only one cell: empty fraction 8/9 is well over 30%.
    const g: GraphicPrimitive[] = [];
    for (const y of [100, 130, 160, 190]) g.push(stroke(50, y, 350, y, 0.5));
    for (const x of [50, 150, 250, 350]) g.push(stroke(x, 100, x, 190, 0.5));
    const lines = [line("only", 90, 115, 10, 10)];
    expect(detectRuledTables(lines, extractRuleSegments(g), 612, 792)).toEqual([]);
  });

  test("ruled_table_first_row_bold_becomes_header", () => {
    const a = line("Name", 90, 115, 10, 10);
    const b = line("Score", 190, 115, 10, 10);
    a.all_bold = true;
    b.all_bold = true;
    const lines = [a, b, line("alice", 90, 155, 10, 10), line("99", 190, 155, 10, 10)];
    const runs = detectRuledTables(lines, extractRuleSegments(grid2x2()), 612, 792);
    expect(runs.length).toBe(1);
    const { header, rows: body } = tableOf(runs[0]);
    expect(header?.map((c) => c.text)).toEqual(["Name", "Score"]);
    expect(rowTexts(body)).toEqual([["alice", "99"]]);
  });

  test("ruled_table_cells_carry_their_items", () => {
    const lines = [
      lineWithSpans(
        [
          ["a", 90],
          ["b", 190],
        ],
        115,
        10
      ),
      lineWithSpans(
        [
          ["c", 90],
          ["d", 190],
        ],
        155,
        10
      ),
    ];
    lines[0].span_item_indices = [10, 11];
    lines[1].span_item_indices = [12, 13];
    const runs = detectRuledTables(lines, extractRuleSegments(grid2x2()), 612, 792);
    expect(runs.length).toBe(1);
    const { rows: body } = tableOf(runs[0]);
    expect(body[0][0].text_item_indices).toEqual([10]);
    expect(body[0][1].text_item_indices).toEqual([11]);
    expect(body[1][0].text_item_indices).toEqual([12]);
    expect(body[1][1].text_item_indices).toEqual([13]);
  });

  test("ruled_straddle_split_attributes_both_cells", () => {
    // Row 1's single span crosses the column boundary at x=150, so both halves
    // come from the same item.
    const lines = [
      lineWithSpans(
        [
          ["a", 90],
          ["b", 190],
        ],
        115,
        10
      ),
      lineWithSpans([["aaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbb", 55]], 155, 10),
    ];
    lines[0].span_item_indices = [0, 1];
    lines[1].span_item_indices = [2];
    const runs = detectRuledTables(lines, extractRuleSegments(grid2x2()), 612, 792);
    const { rows: body } = tableOf(runs[0]);
    expect(body[1][0].text !== "" && body[1][1].text !== "").toBe(true);
    expect(body[1][0].text_item_indices).toEqual([2]);
    expect(body[1][1].text_item_indices).toEqual([2]);
  });
});

describe("mergeTableRuns", () => {
  test("merge_prefers_ruled_when_overlapping", () => {
    const ruled: TableRun[] = [
      {
        interstitials: [],
        item_indices: [],
        start: 5,
        end: 10,
        body_start: 5,
        bbox: null,
        block: { Table: { header: null, rows: [[cell("ruled")]] } },
      },
    ];
    const gridFallback: Block = { GridFallback: { lines: ["bl"] } };
    const borderless: TableRun[] = [
      {
        interstitials: [],
        item_indices: [],
        start: 6,
        end: 11,
        body_start: 6,
        bbox: null,
        block: gridFallback,
      },
    ];
    const merged = mergeTableRuns(ruled, borderless);
    expect(merged.length).toBe(1);
    expect("Table" in (merged[0].block as object)).toBe(true);
  });
});
