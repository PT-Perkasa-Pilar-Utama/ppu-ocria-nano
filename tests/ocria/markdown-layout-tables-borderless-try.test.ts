// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The #[cfg(test)] tests of liteparse markdown_layout/tables.rs (try_detect_table and run text accounting), ported test for test.

import { describe, expect, test } from "bun:test";

import { cell } from "../../src/ocria/markdown-layout/block-types.js";
import type { Cell } from "../../src/ocria/markdown-layout/block-types.js";
import {
  linesLeftOut,
  runTextKept,
  tryDetectTable,
} from "../../src/ocria/markdown-layout/tables/borderless/index.js";
import type { TableRun } from "../../src/ocria/markdown-layout/tables/types.js";
import { line } from "../../src/ocria/markdown-layout/test-helpers.js";
import { assertRunKeepsText, row3, spec } from "./markdown-layout-borderless-helpers.test.js";

describe("try_detect_table", () => {
  test("grid_fallback_keeps_lines_folded_into_a_row", () => {
    // The third line wraps into the second row's last cell; the uneven row
    // cadence (10pt then 35pt) then demotes the run to a grid fallback, which
    // must still carry the wrapped line.
    const lines = [
      row3("Name", "Phone", "Notes", 100),
      row3("Ann", "555-0100", "call first", 110),
      spec("after noon@350", 120),
      row3("Bob", "555-0101", "none", 145),
    ];
    const run = tryDetectTable(lines, 0, 0);
    if (run === null) throw new Error("tabular enough to fall back to a grid");
    expect(typeof run.block !== "string" && "GridFallback" in run.block).toBe(true);
    expect([run.start, run.end]).toEqual([0, 4]);
    assertRunKeepsText(lines, run);
  });

  test("cells_past_the_tracks_become_interstitials", () => {
    // The second row carries a fourth cell beyond the table's right edge
    // (another page column's text on the same baseline).
    const lines = [
      row3("Name", "Phone", "Notes", 100),
      row3("Ann", "555-0100", "none", 112, "Fax 555-0199@450"),
      row3("Bob", "555-0101", "none", 124),
      row3("Cy", "555-0102", "none", 136),
    ];
    const run = tryDetectTable(lines, 0, 0);
    if (run === null) throw new Error("table");
    expect(typeof run.block !== "string" && "Table" in run.block).toBe(true);
    expect([run.start, run.end]).toEqual([0, 4]);
    assertRunKeepsText(lines, run);
  });

  test("lines_right_of_the_tracks_become_interstitials", () => {
    // The third line sits wholly right of the table, between its rows. The run
    // steps over it to keep the table whole; its text must come back.
    const lines = [
      row3("Name", "Phone", "Notes", 100),
      row3("Ann", "555-0100", "none", 112),
      spec("Fax 555-0199@450", 118),
      row3("Bob", "555-0101", "none", 124),
      row3("Cy", "555-0102", "none", 136),
    ];
    const run = tryDetectTable(lines, 0, 0);
    if (run === null) throw new Error("table");
    expect([run.start, run.end]).toEqual([0, 5]);
    assertRunKeepsText(lines, run);
  });

  test("a_line_right_of_the_tracks_after_the_last_row_stays_out_of_the_run", () => {
    const lines = [
      row3("Name", "Phone", "Notes", 100),
      row3("Ann", "555-0100", "none", 112),
      row3("Bob", "555-0101", "none", 124),
      spec("Fax 555-0199@450", 136),
      line("A paragraph well below the table.", 50, 300, 10, 10),
    ];
    const run = tryDetectTable(lines, 0, 0);
    if (run === null) throw new Error("table");
    expect([run.start, run.end]).toEqual([0, 3]);
    expect(run.interstitials).toEqual([]);
  });
});

describe("run text accounting", () => {
  const mkRun = (rows: Cell[][], header: Cell[] | null, end: number): TableRun => ({
    interstitials: [],
    start: 0,
    end,
    body_start: 0,
    bbox: null,
    item_indices: [],
    block: { Table: { header, rows } },
  });

  test("run_text_kept_counts_what_the_table_carries", () => {
    const lines = [
      line("Model Capacity", 10, 10, 12, 10),
      line("50D 5,000 @ 24 2,270 @ 600 26-79", 10, 25, 12, 10),
    ];
    const whole = mkRun(
      [
        [cell("Model"), cell("Capacity")],
        [cell("50D"), cell("5,000 @ 24 2,270 @ 600 26-79")],
      ],
      null,
      2
    );
    expect(runTextKept(whole, lines)).toBe(1);
    // Only the model column made it into the cells: the capacities are inside
    // the span the classifier skips, so they would be lost.
    const partial = mkRun([[cell("Model")], [cell("50D")]], null, 2);
    expect(runTextKept(partial, lines) ?? 1).toBeLessThan(0.7);
  });

  test("lines_left_out_names_lines_no_cell_took", () => {
    const lines = [
      line("Model Order No.", 10, 10, 12, 10),
      line("50D 659249", 10, 25, 12, 10),
      line("Integral arms.", 10, 40, 12, 10),
    ];
    const run = mkRun([[cell("50D"), cell("659249")]], [cell("Model"), cell("Order No.")], 3);
    expect(linesLeftOut(run, lines)).toEqual([2]);
  });
});
