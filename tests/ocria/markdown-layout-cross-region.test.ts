// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The #[cfg(test)] tests of liteparse markdown_layout/cross_region.rs.

import { describe, expect, test } from "bun:test";

import type { Block, Cell } from "../../src/ocria/markdown-layout/block-types.js";
import { cellLocated } from "../../src/ocria/markdown-layout/blocks/positioned.js";
import { findCrossRegionTableMerge } from "../../src/ocria/markdown-layout/cross-region/index.js";
import { line, lineWithSpans } from "../../src/ocria/markdown-layout/test-helpers.js";
import type { TableRun } from "../../src/ocria/markdown-layout/tables/types.js";
import { absorbCrossRegionHeaders } from "../../src/ocria/markdown-layout/tables/merge/index.js";
import type { ProjectedLine } from "../../src/ocria/types/page.js";

function atRegion(l: ProjectedLine, path: number[]): ProjectedLine {
  l.region_path = path;
  return l;
}

function tableOf(b: Block): { header: Cell[] | null; rows: Cell[][] } | null {
  return typeof b !== "string" && "Table" in b ? b.Table : null;
}

const LABELS = ["MANILA", "CEBU", "CAGAYAN DE ORO", "SUBIC"];
const NUMBERS: Array<[string, string]> = [
  ["2454", "6125"],
  ["1138", "79500"],
  ["958", "13196"],
  ["313", "136"],
];

function slicedNumericTable(): ProjectedLine[] {
  const lines: ProjectedLine[] = [];
  LABELS.forEach((label, i) => {
    lines.push(atRegion(lineWithSpans([[label, 50]], 100 + i * 20, 10), [0, 0]));
  });
  NUMBERS.forEach(([a, b], i) => {
    lines.push(
      atRegion(
        lineWithSpans(
          [
            [a, 200],
            [b, 280],
          ],
          100 + i * 20,
          10
        ),
        [0, 1]
      )
    );
  });
  return lines;
}

const COLUMNS: Array<[number, [string, string], [string, string, string, string]]> = [
  [50, ["Trading", "Projections"], ["Rooms Revenue", "Rooms Occupied", "Average Rate", "RevPAR"]],
  [200, ["Year One", "Year Two"], ["1,644,143", "1,650,000", "123.45", "87.65"]],
  [280, ["% of TR", "% of TR"], ["71.0%", "70.5%", "—", "50.2%"]],
];

function interleavedThreeColumnTable(wideTopProse: boolean): ProjectedLine[] {
  const lines: ProjectedLine[] = [];
  COLUMNS.forEach(([x, top, body], column) => {
    top.forEach((text, row) => {
      const l =
        wideTopProse && column === 2 && row === 0
          ? line("a ".repeat(80), -200, 100, 10, 10)
          : lineWithSpans([[text, x]], 100 + row * 12, 10);
      lines.push(atRegion(l, [column, 0]));
    });
    body.forEach((text, row) => {
      lines.push(atRegion(lineWithSpans([[text, x]], 200 + row * 20, 10), [column, 1]));
    });
  });
  return lines;
}

describe("cross_region", () => {
  test("sliced_numeric_table_is_merged", () => {
    const m = findCrossRegionTableMerge(slicedNumericTable());
    expect(m).not.toBeNull();
    if (m == null) return;
    expect([m.start, m.end]).toEqual([0, 8]);
    expect(m.merged.length).toBe(4);
    expect(m.runs.length).toBeGreaterThan(0);
    // Every fused row carries the label and both numbers.
    expect(m.merged[0].text).toContain("MANILA");
    expect(m.merged[0].text).toContain("2454");
    expect(m.merged[0].text).toContain("6125");
  });

  test("interleaved_h_cut_leaves_close_into_a_table", () => {
    const m = findCrossRegionTableMerge(interleavedThreeColumnTable(false));
    expect(m).not.toBeNull();
    if (m == null) return;
    expect(m.merged.length).toBe(6);
    expect(m.merged[2].text).toContain("Rooms Revenue");
    expect(m.merged[2].text).toContain("1,644,143");
    expect(m.merged[2].text).toContain("71.0%");
    const hasCompleteRow = m.runs.some((run) => {
      const t = tableOf(run.block);
      if (t == null) return false;
      return [...(t.header == null ? [] : [t.header]), ...t.rows].some((row) => {
        const text = row.map((c) => c.text).join("");
        return (
          text.includes("Rooms Revenue") && text.includes("1,644,143") && text.includes("71.0%")
        );
      });
    });
    expect(hasCompleteRow).toBe(true);
  });

  test("interleaved_table_headers_align_with_merged_body_columns", () => {
    const lines: ProjectedLine[] = [];
    COLUMNS.forEach(([x, top, body], column) => {
      top.forEach((text, row) => {
        lines.push(atRegion(lineWithSpans([[text, x]], 160 + row * 12, 10), [column, 0]));
      });
      if (column === 0) {
        lines.push(atRegion(lineWithSpans([["Revenue", x]], 188, 10), [column, 1]));
      }
      body.forEach((text, row) => {
        lines.push(atRegion(lineWithSpans([[text, x]], 200 + row * 20, 10), [column, 1]));
      });
    });
    const m = findCrossRegionTableMerge(lines);
    expect(m).not.toBeNull();
    if (m == null) return;
    const header = m.runs.map((r) => tableOf(r.block)?.header).find((h) => h != null);
    expect(header).toBeDefined();
    const headerText = (header ?? []).map((c) => c.text).join(" ");
    expect(headerText).toContain("Year One");
    expect(headerText).toContain("Year Two");
    const bodyText = m.runs
      .flatMap((run) => tableOf(run.block)?.rows.flatMap((row) => row.map((c) => c.text)) ?? [])
      .join(" ");
    expect(bodyText).toContain("1,644,143");
    expect(bodyText).toContain("71.0%");
  });

  test("cross_region_header_absorption_skips_one_section_label", () => {
    const lines = [
      lineWithSpans(
        [
          ["Year One", 794.4],
          ["Total", 875.6],
        ],
        100,
        10
      ),
      lineWithSpans(
        [
          ["Year Two", 794.4],
          ["Total", 875.6],
        ],
        110,
        10
      ),
      lineWithSpans([["Revenue", 50]], 120, 10),
      lineWithSpans(
        [
          ["Rooms Revenue", 50],
          ["1,644,143", 794.4],
        ],
        140,
        10
      ),
      lineWithSpans(
        [
          ["Rooms Occupied", 50],
          ["1,650,000", 794.4],
        ],
        160,
        10
      ),
    ];
    const located = (text: string, x: number): Cell =>
      cellLocated(text, { x, y: 140, width: 20, height: 10 });
    const blank = (): Cell => ({ text: "", bbox: null, text_item_indices: [] });
    const runs: TableRun[] = [
      {
        start: 3,
        end: 5,
        body_start: 3,
        bbox: null,
        item_indices: [],
        block: {
          Table: {
            header: null,
            rows: [
              [
                located("Rooms Revenue", 50),
                located("1,644,143", 794.4),
                blank(),
                located("2,000,000", 853.8),
              ],
              [
                located("Rooms Occupied", 50),
                located("1,650,000", 794.4),
                blank(),
                located("2,100,000", 853.8),
              ],
            ],
          },
        },
        interstitials: [],
      },
    ];

    absorbCrossRegionHeaders(lines, runs);

    const run = runs[0];
    expect(run.start).toBe(0);
    expect(run.interstitials[0].text).toBe("Revenue");
    const header = tableOf(run.block)?.header;
    expect(header).toBeTruthy();
    if (header == null) return;
    expect(header[1].text).toContain("Year One");
    expect(header[1].text).toContain("Year Two");
    expect(header[2].text).toBe("");
    expect(header[3].text).toContain("Total");
  });

  test("interleaved_wide_prose_leaf_prevents_closure", () => {
    expect(findCrossRegionTableMerge(interleavedThreeColumnTable(true))).toBeNull();
  });

  // Two side-by-side prose columns with coincidentally aligned baselines must
  // not merge: that's the layout the V-cut exists to protect.
  test("two_column_prose_is_not_merged", () => {
    const lines: ProjectedLine[] = [];
    for (let i = 0; i < 8; i++) {
      lines.push(
        atRegion(line("the quick brown fox jumps over it", 50, 100 + i * 12, 10, 10), [0, 0])
      );
    }
    for (let i = 0; i < 8; i++) {
      lines.push(
        atRegion(line("a second column of body text here", 250, 100 + i * 12, 10, 10), [0, 1])
      );
    }
    expect(findCrossRegionTableMerge(lines)).toBeNull();
  });

  // Label / description shape with list-marker labels (the doc-146 shape):
  // standard detectors reject it, the direct 2-col path accepts.
  test("sliced_label_description_table_uses_direct_path", () => {
    const lines: ProjectedLine[] = [atRegion(line("Area", 50, 100, 10, 10), [0, 0])];
    ["1. Embodying values", "2. Embracing complexity", "3. Envisioning futures"].forEach(
      (label, i) => lines.push(atRegion(line(label, 50, 150 + i * 50, 10, 10), [0, 0]))
    );
    lines.push(atRegion(line("Competence", 250, 100, 10, 10), [0, 1]));
    [
      "1.1 Valuing sustainability 1.2 Supporting fairness",
      "2.1 Systems thinking 2.2 Critical thinking",
      "3.1 Futures literacy 3.2 Adaptability",
    ].forEach((desc, i) => lines.push(atRegion(line(desc, 250, 150 + i * 50, 10, 10), [0, 1])));
    const m = findCrossRegionTableMerge(lines);
    expect(m).not.toBeNull();
    if (m == null) return;
    expect(m.runs.length).toBe(1);
    const t = tableOf(m.runs[0].block);
    expect(t).not.toBeNull();
    if (t == null) return;
    expect(t.header?.map((c) => c.text)).toEqual(["Area", "Competence"]);
    expect(t.rows.length).toBe(3);
    expect(t.rows[0][1].text).toContain("1.1 Valuing sustainability");
  });

  // A single region (no V-cut) never merges.
  test("single_leaf_is_untouched", () => {
    const lines = Array.from({ length: 6 }, (_, i) =>
      atRegion(line("text", 50, 100 + i * 12, 10, 10), [0])
    );
    expect(findCrossRegionTableMerge(lines)).toBeNull();
  });

  // Vertically stacked leaves (H-cut siblings) never pair: no y-overlap.
  test("stacked_leaves_do_not_pair", () => {
    const lines: ProjectedLine[] = [];
    for (let i = 0; i < 4; i++)
      lines.push(atRegion(line("alpha beta", 50, 100 + i * 12, 10, 10), [0]));
    for (let i = 0; i < 4; i++)
      lines.push(atRegion(line("gamma delta", 50, 300 + i * 12, 10, 10), [1]));
    expect(findCrossRegionTableMerge(lines)).toBeNull();
  });
});
