// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The #[cfg(test)] tests of liteparse markdown_layout/tables.rs (span pieces, split_cells, rule bands), ported test for test.

import { describe, expect, test } from "bun:test";

import { f32 } from "../../src/ocria/rust.js";
import type { GraphicPrimitive } from "../../src/ocria/types/geometry.js";
import { textItem } from "../../src/ocria/types/text-item.js";
import type { TextItem } from "../../src/ocria/types/text-item.js";
import { extractRuleSegments } from "../../src/ocria/markdown-layout/tables/ruled/index.js";
import {
  cellsFromPieces,
  lineCell,
  linePieces,
  ruleBands,
  spanningHeaderEligible,
  spanningTrackIndices,
  splitCells,
  splitSpanAtGutters,
} from "../../src/ocria/markdown-layout/tables/borderless/index.js";
import { spec, tc, texts } from "./markdown-layout-borderless-helpers.test.js";

function runWithWords(words: ReadonlyArray<[string, number, number]>): TextItem {
  const ws = words.map(([t, x, w]) => [t, f32(x), f32(w)] as const);
  const x = ws[0][1];
  const last = ws[ws.length - 1];
  return textItem({
    text: ws.map(([t]) => t).join(" "),
    x,
    width: f32(f32(last[1] + last[2]) - x),
    height: 10,
    font_size: 10,
    words: ws.map(([t, wx, ww]) => ({ text: t, x: wx, y: 0, width: ww, height: 10 })),
  });
}

function pieceTexts(span: TextItem): string[] {
  return splitSpanAtGutters(span).map((p) => p.text);
}

describe("span pieces", () => {
  test("merged_run_splits_at_its_column_gutters", () => {
    // doc 190's header: PDFium emits eight cells as one run. In-cell word
    // gaps are 1.76pt; the gutters are 7.7-12.2pt.
    const span = runWithWords([
      ["Merge", 172.5, 18.3],
      ["Method", 192.5, 21.9],
      ["H6", 226.6, 8.6],
      ["(Avg.)", 237.0, 18.1],
      ["ARC", 263.5, 14.5],
    ]);
    expect(pieceTexts(span)).toEqual(["Merge Method", "H6 (Avg.)", "ARC"]);
  });

  test("justified_prose_does_not_split", () => {
    const span = runWithWords([
      ["may", 306.1, 19.0],
      ["not", 327.8, 14.1],
      ["be", 344.6, 10.4],
      ["as", 357.8, 9.2],
      ["crucial.", 369.7, 32.7],
      ["Thus,", 405.8, 24.8],
      ["we", 433.3, 12.8],
    ]);
    expect(pieceTexts(span).length).toBe(1);
  });

  test("run_without_word_boxes_stays_whole", () => {
    const span = runWithWords([
      ["A", 0, 5],
      ["B", 20, 5],
      ["C", 26, 5],
    ]);
    span.words = [];
    expect(pieceTexts(span)).toEqual(["A B C"]);
  });

  test("kerning_outlier_gap_does_not_fake_bimodality", () => {
    const span = runWithWords([
      ["wide", 100, 20],
      ["gap", 120.1, 15],
      ["then", 138.5, 18],
      ["normal", 159.9, 25],
    ]);
    expect(pieceTexts(span).length).toBe(1);
  });

  test("two_word_run_has_no_bimodality_to_measure", () => {
    const span = runWithWords([
      ["Added", 60.3, 24.1],
      ["Relative", 118.0, 31.1],
    ]);
    expect(pieceTexts(span)).toEqual(["Added Relative"]);
  });

  test("merged_span_split_attributes_each_cell", () => {
    const l = spec("aaaaaaaaaa bbbbbbbbbb@50", 100);
    const pieces = linePieces(l);
    expect(pieces.length).toBe(1);
    expect(pieces[0].item_index).toBe(0);
    const cells = cellsFromPieces(pieces, [50, 150], true);
    if (cells === null) throw new Error("split should succeed");
    expect(cells[0].text).toBe("aaaaaaaaaa");
    expect(cells[1].text).toBe("bbbbbbbbbb");
    expect(cells[0].text_item_indices).toEqual([0]);
    expect(cells[1].text_item_indices).toEqual([0]);
  });

  test("empty_track_cells_carry_no_items", () => {
    const l = spec("alpha@50|beta@150", 100);
    const cells = cellsFromPieces(linePieces(l), [50, 150, 250], false);
    if (cells === null) throw new Error("bin should succeed");
    expect(cells[0].text_item_indices).toEqual([0]);
    expect(cells[1].text_item_indices).toEqual([1]);
    expect(cells[2].text).toBe("");
    expect(cells[2].text_item_indices).toEqual([]);
  });
});

describe("spanning headers", () => {
  const tracks: Array<[number, number]> = [
    [152, 167],
    [179, 195],
  ];
  const year = tc(170, 186, "2001");

  test("spanning_year_header_covers_both_subcolumns", () => {
    expect(spanningTrackIndices(year, tracks)).toEqual([0, 1]);
    expect(spanningTrackIndices(tc(152, 167, "Mill."), tracks)).toEqual([0]);
  });

  test("year_header_is_eligible_to_name_both_subcolumns", () => {
    const covered = spanningTrackIndices(year, tracks);
    expect(covered).toEqual([0, 1]);
    expect(spanningHeaderEligible(year, covered, tracks, 2)).toBe(true);
  });

  test("single_header_line_never_replicates", () => {
    const covered = spanningTrackIndices(year, tracks);
    expect(spanningHeaderEligible(year, covered, tracks, 1)).toBe(false);
  });

  test("wide_single_token_header_stays_in_its_column", () => {
    // Bleeds into the next track but is centered in its own column.
    const t: Array<[number, number]> = [
      [100, 150],
      [160, 200],
    ];
    const c = tc(100, 165, "Revenue");
    const covered = spanningTrackIndices(c, t);
    expect(covered).toEqual([0, 1]);
    expect(spanningHeaderEligible(c, covered, t, 2)).toBe(false);
  });

  test("prose_header_never_replicates", () => {
    const t: Array<[number, number]> = [
      [100, 150],
      [160, 200],
    ];
    const c = tc(95, 205, "Clasificacion por grandes rubros");
    const covered = spanningTrackIndices(c, t);
    expect(spanningHeaderEligible(c, covered, t, 2)).toBe(false);
  });
});

describe("split_cells", () => {
  test("split_cells_splits_on_wide_gaps", () => {
    const l = spec("A@50|B@150|C@250", 100);
    const cells = splitCells(l);
    expect(texts(cells)).toEqual(["A", "B", "C"]);
  });

  test("split_cells_keeps_close_spans_together", () => {
    // Two spans 2pt apart at 10pt font (gap < font_size) go in the same cell.
    const l = spec("Hello@50|world@80", 100);
    const cells = splitCells(l);
    expect(cells.length).toBe(1);
    expect(cells[0].text).toBe("Hello world");
  });

  test("split_cells_groups_items_with_their_cells", () => {
    const l = spec("a@50|b@58|c@250", 100);
    const cells = splitCells(l);
    expect(cells.length).toBe(2);
    expect(cells[0].text_item_indices).toEqual([0, 1]);
    expect(cells[1].text_item_indices).toEqual([2]);
  });

  test("whole_line_cell_items_follow_reading_order", () => {
    const l = spec("עולם@50|שלום@100", 100);
    l.rtl = true;
    l.text = "שלום עולם";
    l.span_item_indices = [4, 5];
    expect(lineCell(l).text_item_indices).toEqual([5, 4]);
  });
});

function hairline(y: number, x: number, w: number): GraphicPrimitive {
  return {
    Rect: {
      bbox: { x: f32(x), y: f32(y), width: f32(w), height: f32(0.8) },
      stroke: "#000",
      fill: null,
    },
  };
}

describe("rule bands", () => {
  test("booktabs_rule_pair_is_a_band", () => {
    // doc 165: the whole table is two hairlines 98pt apart, no verticals.
    const g = [hairline(139.5, 56.7, 225.9), hairline(237.4, 56.7, 225.9)];
    expect(ruleBands(extractRuleSegments(g), 792)).toEqual([[f32(139.5), f32(237.4)]]);
  });

  test("ruled_grid_is_not_a_band", () => {
    // Same rules, but a vertical runs between them: this is a real grid and
    // the ruled detector owns it.
    const g = [
      hairline(139.5, 56.7, 225.9),
      hairline(237.4, 56.7, 225.9),
      {
        Rect: {
          bbox: { x: 150, y: f32(139.5), width: f32(0.8), height: f32(97.9) },
          stroke: "#000",
          fill: null,
        },
      },
    ];
    expect(ruleBands(extractRuleSegments(g), 792)).toEqual([]);
  });

  test("heading_underline_pair_is_not_a_band", () => {
    // Two rules 6pt apart bound a heading underline, not a table body.
    const g = [hairline(100, 56.7, 225.9), hairline(106, 56.7, 225.9)];
    expect(ruleBands(extractRuleSegments(g), 792)).toEqual([]);
  });
});
