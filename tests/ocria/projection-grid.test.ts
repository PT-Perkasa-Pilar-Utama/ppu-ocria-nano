// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The `#[cfg(test)]` tests of liteparse projection.rs that exercise
// `form_lines`, the gutter line-number filter, `compress_wide_spaces`,
// `fix_sparse_blocks` and `project_to_grid`.

import { describe, expect, test } from "bun:test";

import { formLines } from "../../src/ocria/projection/form-lines.js";
import { cleanProjectedItems, isGutterNumberCandidate } from "../../src/ocria/projection/gutter.js";
import { projectToGrid } from "../../src/ocria/projection/project-to-grid.js";
import { newProjectedItem } from "../../src/ocria/projection/projected-item.js";
import { buildProjectedLines } from "../../src/ocria/projection/projected-lines.js";
import { NUMERIC_FOOTER_PATH } from "../../src/ocria/projection/xy-cut.js";
import {
  FLOATING_SPACES,
  compressWideSpaces,
  fixSparseBlocks,
} from "../../src/ocria/projection/text-lines.js";
import type { ProjectedTextItem } from "../../src/ocria/projection/types.js";
import { roundF32 } from "../../src/ocria/rust-extra.js";
import { f32 } from "../../src/ocria/rust.js";
import type { Page } from "../../src/ocria/types/page.js";
import { textItem } from "../../src/ocria/types/text-item.js";

/** Rust test helper `item_at`; every number is an f32 literal there. */
function itemAt(text: string, x: number, y: number, w: number, h: number): ProjectedTextItem {
  return newProjectedItem(textItem({ text, x: f32(x), y: f32(y), width: f32(w), height: f32(h) }));
}

function emptyPage(): Page {
  return {
    page_number: 1,
    page_width: 612,
    page_height: 792,
    text_items: [],
    graphics: [],
    struct_nodes: [],
    image_refs: [],
  };
}

/** The text of every item of every line, in order. */
const texts = (lines: ProjectedTextItem[][]): string[] => lines.flat().map((p) => p.item.text);

describe("rendered-line helpers", () => {
  test("compress_wide_spaces preserves utf8 text", () => {
    expect(compressWideSpaces("売上高    1,234 Café  Größe", 4, 2)).toBe(
      "売上高  1,234 Café  Größe"
    );
  });

  test("sparse blocks preserve utf8 text when compressing columns", () => {
    const labels = ["売上高", "営業利益", "Café", "Größe"];
    const lines = labels.map((label) => `${label}${" ".repeat(120)}1,234`);
    fixSparseBlocks(lines, 0, lines.length);
    expect(lines).toEqual(labels.map((label) => `${label}${" ".repeat(FLOATING_SPACES)}1,234`));
  });

  test("a block with little whitespace keeps its spacing", () => {
    const lines = ["a    b", "c    d"];
    fixSparseBlocks(lines, 0, 2);
    expect(lines).toEqual(["a    b", "c    d"]);
  });
});

describe("project_to_grid", () => {
  test("handles text-sparse zero-width items", () => {
    const boxes = [
      newProjectedItem(textItem({ text: "", x: 10, y: 10, width: 0, height: 10 })),
      newProjectedItem(textItem({ text: "", x: 10, y: 30, width: 0, height: 20 })),
    ];
    const [, text] = projectToGrid(emptyPage(), boxes, false);
    expect(text).toBe("");
  });

  test("a page with no items gives no text", () => {
    expect(projectToGrid(emptyPage(), [], false)).toEqual([[], ""]);
  });
});

describe("gutter line numbers", () => {
  test("a digit abutting its neighbour is not a margin line number", () => {
    // Issue #465: a table cell "7.7" emitted as runs "7" + ".7" with zero
    // gap, sitting in the page-centre band. The "7" must stay on the row
    // and merge with ".7" instead of being split off as a line number.
    const items = [
      itemAt("58.5", 252.7, 149.76, 10.9, 8.42),
      itemAt("7", 313.37, 149.76, 3.108, 8.42),
      itemAt(".7", 316.478, 149.76, 4.66, 8.42),
      itemAt("2.3", 370.9, 149.76, 10.6, 8.42),
    ];
    const lines = formLines(items, 10, f32(8.42), 612, 792, true);
    expect(lines.length).toBe(1);
    expect(lines[0].some((i) => i.item.text === "7.7")).toBe(true);
    expect(lines[0].every((i) => !i.is_margin_line_number)).toBe(true);
  });

  test("a merged item inherits the trailing space of its last part", () => {
    // "case" was split at a space; "estimates" joins it through the spaced
    // merge, so the abutting "." must not see "case"'s flag.
    const kase = itemAt("case", 10, 100, 20, 10);
    kase.item.followed_by_space = true;
    const items = [kase, itemAt("estimates", 33, 100, 45, 10), itemAt(".", 78, 101, 2, 9)];
    const lines = formLines(items, 10, 10, 612, 792, true);
    expect(lines[0].map((i) => i.item.text)).toEqual(["case estimates."]);
  });

  test("an isolated gutter digit is still a margin line number", () => {
    // Two-column paper: "12" alone in the gutter, well clear of both
    // columns' text, keeps its line-number flag.
    const items = [
      itemAt("left column text", 60, 100, 230, 10),
      itemAt("12", 310, 100, 8, 10),
      itemAt("right column text", 330, 100, 230, 10),
    ];
    const lines = formLines(items, 10, 10, 612, 792, true);
    const flagged = lines
      .flat()
      .filter((i) => i.is_margin_line_number)
      .map((i) => i.item.text);
    expect(flagged).toEqual(["12"]);
  });

  test("a lone footer number survives but a gutter number column is removed", () => {
    for (const positions of [[760], [100, 120, 140]]) {
      const column = positions.length >= 3;
      const items = positions.map((y) => itemAt("12", 310, y, 8, 10));
      const lines = formLines(items, 10, 10, 612, 792, true);
      let projected = lines.flat();
      expect(projected.every((item) => item.is_margin_line_number === column)).toBe(true);
      projected = cleanProjectedItems(projected, 612, 792);
      if (column) {
        expect(projected).toEqual([]);
      } else {
        expect(projected.length).toBe(1);
        expect(projected[0].item.text).toBe("12");
      }
    }
  });

  test("unrelated centered numbers do not turn a footer into gutter numbering", () => {
    // Cover both aligned chart ticks and numbers spread across the gutter band.
    for (const xs of [
      [310, 310],
      [299, 321],
    ]) {
      const items = [
        itemAt("10", xs[0], 100, 8, 10),
        itemAt("20", xs[1], 120, 8, 10),
        itemAt("body text", 50, 600, 200, 10),
        itemAt("12", 310, 760, 8, 10),
      ];
      const lines = formLines(items, 10, 10, 612, 792, true);
      let projected = lines.flat();
      expect(projected.find((item) => item.item.text === "12")?.is_margin_line_number).toBe(false);
      projected = cleanProjectedItems(projected, 612, 792);
      expect(projected.some((item) => item.item.text === "12")).toBe(true);
    }
  });

  test("OCR gutter filtering keeps its footer exception", () => {
    const items = [
      itemAt("body text", 50, 100, 200, 10),
      itemAt("12", 310, 120, 8, 10),
      itemAt("34", 310, 760, 8, 10),
    ];
    for (const item of items) item.item.confidence = f32(0.4);
    const lines = formLines(items, 10, 10, 612, 792, true);
    let projected = lines.flat();
    expect(projected.find((item) => item.item.text === "12")?.is_margin_line_number).toBe(true);
    expect(projected.find((item) => item.item.text === "34")?.is_margin_line_number).toBe(false);
    projected = cleanProjectedItems(projected, 612, 792);
    expect(projected.some((item) => item.item.text === "12")).toBe(false);
    expect(projected.some((item) => item.item.text === "34")).toBe(true);
  });

  test("a three-digit footer preserves the body layout", () => {
    const items = [itemAt("body text", 50, 600, 200, 10)];
    const [body, regions] = buildProjectedLines(items, 612, 792, []);
    items.push(itemAt("100", 300, 760, 18, 10));
    expect(isGutterNumberCandidate(items[1], 612)).toBe(false);
    const [lines, withFooter] = buildProjectedLines(items, 612, 792, []);
    expect(regions).toEqual(withFooter);
    expect(body).toEqual(lines.slice(0, 1));
    expect(lines[1].text).toBe("100");
    expect(lines[1].region_path).toEqual([...NUMERIC_FOOTER_PATH]);
  });
});

describe("form_lines merging", () => {
  test("font-scaled gap checks preserve word spaces and kerning", () => {
    const cases: Array<[string, string, number, number, number, number, boolean, string]> = [
      ["word", "next", 12.75, 35.4, -0.222, 0, true, "word next"],
      ["word", "next", 8, 15.885, 0.063, 10, false, "word next"],
      ["word", "next", 6.745, 38.1856, -0.0706, 12, false, "word next"],
      ["r", "e", 6.9975, 2.4281, -0.0979, 0, false, "re"],
      ["W", "ord", 6.9975, 6.602, -0.2537, 0, false, "Word"],
      ["acti viti", "es", 16, 49.7824, 0.096, 0, false, "acti vities"],
      ["Operati", "ng", 27, 86.5485, -0.2592, 0, false, "Operating"],
    ];
    for (const [left, right, height, width, gap, rotation, mono, expected] of cases) {
      const w = f32(width);
      const items = [
        itemAt(left, 40, 100, w, height),
        itemAt(right, f32(f32(40 + w) + f32(gap)), 100, 20, height),
      ];
      for (const item of items) {
        item.item.font_height = f32(height);
        item.item.rotation = rotation;
        if (mono) item.item.font_name = "Courier";
        item.item.width = roundF32(item.item.width);
        item.item.height = roundF32(item.item.height);
      }
      const lines = formLines(items, 5, f32(height), 500, 800, true);
      expect(lines[0].map((p) => p.item.text).join("")).toBe(expected);
    }
  });

  test("decimal continuation preserves styled text", () => {
    const items = [
      itemAt("Reference", 10, 100, 29.8, 9),
      itemAt("doi.org/10", 40.2, 100, 39.8, 9),
      itemAt(".1234/example", 80.4, 100, 40, 9),
    ];
    items[1].item.underline = true;
    items[2].item.underline = true;
    for (const item of items) item.item.width = roundF32(item.item.width);
    const lines = formLines(items, 5, 9, 500, 800, true);
    const merged = lines[0][0].item;
    expect(merged.text).toContain("doi.org/10.1234/example");
    expect(merged.style_pieces.map((p) => p.text).join("")).toContain("doi.org/10.1234/example");
  });

  test("overlapping OCR detections keep the following label separate", () => {
    const items = [
      itemAt("b", 9.12218, 34.08, 5.2812614, 4.799999),
      itemAt("h", 9.12218, 34.56, 3.6008606, 3.8400002),
      itemAt("Label", 13.6832695, 33.36, 60.2544, 5.040001),
    ];
    for (const item of items) {
      item.item.font_name = "OCR";
      item.item.font_size = item.item.height;
      item.item.confidence = f32(0.98);
      item.item.width = roundF32(item.item.width);
      item.item.height = roundF32(item.item.height);
    }
    expect(texts(formLines(items, 5, 5, 500, 800, true))).toEqual(["bh Label"]);
  });

  test("OCR and mixed pairs keep rounded gaps in both merge checks", () => {
    const pairs: Array<[number | null, number | null]> = [
      [0.98, 0.98],
      [0.98, null],
      [null, 0.98],
    ];
    for (const [a, b] of pairs) {
      const items = [itemAt("first", 40, 100, 10.4, 9), itemAt("second", 50.2, 100, 12.3, 9)];
      items[0].item.confidence = a === null ? null : f32(a);
      items[1].item.confidence = b === null ? null : f32(b);
      for (const item of items) item.item.width = roundF32(item.item.width);
      const lines = formLines(items, 5, 9, 500, 800, true);
      expect(lines.length).toBe(1);
      expect(lines[0].length).toBe(1);
      expect(lines[0][0].item.text).toBe("first second");
    }
  });

  test("the original gap does not silently join scripts or mismatched native runs", () => {
    for (let kase = 0; kase < 6; kase++) {
      const items = [itemAt("word", 40, 100, 10.2, 9), itemAt("a", 50.2, 100, 3.3, 9)];
      const marker = items[1].item;
      if (kase === 0) marker.script_geom = [98, 6];
      else if (kase === 1) marker.sup = true;
      else if (kase === 2) marker.sub = true;
      else if (kase === 3) marker.font_size = 6;
      else if (kase === 4) marker.font_height = 6;
      else {
        marker.y = f32(marker.y + f32(0.2));
        items[1].orig_y = f32(items[1].orig_y + f32(0.2));
      }
      for (const item of items) {
        item.item.width = roundF32(item.item.width);
        item.item.height = roundF32(item.item.height);
      }
      expect(texts(formLines(items, 5, 9, 500, 800, true))).toEqual(["word a"]);
    }
  });
});
