// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The `impl Grid` of liteparse crates/liteparse/src/table_model/{mod,decode}.rs (crates-v2.21.2):
// the checks that keep a grid from being a table, its span rows and its HTML.

import { describe, expect, test } from "bun:test";

import { toHtml } from "../../src/ocria/table-model/grid-html.js";
import { isChart, isProse, isToc, toSpanRows } from "../../src/ocria/table-model/grid.js";
import type { Grid, GridCell } from "../../src/ocria/table-model/types.js";

const cell = (r0: number, c0: number, text: string, r1 = r0, c1 = c0): GridCell => ({
  r0,
  c0,
  r1,
  c1,
  text,
  bx: [c0 * 50, r0 * 20, c0 * 50 + 40, r0 * 20 + 10],
});

const grid = (cells: GridCell[], nRows: number, nCols: number, head: number[] = []): Grid => ({
  cells,
  head_rows: head,
  n_rows: nRows,
  n_cols: nCols,
});

describe("Grid", () => {
  test("a table of contents ends rows in rising page numbers", () => {
    const toc = grid(
      [
        cell(0, 0, "Intro"),
        cell(0, 1, "1"),
        cell(1, 0, "Method"),
        cell(1, 1, "4"),
        cell(2, 0, "Results"),
        cell(2, 1, "9"),
        cell(3, 0, "Preface"),
        cell(3, 1, "iv"),
      ],
      4,
      2
    );
    expect(isToc(toc)).toBe(true);
    expect(
      isToc(
        grid(
          toc.cells.map((c) => (c.text === "9" ? { ...c, text: "ix" } : c)),
          4,
          2
        )
      )
    ).toBe(true);
    // pages going back down are no contents list
    const falling = grid(
      toc.cells
        .map((c) => (c.text === "4" ? { ...c, text: "0" } : c))
        .map((c) => (c.text === "9" ? { ...c, text: "1" } : c))
        .map((c) => (c.text === "1" ? { ...c, text: "9" } : c)),
      4,
      2
    );
    expect(isToc(falling)).toBe(false);
    expect(isToc(grid(toc.cells, 4, 4))).toBe(false);
    expect(isToc(grid([cell(0, 0, "a"), cell(0, 1, "b")], 1, 2))).toBe(false);
  });

  test("columns of running prose are no table", () => {
    const words = "the quick brown fox jumps over";
    const prose = grid(
      [0, 1, 2].flatMap((r) => [cell(r, 0, `${words} calendar`), cell(r, 1, `will be ${words}`)]),
      3,
      2
    );
    expect(isProse(prose)).toBe(true);
    // sentences that end do not run on
    expect(
      isProse(
        grid(
          prose.cells.map((c) => ({ ...c, text: `${c.text}.` })),
          3,
          2
        )
      )
    ).toBe(false);
    // short or numeric cells are data
    expect(
      isProse(
        grid(
          prose.cells.map((c) => ({ ...c, text: "12" })),
          3,
          2
        )
      )
    ).toBe(false);
    expect(isProse(grid(prose.cells.slice(0, 3), 2, 2))).toBe(false);
    expect(
      isProse(
        grid(
          prose.cells.map((c) => ({ ...c, text: `x ${c.text.split(" ")[0]}` })),
          3,
          2
        )
      )
    ).toBe(false);
  });

  test("a sparse numeric grid with a stepped axis is a chart", () => {
    const ticks = [100, 80, 60, 40, 20].map((v, r) => cell(r, 0, String(v)));
    const chart = grid([...ticks, cell(2, 3, "7")], 5, 6);
    expect(isChart(chart)).toBe(true);
    expect(isChart(grid([], 0, 0))).toBe(false);
    // a dense grid is a table
    expect(isChart(grid(ticks, 5, 1))).toBe(false);
    // unevenly stepped numbers are data
    const uneven = [100, 80, 55, 40, 20].map((v, r) => cell(r, 0, String(v)));
    expect(isChart(grid([...uneven, cell(2, 3, "n/a")], 5, 6))).toBe(false);
    // numbers in reading order across columns
    const years = [2019, 2020, 2021, 2022].map((v, i) => cell(i, i, String(v)));
    expect(isChart(grid(years, 4, 8))).toBe(true);
    expect(
      isChart(
        grid([cell(0, 0, "1.2.3"), cell(1, 0, "-"), cell(2, 0, "+.5%"), cell(3, 0, "1,0")], 4, 9)
      )
    ).toBe(false);
  });

  test("span rows omit covered slots and fill empty ones", () => {
    const g = grid([cell(0, 0, "Title", 0, 1), cell(1, 0, "a", 2, 0), cell(1, 1, "b")], 3, 3, [0]);
    const [rows, header] = toSpanRows(g);
    expect(header).toBe(1);
    expect(rows[0].map((c) => [c.text, c.colspan, c.rowspan])).toEqual([
      ["Title", 2, 1],
      ["", 1, 1],
    ]);
    expect(rows[1].map((c) => c.text)).toEqual(["a", "b", ""]);
    expect(rows[1][0].rowspan).toBe(2);
    expect(rows[2].map((c) => c.text)).toEqual(["", ""]);
    expect(rows[0][0].bbox).toEqual({ x: 0, y: 0, width: 40, height: 10 });
    expect(rows[0][1].bbox).toBeNull();
  });

  test("html escapes the text, marks header rows and spans", () => {
    const g = grid([cell(0, 0, "A & <B> \"c\" 'd'", 0, 1), cell(1, 0, "x", 2, 0)], 3, 2, [0]);
    expect(toHtml(g)).toBe(
      [
        "<table>",
        '<tr><th colspan="2">A &amp; &lt;B&gt; &quot;c&quot; &#x27;d&#x27;</th></tr>',
        '<tr><td rowspan="2">x</td><td></td></tr>',
        "<tr><td></td></tr>",
        "</table>",
      ].join("\n")
    );
  });
});
