// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// The #[cfg(test)] tests of liteparse markdown_layout/tables.rs whose subject
// is the union header (plus direct tests of the cluster re-extraction).

import { describe, expect, test } from "bun:test";

import type { Block, Cell } from "../../src/ocria/markdown-layout/block-types.js";
import { cell } from "../../src/ocria/markdown-layout/block-types.js";
import {
  mergeFragmentedTableClusters,
  unionHeaderFromAbove,
} from "../../src/ocria/markdown-layout/tables/merge/index.js";
import type { TableRun } from "../../src/ocria/markdown-layout/tables/types.js";
import { lineWithSpans } from "../../src/ocria/markdown-layout/test-helpers.js";
import type { ProjectedLine } from "../../src/ocria/types/page.js";

/** `"A".into()` for each text: cells carrying text only. */
const cells = (...texts: string[]): Cell[] => texts.map((t) => cell(t));

function tableOf(b: Block): { header: Cell[] | null; rows: Cell[][] } {
  if (typeof b === "string" || !("Table" in b)) throw new Error("expected Block::Table");
  return b.Table;
}

const texts = (row: Cell[]): string[] => row.map((c) => c.text);

function run(
  start: number,
  end: number,
  header: Cell[] | null,
  rows: Cell[][],
  block?: Block
): TableRun {
  return {
    interstitials: [],
    item_indices: [],
    start,
    end,
    body_start: start,
    bbox: null,
    block: block ?? { Table: { header, rows } },
  };
}

describe("union_header_from_above", () => {
  test("union_header_fold_carries_span_items", () => {
    // A spanning group header replicates into both columns it covers.
    const header = lineWithSpans(
      [
        ["Region", 50],
        ["GroupGroupGroup", 145],
      ],
      100,
      20
    );
    header.span_item_indices = [7, 8];
    const body = lineWithSpans(
      [
        ["x", 50],
        ["1", 150],
        ["2", 250],
      ],
      125,
      10
    );
    body.span_item_indices = [9, 10, 11];
    const found = unionHeaderFromAbove(
      [header, body],
      1,
      0,
      [
        [50, 50],
        [150, 150],
        [250, 250],
      ],
      false
    );
    expect(found).not.toBeNull();
    if (found == null) return;
    const [start, h] = found;
    expect(start).toBe(0);
    expect(h[0].text_item_indices).toEqual([7]);
    expect(h[1].text_item_indices).toEqual([8]);
    expect(h[2].text_item_indices).toEqual([8]);
  });

  test("union_header_fold_attributes_deduplicated_layers", () => {
    // Two header layers repeat "Rated" from different items: the text folds to
    // one, the items to both.
    const top = lineWithSpans(
      [
        ["Rated", 50],
        ["Voltage", 150],
      ],
      100,
      10
    );
    top.span_item_indices = [1, 2];
    const bottom = lineWithSpans(
      [
        ["Rated", 50],
        ["(VDC)", 150],
      ],
      115,
      10
    );
    bottom.span_item_indices = [3, 4];
    const body = lineWithSpans(
      [
        ["x", 50],
        ["1", 150],
      ],
      130,
      10
    );
    body.span_item_indices = [5, 6];
    const found = unionHeaderFromAbove(
      [top, bottom, body],
      2,
      0,
      [
        [50, 50],
        [150, 150],
      ],
      false
    );
    expect(found).not.toBeNull();
    if (found == null) return;
    const h = found[1];
    expect(h[0].text).toBe("Rated");
    expect(h[0].text_item_indices).toEqual([1, 3]);
    expect(h[1].text).toBe("Voltage (VDC)");
    expect(h[1].text_item_indices).toEqual([2, 4]);
  });
});

// Not a Rust test: upstream reaches `merge_fragmented_table_clusters` only through
// `detect_tables` and the page goldens, so these two tests pin its behavior directly.
describe("merge_fragmented_table_clusters", () => {
  const fourCol = (a: string, b: string, c: string, d: string, y: number): ProjectedLine =>
    lineWithSpans(
      [
        [a, 50],
        [b, 150],
        [c, 250],
        [d, 350],
      ],
      y,
      10
    );

  test("re_extracts_a_sparse_row_stranded_between_two_runs", () => {
    const lines = [
      fourCol("Region", "2001", "2002", "2003", 10),
      fourCol("North", "11", "12", "13", 25),
      fourCol("South", "21", "22", "23", 40),
      lineWithSpans(
        [
          ["East", 50],
          ["31", 250],
        ],
        55,
        10
      ),
      fourCol("West", "41", "42", "43", 70),
      fourCol("Total", "91", "92", "93", 85),
    ];
    const a = run(1, 3, null, [cells("North", "11", "12", "13"), cells("South", "21", "22", "23")]);
    const b = run(4, 6, null, [cells("West", "41", "42", "43"), cells("Total", "91", "92", "93")]);
    const merged = mergeFragmentedTableClusters([a, b], lines);
    expect(merged.length).toBe(1);
    // The header line above the first fragment is absorbed too.
    expect([merged[0].start, merged[0].end, merged[0].body_start]).toEqual([0, 6, 1]);
    const { header, rows } = tableOf(merged[0].block);
    expect(texts(header ?? [])).toEqual(["Region", "2001", "2002", "2003"]);
    expect(rows.map(texts)).toEqual([
      ["North", "11", "12", "13"],
      ["South", "21", "22", "23"],
      ["East", "", "31", ""],
      ["West", "41", "42", "43"],
      ["Total", "91", "92", "93"],
    ]);
  });

  test("leaves_runs_with_different_tracks_alone", () => {
    const lines = [
      fourCol("a", "b", "c", "d", 10),
      fourCol("a", "b", "c", "d", 25),
      lineWithSpans(
        [
          ["k", 70],
          ["v", 190],
          ["w", 300],
        ],
        40,
        10
      ),
      lineWithSpans(
        [
          ["k", 70],
          ["v", 190],
          ["w", 300],
        ],
        55,
        10
      ),
    ];
    const a = run(0, 2, null, [cells("a", "b", "c", "d"), cells("a", "b", "c", "d")]);
    const b = run(2, 4, null, [cells("k", "v", "w"), cells("k", "v", "w")]);
    expect(mergeFragmentedTableClusters([a, b], lines).length).toBe(2);
  });
});
