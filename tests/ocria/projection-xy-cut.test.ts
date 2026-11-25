// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The `#[cfg(test)]` tests of liteparse projection.rs that exercise the XY-cut
// (xy-*.ts): cut finders, the recursion and the numeric-footer rule. Inputs are
// integers, so they are exact f32 values.

import { describe, expect, test } from "bun:test";

import { buildProjectedLines, xyWalkLeaves } from "../../src/ocria/projection/projected-lines.js";
import type { ProjectedTextItem } from "../../src/ocria/projection/types.js";
import { newProjectedItem } from "../../src/ocria/projection/projected-item.js";
import { xyFindBannerCut } from "../../src/ocria/projection/xy-banner-cut.js";
import { xyMedianLineHeight, xyRootBbox, xySplitBbox } from "../../src/ocria/projection/xy-bbox.js";
import { xyFindColumnCut } from "../../src/ocria/projection/xy-column-cut.js";
import { XY_BUCKET_PT, XY_MAX_BUCKETS } from "../../src/ocria/projection/xy-consts.js";
import {
  NUMERIC_FOOTER_PATH,
  isEquationNumber,
  isFormulaFragment,
  isolatedNumericFooter,
  xyBucketPt,
  xyCut,
} from "../../src/ocria/projection/xy-cut.js";
import { xyFindBestCut } from "../../src/ocria/projection/xy-find-cut.js";
import type { Rect, Region } from "../../src/ocria/types/geometry.js";
import { textItem } from "../../src/ocria/types/text-item.js";
import { canon } from "./parse-golden.js";

/** Rust test helper `item_at`. */
function itemAt(text: string, x: number, y: number, w: number, h: number): ProjectedTextItem {
  return newProjectedItem(textItem({ text, x, y, width: w, height: h }));
}

function hasVerticalSplit(region: Region): boolean {
  if ("Split" in region.kind) {
    const { axis, children } = region.kind.Split;
    return axis === "Vertical" || children.some(hasVerticalSplit);
  }
  return false;
}

function twoColumnBody(items: ProjectedTextItem[], y0: number): void {
  // Left column at x 50..280, right column at x 320..550, sharing y-bands.
  for (let row = 0; row < 8; row++) {
    const y = y0 + row * 14;
    items.push(itemAt("left column body text here", 50, y, 230, 12));
    items.push(itemAt("right column body text here", 320, y, 230, 12));
  }
}

function twoColumnFiveRows(left: string, right: string, y0 = 100): ProjectedTextItem[] {
  const items: ProjectedTextItem[] = [];
  for (let row = 0; row < 5; row++) {
    const y = y0 + row * 14;
    items.push(itemAt(left, 50, y, 200, 10));
    items.push(itemAt(right, 350, y, 200, 10));
  }
  return items;
}

describe("XY-cut text predicates", () => {
  test("equation_numbers_and_formula_fragments", () => {
    expect(isEquationNumber("(22)")).toBe(true);
    expect(isEquationNumber(" (3.14) ")).toBe(true);
    expect(isEquationNumber("(A.2)")).toBe(true);
    expect(isEquationNumber("(see above)")).toBe(false);
    expect(isEquationNumber("(a)")).toBe(false);
    expect(isFormulaFragment("0")).toBe(true);
    expect(isFormulaFragment(", B =")).toBe(true);
    expect(isFormulaFragment("which defines the")).toBe(false);
    expect(isFormulaFragment(" ")).toBe(false);
  });

  test("equation numbers reject empty, long, unbalanced and non-ASCII inner text", () => {
    expect(isEquationNumber("()")).toBe(false);
    expect(isEquationNumber("(")).toBe(false);
    expect(isEquationNumber("22")).toBe(false);
    expect(isEquationNumber("(1234567)")).toBe(false);
    expect(isEquationNumber("(1é)")).toBe(false);
  });

  test("xy_bucket_size_caps_histogram_length", () => {
    expect(xyBucketPt(792)).toBe(XY_BUCKET_PT);
    expect(xyBucketPt(2 * 65_536)).toBe(XY_BUCKET_PT);
    const runaway = Math.fround(3.0e9);
    expect(Math.ceil(Math.fround(runaway / xyBucketPt(runaway)))).toBeLessThanOrEqual(
      XY_MAX_BUCKETS
    );
  });
});

describe("xyCut", () => {
  test("xy_cut_finds_column_gutter_on_two_column_layout", () => {
    // Two columns, 50pt-wide gutter centered at x=300. Expect one vertical
    // split at the gutter, both children leaves of 5 items.
    const region = xyCut(twoColumnFiveRows("left side text", "right side text"), 612, 792, []);
    if (!("Split" in region.kind)) throw new Error("expected a vertical split");
    const { axis, children } = region.kind.Split;
    expect(axis).toBe("Vertical");
    expect(children.length).toBe(2);
    const leafLen = (r: Region): number => ("Leaf" in r.kind ? r.kind.Leaf.item_indices.length : 0);
    expect(leafLen(children[0])).toBe(5);
    expect(leafLen(children[1])).toBe(5);
  });

  test("footer_above_blank_bottom_margin_is_detached_but_table_value_is_not", () => {
    const items = [itemAt("description", 50, 560, 200, 10), itemAt("67", 294, 605, 8, 10)];
    const [lines] = buildProjectedLines(items, 595, 842, []);
    expect(lines[lines.length - 1].region_path).toEqual([...NUMERIC_FOOTER_PATH]);
    items[1].orig_y = 575;
    items[1].item.y = 575;
    const [lines2] = buildProjectedLines(items, 595, 842, []);
    expect(lines2.every((l) => l.region_path.join() !== NUMERIC_FOOTER_PATH.join())).toBe(true);
  });

  test("isolated_footer_preserves_body_regions_and_lines", () => {
    const items = twoColumnFiveRows("left column", "right column");
    const [bodyLines, bodyRegions] = buildProjectedLines(items, 612, 792, []);
    const footerItem = itemAt("12", 304, 760, 8, 10);
    footerItem.item.words.push({ text: "12", x: 304, y: 760, width: 8, height: 10 });
    items.push(footerItem);
    const [lines, regions] = buildProjectedLines(items, 612, 792, []);
    expect(canon(regions)).toEqual(canon(bodyRegions));
    expect(canon(lines.slice(0, bodyLines.length))).toEqual(canon(bodyLines));
    const footer = lines[lines.length - 1];
    expect(footer.text).toBe("12");
    expect(footer.region_path).toEqual([...NUMERIC_FOOTER_PATH]);
    expect(canon(footer.spans[0])).toEqual(canon(items[items.length - 1].item));
  });

  test("xy_cut_returns_leaf_on_single_column_prose", () => {
    // Tight single-column text: no valley wide enough to cut.
    const items = Array.from({ length: 8 }, (_, row) =>
      itemAt("the quick brown fox", 60, 100 + row * 12, 400, 10)
    );
    expect("Leaf" in xyCut(items, 612, 792, []).kind).toBe(true);
  });

  test("xy_cut_walk_assigns_reading_order_paths", () => {
    // 2-column page: pre-order walk visits left column before right.
    const [lines] = buildProjectedLines(twoColumnFiveRows("L", "R"), 612, 792, []);
    expect(lines.length).toBe(10);
    for (const line of lines.slice(0, 5)) expect(line.region_path[0]).toBe(0);
    for (const line of lines.slice(5)) expect(line.region_path[0]).toBe(1);
  });

  test("xy_cut with no items is an empty leaf over the page", () => {
    const region = xyCut([], 612, 792, []);
    expect(region.bbox).toEqual({ x: 0, y: 0, width: 612, height: 792 });
    expect(region.kind).toEqual({ Leaf: { item_indices: [] } });
  });

  test("banner_cut_isolates_full_width_title_above_two_columns", () => {
    // A centered wide title, a clear gap, then 2-column body text. The banner
    // detector H-cuts below the title, so it is the first leaf, apart from both columns.
    const items = [itemAt("Wide Centered Title Spanning Full Page", 100, 50, 412, 14)];
    for (let row = 0; row < 5; row++) {
      const y = 200 + row * 14;
      items.push(itemAt("left side text", 50, y, 200, 10));
      items.push(itemAt("right side text", 350, y, 200, 10));
    }
    const [lines] = buildProjectedLines(items, 612, 792, []);
    const first = lines[0];
    expect(first.text).toContain("Title");
    for (const l of lines.slice(1)) expect(l.region_path).not.toEqual(first.region_path);
  });

  test("banner_cut_does_not_fire_on_plain_two_column_layout", () => {
    const region = xyCut(twoColumnFiveRows("left side text", "right side text"), 612, 792, []);
    if (!("Split" in region.kind)) throw new Error("expected a split at the root");
    expect(region.kind.Split.axis).toBe("Vertical");
  });

  test("figure_obstacle_forces_h_cut_around_straddling_figure", () => {
    // Two wide text bands with a figure between them that spans both halves of
    // the page: with the figure stamped into the density, the root cut is horizontal.
    const items: ProjectedTextItem[] = [];
    for (let row = 0; row < 4; row++) {
      items.push(itemAt("top band line spans full width", 50, 100 + row * 14, 500, 12));
    }
    for (let row = 0; row < 4; row++) {
      items.push(itemAt("bottom band line after the figure", 50, 400 + row * 14, 500, 12));
    }
    const figures: Rect[] = [{ x: 60, y: 160, width: 490, height: 200 }];
    const withFig = xyCut(items, 612, 792, figures);
    if (!("Split" in withFig.kind)) throw new Error("expected a split when figure is present");
    expect(withFig.kind.Split.axis).toBe("Horizontal");
    expect(xyCut(items, 612, 792, []).bbox.width).toBeGreaterThan(0);
  });

  test("xy_cut_no_vertical_split_on_table_with_sparse_row", () => {
    // Issue #400: a sparse row (3 of 8 cells) plus a note line drag the column
    // peaks under the strong-peak floor, and the unprotected density V-cut used
    // to transpose the table into column-major prose.
    const cols = [48, 108, 190, 300, 360, 424, 486, 545];
    const cells = ["10/10/2024", "IC-1000", "WIDGET", "Open", "$1.00", "$0.00", "$2.00", "N/A"];
    // Widths must undershoot the column slots: the fill check keys on that whitespace.
    const widths = [42, 30, 55, 22, 24, 22, 24, 15];
    const items: ProjectedTextItem[] = [];
    let y = 100;
    for (let i = 0; i < 8; i++) {
      for (let r = 0; r < 3; r++) items.push(itemAt(cells[i], cols[i], 100 + r * 16, widths[i], 9));
    }
    y += 3 * 16;
    for (const i of [0, 1, 3]) items.push(itemAt(cells[i], cols[i], y, widths[i], 9));
    y += 22;
    items.push(itemAt("note text spanning a while here", 190, y, 220, 9));
    y += 22;
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < 8; i++) items.push(itemAt(cells[i], cols[i], y, widths[i], 9));
      y += 16;
    }
    expect(hasVerticalSplit(xyCut(items, 612, 792, []))).toBe(false);
  });

  test("xy_cut_inherits_tabular_state_through_section_banners", () => {
    const items: ProjectedTextItem[] = [];
    const sectionRows: number[][][] = [];
    const sectionYs = [100, 190, 280];
    for (let section = 0; section < sectionYs.length; section++) {
      const rows: number[][] = [];
      for (let row = 0; row < 3; row++) {
        const y = sectionYs[section] + row * 12;
        const offset = row * 24;
        const rowIndices: number[] = [];
        for (let col = 0; col < 7; col++) {
          const text =
            col === 0
              ? `Section ${section} label ${row}`
              : `${(section + 1) * 100 + row * 10 + col}`;
          rowIndices.push(items.length);
          items.push(itemAt(text, 50 + col * 72 + offset, y, 8, 10));
        }
        rows.push(rowIndices);
      }
      sectionRows.push(rows);
      if (section + 1 < sectionYs.length) {
        items.push(itemAt(`Section ${section + 1}`, 50, sectionYs[section] + 50, 488, 10));
      }
    }

    const all = items.map((_, i) => i);
    const bbox = xyRootBbox(items, all, 612, 792);
    const medianH = xyMedianLineHeight(items, all);
    const rootFlag = { tabular: false };
    expect(xyFindColumnCut(items, all, bbox, medianH, rootFlag)).toBeNull();
    // The synthetic root must receive the tabular verdict.
    expect(rootFlag.tabular).toBe(true);

    const firstSectionIdxs = sectionRows[0].flat();
    const childFlag = { tabular: false };
    expect(xyFindColumnCut(items, firstSectionIdxs, bbox, medianH, childFlag)).toBeNull();
    // The short section must not independently receive a tabular verdict.
    expect(childFlag.tabular).toBe(false);
    const banner = xyFindBannerCut(items, all, bbox, medianH);
    if (banner === null) throw new Error("the first section should be separated by a banner cut");
    expect(banner.axis).toBe("Horizontal");
    expect(banner.position).toBeGreaterThan(134);
    expect(banner.position).toBeLessThan(150);
    const [firstSectionBbox] = xySplitBbox(bbox, banner);
    expect(
      xyFindBestCut(items, firstSectionIdxs, firstSectionBbox, "Vertical", medianH, [])
    ).not.toBeNull();

    const region = xyCut(items, 612, 792, []);
    if (!("Split" in region.kind)) throw new Error("expected a split");
    expect(region.kind.Split.axis).toBe("Horizontal");
    const leaves: Array<[number[], number[]]> = [];
    xyWalkLeaves(region, [], leaves);
    const leafForItem: Array<number | null> = items.map(() => null);
    leaves.forEach(([, itemIndices], leafIdx) => {
      for (const itemIdx of itemIndices) leafForItem[itemIdx] = leafIdx;
    });
    sectionRows.forEach((rows, section) => {
      rows.forEach((itemIndices, row) => {
        const leaf = leafForItem[itemIndices[0]];
        const together = leaf !== null && itemIndices.every((i) => leafForItem[i] === leaf);
        expect(together, `section ${section} row ${row} was split across leaves`).toBe(true);
      });
    });
  });

  test("spanning_line_above_columns_is_peeled_to_reveal_gutter", () => {
    // A single centered line that crosses the gutter (x 160..450, gutter about
    // 300) sits above a clean two-column body. The rescue in the min-lines guard
    // allows the finite-score H-cut that isolates it, after which the body splits.
    const items = [itemAt("Centered Spanning Author Line", 160, 100, 290, 12)];
    twoColumnBody(items, 140);
    expect(hasVerticalSplit(xyCut(items, 612, 792, []))).toBe(true);
  });

  test("single_column_caption_is_not_peeled_into_columns", () => {
    // A short line entirely within the left column must not trigger the spanning rescue.
    const items = [itemAt("Short caption", 60, 100, 140, 12)];
    for (let row = 0; row < 8; row++) {
      items.push(itemAt("single column running body text", 50, 140 + row * 14, 230, 12));
    }
    expect(hasVerticalSplit(xyCut(items, 612, 792, []))).toBe(false);
  });
});

describe("isolatedNumericFooter", () => {
  test("needs one to three ASCII digits near the page centre, below all other text", () => {
    const body = itemAt("body text", 50, 600, 200, 10);
    const ok = (t: string, x = 300): boolean =>
      isolatedNumericFooter([body, itemAt(t, x, 760, 18, 10)], 1, 612, 792);
    expect(ok("100")).toBe(true);
    expect(ok("1000")).toBe(false);
    expect(ok("1a")).toBe(false);
    expect(ok("")).toBe(false);
    expect(ok("12", 100)).toBe(false);
    expect(ok("12", 400)).toBe(false);
    const upper = itemAt("12", 300, 300, 18, 10);
    expect(isolatedNumericFooter([body, upper], 1, 612, 792)).toBe(false);
    const margin = itemAt("12", 300, 760, 18, 10);
    margin.is_margin_line_number = true;
    expect(isolatedNumericFooter([body, margin], 1, 612, 792)).toBe(false);
  });
});
