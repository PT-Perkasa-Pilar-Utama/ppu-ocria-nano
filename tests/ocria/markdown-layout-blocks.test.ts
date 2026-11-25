// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The #[cfg(test)] tests of liteparse markdown_layout/blocks.rs that exercise the block passes
// (the renderer's tests belong to the rendering agent), plus `paragraph_from_accum`.

import { describe, expect, test } from "bun:test";

import type { Block, Cell, PositionedBlock } from "../../src/ocria/markdown-layout/block-types.js";
import { cell } from "../../src/ocria/markdown-layout/block-types.js";
import {
  paragraphFromAccum,
  positionedBlock,
  rejoinParagraphsAroundFigures,
  sourcedBlock,
  splitRepeatedHeaderTables,
  spliceSoftHyphens,
  unlocatedBlock,
} from "../../src/ocria/markdown-layout/blocks/index.js";
import { renderBlocks } from "../../src/ocria/markdown-layout/render/index.js";
import { line } from "../../src/ocria/markdown-layout/test-helpers.js";
import type { ParaAccum } from "../../src/ocria/markdown-layout/paragraphs/index.js";
import type { Rect } from "../../src/ocria/types/geometry.js";

function grid(rows: string[][]): PositionedBlock {
  const [header, ...rest] = rows.map((r) => r.map((c) => cell(c)));
  return positionedBlock({ Table: { header: header ?? null, rows: rest } }, null);
}

function tableCount(blocks: PositionedBlock[]): number {
  return blocks.filter((b) => typeof b.block !== "string" && "Table" in b.block).length;
}

function para(text: string): PositionedBlock {
  return positionedBlock({ Paragraph: { text, bold: false, italic: false } }, null);
}

function fig(id: string): PositionedBlock {
  return positionedBlock({ Figure: { id, format: "png" } }, null);
}

function paragraphText(b: PositionedBlock): string {
  if (typeof b.block === "string" || !("Paragraph" in b.block)) throw new Error("not a paragraph");
  return b.block.Paragraph.text;
}

function isFigure(b: PositionedBlock): boolean {
  return typeof b.block !== "string" && "Figure" in b.block;
}

describe("blocks", () => {
  test("figure_inside_a_sentence_moves_after_the_paragraph", () => {
    const out = rejoinParagraphsAroundFigures([
      para("Add the ability to engrave items, including"),
      fig("a"),
      fig("b"),
      para("glasses, bottles, and more."),
    ]);
    expect(out.length).toBe(3);
    expect(paragraphText(out[0])).toBe(
      "Add the ability to engrave items, including glasses, bottles, and more."
    );
    expect(isFigure(out[1]) && isFigure(out[2])).toBe(true);
    // between complete sentences (or before a capitalised start) the figure stays put
    expect(
      rejoinParagraphsAroundFigures([para("One sentence."), fig("a"), para("next one.")]).length
    ).toBe(3);
    expect(
      rejoinParagraphsAroundFigures([para("A list of"), fig("a"), para("New section")]).length
    ).toBe(3);
  });

  test("repeated_header_row_starts_a_new_table", () => {
    const b = grid([
      ["", "Current Base Rate", "", ""],
      ["CA", "PPO 1500", "PPO 2500", "HDHP 3000"],
      ["Block A", "254.96", "207.94", "173.76"],
      ["", "Proposed Base Rate", "", ""],
      ["CA", "PPO 1500", "PPO 2500", "HDHP 3000"],
      ["Block A", "284.28", "231.85", "193.74"],
    ]);
    const out = splitRepeatedHeaderTables([b]);
    expect(tableCount(out)).toBe(2);
    const t = out[1].block;
    if (typeof t === "string" || !("Table" in t)) throw new Error("not a table");
    expect(t.Table.header?.[1].text).toBe("Proposed Base Rate");
    expect(t.Table.rows.length).toBe(2);
  });

  test("repeated_data_row_is_not_a_header", () => {
    // a regression table's reference category repeats in every group: one table
    const b = grid([
      ["", "OR", "95% CI", "OR"],
      ["Non-snacker", "1.00", "", "1.00"],
      ["Low snacker", "0.68", "0.44-1.05", "0.80"],
      ["Non-snacker", "1.00", "", "1.00"],
      ["Low snacker", "0.96", "0.70-1.30", "0.36"],
    ]);
    expect(tableCount(splitRepeatedHeaderTables([b]))).toBe(1);
  });

  test("side_by_side_tables_split_at_their_gutter", () => {
    const b = grid([
      ["Tier", "Type", "Rate", "", "Tier", "Type", "Rate"],
      ["001", "AN", "1.000", "", "001", "AN", "1.000"],
      ["001", "AN", "0.170", "", "001", "AN", "0.210"],
    ]);
    expect(tableCount(splitRepeatedHeaderTables([b]))).toBe(2);
    // an empty spacer column inside one table (different headers either side) stays
    const c = grid([
      ["Item", "2024", "", "2023", "Change"],
      ["Revenue", "10", "", "9", "1"],
    ]);
    expect(tableCount(splitRepeatedHeaderTables([c]))).toBe(1);
  });

  /** `grid`, with each non-empty cell sourced from item `100 * row + column`. */
  function sourcedGrid(rows: string[][]): [PositionedBlock, number[]] {
    const b = grid(rows);
    if (typeof b.block === "string" || !("Table" in b.block)) throw new Error("not a table");
    const items: number[] = [];
    const all: Cell[][] = [
      ...(b.block.Table.header == null ? [] : [b.block.Table.header]),
      ...b.block.Table.rows,
    ];
    all.forEach((row, r) =>
      row.forEach((c, i) => {
        if (c.text !== "") {
          c.text_item_indices = [100 * r + i];
          items.push(100 * r + i);
        }
      })
    );
    return [b, items];
  }

  function cellItems(blocks: PositionedBlock[]): number[] {
    const items: number[] = [];
    for (const b of blocks) {
      if (typeof b.block === "string" || !("Table" in b.block)) continue;
      const cells = [...(b.block.Table.header ?? []), ...b.block.Table.rows.flat()];
      for (const c of cells) items.push(...c.text_item_indices);
    }
    return items.sort((a, b) => a - b);
  }

  test("split_tables_keep_their_cells_items", () => {
    const [stacked, items] = sourcedGrid([
      ["", "Current Base Rate", "", ""],
      ["CA", "PPO 1500", "PPO 2500", "HDHP 3000"],
      ["Block A", "254.96", "207.94", "173.76"],
      ["", "Proposed Base Rate", "", ""],
      ["CA", "PPO 1500", "PPO 2500", "HDHP 3000"],
      ["Block A", "284.28", "231.85", "193.74"],
    ]);
    let out = splitRepeatedHeaderTables([stacked]);
    expect(tableCount(out)).toBe(2);
    expect(cellItems(out)).toEqual(items);

    const [sideBySide, items2] = sourcedGrid([
      ["Tier", "Type", "Rate", "", "Tier", "Type", "Rate"],
      ["001", "AN", "1.000", "", "001", "AN", "1.000"],
      ["001", "AN", "0.170", "", "001", "AN", "0.210"],
    ]);
    out = splitRepeatedHeaderTables([sideBySide]);
    expect(tableCount(out)).toBe(2);
    expect(cellItems(out)).toEqual(items2);

    // blocks the pass does not split keep their own items
    const kept = splitRepeatedHeaderTables([
      sourcedBlock({ Paragraph: { text: "Body.", bold: false, italic: false } }, null, [7, 8]),
    ]);
    expect(kept[0].text_item_indices).toEqual([7, 8]);
  });

  test("paragraph_rejoined_around_a_figure_keeps_both_halves_items", () => {
    const head = para("Add the ability to engrave items, including");
    head.text_item_indices = [0, 1];
    const tail = para("glasses, bottles, and more.");
    tail.text_item_indices = [2, 3];
    const out = rejoinParagraphsAroundFigures([head, fig("a"), tail]);
    expect(out.length).toBe(2);
    expect(out[0].text_item_indices).toEqual([0, 1, 2, 3]);
  });

  test("splices_hyphen_split_across_paragraph_blocks", () => {
    const p = (t: string): Block => ({ Paragraph: { text: t, bold: false, italic: false } });
    const spliced = (a: string, b: string): PositionedBlock[] =>
      spliceSoftHyphens([unlocatedBlock(p(a)), unlocatedBlock(p(b))]);
    const rendered = (a: string, b: string): string => renderBlocks(spliced(a, b));
    // Mid-word hyphen split into two paragraphs heals into one.
    expect(rendered("they dis-", "lodged the part")).toBe("they dislodged the part");
    // Capitalized continuation is a real compound break: left intact.
    expect(rendered("the well-", "Known fact")).toBe("the well-\n\nKnown fact");
    // Trailing dash not preceded by a letter doesn't splice.
    expect(rendered("a -", "dash line")).toBe("a -\n\ndash line");
    // A spliced block covers both source regions.
    const r = (y: number): Rect => ({ x: 10, y, width: 100, height: 12 });
    const joined = spliceSoftHyphens([
      sourcedBlock(p("they dis-"), r(50), [0, 1]),
      sourcedBlock(p("lodged the part"), r(70), [2, 3]),
    ]);
    expect(joined.length).toBe(1);
    expect([joined[0].bbox?.y, joined[0].bbox?.height]).toEqual([50, 32]);
    expect(joined[0].text_item_indices).toEqual([0, 1, 2, 3]);
  });

  test("paragraph_from_accum keeps the uniform style on the block and escapes the raw text", () => {
    const accum = (uniform: [boolean, boolean] | null): ParaAccum => ({
      raw: "a * b",
      inline: "**a** b",
      last: line("a * b", 0, 0, 10, 10),
      uniform,
      bbox: null,
      item_indices: [],
    });
    expect(paragraphFromAccum(accum([true, false]))).toEqual({
      Paragraph: { text: "a \\* b", bold: true, italic: false },
    });
    expect(paragraphFromAccum(accum([false, false]))).toEqual({
      Paragraph: { text: "a \\* b", bold: false, italic: false },
    });
    expect(paragraphFromAccum(accum(null))).toEqual({
      Paragraph: { text: "**a** b", bold: false, italic: false },
    });
  });

  test("a merged table splits at a repeated header row, never inside a row span", () => {
    const sc = (text: string, rowspan = 1) => ({
      text,
      colspan: 1,
      rowspan,
      bbox: null,
      text_item_indices: [],
    });
    const header = [sc("A"), sc("B"), sc("C")];
    const rows = [
      header,
      [sc("1"), sc("x"), sc("y")],
      [sc("T"), sc(""), sc("")],
      header,
      [sc("2"), sc("x"), sc("y")],
    ];
    const out = splitRepeatedHeaderTables([
      positionedBlock({ MergedTable: { rows, header_rows: 1 } }, null),
    ]);
    expect(out.length).toBe(2);
    const second = out[1].block;
    if (typeof second === "string" || !("MergedTable" in second)) throw new Error("not merged");
    expect(second.MergedTable.rows.length).toBe(3);
    expect(second.MergedTable.header_rows).toBe(2);
    // a row span across the would-be cut blocks it
    const spanned = [
      header,
      [sc("1", 3), sc("x"), sc("y")],
      [sc("x"), sc("y")],
      header,
      [sc("2"), sc("x"), sc("y")],
    ];
    expect(
      splitRepeatedHeaderTables([
        positionedBlock({ MergedTable: { rows: spanned, header_rows: 1 } }, null),
      ]).length
    ).toBe(1);
  });
});
