// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The `#[cfg(test)]` tests of liteparse markdown_layout/classify.rs (crates-v2.21.2).

import { describe, expect, test } from "bun:test";

import {
  classifyPage,
  columnCount,
  isKind,
  mapOf,
  tableOf,
} from "./markdown-layout-classify-helpers.test.js";

import type {} from "../../src/ocria/markdown-layout/block-types.js";
import {
  filledCellCount,
  numericFilledCellCount,
  tableColumnCount,
  tableCoversGlobal,
} from "../../src/ocria/markdown-layout/classify/index.js";
import {} from "../../src/ocria/markdown-layout/headings/index.js";
import {} from "../../src/ocria/markdown-layout/repetition/index.js";
import {
  detectRuledTablesGlobal,
  detectRuledTables,
  extractRuleSegments,
} from "../../src/ocria/markdown-layout/tables/ruled/index.js";
import { detectTables } from "../../src/ocria/markdown-layout/tables/borderless/index.js";
import {
  lineWithSpans,
  page,
  pageWithGraphics,
  stroke,
} from "../../src/ocria/markdown-layout/test-helpers.js";
import type { ProjectedLine } from "../../src/ocria/types/page.js";

describe("classify", () => {
  test("detects_simple_borderless_table", () => {
    const p = page([
      lineWithSpans(
        [
          ["Name", 50],
          ["Age", 150],
          ["City", 250],
        ],
        100,
        10
      ),
      lineWithSpans(
        [
          ["Alice", 50],
          ["30", 150],
          ["NYC", 250],
        ],
        115,
        10
      ),
      lineWithSpans(
        [
          ["Bob", 50],
          ["25", 150],
          ["LA", 250],
        ],
        130,
        10
      ),
    ]);
    const blocks = classifyPage(p, mapOf(p));
    expect(blocks.length).toBe(1);
    const t = blocks[0].block;
    if (typeof t === "string" || !("Table" in t)) throw new Error("expected table");
    // Header isn't bold so no header row promoted.
    expect(t.Table.header).toBeNull();
    expect(t.Table.rows.length).toBe(3);
    expect(t.Table.rows[0][0].text).toBe("Name");
    expect(t.Table.rows[1][2].text).toBe("NYC");
  });

  test("global_ruled_table_survives_single_column_leaf_veto", () => {
    const rows: Array<[string, string, string]> = [
      ["Account", "2024", "2023"],
      ["Cash", "$1,000", "$900"],
      ["Debt", "$500", "$600"],
      ["Equity", "$500", "$300"],
    ];
    const labels: ProjectedLine[] = [];
    const current: ProjectedLine[] = [];
    const prior: ProjectedLine[] = [];
    rows.forEach(([label, cur, pri], r) => {
      const y = 100 + r * 25;
      const l = lineWithSpans([[label, 100]], y, 10);
      l.region_path = [0];
      labels.push(l);
      const c = lineWithSpans([[cur, 323]], y, 8);
      c.region_path = [1];
      current.push(c);
      const q = lineWithSpans([[pri, 354]], y, 8);
      q.region_path = [2];
      prior.push(q);
    });
    const graphics = [];
    for (const y of [90, 115, 140, 165, 190]) graphics.push(stroke(80, y, 380, y, 0.5));
    for (const x of [80, 320, 350, 380]) graphics.push(stroke(x, 90, x, 190, 0.5));
    const pg = pageWithGraphics([...labels, ...current, ...prior], graphics);
    const segs = extractRuleSegments(pg.graphics);
    const labelLeaf = pg.projected_lines.slice(0, rows.length);
    const labelRuns = detectRuledTables(labelLeaf, segs, pg.page_width, pg.page_height);
    expect(labelRuns.some((run) => tableColumnCount(run.block) === 1)).toBe(true);
    expect(detectTables(labelLeaf).length).toBe(0);

    const blocks = classifyPage(pg, []);
    const found = blocks.map((b) => b.block).find((b) => typeof b !== "string" && "Table" in b);
    if (found === undefined || typeof found === "string" || !("Table" in found)) {
      throw new Error("the global ruled pass should emit the scattered table");
    }
    const { header, rows: trows } = found.Table;
    const colCount = columnCount(found.Table);
    expect(colCount).toBeGreaterThanOrEqual(2);
    const cells = [...(header ?? []), ...trows.flat()].map((c) => c.text);
    expect(cells).toContain("$1,000");
    expect(cells).toContain("$900");
  });

  test("global_veto_uses_filled_cells_when_numeric_count_is_zero", () => {
    const local = tableOf(["Label", "Description"]);
    const global = tableOf(["Label", "Current", "Prior"]);
    expect(numericFilledCellCount(global)).toBe(0);
    expect(tableCoversGlobal(local, global)).toBe(true);
    const sparseLocal = tableOf(["Label", ""]);
    expect(tableCoversGlobal(sparseLocal, global)).toBe(false);
  });

  test("global_veto_numeric_coverage_distinguishes_data_from_prose_frame", () => {
    const global = tableOf(["Asset", "100", "200", "300", "400", "500"]);
    const dataRegion = tableOf(["100", "200", "300"]);
    const proseFrame = tableOf(["Narrative", "1", "Additional prose", "Footer"]);
    expect(tableCoversGlobal(dataRegion, global)).toBe(true);
    expect(filledCellCount(proseFrame)).toBeGreaterThanOrEqual(
      Math.fround(Math.fround(0.6) * filledCellCount(global))
    );
    expect(tableCoversGlobal(proseFrame, global)).toBe(false);
  });

  test("global_ruled_table_survives_sparse_two_column_leaf_veto", () => {
    type Row = [string, string, string | null, string | null, string | null];
    const rows: Row[] = [
      ["Account", "Current Period", "$900", null, null],
      ["Cash", "Cash Position", "$1,000", null, null],
      ["Debt", "Long-Term Debt", null, null, "$600"],
      ["Equity", "1", null, null, "$100"],
    ];
    const labels: ProjectedLine[] = [];
    const middle: ProjectedLine[] = [];
    const last: ProjectedLine[] = [];
    rows.forEach(([label, first, second, third, fourth], r) => {
      const y = 100 + r * 25;
      const l = lineWithSpans(
        [
          [label, 100],
          [first, 160],
        ],
        y,
        10
      );
      l.region_path = [0];
      labels.push(l);
      const spans: Array<[string, number]> = [];
      if (second !== null) spans.push([second, 230]);
      if (third !== null) spans.push([third, 300]);
      if (spans.length > 0) {
        const m = lineWithSpans(spans, y, 8);
        m.region_path = [1];
        middle.push(m);
      }
      if (fourth !== null) {
        const f = lineWithSpans([[fourth, 370]], y, 8);
        f.region_path = [2];
        last.push(f);
      }
    });
    const graphics = [];
    for (const y of [90, 115, 140, 165, 190]) graphics.push(stroke(80, y, 430, y, 0.5));
    for (const x of [80, 150, 220, 290, 360, 430]) graphics.push(stroke(x, 90, x, 190, 0.5));
    const pg = pageWithGraphics([...labels, ...middle, ...last], graphics);
    const labelLeaf = pg.projected_lines.slice(0, rows.length);
    const labelRun = detectTables(labelLeaf).find((run) => tableColumnCount(run.block) === 2);
    if (labelRun === undefined) throw new Error("the label leaf should form a two-column table");
    expect(filledCellCount(labelRun.block)).toBe(8);
    expect(numericFilledCellCount(labelRun.block)).toBe(1);

    const segs = extractRuleSegments(pg.graphics);
    const globalHit = detectRuledTablesGlobal(
      pg.projected_lines,
      segs,
      pg.page_width,
      pg.page_height
    ).find(([run]) => tableColumnCount(run.block) === 5);
    if (globalHit === undefined)
      throw new Error("the page-wide detector should find the 5-col table");
    const globalRun = globalHit[0];
    expect(filledCellCount(labelRun.block)).toBeGreaterThanOrEqual(
      Math.fround(Math.fround(0.6) * filledCellCount(globalRun.block))
    );
    expect(numericFilledCellCount(labelRun.block)).toBeLessThan(
      Math.fround(Math.fround(0.6) * numericFilledCellCount(globalRun.block))
    );

    const blocks = classifyPage(pg, []);
    const found = blocks.map((b) => b.block).find((b) => typeof b !== "string" && "Table" in b);
    if (found === undefined || typeof found === "string" || !("Table" in found)) {
      throw new Error("the global ruled pass should emit the fuller scattered table");
    }
    const { header, rows: trows } = found.Table;
    const colCount = columnCount(found.Table);
    expect(colCount).toBe(5);
    const cells = [...(header ?? []), ...trows.flat()].map((c) => c.text);
    for (const value of ["$900", "$1,000", "$600", "$100"]) {
      expect(cells.some((c) => c.includes(value))).toBe(true);
    }
  });

  test("a_line_no_ruled_cell_took_keeps_its_items", () => {
    // The note hangs off the grid's left edge, so no cell takes it; it comes back as a
    // paragraph ahead of the table.
    const ys = [100, 130, 160, 190, 220];
    const graphics = [];
    for (const y of ys) graphics.push(stroke(50, y, 350, y, 0.5));
    for (const x of [50, 150, 250, 350]) graphics.push(stroke(x, 100, x, 220, 0.5));
    const rows = [
      ["Part", "Qty", "Price"],
      ["Bolt", "2,000", "$1.20"],
      ["Nut", "3,000", "$0.80"],
      ["Washer", "1,500", "$0.40"],
    ];
    const lines: ProjectedLine[] = [];
    rows.forEach((row, r) => {
      const y = Math.fround(ys[r] + 10);
      const l = lineWithSpans(
        [
          [row[0], 60],
          [row[1], 160],
          [row[2], 260],
        ],
        y,
        10
      );
      l.span_item_indices = [3 * r, 3 * r + 1, 3 * r + 2];
      lines.push(l);
      if (r === 1) {
        const note = lineWithSpans([["Overhanging", 0]], Math.fround(y + 10), 10);
        note.span_item_indices = [99];
        lines.push(note);
      }
    });
    const blocks = classifyPage(pageWithGraphics(lines, graphics), []);
    expect(blocks.some((b) => isKind(b, "Table"))).toBe(true);
    const note = blocks.find(
      (b) =>
        typeof b.block !== "string" &&
        "Paragraph" in b.block &&
        b.block.Paragraph.text === "Overhanging"
    );
    if (note === undefined) throw new Error("left-out line missing");
    expect(note.text_item_indices).toEqual([99]);
  });
});
