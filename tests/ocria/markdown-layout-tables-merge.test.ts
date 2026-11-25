// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The #[cfg(test)] tests of liteparse markdown_layout/tables.rs whose subject
// is the cross-run merges and the union header.

import { describe, expect, test } from "bun:test";

import type { Block, Cell } from "../../src/ocria/markdown-layout/block-types.js";
import { cell } from "../../src/ocria/markdown-layout/block-types.js";
import { mergeConsecutiveTableRuns } from "../../src/ocria/markdown-layout/tables/merge/index.js";
import type { TableRun } from "../../src/ocria/markdown-layout/tables/types.js";
import { lineWithSpans } from "../../src/ocria/markdown-layout/test-helpers.js";
import type { ProjectedLine } from "../../src/ocria/types/page.js";

/** `"A".into()` for each text: cells carrying text only. */
const cells = (...texts: string[]): Cell[] => texts.map((t) => cell(t));

function tableOf(b: Block): { header: Cell[] | null; rows: Cell[][] } {
  if (typeof b === "string" || !("Table" in b)) throw new Error("expected Block::Table");
  return b.Table;
}

const texts = (row: Cell[]): string[] => row.map((c) => c.text);

function run(
  start: number,
  end: number,
  header: Cell[] | null,
  rows: Cell[][],
  block?: Block
): TableRun {
  return {
    interstitials: [],
    item_indices: [],
    start,
    end,
    body_start: start,
    bbox: null,
    block: block ?? { Table: { header, rows } },
  };
}

describe("merge_consecutive_table_runs", () => {
  // Fixtures are synthetic 3-cell and 4-cell rows at known x positions so the
  // re-derived tracks match the runs constructed by hand.
  const threeColLine = (label: string, y: number): ProjectedLine =>
    lineWithSpans(
      [
        [label, 50],
        [label, 150],
        [label, 250],
      ],
      y,
      10
    );
  const fourColLine = (label: string, y: number): ProjectedLine =>
    lineWithSpans(
      [
        [label, 50],
        [label, 150],
        [label, 250],
        [label, 350],
      ],
      y,
      10
    );
  // A row whose three cells sit at tracks 2..4 of a 4-col layout (subset of
  // the 4-col tracks: missing leftmost column at x=50).
  const threeColSubsetLine = (label: string, y: number): ProjectedLine =>
    lineWithSpans(
      [
        [label, 150],
        [label, 250],
        [label, 350],
      ],
      y,
      10
    );

  test("merge_same_column_count_concatenates_rows", () => {
    const lines = [
      threeColLine("h1", 10),
      threeColLine("h2", 25),
      threeColLine("b1", 40),
      threeColLine("b2", 55),
      threeColLine("b3", 70),
    ];
    const a = run(0, 2, cells("A", "B", "C"), [cells("1", "2", "3")]);
    const b = run(2, 5, null, [cells("x", "y", "z"), cells("p", "q", "r"), cells("m", "n", "o")]);
    const merged = mergeConsecutiveTableRuns([a, b], lines);
    expect(merged.length).toBe(1);
    const { header, rows } = tableOf(merged[0].block);
    expect(header?.length).toBe(3);
    expect(rows.length).toBe(4);
    expect(texts(rows[0])).toEqual(["1", "2", "3"]);
    expect(texts(rows[3])).toEqual(["m", "n", "o"]);
  });

  test("merge_subset_columns_folds_into_header", () => {
    // A is a 2-row 3-col "header" whose tracks land on columns 2..4 of B's
    // 4-col body (the row-label column is missing in A). After merge: one 4-col
    // table whose header has empty col 0 and B's body rows.
    const lines = [
      threeColSubsetLine("2011", 10),
      threeColSubsetLine("(pct)", 25),
      fourColLine("body", 40),
      fourColLine("body", 55),
      fourColLine("body", 70),
    ];
    const a = run(0, 2, null, [cells("2011", "2010", "Avg"), cells("(pct)", "(pct)", "(pct)")]);
    const b = run(2, 5, null, [
      cells("Q3", "10", "20", "30"),
      cells("Q4", "11", "21", "31"),
      cells("YR", "12", "22", "32"),
    ]);
    const merged = mergeConsecutiveTableRuns([a, b], lines);
    expect(merged.length).toBe(1);
    const { header, rows } = tableOf(merged[0].block);
    expect(header).not.toBeNull();
    const h = header ?? [];
    expect(h.length).toBe(4);
    expect(h[0].text).toBe("");
    // Adjacent identical pieces are deduped per column.
    expect(h[1].text).toBe("2011 (pct)");
    expect(h[2].text).toBe("2010 (pct)");
    expect(h[3].text).toBe("Avg (pct)");
    expect(rows.length).toBe(3);
    expect(texts(rows[0])).toEqual(["Q3", "10", "20", "30"]);
  });

  test("merge_skips_distant_runs", () => {
    // Same shape as the same-column test but B is far below A.
    const lines = [
      threeColLine("h1", 10),
      threeColLine("h2", 25),
      threeColLine("b1", 200), // ~16x line height below
      threeColLine("b2", 215),
    ];
    const a = run(0, 2, cells("A", "B", "C"), [cells("1", "2", "3")]);
    const b = run(2, 4, null, [cells("x", "y", "z"), cells("p", "q", "r")]);
    expect(mergeConsecutiveTableRuns([a, b], lines).length).toBe(2);
  });

  test("merge_skips_large_prior_run", () => {
    // A has 10 body rows: large enough that it's a real standalone table, not
    // a header to fold into B.
    const lines = [
      ...Array.from({ length: 10 }, (_, i) => threeColSubsetLine("x", 10 + i * 15)),
      ...Array.from({ length: 3 }, (_, i) => fourColLine("y", 160 + i * 15)),
    ];
    const a = run(
      0,
      10,
      null,
      Array.from({ length: 10 }, () => cells("a", "b", "c"))
    );
    const b = run(
      10,
      13,
      null,
      Array.from({ length: 3 }, () => cells("1", "2", "3", "4"))
    );
    expect(mergeConsecutiveTableRuns([a, b], lines).length).toBe(2);
  });

  test("merge_skips_two_col_diff", () => {
    // A is 3-col, B is 5-col: too large a column-count delta to be a
    // header-vs-body relationship.
    const five = (y: number): ProjectedLine =>
      lineWithSpans(
        [
          ["a", 50],
          ["b", 150],
          ["c", 250],
          ["d", 350],
          ["e", 450],
        ],
        y,
        10
      );
    const lines = [threeColSubsetLine("x", 10), threeColSubsetLine("y", 25), five(40), five(55)];
    const a = run(0, 2, null, [cells("x", "y", "z"), cells("x", "y", "z")]);
    const b = run(2, 4, null, [cells("1", "2", "3", "4", "5"), cells("1", "2", "3", "4", "5")]);
    expect(mergeConsecutiveTableRuns([a, b], lines).length).toBe(2);
  });

  test("merge_grid_fallback_left_alone", () => {
    const lines = [threeColLine("a", 10), threeColLine("b", 25), threeColLine("c", 40)];
    const a = run(0, 2, null, [cells("a", "b", "c"), cells("a", "b", "c")]);
    const b = run(2, 3, null, [], { GridFallback: { lines: ["fallback"] } });
    expect(mergeConsecutiveTableRuns([a, b], lines).length).toBe(2);
  });

  test("merge_rejects_long_prose_interstitial", () => {
    // A multi-cell or long prose line between runs must not be silently
    // dropped by a merge.
    const lines = [
      threeColLine("h", 10),
      threeColLine("h", 25),
      lineWithSpans(
        [
          ["This", 50],
          ["is", 150],
          ["real", 250],
          ["content", 350],
        ],
        40,
        10
      ),
      threeColLine("b", 55),
      threeColLine("b", 70),
    ];
    const a = run(0, 2, cells("A", "B", "C"), [cells("1", "2", "3")]);
    const b = run(3, 5, null, [cells("x", "y", "z"), cells("p", "q", "r")]);
    expect(mergeConsecutiveTableRuns([a, b], lines).length).toBe(2);
  });

  test("merge_absorbs_single_cell_interstitial_as_body_row", () => {
    // Apple-earnings / NASS shape: 4-col header rows + a single-cell category
    // divider ("Topsoil") + 5-col body. The divider must be preserved as a body
    // row in the merged table.
    const lines = [
      threeColSubsetLine("h", 10),
      threeColSubsetLine("h", 25),
      lineWithSpans([["Topsoil", 50]], 40, 10),
      fourColLine("body", 55),
      fourColLine("body", 70),
      fourColLine("body", 85),
    ];
    const a = run(0, 2, null, [cells("2011", "2010", "Avg"), cells("(pct)", "(pct)", "(pct)")]);
    const b = run(3, 6, null, [
      cells("Q3", "10", "20", "30"),
      cells("Q4", "11", "21", "31"),
      cells("YR", "12", "22", "32"),
    ]);
    const merged = mergeConsecutiveTableRuns([a, b], lines);
    expect(merged.length).toBe(1);
    const { header, rows } = tableOf(merged[0].block);
    expect(header).not.toBeNull();
    expect(rows.length).toBe(4); // interstitial + 3 body rows
    expect(rows[0][0].text).toBe("Topsoil");
    expect(texts(rows[1])).toEqual(["Q3", "10", "20", "30"]);
  });
});
