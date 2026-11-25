// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The #[cfg(test)] tests of liteparse markdown_layout/tables.rs whose subject is
// the description-list detector.

import { describe, expect, test } from "bun:test";

import type { Block, Cell } from "../../src/ocria/markdown-layout/block-types.js";
import { splitCells } from "../../src/ocria/markdown-layout/tables/borderless/index.js";
import {
  isBulletOnly,
  isLabelLike,
  splitDescriptionCellAtAnchor,
  splitMergedAtAnchor,
  tryDetectDescriptionList,
} from "../../src/ocria/markdown-layout/tables/merge/index.js";
import type { TableCell } from "../../src/ocria/markdown-layout/tables/types.js";
import { lineWithSpans } from "../../src/ocria/markdown-layout/test-helpers.js";
import type { ProjectedLine } from "../../src/ocria/types/page.js";
import type { WordBox } from "../../src/ocria/types/text-item.js";

function tableOf(b: Block): { header: Cell[] | null; rows: Cell[][] } {
  if (typeof b === "string" || !("Table" in b)) throw new Error("expected Block::Table");
  return b.Table;
}

describe("description-list split", () => {
  test("description_split_uses_verified_word_positions_and_falls_back_when_unavailable", () => {
    const word = (text: string, x: number, width: number): WordBox => ({
      text,
      x,
      width,
      y: 0,
      height: 0,
    });
    const assertFallback = (row: ProjectedLine, c: TableCell, anchor: number): void => {
      const expected = splitMergedAtAnchor(c.text, c.start_x, c.end_x, anchor);
      expect(expected).not.toBeNull();
      expect(splitDescriptionCellAtAnchor(row, c, anchor)).toEqual(expected);
    };
    const row = lineWithSpans([["Mode automatic mode", 0]], 10, 10);
    const c = splitCells(row)[0];
    // Callers that do not supply word geometry retain the old fallback.
    assertFallback(row, c, 45);

    row.spans[0].words = [word("Mode", 0, 20), word("automatic", 45, 40), word("mode", 90, 10)];
    expect(splitDescriptionCellAtAnchor(row, c, 45)).toEqual(["Mode", "automatic mode"]);
    // When all words are verified, a distant boundary must not be guessed.
    row.spans[0].words[1].x = 70;
    expect(splitDescriptionCellAtAnchor(row, c, 45)).toBeNull();

    // Incomplete or mismatched geometry is not evidence against a split.
    row.spans[0].words.pop();
    assertFallback(row, c, 45);
    row.spans[0].words.push(word("other", 90, 10));
    assertFallback(row, c, 45);

    // Word boxes of repositioned rotated text are not in the projected
    // coordinate system, even if their x positions happen to overlap.
    row.spans[0].words[2].text = "mode";
    row.spans[0].rotation = 90;
    assertFallback(row, c, 45);

    row.spans[0].rotation = 0;
    row.rtl = true;
    assertFallback(row, c, 45);
    row.rtl = false;
    row.spans[0].words[1].x = 90;
    row.spans[0].words[2].x = 70;
    assertFallback(row, c, 45);

    // A single cell can contain several spans in a different order, with
    // whitespace between words or in spans that carry no text.
    const mixed = lineWithSpans(
      [
        ["automatic\u{a0}mode  ", 25],
        [" \t Mode\t", 0],
        [" \t", 5],
      ],
      10,
      10
    );
    mixed.spans[0].words = [word("automatic", 25, 40), word("mode", 70, 20)];
    mixed.spans[1].words = [word("Mode", 0, 20)];
    const mixedCell = splitCells(mixed)[0];
    expect(mixedCell.text).toBe("Mode automatic mode");
    expect(splitDescriptionCellAtAnchor(mixed, mixedCell, 25)).toEqual(["Mode", "automatic mode"]);
    expect(splitDescriptionCellAtAnchor(mixed, mixedCell, 45)).toBeNull();
    // The fallback also applies when only some spans have word boxes.
    mixed.spans[0].words = [];
    assertFallback(mixed, mixedCell, 25);
  });
});

describe("description lists", () => {
  test("is_bullet_only_recognizes_lettered_markers", () => {
    // Digit and roman markers were already handled; lettered ordered-list
    // markers must be too, so a nested a./b./c. list is not mistaken for a
    // description-list table label.
    for (const m of ["a.", "b.", "c.", "z.", "A.", "a)", "B)", "(a)", "(B)"]) {
      expect(isBulletOnly(m)).toBe(true);
      expect(isLabelLike(m)).toBe(false);
    }
    // Genuine short labels stay labels.
    for (const l of ["Name:", "Term", "Rate", "Fee.", "AB.", "ab."]) {
      expect(isBulletOnly(l)).toBe(false);
    }
  });

  test("description_list_split_hands_each_half_its_own_items", () => {
    const lines = [
      lineWithSpans(
        [
          ["Name", 50],
          ["Alice Smith", 200],
        ],
        100,
        10
      ),
      lineWithSpans(
        [
          ["Role", 50],
          ["Engineer", 200],
        ],
        114,
        10
      ),
      // One cell from two items: "Department" ends at x=100, the run after it
      // crosses col 1 (x=200), so the row splits at col 1.
      lineWithSpans(
        [
          ["Department", 50],
          ["Platform engineering group", 104],
        ],
        128,
        10
      ),
    ];
    lines[0].span_item_indices = [0, 1];
    lines[1].span_item_indices = [2, 3];
    lines[2].span_item_indices = [4, 5];
    const r = tryDetectDescriptionList(lines, 0);
    expect(r).not.toBeNull();
    if (r == null) return;
    const { rows } = tableOf(r.block);
    const last = rows[rows.length - 1];
    expect(last[1].text).toBe("group");
    // "Department" stays left; the straddling run feeds both halves.
    expect(last[0].text_item_indices).toEqual([4, 5]);
    expect(last[1].text_item_indices).toEqual([5]);
  });

  test("lettered_list_is_not_a_description_table", () => {
    // Two-level lettered list: short marker column (col 0) beside wrapped body
    // text (col 1). Regression for the nested-list to pipe-table bug.
    const lines = [
      lineWithSpans(
        [
          ["a.", 80],
          ["The Committee may retain outside advisors.", 120],
        ],
        100,
        10
      ),
      lineWithSpans(
        [
          ["b.", 80],
          ["The Committee shall have sole authority.", 120],
        ],
        88,
        10
      ),
      lineWithSpans(
        [
          ["c.", 80],
          ["In retaining advice the Committee considers:", 120],
        ],
        76,
        10
      ),
    ];
    expect(tryDetectDescriptionList(lines, 0)).toBeNull();
  });
});
