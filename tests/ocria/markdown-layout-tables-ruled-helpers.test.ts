// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Hand-computed cases for the ruled-grid helpers the Rust unit tests only reach
// through the goldens (not in the Rust test module).

import { describe, expect, test } from "bun:test";

import type { Cell } from "../../src/ocria/markdown-layout/block-types.js";
import { cell } from "../../src/ocria/markdown-layout/block-types.js";
import type { HSeg, VSeg } from "../../src/ocria/markdown-layout/tables/grid-segments.js";
import {
  bucketWordsIntoColumns,
  clusterBoundaries,
  dedupClose,
  detectRuledTablesGlobal,
  extractRuleSegments,
  findBucket,
  flattenHeaderBand,
  mergeStackedHeader,
  splitComponentAtGridGaps,
} from "../../src/ocria/markdown-layout/tables/ruled/index.js";
import { line, rowTexts, stroke } from "../../src/ocria/markdown-layout/test-helpers.js";
import type { GraphicPrimitive } from "../../src/ocria/types/geometry.js";
import type { ProjectedLine } from "../../src/ocria/types/page.js";
import { textItem } from "../../src/ocria/types/text-item.js";

function rows(v: readonly (readonly string[])[]): Cell[][] {
  return v.map((r) => r.map((s) => cell(s)));
}

function grid2x2(): GraphicPrimitive[] {
  const g: GraphicPrimitive[] = [];
  for (const y of [100, 140, 180]) g.push(stroke(50, y, 250, y, 0.5));
  for (const x of [50, 150, 250]) g.push(stroke(x, 100, x, 180, 0.5));
  return g;
}

function fourCellLines(): ProjectedLine[] {
  return [
    line("a", 90, 115, 10, 10),
    line("b", 190, 115, 10, 10),
    line("c", 90, 155, 10, 10),
    line("d", 190, 155, 10, 10),
  ];
}

describe("ruled-grid helpers beyond the Rust unit tests", () => {
  test("flattenHeaderBand joins a colspan band into one header row", () => {
    const cells = [
      rows([["North", "America", "", ""]])[0],
      rows([["Rev", "Units", "Rev", "Units"]])[0],
      rows([["a", "b", "c", "d"]])[0],
    ];
    const has = [
      [true, true, false, false],
      [true, true, true, true],
      [true, true, true, true],
    ];
    const repl = rows([
      ["North America", "North America", "", ""],
      ["Rev", "Units", "Rev", "Units"],
      ["a", "b", "c", "d"],
    ]);
    const flat = flattenHeaderBand(cells, has, repl, [true, false, false], 3, 4);
    expect(flat?.[1]).toBe(2);
    expect(flat?.[0].map((c) => c.text)).toEqual([
      "North America Rev",
      "North America Units",
      "Rev",
      "Units",
    ]);
  });

  test("flattenHeaderBand refuses an anchor row that holds measurement values", () => {
    const cells = rows([
      ["North", "America"],
      ["1.5", "2.5"],
      ["a", "b"],
    ]);
    const has = [
      [true, true],
      [true, true],
      [true, true],
    ];
    expect(flattenHeaderBand(cells, has, cells, [true, false, false], 3, 2)).toBeNull();
  });

  test("mergeStackedHeader folds sparse thin rows into one header row", () => {
    const cells = rows([
      ["Rated", "", ""],
      ["", "Voltage", "(VDC)"],
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
    const has = [
      [true, false, false],
      [false, true, true],
      [true, true, true],
      [true, true, true],
    ];
    const bold = has.map((r) => r.map(() => true));
    const [outCells, , , nRows, merged] = mergeStackedHeader(
      cells,
      has,
      bold,
      4,
      3,
      [7, 7, 22, 22],
      false
    );
    expect(merged).toBe(true);
    expect(nRows).toBe(3);
    expect(rowTexts(outCells)).toEqual([
      ["Rated", "Voltage", "(VDC)"],
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
  });

  test("splitComponentAtGridGaps cuts two tables stacked in one column", () => {
    const ys = [0, 10, 20, 100, 110, 120];
    const hs: HSeg[] = ys.map((y) => ({ x_min: 0, x_max: 50, y }));
    const vs: VSeg[] = [
      { x: 0, y_min: 0, y_max: 20 },
      { x: 50, y_min: 0, y_max: 20 },
      { x: 0, y_min: 100, y_max: 120 },
      { x: 50, y_min: 100, y_max: 120 },
    ];
    const bands = splitComponentAtGridGaps(hs, vs, vs, [0, 1, 2, 3, 4, 5], [0, 1, 2, 3]);
    expect(bands.map((b) => b.h_idx)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
    ]);
    expect(bands.map((b) => b.v_idx)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  test("splitComponentAtGridGaps keeps a component whose vertical spans the gap", () => {
    const ys = [0, 10, 20, 100, 110, 120];
    const hs: HSeg[] = ys.map((y) => ({ x_min: 0, x_max: 50, y }));
    const vs: VSeg[] = [{ x: 0, y_min: 0, y_max: 120 }];
    expect(splitComponentAtGridGaps(hs, vs, vs, [0, 1, 2, 3, 4, 5], [0]).length).toBe(1);
  });

  test("detectRuledTablesGlobal reports the consumed line indices", () => {
    const runs = detectRuledTablesGlobal(fourCellLines(), extractRuleSegments(grid2x2()), 612, 792);
    expect(runs.length).toBe(1);
    expect(runs[0][1]).toEqual([0, 1, 2, 3]);
  });

  test("bucketWordsIntoColumns puts each word in the column holding its centre", () => {
    const span = textItem({
      text: "alpha beta",
      x: 60,
      width: 120,
      words: [
        { text: "alpha", x: 60, y: 0, width: 20, height: 10 },
        { text: "beta", x: 160, y: 0, width: 20, height: 10 },
      ],
    });
    expect(bucketWordsIntoColumns(span, [50, 150, 250])).toEqual([
      [0, "alpha"],
      [1, "beta"],
    ]);
    expect(bucketWordsIntoColumns(span, [50, 250, 300])).toBeNull();
  });

  test("clusterBoundaries averages chains and dedupClose keeps the first", () => {
    const v = [10, 14, 40, 100, 103, 106];
    clusterBoundaries(v, 6);
    expect(v).toEqual([12, 40, 103]);
    const d = [10, 11, 20, 21, 22];
    dedupClose(d, 2);
    expect(d).toEqual([10, 20]);
  });

  test("findBucket returns null outside the boundaries", () => {
    expect(findBucket([0, 10, 20], 25)).toBeNull();
    expect(findBucket([0, 10, 20], 10)).toBe(0);
    expect(findBucket([0], 0)).toBeNull();
  });
});
