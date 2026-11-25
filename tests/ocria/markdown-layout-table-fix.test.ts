// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The #[cfg(test)] tests of liteparse markdown_layout/table_fix.rs, plus one `absorb_header_band`
// check (upstream has none; the goldens reach it only through a model table).

import { describe, expect, test } from "bun:test";

import type { Block, SpanCell } from "../../src/ocria/markdown-layout/block-types.js";
import { line } from "../../src/ocria/markdown-layout/test-helpers.js";
import { absorbHeaderBand, fixBlock } from "../../src/ocria/markdown-layout/table-fix/index.js";
import { stripLeaderRuns } from "../../src/ocria/markdown-layout/table-fix/rules.js";
import type { Grid } from "../../src/ocria/table-model/types.js";
import type { Rect } from "../../src/ocria/types/geometry.js";
import type { ProjectedLine } from "../../src/ocria/types/page.js";
import { textItem } from "../../src/ocria/types/text-item.js";

function sc(text: string, bbox: Rect | null = null): SpanCell {
  return { text, colspan: 1, rowspan: 1, bbox, text_item_indices: [] };
}

function merged(rows: SpanCell[][], headerRows: number): Block {
  return { MergedTable: { rows, header_rows: headerRows } };
}

function mergedRows(b: Block): SpanCell[][] {
  if (typeof b === "string" || !("MergedTable" in b)) throw new Error("not a merged table");
  return b.MergedTable.rows;
}

function texts(rows: SpanCell[][]): string[][] {
  return rows.map((r) => r.map((c) => c.text));
}

describe("table_fix", () => {
  test("currency_cells_move_and_empty_column_goes", () => {
    const b = merged(
      [
        [sc("Item"), sc(""), sc("2024"), sc("Pct")],
        [sc("Appliances"), sc("$"), sc("14,046"), sc("8.8 %")],
        [sc("Bath"), sc(""), sc("6,485"), sc("4.1")],
      ],
      1
    );
    fixBlock(b);
    expect(texts(mergedRows(b))).toEqual([
      ["Item", "2024", "Pct"],
      ["Appliances", "$ 14,046", "8.8 %"],
      ["Bath", "6,485", "4.1"],
    ]);
  });

  test("trailing_symbol_moves_right", () => {
    const b = merged(
      [
        [sc("A"), sc("8.8 % $"), sc("13,917")],
        [sc("B"), sc("4.3"), sc("6,630")],
      ],
      0
    );
    fixBlock(b);
    expect(texts(mergedRows(b))[0]).toEqual(["A", "8.8 %", "$ 13,917"]);
  });

  test("wrapped_cell_row_folds", () => {
    const b = merged(
      [
        [sc("Title"), sc("Page"), sc("Dated")],
        [sc("Independent Distributors"), sc("CW-CGL"), sc("06/01/18")],
        [sc(""), sc("FOOD.EXCLPRODUCTS"), sc("")],
        [sc("Independent Distributors"), sc("CW-CGL"), sc("06/01/18")],
        [sc("Other"), sc("CW-X"), sc("06/01/18")],
      ],
      1
    );
    fixBlock(b);
    const t = texts(mergedRows(b));
    expect(t.length).toBe(4);
    expect(t[1][1]).toBe("CW-CGL FOOD.EXCLPRODUCTS");
  });

  test("numeric_sub_rows_do_not_fold", () => {
    const b = merged(
      [
        [sc("Year"), sc("Q"), sc("Value")],
        [sc("2022"), sc("Q1"), sc("5")],
        [sc(""), sc("Q2"), sc("6")],
        [sc("2023"), sc("Q1"), sc("7")],
      ],
      1
    );
    fixBlock(b);
    expect(mergedRows(b).length).toBe(4);
  });

  test("leaders_stripped", () => {
    expect(stripLeaderRuns("2022 ......................")).toBe("2022");
    expect(stripLeaderRuns("Total . . . . . .")).toBe("Total");
    expect(stripLeaderRuns("v1.2.3")).toBe("v1.2.3");
  });

  test("group_header_spans_when_centred", () => {
    const r = (x: number, w: number): Rect => ({ x, y: 0, width: w, height: 10 });
    const b = merged(
      [
        [sc(""), sc("Fiscal 2024", r(120, 60)), sc("")],
        [sc("Item", r(0, 50)), sc("Net Sales", r(100, 40)), sc("% of Net Sales", r(150, 50))],
        [sc("Bath"), sc("6,485"), sc("4.1")],
      ],
      2
    );
    fixBlock(b);
    const rows = mergedRows(b);
    expect(rows[0].length).toBe(2);
    expect(rows[0][1].colspan).toBe(2);
  });

  test("a hyphenated cell continued on the next row folds into it", () => {
    const b = merged(
      [
        [sc("Name"), sc("Desc"), sc("Val")],
        [sc("A"), sc("Long descrip-"), sc("5")],
        [sc(""), sc("tion text"), sc("")],
        [sc("B"), sc("Short"), sc("6")],
      ],
      1
    );
    fixBlock(b);
    expect(texts(mergedRows(b))[1]).toEqual(["A", "Long descrip-tion text", "5"]);
    expect(mergedRows(b).length).toBe(3);
  });

  test("a continuation joins the cell above it by horizontal overlap, not by column", () => {
    const r = (x: number, w: number): Rect => ({ x, y: 0, width: w, height: 10 });
    const b = merged(
      [
        [sc("Name"), sc("Desc"), sc("Val")],
        [sc("A", r(0, 40)), sc("Long descrip-", r(100, 50)), sc("5", r(200, 20))],
        [sc("tion text", r(100, 50)), sc(""), sc("")],
        [sc("B"), sc("Short"), sc("6")],
      ],
      1
    );
    fixBlock(b);
    const row = mergedRows(b)[1];
    expect(row.map((c) => c.text)).toEqual(["A", "Long descrip-tion text", "5"]);
    expect(row[1].bbox).toEqual({ x: 100, y: 0, width: 50, height: 10 });
  });

  test("a wrapped cell written with row spans folds into the record", () => {
    const spanning = (text: string): SpanCell => ({ ...sc(text), rowspan: 2 });
    const b = merged(
      [
        [sc("H1"), sc("H2"), sc("H3")],
        [spanning("A"), sc("Long descrip-"), spanning("V")],
        [sc("tion")],
      ],
      1
    );
    fixBlock(b);
    expect(texts(mergedRows(b))).toEqual([
      ["H1", "H2", "H3"],
      ["A", "Long descrip-tion", "V"],
    ]);
    expect(mergedRows(b)[1].map((c) => c.rowspan)).toEqual([1, 1, 1]);
  });

  test("a plain table stays plain and drops its currency column", () => {
    const cell = (text: string) => ({ text, bbox: null, text_item_indices: [] });
    const b: Block = {
      Table: {
        header: [cell("Item"), cell(""), cell("2024")],
        rows: [
          [cell("Appliances"), cell("$"), cell("14,046")],
          [cell("Bath"), cell(""), cell("6,485")],
        ],
      },
    };
    fixBlock(b);
    if (typeof b === "string" || !("Table" in b)) throw new Error("not a table");
    expect(b.Table.header?.map((c) => c.text)).toEqual(["Item", "2024"]);
    expect(b.Table.rows.map((r) => r.map((c) => c.text))).toEqual([
      ["Appliances", "$ 14,046"],
      ["Bath", "6,485"],
    ]);
  });

  test("absorb_header_band turns a column-aligned line above a table into header rows", () => {
    const cellAt = (r: number, c: number, text: string, x: number) => ({
      r0: r,
      c0: c,
      r1: r,
      c1: c,
      text,
      bx: [x, 100 + r * 12, x + 40, 110 + r * 12] as [number, number, number, number],
    });
    const g: Grid = {
      // column 1 is empty in row 0 and gets its extent from row 1
      cells: [cellAt(0, 0, "a", 0), cellAt(1, 0, "b", 0), cellAt(1, 1, "c", 100)],
      head_rows: [0],
      n_rows: 2,
      n_cols: 2,
    };
    const spans = [
      textItem({ text: "Name", x: 0, y: 80, width: 30, height: 10 }),
      textItem({ text: "Value", x: 100, y: 80, width: 30, height: 10 }),
    ];
    const l: ProjectedLine = { ...line("Name   Value", 0, 80, 10, 10), spans };
    const pb: Rect[] = [{ x: 0, y: 80, width: 130, height: 10 }];
    const taken = new Map<number, ProjectedLine | null>();
    const absorbed = absorbHeaderBand(g, [l], pb, taken);
    expect(absorbed).toEqual([0]);
    expect(g.n_rows).toBe(3);
    expect(g.head_rows).toEqual([0, 1]);
    expect(g.cells.filter((x) => x.r0 === 0).map((x) => x.text)).toEqual(["Name", "Value"]);
    // a line in `taken` is left alone
    const g2: Grid = {
      cells: [cellAt(0, 0, "a", 0), cellAt(1, 1, "c", 100)],
      head_rows: [0],
      n_rows: 2,
      n_cols: 2,
    };
    expect(absorbHeaderBand(g2, [l], pb, new Map([[0, null]]))).toEqual([]);
  });
});
