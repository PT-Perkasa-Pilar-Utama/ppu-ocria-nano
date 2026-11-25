// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama

// Decoding logits into tables and grids (liteparse crates/liteparse/src/table_model/decode.rs,
// crates-v2.21.2) on logits built from a known layout: the
// goldens hold four tables, and these reach the branches they do not.

import { describe, expect, test } from "bun:test";

import type { DUnit } from "../../src/ocria/table-model/decode.js";
import {
  decodeTables,
  defaultDecodeOptions,
  isCaption,
} from "../../src/ocria/table-model/decode.js";
import { spanLink } from "../../src/ocria/table-model/decode-link.js";
import { decodeGrid } from "../../src/ocria/table-model/decode-grid.js";
import type { Logits } from "../../src/ocria/table-model/net.js";

const opt = defaultDecodeOptions();

/** What a unit is in the layout the logits describe. */
type Truth = { inTable: boolean; header?: boolean; row: number; col: number; cell?: number };

/** Logits that say what `truth` says: +6 where two units share the property, -6 where they do not. */
function logitsOf(truth: readonly Truth[], inTableLogit = 5): Logits {
  const n = truth.length;
  const node = new Float32Array(n * 2);
  const pair = new Float32Array(4 * n * n);
  truth.forEach((t, i) => {
    node[i * 2] = t.inTable ? inTableLogit : -0.5;
    node[i * 2 + 1] = t.header ? 5 : -5;
    truth.forEach((u, j) => {
      const both = t.inTable && u.inTable;
      pair[i * n + j] = both ? 6 : -6;
      pair[(1 * n + i) * n + j] = t.row === u.row ? 6 : -6;
      pair[(2 * n + i) * n + j] = t.col === u.col ? 6 : -6;
      const cell = t.cell ?? i * 1000 + 7;
      const other = u.cell ?? j * 1000 + 7;
      pair[(3 * n + i) * n + j] = cell === other ? 6 : -6;
    });
  });
  return { n, node, pair, cls: new Float32Array(0), n_cls: 0, n_pair: 4 };
}

const unit = (text: string, x: number, y: number, w = 40, h = 10): DUnit => ({
  bx: [x, y, x + w, y + h],
  text,
  h,
});

/** A r x c table of units `Rr Cc` at a 30-point row pitch and a 60-point column pitch. */
function table(rows: number, cols: number, y0 = 100): Array<[DUnit, Truth]> {
  const out: Array<[DUnit, Truth]> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push([unit(`R${r}C${c}`, 50 + c * 60, y0 + r * 30), { inTable: true, row: r, col: c }]);
    }
  }
  return out;
}

const split = (cells: Array<[DUnit, Truth]>): [DUnit[], Truth[]] => [
  cells.map((c) => c[0]),
  cells.map((c) => c[1]),
];

describe("decode_tables", () => {
  test("a table and the grid it reads as", () => {
    const [units, truth] = split(table(4, 3));
    const l = logitsOf(truth);
    const groups = decodeTables(units, l, opt);
    expect(groups).toEqual([units.map((_, i) => i)]);
    const g = decodeGrid(units, groups[0], l, opt);
    expect([g.n_rows, g.n_cols, g.cells.length]).toEqual([4, 3, 12]);
    expect(g.cells.find((c) => c.r0 === 2 && c.c0 === 1)?.text).toBe("R2C1");
    expect(decodeGrid(units, [], l, opt)).toEqual({
      cells: [],
      head_rows: [],
      n_rows: 0,
      n_cols: 0,
    });
    expect(
      decodeTables(units, logitsOf(truth.map((t) => ({ ...t, inTable: false }))), opt)
    ).toEqual([]);
  });

  test("a header line above the table joins it, a caption does not", () => {
    const body = table(3, 3, 100);
    const head: Array<[DUnit, Truth]> = [0, 1, 2].map((c) => [
      unit(`Head${c}`, 50 + c * 60, 70),
      { inTable: false, header: true, row: -1, col: c },
    ]);
    const [units, truth] = split([...head, ...body]);
    const l = logitsOf(truth);
    const g = decodeTables(units, l, opt);
    expect(g.length).toBe(1);
    expect(g[0].length).toBe(12);
    expect(decodeGrid(units, g[0], l, opt).head_rows).toEqual([0]);
    // the same line read as a caption stays out
    const capt = head.map(([u, t]): [DUnit, Truth] => [{ ...u, text: `Table ${u.text}` }, t]);
    const [u2, t2] = split([...capt, ...body]);
    expect(decodeTables(u2, logitsOf(t2), opt)[0].length).toBe(9);
    // without the head band option the header line stays out as well
    expect(decodeTables(units, l, { ...opt, head_band: false })[0].length).toBe(9);
  });

  test("a stray unit inside the table's box joins it", () => {
    const [units, truth] = split([
      ...table(3, 3),
      [unit("stray", 110, 130, 10, 10), { inTable: false, row: 9, col: 9 }],
    ]);
    const g = decodeTables(units, logitsOf(truth), opt);
    expect(g[0]).toContain(9);
  });

  test("pieces stacked and lined up merge, a small group inside a table's box joins it", () => {
    const upper = table(3, 3, 100);
    const lower: Array<[DUnit, Truth]> = [0, 1, 2].map((c) => [
      unit(`L${c}`, 50 + c * 60, 200),
      { inTable: true, row: 5, col: c },
    ]);
    // `upper` and `lower` are two groups: no same_table link between them
    const [units, truth] = split([...upper, ...lower]);
    const l = logitsOf(truth);
    const n = units.length;
    for (let i = 0; i < 9; i++) {
      for (let j = 9; j < n; j++) {
        l.pair[i * n + j] = -6;
        l.pair[j * n + i] = -6;
      }
    }
    const merged = decodeTables(units, l, opt);
    expect(merged.length).toBe(1);
    expect(merged[0].length).toBe(12);
    // a pair of units inside the big box, linked to each other only
    const inside: Array<[DUnit, Truth]> = [
      [unit("in1", 60, 125, 30, 10), { inTable: true, row: 7, col: 7 }],
      [unit("in2", 100, 125, 30, 10), { inTable: true, row: 7, col: 8 }],
    ];
    const [u3, t3] = split([...upper, ...inside]);
    const l3 = logitsOf(t3);
    for (let i = 0; i < 9; i++) {
      for (let j = 9; j < 11; j++) {
        l3.pair[i * 11 + j] = -6;
        l3.pair[j * 11 + i] = -6;
      }
    }
    const joined = decodeTables(u3, l3, opt);
    expect(joined.length).toBe(1);
    expect(joined[0].length).toBe(11);
  });

  test("captions as tn_core reads them", () => {
    for (const t of [
      "Table 1",
      "  tables of",
      "FIG.2",
      "Figures",
      "Source: x",
      "note",
      "Exhibit A",
      "Chart-1",
      "Notes",
      "Sources",
    ]) {
      expect(isCaption(t), t).toBe(true);
    }
    // "fig." then a space has no word boundary after the dot, as in the regular expression
    for (const t of ["Tablet", "Notebook", "figs", "", "Tab", "chartreuse", "FIG. 2"]) {
      expect(isCaption(t), t).toBe(false);
    }
  });
});

describe("span_link", () => {
  test("a unit positive with two groups that disagree joins the group it likes best", () => {
    // units 0, 1 and 2, 3 are two groups; unit 4 is a little positive with 0 and 2 and
    // clearly negative with 1 and 3, so no group is positive on average
    const n = 5;
    const p = new Float64Array(n * n);
    const set = (a: number, b: number, v: number): void => {
      p[a * n + b] = v;
      p[b * n + a] = v;
    };
    set(0, 1, 4);
    set(2, 3, 4);
    set(0, 2, -4);
    set(0, 3, -4);
    set(1, 2, -4);
    set(1, 3, -4);
    set(4, 0, 0.1);
    set(4, 2, 0.1);
    set(4, 1, -5);
    set(4, 3, -5);
    expect(spanLink(p, n)).toEqual([
      [0, 1, 4],
      [2, 3],
    ]);
    // a bridging unit positive on average with both groups spans them
    set(4, 1, 5);
    set(4, 3, 5);
    expect(spanLink(p, n)).toEqual([
      [0, 1, 4],
      [2, 3, 4],
    ]);
  });
});

describe("decode_grid", () => {
  test("stacked lines of one cell are forced together", () => {
    const body = table(2, 2);
    // a second line under R0C0, in the same row and column but not linked as one cell
    const two: Array<[DUnit, Truth]> = [
      [unit("again", 50, 111), { inTable: true, row: 0, col: 0, cell: 99 }],
    ];
    const [units, truth] = split([...body, ...two]);
    const l = logitsOf(truth);
    const g = decodeGrid(
      units,
      units.map((_, i) => i),
      l,
      opt
    );
    expect(g.cells.find((c) => c.r0 === 0 && c.c0 === 0)?.text).toBe("R0C0 again");
    // the forced pair is also a positive cell logit, so linkage alone joins it too
    const free = decodeGrid(
      units,
      units.map((_, i) => i),
      l,
      { ...opt, forced_link: false }
    );
    expect(free.cells.length).toBe(g.cells.length);
  });

  test("a near-empty column folds into its neighbour, header cells moving to the open slot", () => {
    // three columns; the middle one holds "%" beside R1C0 and a lone header mark
    const body = table(3, 3);
    const units: DUnit[] = body.map((b) => b[0]);
    const truth: Truth[] = body.map((b) => b[1]);
    // column 1 has no units except one: drop R0C1 and R2C1, keep R1C1 as the "%"
    const keep = body.map((_, i) => ![1, 7].includes(i) && !(i % 3 === 1 && i !== 4));
    const us = units.filter((_, i) => keep[i]);
    const ts = truth.filter((_, i) => keep[i]);
    us[us.findIndex((u) => u.text === "R1C1")] = unit("%", 50 + 40, 130, 8, 10);
    const l = logitsOf(ts);
    const g = decodeGrid(
      us,
      us.map((_, i) => i),
      l,
      opt
    );
    expect(g.n_cols).toBe(2);
    expect(g.cells.find((c) => c.r0 === 1 && c.c0 === 0)?.text).toBe("R1C0 %");
    expect(
      decodeGrid(
        us,
        us.map((_, i) => i),
        l,
        { ...opt, squeeze: false }
      ).n_cols
    ).toBe(3);
  });

  test("a wrapped line folds into the row above, a header wrap into its header", () => {
    const body = table(4, 2);
    const wrap: Array<[DUnit, Truth]> = [
      [unit("wrapped", 50, 140, 40, 10), { inTable: true, row: 1.5, col: 0 }],
    ];
    const [units, truth] = split([...body, ...wrap]);
    const g = decodeGrid(
      units,
      units.map((_, i) => i),
      logitsOf(truth),
      opt
    );
    expect(g.n_rows).toBe(4);
    expect(g.cells.find((c) => c.r0 === 1 && c.c0 === 0)?.text).toBe("R1C0 wrapped");
    expect(
      decodeGrid(
        units,
        units.map((_, i) => i),
        logitsOf(truth),
        { ...opt, fold_wraps: false }
      ).n_rows
    ).toBe(5);
  });

  test("a unit over two columns is a spanning cell", () => {
    const body = table(3, 2, 130);
    const title: Array<[DUnit, Truth]> = [
      [unit("Title", 50, 100, 100), { inTable: true, row: -1, col: -1 }],
    ];
    const [units, truth] = split([...title, ...body]);
    const l = logitsOf(truth);
    const n = units.length;
    // the title shares a column with both of the others
    for (let j = 1; j < n; j++) {
      l.pair[(2 * n + 0) * n + j] = 6;
      l.pair[(2 * n + j) * n + 0] = 6;
    }
    const g = decodeGrid(
      units,
      units.map((_, i) => i),
      l,
      opt
    );
    const t = g.cells.find((c) => c.text === "Title");
    expect([t?.r0, t?.c0, t?.c1]).toEqual([0, 0, 1]);
    expect(g.n_cols).toBe(2);
  });
});
