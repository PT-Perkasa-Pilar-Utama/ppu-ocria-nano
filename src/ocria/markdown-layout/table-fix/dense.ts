// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/table_fix.rs (crates-v2.21.2, Apache-2.0): the dense grid.

import type { Rect } from "../../types/geometry.js";
import type { SpanCell } from "../block-types.js";

/** A cell on the dense grid: top-left slot, spans, text, box. */
export type DCell = {
  r0: number;
  c0: number;
  rs: number;
  cs: number;
  text: string;
  bbox: Rect | null;
};

export type Dense = { cells: DCell[]; n_rows: number; n_cols: number; header_rows: number };

function cloneRect(r: Rect | null): Rect | null {
  return r == null ? null : { ...r };
}

/** Place cells HTML-style: each row's cells fill the next free slots left to right. */
export function fromSpanRows(
  rows: readonly (readonly SpanCell[])[],
  headerRows: number
): Dense | null {
  const nRows = rows.length;
  if (nRows === 0) return null;
  const occ: boolean[][] = rows.map(() => []);
  const cells: DCell[] = [];
  for (let r = 0; r < rows.length; r++) {
    let c = 0;
    for (const sc of rows[r]) {
      while (occ[r][c] ?? false) c++;
      const rs = Math.max(sc.rowspan, 1);
      const cs = Math.max(sc.colspan, 1);
      for (let rr = r; rr < Math.min(r + rs, nRows); rr++) {
        while (occ[rr].length < c + cs) occ[rr].push(false);
        for (let cc = c; cc < c + cs; cc++) occ[rr][cc] = true;
      }
      cells.push({
        r0: r,
        c0: c,
        rs: Math.min(rs, nRows - r),
        cs,
        text: sc.text,
        bbox: cloneRect(sc.bbox),
      });
      c += cs;
    }
  }
  const nCols = Math.max(0, ...occ.map((o) => o.length));
  if (nCols === 0) return null;
  // ragged rows: fill missing slots with empty cells so every slot has an owner
  for (let r = 0; r < occ.length; r++) {
    for (let c = 0; c < nCols; c++) {
      if (!(occ[r][c] ?? false)) cells.push({ r0: r, c0: c, rs: 1, cs: 1, text: "", bbox: null });
    }
  }
  return { cells, n_rows: nRows, n_cols: nCols, header_rows: Math.min(headerRows, nRows) };
}

export function toSpanRows(d: Dense): [SpanCell[][], number] {
  const rows: Array<Array<[number, SpanCell]>> = Array.from({ length: d.n_rows }, () => []);
  for (const c of d.cells) {
    rows[c.r0].push([
      c.c0,
      {
        text: c.text,
        colspan: c.cs,
        rowspan: c.rs,
        bbox: cloneRect(c.bbox),
        text_item_indices: [],
      },
    ]);
  }
  const out = rows.map((r) => r.sort((a, b) => a[0] - b[0]).map(([, s]) => s));
  return [out, d.header_rows];
}

/** Index of the cell covering slot (r, c). */
export function at(d: Dense, r: number, c: number): number | null {
  const k = d.cells.findIndex((x) => x.r0 <= r && r < x.r0 + x.rs && x.c0 <= c && c < x.c0 + x.cs);
  return k < 0 ? null : k;
}

/** Index of the 1x1 cell at (r, c), if the slot holds one. */
export function single(d: Dense, r: number, c: number): number | null {
  const k = at(d, r, c);
  return k != null && d.cells[k].rs === 1 && d.cells[k].cs === 1 ? k : null;
}

/** Delete row r (its own cells go; spans through it shrink; rows below move up). */
export function removeRow(d: Dense, r: number): void {
  d.cells = d.cells.filter((x) => !(x.r0 === r && x.rs === 1));
  for (const x of d.cells) {
    if (x.r0 > r) x.r0 -= 1;
    else if (x.r0 + x.rs > r) x.rs -= 1;
  }
  d.n_rows -= 1;
}
