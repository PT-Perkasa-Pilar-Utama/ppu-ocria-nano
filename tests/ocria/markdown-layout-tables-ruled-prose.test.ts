// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The #[cfg(test)] tests of liteparse markdown_layout/tables.rs for the ruled-grid
// prose stop and continuation rows (crates-v2.21.2).

import { describe, expect, test } from "bun:test";

import type { Cell } from "../../src/ocria/markdown-layout/block-types.js";
import { cell } from "../../src/ocria/markdown-layout/block-types.js";
import {
  assignCells,
  mergeContinuationRows,
  runningProseSentenceShape,
  shouldStopAtRunningProse,
} from "../../src/ocria/markdown-layout/tables/ruled/index.js";
import { line } from "../../src/ocria/markdown-layout/test-helpers.js";
import { f32 } from "../../src/ocria/rust.js";
import type { ProjectedLine } from "../../src/ocria/types/page.js";
import { textItem } from "../../src/ocria/types/text-item.js";
import type { TextItem } from "../../src/ocria/types/text-item.js";

type Positioned = Array<[string, number, number]>;

function proseTestWords(
  words: readonly string[],
  startX: number,
  charWidth: number,
  wordGap: number
): Positioned {
  let x = startX;
  return words.map((word) => {
    const width = f32(Array.from(word).length * charWidth);
    const positioned: [string, number, number] = [word, x, width];
    x = f32(x + f32(width + wordGap));
    return positioned;
  });
}

function proseTestSpan(words: Positioned, fontSize: number): TextItem {
  const x = words[0][1];
  const last = words[words.length - 1];
  const endX = f32(last[1] + last[2]);
  return textItem({
    text: words.map(([w]) => w).join(" "),
    x,
    y: 0,
    width: f32(endX - x),
    height: fontSize,
    font_size: fontSize,
    words: words.map(([text, wx, width]) => ({ text, x: wx, y: 0, width, height: fontSize })),
  });
}

function proseTestLine(text: string, spans: TextItem[], fontSize: number): ProjectedLine {
  const x0 = Math.min(...spans.map((s) => s.x));
  const x1 = Math.max(...spans.map((s) => f32(s.x + s.width)));
  const l = line(text, x0, 0, fontSize, fontSize);
  l.bbox = { x: x0, y: 0, width: f32(x1 - x0), height: fontSize };
  l.spans = spans;
  return l;
}

const PROSE =
  "During the year ended September 30, 2025, compensation expense increased $1.3 billion, or 2.8%, compared";

function atY(l: ProjectedLine, y: number): ProjectedLine {
  l.bbox.y = y;
  for (const span of l.spans) {
    span.y = y;
    for (const word of span.words) word.y = y;
  }
  return l;
}

function dataRow(cells: readonly string[], y: number): ProjectedLine {
  const spans = cells.map((text, c) =>
    proseTestSpan(proseTestWords([text], f32(10 + f32(100 * c)), 5, 2), 10)
  );
  return atY(proseTestLine(cells.join(" "), spans, 10), y);
}

function proseRow(y: number): ProjectedLine {
  const words = PROSE.split(" ");
  const positions = proseTestWords(words, 10, 3, 2);
  return atY(proseTestLine(PROSE, [proseTestSpan(positions, 10)], 10), y);
}

describe("ruled prose stop", () => {
  test("justified_prose_crossing_three_ruled_columns_stops", () => {
    const words = PROSE.split(" ");
    const positions = proseTestWords(words, 10, 3, 2);
    const l = proseTestLine(PROSE, [proseTestSpan(positions, 10)], 10);
    const firstGap = f32(f32(positions[5][1] + positions[5][2]) + 1);
    const secondGap = f32(f32(positions[10][1] + positions[10][2]) + 1);
    const xs = [0, firstGap, secondGap, 330];
    expect(runningProseSentenceShape(l)).toBe(true);
    expect(shouldStopAtRunningProse(l, xs)).toBe(true);
  });

  test("first_rent_comps_row_with_wide_cell_gaps_continues", () => {
    const left = proseTestWords(
      ["1", "Ashley", "Gables", "Buckhead", "530", "E", "Paces"],
      10,
      2,
      2
    );
    const middle = proseTestWords(["Ferry", "Rd", "NE", "2019", "Residential"], 120, 2, 2);
    const right = proseTestWords(["94%", "325", "0.6", "Miles", "$2,443"], 220, 2, 2);
    const text =
      "1 Ashley Gables Buckhead 530 E Paces Ferry Rd NE 2019 Residential 94% 325 0.6 Miles $2,443";
    const l = proseTestLine(
      text,
      [proseTestSpan(left, 10), proseTestSpan(middle, 10), proseTestSpan(right, 10)],
      10
    );
    expect(runningProseSentenceShape(l)).toBe(true);
    const assigned = assignCells([l], [0, 100, 200, 300], [0, 20], true);
    expect(assigned?.[1]).toEqual([0]);
  });

  test("merged_note_row_mid_table_keeps_rows_below", () => {
    const lines = [
      dataRow(["Cash", "1,000", "900"], 5),
      proseRow(25),
      dataRow(["Debt", "500", "600"], 45),
      dataRow(["Equity", "500", "300"], 65),
    ];
    const xs = [0, 100, 200, 330];
    expect(shouldStopAtRunningProse(lines[1], xs)).toBe(true);
    expect(assignCells(lines, xs, [0, 20, 40, 60, 80], true)?.[1]).toEqual([0, 1, 2, 3]);
  });

  test("prose_paragraph_between_tables_stops", () => {
    const lines = [
      dataRow(["Cash", "1,000", "900"], 5),
      proseRow(25),
      proseRow(45),
      dataRow(["Debt", "500", "600"], 65),
      dataRow(["Equity", "500", "300"], 85),
    ];
    const assigned = assignCells(lines, [0, 100, 200, 330], [0, 20, 40, 60, 80, 100], true);
    expect(assigned?.[1]).toEqual([0]);
  });

  test("running_prose_below_table_still_stops", () => {
    const lines = [
      dataRow(["Cash", "1,000", "900"], 5),
      dataRow(["Debt", "500", "600"], 25),
      proseRow(45),
      proseRow(65),
    ];
    const assigned = assignCells(lines, [0, 100, 200, 330], [0, 20, 40, 60, 80], true);
    expect(assigned?.[1]).toEqual([0, 1]);
  });

  test("long_left_column_label_with_right_column_numbers_continues", () => {
    const label =
      "The subject property benefits from recent renovations and convenient access to neighborhood services.";
    const spans = [
      textItem({ text: label, x: 10, y: 0, width: 270, height: 10 }),
      textItem({ text: "$1,250", x: 330, y: 0, width: 30, height: 10 }),
      textItem({ text: "2025", x: 520, y: 0, width: 24, height: 10 }),
    ];
    const l = proseTestLine(`${label} $1,250 2025`, spans, 10);
    expect(runningProseSentenceShape(l)).toBe(true);
    expect(shouldStopAtRunningProse(l, [0, 300, 500, 680])).toBe(false);
  });
});

function rows(v: readonly (readonly string[])[]): Cell[][] {
  return v.map((r) => r.map((s) => cell(s)));
}

describe("continuation rows", () => {
  test("wrapped_cell_lines_fold_into_their_row", () => {
    const r = rows([
      ["Knowledge", "● To understand the meaning of reducing and recycling"],
      ["", "and how they connect ● To be familiar with the 7 Rs"],
      ["Skills", "● To implement waste management into daily"],
      ["", "life ● To promote reducing before recycling"],
    ]);
    mergeContinuationRows(r);
    expect(r.length).toBe(2);
    expect(r[0][1].text).toBe(
      "● To understand the meaning of reducing and recycling and how they connect ● To be familiar with the 7 Rs"
    );
    expect(r[1][0].text).toBe("Skills");
  });

  test("totals_row_with_blank_label_is_not_a_continuation", () => {
    // Regression: doc 45/47. A `Total` line legitimately has an empty label
    // column; folding it into the last data row destroys both rows.
    const r = rows([
      ["7", "Traditional and Modern Mental Health Organization", "15"],
      ["", "Total", "27,926"],
    ]);
    mergeContinuationRows(r);
    expect(r.length).toBe(2);
    expect(r[1][1].text).toBe("Total");
  });

  test("sparse_first_column_disables_continuation_merging", () => {
    const r = rows([
      ["", "8:24", "8:28", "8:41"],
      ["", "8:29", "8:33", "8:46"],
      ["", "8:33", "8:37", "8:50"],
      ["", "8:38", "8:42", "8:55"],
    ]);
    mergeContinuationRows(r);
    expect(r.length).toBe(4);
  });

  test("continuation_may_not_introduce_a_new_column", () => {
    const r = rows([
      ["Label", "some text", ""],
      ["", "more text", "brand new"],
    ]);
    mergeContinuationRows(r);
    expect(r.length).toBe(2);
  });

  test("fresh_sentence_after_closed_cell_is_not_a_continuation", () => {
    const r = rows([
      ["Label", "A complete thought ending here."],
      ["", "Another separate statement entirely."],
    ]);
    mergeContinuationRows(r);
    expect(r.length).toBe(2);
  });

  test("continuation_row_merge_folds_items", () => {
    const r = rows([
      ["Knowledge", "To understand the meaning of reducing"],
      ["", "and how they connect"],
    ]);
    r[0][0].text_item_indices = [0];
    r[0][1].text_item_indices = [1];
    r[1][1].text_item_indices = [2];
    mergeContinuationRows(r);
    expect(r.length).toBe(1);
    expect(r[0][1].text_item_indices).toEqual([1, 2]);
  });
});
