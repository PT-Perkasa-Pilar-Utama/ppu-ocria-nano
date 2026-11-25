// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/decode.rs (crates-v2.21.2, Apache-2.0): decoding one table's grid.

// `decodeGrid`: one table's cells (same_cell, with stacked row-and-column pairs forced together),
// rows and columns over cells (span-aware linkage), header rows, the near-empty column fold.

import { f32, trim } from "../rust.js";
import { bboxOf, CELL_MARGIN, GATE, medianH, STACK_GAP, STACK_GAP_HDR } from "./decode.js";
import type { DecodeOptions, DUnit } from "./decode.js";
import { foldHeaderWraps, foldWrappedRows } from "./decode-fold.js";
import { avgLink, readingOrder, spanLink } from "./decode-link.js";
import type { Logits } from "./net.js";
import { logitNode, logitPair } from "./net.js";
import type { Grid, GridCell } from "./types.js";
import type { Box4 } from "./units.js";

/** Fold near-empty columns into their nearest neighbour (tn_core._squeeze, column rule). Returns the new column count. */
function squeezeCols(
  cells: GridCell[],
  head: readonly number[],
  nColsIn: number,
  hh: number
): number {
  let nCols = nColsIn;
  let changed = true;
  while (changed && nCols >= 3) {
    changed = false;
    for (let q = 0; q < nCols; q++) {
      const col: number[] = [];
      cells.forEach((c, k) => {
        if (c.c0 === q && c.c1 === q && c.text !== "") col.push(k);
      });
      if (col.filter((k) => !head.includes(cells[k].r0)).length > 1) continue;
      const boxes = col.map((k) => cells[k].bx);
      let best: [number, number] | null = null;
      for (const t of [q - 1, q + 1]) {
        if (t < 0 || t >= nCols) continue;
        const nb = cells
          .filter((x) => x.c0 <= t && t <= x.c1 && x.c0 === x.c1 && x.text !== "")
          .map((x) => x.bx);
        if (boxes.length === 0 || nb.length === 0) continue;
        let gap = Infinity;
        for (const b of boxes) {
          for (const nn of nb) gap = Math.min(gap, Math.max(b[0] - nn[2], nn[0] - b[2], 0));
        }
        if (gap < 1.5 * hh && (best === null || gap < best[0])) best = [gap, t];
      }
      if (best !== null) {
        foldCol(cells, q, best[1]);
        nCols -= 1;
        changed = true;
        break;
      }
    }
  }
  return nCols;
}

function foldCol(cells: GridCell[], k: number, t: number): void {
  const movers: number[] = [];
  cells.forEach((c, i) => {
    if (c.c0 === k && c.c1 === k) movers.push(i);
  });
  const remove: number[] = [];
  for (const xi of movers) {
    const r = cells[xi].r0;
    const j = cells.findIndex((c) => c.r0 <= r && r <= c.r1 && c.c0 <= t && t <= c.c1);
    if (j >= 0 && j !== xi) {
      if (cells[xi].text !== "") {
        const joined =
          t < k ? `${cells[j].text} ${cells[xi].text}` : `${cells[xi].text} ${cells[j].text}`;
        cells[j].text = trim(joined);
      }
      remove.push(xi);
    } else {
      cells[xi].c0 = t;
      cells[xi].c1 = t;
    }
  }
  remove.sort((a, b) => a - b);
  for (const i of remove.reverse()) cells.splice(i, 1);
  for (const x of cells) {
    if (x.c0 <= k && k <= x.c1 && x.c0 < x.c1) {
      x.c1 -= 1;
    } else if (x.c0 > k) {
      x.c0 -= 1;
      x.c1 -= 1;
    }
  }
}

function root(parent: number[], k: number): number {
  while (parent[k] !== k) {
    parent[k] = parent[parent[k]];
    k = parent[k];
  }
  return k;
}

/** Cells as groups of unit positions (into `idx`): same_cell links, then stacked pairs forced together. */
function cellGroups(
  units: readonly DUnit[],
  idx: readonly number[],
  l: Logits,
  opt: DecodeOptions
): number[][] {
  const m = idx.length;
  const bxs = idx.map((i): [number, number, number, number] => {
    const b = units[i].bx;
    return [f32(b[0]), f32(b[1]), f32(b[2]), f32(b[3])];
  });
  const hh = bxs.map((b) => Math.max(f32(b[3] - b[1]), f32(1e-3)));
  const pr = (k: number, a: number, b: number): number => logitPair(l, k, idx[a], idx[b]);
  // cell logits: same_cell, or for stacked neighbours the weaker of same_row / same_col - margin
  const cellP = new Float64Array(m * m);
  const forced = new Uint8Array(m * m);
  for (let a = 0; a < m; a++) {
    for (let b = 0; b < m; b++) {
      const vgap = Math.max(f32(bxs[b][1] - bxs[a][3]), f32(bxs[a][1] - bxs[b][3]));
      const xov = f32(Math.min(bxs[a][2], bxs[b][2]) - Math.max(bxs[a][0], bxs[b][0]));
      const bothHdr = logitNode(l, idx[a], 1) > 0 && logitNode(l, idx[b], 1) > 0;
      const lim = (bothHdr ? STACK_GAP_HDR : STACK_GAP) * Math.min(hh[a], hh[b]);
      const stacked = vgap < lim && vgap > f32(f32(-0.5) * hh[a]) && xov > 0;
      const f = stacked ? f32(Math.min(pr(1, a, b), pr(2, a, b)) - CELL_MARGIN) : -Infinity;
      forced[a * m + b] = f > 0 ? 1 : 0;
      cellP[a * m + b] = Math.max(pr(3, a, b), f);
    }
  }
  let cells = avgLink(cellP, m, 0);
  if (opt.forced_link && cells.length > 1) {
    const of = Array.from({ length: m }, () => 0);
    cells.forEach((g, k) => {
      for (const i of g) of[i] = k;
    });
    const parent = cells.map((_, i) => i);
    for (let a = 0; a < m; a++) {
      for (let b = 0; b < m; b++) {
        if (forced[a * m + b] === 1) {
          const ra = root(parent, of[a]);
          const rb = root(parent, of[b]);
          if (ra !== rb) parent[ra] = rb;
        }
      }
    }
    const keys: number[] = [];
    const merged: number[][] = [];
    cells.forEach((g, k) => {
      const r = root(parent, k);
      const p = keys.indexOf(r);
      if (p >= 0) {
        merged[p].push(...g);
      } else {
        keys.push(r);
        merged.push([...g]);
      }
    });
    for (const g of merged) g.sort((a, b) => a - b);
    cells = merged;
  }
  return cells;
}

/** One table's grid from its units (global indices `idx`) and the row / col / cell heads. */
export function decodeGrid(
  units: readonly DUnit[],
  idx: readonly number[],
  l: Logits,
  opt: DecodeOptions
): Grid {
  const m = idx.length;
  if (m === 0) return { cells: [], head_rows: [], n_rows: 0, n_cols: 0 };
  const cells = cellGroups(units, idx, l, opt);
  const nc = cells.length;
  const cb = cells.map((g) =>
    bboxOf(
      units,
      g.map((i) => idx[i])
    )
  );
  // cell-pair logits on an axis: the mean of their unit pairs, minus GATE without overlap
  const cellLogits = (k: number, lo: number, hi: number): Float64Array => {
    const out = new Float64Array(nc * nc);
    for (let a = 0; a < nc; a++) {
      for (let b = a + 1; b < nc; b++) {
        let s = 0;
        for (const i of cells[a]) {
          for (const j of cells[b]) s += logitPair(l, k, idx[i], idx[j]);
        }
        let v = s / (cells[a].length * cells[b].length);
        if (Math.min(cb[a][hi], cb[b][hi]) - Math.max(cb[a][lo], cb[b][lo]) <= 0) v -= GATE;
        out[a * nc + b] = v;
        out[b * nc + a] = v;
      }
    }
    return out;
  };
  const rows = nc > 1 ? spanLink(cellLogits(1, 1, 3), nc) : [[0]];
  const cols = nc > 1 ? spanLink(cellLogits(2, 0, 2), nc) : [[0]];
  const meanOf = (g: readonly number[], f: (k: number) => number): number =>
    g.reduce((s, k) => s + f(k), 0) / g.length;
  const ycen = (k: number): number => (cb[k][1] + cb[k][3]) / 2;
  const xcen = (k: number): number => (cb[k][0] + cb[k][2]) / 2;
  rows.sort((a, b) => meanOf(a, ycen) - meanOf(b, ycen));
  cols.sort((a, b) => meanOf(a, xcen) - meanOf(b, xcen));
  const rIn: number[][] = cells.map(() => []);
  const cIn: number[][] = cells.map(() => []);
  rows.forEach((g, k) => {
    for (const c of g) rIn[c].push(k);
  });
  cols.forEach((g, k) => {
    for (const c of g) cIn[c].push(k);
  });
  const nRows0 = rows.length;
  const nCols0 = cols.length;
  const placed: GridCell[] = [];
  const owner = new Int32Array(nRows0 * nCols0).fill(-1); // slot -> index in `placed`
  const rmin = (c: number): number => Math.min(...rIn[c]);
  const cmin = (c: number): number => Math.min(...cIn[c]);
  const order = cells.map((_, i) => i);
  order.sort((a, b) => rmin(a) - rmin(b) || cmin(a) - cmin(b));
  for (const c of order) {
    let r0 = rmin(c);
    let r1 = Math.max(...rIn[c]);
    let c0 = cmin(c);
    let c1 = Math.max(...cIn[c]);
    const boxes = cells[c].map((i): Box4 => units[idx[i]].bx);
    const text = readingOrder(boxes)
      .map((k) => units[idx[cells[c][k]]].text)
      .join(" ");
    const span: Array<[number, number]> = [];
    for (let r = r0; r <= r1; r++) {
      for (let q = c0; q <= c1; q++) span.push([r, q]);
    }
    if (span.some(([r, q]) => owner[r * nCols0 + q] !== -1)) {
      const free = span.find(([r, q]) => owner[r * nCols0 + q] === -1);
      if (free !== undefined) {
        [r0, c0] = free;
        r1 = r0;
        c1 = c0;
      } else {
        const o = owner[r0 * nCols0 + c0];
        placed[o].text = `${placed[o].text} ${text}`;
        continue;
      }
    }
    const pi = placed.length;
    placed.push({ r0, c0, r1, c1, text, bx: [...cb[c]] });
    for (let r = r0; r <= r1; r++) {
      for (let q = c0; q <= c1; q++) owner[r * nCols0 + q] = pi;
    }
  }
  const headRows: number[] = [];
  rows.forEach((g, k) => {
    const us = g.flatMap((c) => cells[c]);
    const pos = us.filter((i) => logitNode(l, idx[i], 1) > 0).length;
    if (pos / us.length > 0.5) headRows.push(k);
  });
  let nCols = nCols0;
  if (opt.squeeze) nCols = squeezeCols(placed, headRows, nCols, medianH(units, idx));
  let nRows = nRows0;
  if (opt.fold_wraps) {
    nRows = foldWrappedRows(placed, headRows, nRows);
    nRows = foldHeaderWraps(placed, headRows, nRows);
  }
  return { cells: placed, head_rows: headRows, n_rows: nRows, n_cols: nCols };
}
