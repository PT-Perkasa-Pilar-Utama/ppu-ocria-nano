// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The #[cfg(test)] tests of liteparse markdown_layout/tables.rs (merged-cell recovery, header absorption, detect_tables), ported test for test.

import { describe, expect, test } from "bun:test";

import {
  countTextTableRuns,
  detectTables,
  partitionItems,
  recoverMergedCell,
} from "../../src/ocria/markdown-layout/tables/borderless/index.js";
import type { TableCell } from "../../src/ocria/markdown-layout/tables/types.js";
import {
  spec,
  taggedLines,
  tc,
  tableOf,
  texts,
} from "./markdown-layout-borderless-helpers.test.js";

describe("recover_merged_cell", () => {
  test("recover_merged_cell_splits_off_by_one", () => {
    // Row 1's projection merges "MEMORYBANK" + "5.00" into one span at x=50
    // width=110, so split_cells yields 2 cells while the table expects 3.
    const row = [tc(50, 160, "MEMORYBANK 5.00"), tc(250, 280, "4.77")];
    const out = recoverMergedCell(row, [50, 150, 250]);
    if (out === null) throw new Error("recovery should succeed");
    expect(texts(out)).toEqual(["MEMORYBANK", "5.00", "4.77"]);
  });

  test("recover_merged_cell_hands_each_part_its_own_items", () => {
    const row = (items: number[], ranges: Array<[number, number]>): TableCell[] => [
      tc(50, 160, "MEMORYBANK 5.00", { text_item_indices: items, item_x_ranges: ranges }),
      tc(250, 280, "4.77", { text_item_indices: [9], item_x_ranges: [[250, 280]] }),
    ];
    const tracks = [50, 150, 250];
    // Two items the gap test joined: each part keeps only its own.
    let out = recoverMergedCell(
      row(
        [7, 8],
        [
          [50, 110],
          [152, 160],
        ]
      ),
      tracks
    );
    if (out === null) throw new Error("recovery should succeed");
    expect(out[0].text_item_indices).toEqual([7]);
    expect(out[1].text_item_indices).toEqual([8]);
    expect(out[2].text_item_indices).toEqual([9]);
    // One merged run across the track feeds both parts.
    out = recoverMergedCell(row([7], [[50, 160]]), tracks);
    if (out === null) throw new Error("recovery should succeed");
    expect(out[0].text_item_indices).toEqual([7]);
    expect(out[1].text_item_indices).toEqual([7]);
    // Without ranges, both parts keep every item.
    out = recoverMergedCell(row([7, 8], []), tracks);
    if (out === null) throw new Error("recovery should succeed");
    expect(out[0].text_item_indices).toEqual([7, 8]);
    expect(out[1].text_item_indices).toEqual([7, 8]);
  });

  test("partition_items_loses_no_item_at_a_cut", () => {
    const c = tc(50, 180, "a b c", {
      text_item_indices: [1, 2, 3],
      item_x_ranges: [
        [50, 148],
        [149.5, 149.5],
        [150, 180],
      ],
    });
    const parts = partitionItems(c, [150]);
    expect(parts[0][0]).toEqual([1, 2]);
    expect(parts[1][0]).toEqual([3]);
    // A run spread thinly over many parts (20% of it in each) stays with the
    // part holding its centre. Each part has an item of its own, so the
    // empty-part fallback cannot hide a loss.
    const wide: TableCell = {
      ...c,
      text_item_indices: [7, 1, 2, 3, 4, 5],
      item_x_ranges: [
        [0, 100],
        [5, 10],
        [25, 30],
        [45, 50],
        [65, 70],
        [85, 90],
      ],
    };
    expect(partitionItems(wide, [20, 40, 60, 80]).map((p) => p[0])).toEqual([
      [1],
      [2],
      [7, 3],
      [4],
      [5],
    ]);
  });

  test("recover_merged_cell_splits_off_by_two", () => {
    // Three merged tokens in one cell: "MEMORYBANK 13.18 10.03" straddles
    // tracks at 50/150/250 and the row has only 2 cells, off by 2.
    const row = [tc(50, 260, "MEMORYBANK 13.18 10.03"), tc(350, 380, "7.61")];
    const out = recoverMergedCell(row, [50, 150, 250, 350]);
    if (out === null) throw new Error("recovery should succeed");
    expect(texts(out)).toEqual(["MEMORYBANK", "13.18", "10.03", "7.61"]);
  });

  test("recover_merged_cell_bails_without_enough_whitespace", () => {
    const row = [tc(50, 200, "ABC-DEF-GHI")];
    expect(recoverMergedCell(row, [50, 150])).toBeNull();
  });
});

describe("header absorption", () => {
  test("absorbs_partial_header_line_above_body", () => {
    // A header line with only two track-aligned cells sits above a clean
    // 3-column body. It can't start the table on its own but should be walked
    // back in as the header.
    const lines = [
      spec("Name@50|Scores@150", 100),
      spec("A@50|1@150|2@250", 115),
      spec("B@50|3@150|4@250", 130),
      spec("C@50|5@150|6@250", 145),
    ];
    const runs = detectTables(lines);
    expect(runs.length).toBe(1);
    const run = runs[0];
    expect(run.start).toBe(0);
    expect(run.end).toBe(4);
    const { header, rows } = tableOf(run);
    expect(header && texts(header)).toEqual(["Name", "Scores", ""]);
    // All three body rows survive: the header came from above.
    expect(rows.length).toBe(3);
  });

  test("absorbs_header_over_interleaved_note_line", () => {
    // Issue #395: a free-text note between the header and the first body row
    // blocked header absorption. The walk must step over one such line,
    // absorb the real header, and hand the note back as an interstitial.
    const lines = [
      spec("Name@50|Score@150|Ref@250", 100),
      spec("Shipment was delayed in transit.@80", 122),
      spec("A@50|1@150|2@250", 136),
      spec("B@50|3@150|4@250", 150),
      spec("C@50|5@150|6@250", 164),
    ];
    const runs = detectTables(lines);
    expect(runs.length).toBe(1);
    const run = runs[0];
    expect(run.start).toBe(0);
    expect(run.end).toBe(5);
    expect(texts(run.interstitials)).toEqual(["Shipment was delayed in transit."]);
    const { header, rows } = tableOf(run);
    expect(header && texts(header)).toEqual(["Name", "Score", "Ref"]);
    expect(rows.length).toBe(3);
  });

  test("does_not_absorb_single_cell_title_above_body", () => {
    const lines = [
      spec("Results@50", 100),
      spec("A@50|1@150|2@250", 115),
      spec("B@50|3@150|4@250", 130),
      spec("C@50|5@150|6@250", 145),
    ];
    const runs = detectTables(lines);
    expect(runs.length).toBe(1);
    expect(runs[0].start).toBe(1);
  });
});

describe("detect_tables", () => {
  test("count_text_table_runs_excludes_description_lists", () => {
    // A label/value stack detects as a description-list run, but must not
    // count toward the layout-complexity table signal.
    const lines = [
      spec("Name:@50|Alice@200", 100),
      spec("Role:@50|Engineer@200", 115),
      spec("Team:@50|Platform@200", 130),
      spec("Start:@50|2020@200", 145),
    ];
    expect(detectTables(lines).length).toBe(1);
    expect(countTextTableRuns(lines)).toBe(0);
  });

  test("count_text_table_runs_counts_borderless_tables", () => {
    const lines = [
      spec("A@50|1@150|2@250", 100),
      spec("B@50|3@150|4@250", 115),
      spec("C@50|5@150|6@250", 130),
    ];
    expect(countTextTableRuns(lines)).toBe(1);
  });

  test("rejects_table_when_row_count_too_low", () => {
    const lines = [spec("A@50|B@150|C@250", 100)];
    expect(detectTables(lines)).toEqual([]);
  });

  test("rejects_table_when_column_count_too_low", () => {
    const lines = [spec("A@50|B@200", 100), spec("C@50|D@200", 115)];
    expect(detectTables(lines)).toEqual([]);
  });

  test("borderless_table_cells_carry_span_extents", () => {
    // A borderless table has no drawn boundaries, so a cell covers the ink of
    // its own spans on that row, not a full column track.
    const lines = [
      spec("Name@50|Qty@150|Cost@250", 100),
      spec("Bolt@50|12@150|3.50@250", 115),
      spec("Nut@50|40@150|1.25@250", 130),
    ];
    const runs = detectTables(lines);
    expect(runs.length).toBe(1);
    const { rows } = tableOf(runs[0]);
    for (const row of rows) for (const c of row) expect(c.bbox).not.toBeNull();
    const first = rows[0][0].bbox;
    expect(first?.x).toBe(50);
    const row0y = rows[0][0].bbox?.y ?? 0;
    const row1y = rows[1][0].bbox?.y ?? 0;
    expect(row1y).toBeGreaterThan(row0y);
    expect(rows[0][1].bbox?.x).toBe(150);
    expect(rows[0][2].bbox?.x).toBe(250);
  });

  test("borderless_table_cells_carry_their_items", () => {
    const lines = [
      spec("Name@50|Qty@150|Cost@250", 100),
      spec("Bolt@50|12@150|3.50@250", 115),
      spec("Nut@50|40@150|1.25@250", 130),
    ];
    lines.forEach((l, r) => {
      l.span_item_indices = [r * 3, r * 3 + 1, r * 3 + 2];
    });
    const runs = detectTables(lines);
    expect(runs.length).toBe(1);
    const { header, rows } = tableOf(runs[0]);
    expect(header).toBeNull();
    rows.forEach((row, r) =>
      row.forEach((c, k) => expect(c.text_item_indices).toEqual([r * 3 + k]))
    );
  });

  test("wrapped_label_above_the_body_keeps_its_items", () => {
    // "Productos primarios" is stepped over below the header, then folded into
    // the first body row's label: its item goes with it.
    const lines = taggedLines([
      ["Rubro@50|2001@150|2002@250", 100],
      ["Productos primarios@50", 118],
      ["pesqueros@50|663@150|700@250", 136],
      ["agricolas@50|120@150|130@250", 148],
      ["mineros@50|10@150|20@250", 160],
    ]);
    const runs = detectTables(lines);
    expect(runs.length).toBe(1);
    expect(runs[0].interstitials).toEqual([]);
    const { rows } = tableOf(runs[0]);
    expect(rows[0][0].text).toBe("Productos primarios pesqueros");
    expect(rows[0][0].text_item_indices).toEqual([3, 4]);
  });

  test("buffered_leading_label_keeps_its_items", () => {
    // "Exportaciones totales" is buffered as the leading half of the next
    // row's label and prepended to it: its item goes with it.
    const lines = taggedLines([
      ["Rubro@50|2001@150|2002@250", 100],
      ["agricolas@50|120@150|130@250", 112],
      ["Exportaciones totales@50", 124],
      ["pesqueras@50|895@150|900@250", 136],
      ["mineros@50|10@150|20@250", 148],
    ]);
    const runs = detectTables(lines);
    expect(runs.length).toBe(1);
    const { rows } = tableOf(runs[0]);
    expect(rows[2][0].text).toBe("Exportaciones totales pesqueras");
    expect(rows[2][0].text_item_indices).toEqual([6, 7]);
  });
});
