// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// resegment_by_model_blocks on pages built by hand: the goldens split lines on two pages, and
// these reach the other branches (columns the XY-cut missed, marginal blocks, wide blocks,
// lines that must stay whole).

import { describe, expect, test } from "bun:test";

import { resegmentByModelBlocks } from "../../src/ocria/resegment/index.js";
import type { ModelBlock } from "../../src/ocria/table-model/types.js";
import { emptyRegion } from "../../src/ocria/types/geometry.js";
import type { ParsedPage, ProjectedLine } from "../../src/ocria/types/page.js";
import { textItem } from "../../src/ocria/types/text-item.js";

const block = (x: number, y: number, w: number, h: number, cls = 0): ModelBlock => ({
  bbox: { x, y, width: w, height: h },
  class: cls,
  text: "",
});

/** A line of spans `[text, x, width]` at `y`, 10 high, in leaf `path`. */
function line(
  path: number[],
  y: number,
  spans: Array<[string, number, number]>,
  extra: Partial<ProjectedLine> = {}
): ProjectedLine {
  const items = spans.map(([text, x, width]) => textItem({ text, x, y, width, height: 10 }));
  const x0 = spans[0][1];
  const last = spans[spans.length - 1];
  return {
    text: spans.map((s) => s[0]).join(" "),
    bbox: { x: x0, y, width: last[1] + last[2] - x0, height: 10 },
    anchor: "Left",
    indent_x: x0,
    dominant_font_size: 10,
    font_size_is_estimated: false,
    heading_font_size: null,
    dominant_font_name: null,
    all_bold: false,
    all_italic: false,
    all_mono: false,
    all_strike: false,
    spans: items,
    span_item_indices: [],
    rtl: false,
    region_path: path,
    mcid: null,
    in_figure: false,
    ...extra,
  };
}

function page(lines: ProjectedLine[], blocks: ModelBlock[]): ParsedPage {
  return {
    page_number: 1,
    page_width: 300,
    page_height: 400,
    text: "",
    markdown: "",
    text_items: [],
    projected_lines: lines,
    regions: emptyRegion(),
    graphics: [],
    figures: [],
    projected_item_frames: [],
    model_tables: [],
    model_classes: [],
    model_blocks: blocks,
    struct_nodes: [],
    image_refs: [],
  };
}

const left = block(0, 0, 100, 400);
const right = block(150, 0, 100, 400);
const texts = (p: ParsedPage): string[] => p.projected_lines.map((l) => l.text);

describe("resegment_by_model_blocks", () => {
  test("lines across a gutter are split and each column reads top to bottom", () => {
    const lines = [0, 1, 2, 3].map((i) =>
      line([0], i * 20, [
        [`L${i}`, 10, 80],
        [`R${i}`, 160, 80],
      ])
    );
    const p = page([...lines, line([1], 200, [["Footer", 10, 100]])], [left, right]);
    expect(resegmentByModelBlocks(p)).toBe(4);
    expect(texts(p)).toEqual(["L0", "L1", "L2", "L3", "R0", "R1", "R2", "R3", "Footer"]);
    // each leaf gains a sub-path per column; a leaf with no split is untouched
    expect(p.projected_lines.map((l) => l.region_path)).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 1],
      [0, 1],
      [0, 1],
      [0, 1],
      [1],
    ]);
    expect(p.projected_lines[4].bbox).toEqual({ x: 160, y: 0, width: 80, height: 10 });
    expect(p.projected_lines[4].indent_x).toBe(160);
  });

  test("a lone wide gap, and lines that cannot split, stay whole", () => {
    // one line crossing blocks: no channel (fewer than three lines share the gap)
    const p = page(
      [
        line([0], 0, [
          ["a", 10, 80],
          ["b", 160, 80],
        ]),
        line([0], 20, [["c", 10, 80]]),
      ],
      [left, right]
    );
    expect(resegmentByModelBlocks(p)).toBe(0);
    expect(texts(p)).toEqual(["a b", "c"]);
    // rotated, right-to-left, monospace and table-block lines never split
    const mk = (extra: Partial<ProjectedLine>): ProjectedLine[] =>
      [0, 1, 2, 3].map((i) =>
        line(
          [0],
          i * 20,
          [
            [`L${i}`, 10, 80],
            [`R${i}`, 160, 80],
          ],
          extra
        )
      );
    expect(resegmentByModelBlocks(page(mk({ rtl: true }), [left, right]))).toBe(0);
    expect(resegmentByModelBlocks(page(mk({ all_mono: true }), [left, right]))).toBe(0);
    const rotated = mk({}).map((l) => ({
      ...l,
      spans: l.spans.map((s) => ({ ...s, rotation: 90 })),
    }));
    expect(resegmentByModelBlocks(page(rotated, [left, right]))).toBe(0);
    // block class 6 is Table
    expect(resegmentByModelBlocks(page(mk({}), [block(0, 0, 100, 400, 6), right]))).toBe(0);
    // fewer than two blocks, or no lines
    expect(resegmentByModelBlocks(page(mk({}), [left]))).toBe(0);
    expect(resegmentByModelBlocks(page([], [left, right]))).toBe(0);
  });

  test("whole lines in side-by-side blocks are reordered by column without a split", () => {
    // rows read across: L0 R0 L1 R1 ... with three lines in each block
    const rows = [0, 1, 2].flatMap((i) => [
      line([2], i * 40, [[`L${i}`, 10, 80]]),
      line([2], i * 40 + 20, [[`R${i}`, 160, 80]]),
    ]);
    const p = page(rows, [left, right]);
    expect(resegmentByModelBlocks(p)).toBe(0);
    expect(texts(p)).toEqual(["L0", "L1", "L2", "R0", "R1", "R2"]);
    // monospace leaves and one-line blocks (forms) keep their row order
    const mono = page(
      rows.map((l) => ({ ...l, all_mono: true })),
      [left, right]
    );
    resegmentByModelBlocks(mono);
    expect(texts(mono)).toEqual(rows.map((l) => l.text));
    const form = page(rows.slice(0, 2), [left, right]);
    resegmentByModelBlocks(form);
    expect(texts(form)).toEqual(["L0", "R0"]);
  });

  test("a marginal block of numbers is no column, and a wide block joins the nearest", () => {
    const margin = block(0, 0, 20, 400);
    const body = block(40, 0, 100, 400);
    const side = block(160, 0, 100, 400);
    const lines = [0, 1, 2].map((i) =>
      line([3], i * 20, [
        [String(i + 19), 2, 12],
        [`B${i}`, 50, 40],
        [`S${i}`, 170, 40],
      ])
    );
    const p = page(lines, [margin, body, side]);
    resegmentByModelBlocks(p);
    // the numbers stay with the body column, in y order
    expect(texts(p).slice(0, 3).join(" ")).toContain("B0");
    // a heading over both columns (a wide block) is placed with the column nearest its centre
    const wide = block(0, 0, 260, 15);
    const cols = [1, 2, 3].map((i) =>
      line([4], 20 + i * 20, [
        [`A${i}`, 10, 80],
        [`B${i}`, 160, 80],
      ])
    );
    const head = line([4], 0, [["Heading", 100, 60]]);
    const q = page([head, ...cols], [wide, left, right]);
    resegmentByModelBlocks(q);
    expect(texts(q).length).toBe(7);
    expect(texts(q).filter((t) => t === "Heading").length).toBe(1);
  });
});
