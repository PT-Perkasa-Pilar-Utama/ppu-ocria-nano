// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/units.rs (crates-v2.21.2, Apache-2.0): split_aligned.

import {
  asInt,
  isLowercase,
  isNumeric,
  roundTiesEven,
  chars as charsOf,
  charCount,
} from "../rust.js";
import type { Unit, UnitWord } from "./units.js";

/** `rows` of a split: a row key (unit centre over the run's height, rounded) and its body cells. */
type Row = [number, Unit[]];

/**
 * The body cells near unit `i`, grouped into rows: short units (4 words at most) within the run's
 * span (a page header, caption or prose line of a neighbouring column is no cell).
 */
function bodyRows(i: number, units: readonly Unit[], h: number, tol: number): Row[] {
  const u = units[i];
  const [x0, y0, x1, y1] = u.bx;
  const cy = (v: Unit): number => (v.bx[1] + v.bx[3]) / 2;
  const rows: Row[] = [];
  for (let j = 0; j < units.length; j++) {
    const v = units[j];
    const near =
      j !== i &&
      v.q === u.q &&
      !v.minor &&
      v.bx[0] < x1 + 2 * h &&
      v.bx[2] > x0 - 2 * h &&
      ((y1 - 0.2 * h <= v.bx[1] && v.bx[1] <= y1 + 6 * h) ||
        (y0 - 6 * h <= v.bx[3] && v.bx[3] <= y0 + 0.2 * h));
    const nw = v.words.length === 0 ? 1 : v.words.length;
    if (
      near &&
      nw <= 4 &&
      v.bx[2] - v.bx[0] < 0.6 * (x1 - x0) &&
      v.bx[0] >= x0 - tol &&
      v.bx[2] <= x1 + 2 * h
    ) {
      const key = asInt(roundTiesEven(cy(v) / h));
      const row = rows.find((r) => r[0] === key);
      if (row) row[1].push(v);
      else rows.push([key, [v]]);
    }
  }
  return rows;
}

/**
 * Cut points over `words` (indices into it, from 0 to `words.length`) at every gutter, then with
 * each unaligned piece folded into an aligned merge. Null when a piece cannot be aligned.
 */
function foldedCuts(
  words: readonly UnitWord[],
  aligned: (a: number, b: number) => boolean,
  gutter: (mid: number) => boolean
): number[] | null {
  const cuts: number[] = [0];
  for (let k = 1; k < words.length; k++) {
    if (gutter((words[k - 1][1] + words[k][0]) / 2)) cuts.push(k);
  }
  cuts.push(words.length);
  // pieces as consecutive cut pairs; fold unaligned pieces into an aligned merge
  while (cuts.length >= 3) {
    const n = cuts.length - 1;
    let bad = -1;
    for (let p = 0; p < n; p++) {
      if (!aligned(cuts[p], cuts[p + 1])) {
        bad = p;
        break;
      }
    }
    if (bad < 0) break;
    if (bad > 0 && aligned(cuts[bad - 1], cuts[bad + 1])) cuts.splice(bad, 1);
    else if (bad + 1 < n && aligned(cuts[bad], cuts[bad + 2])) cuts.splice(bad + 1, 1);
    else return null;
  }
  return cuts;
}

function alignedPieces(i: number, units: readonly Unit[]): Unit[] | null {
  const u = units[i];
  const [, y0, , y1] = u.bx;
  const h = Math.max(u.h, 1);
  const tol = Math.max(0.25 * h, 1.5);
  const cy = (v: Unit): number => (v.bx[1] + v.bx[3]) / 2;
  // the body must look tabular: 2+ rows holding 2+ units each, or one row of 3+
  const rows = bodyRows(i, units, h, tol);
  const tab = rows.map((r) => r[1]).filter((r) => r.length >= 2);
  // a lone body row must be 3+ cells, mostly numbers or short marks ("N/A", "-")
  const datum = (v: Unit): boolean =>
    Array.from(v.text).some((c) => isNumeric(c)) || charCount(v.text) <= 3;
  const loneOk =
    tab.length === 1 && tab[0].length >= 3 && 2 * tab[0].filter(datum).length > tab[0].length;
  if (!(tab.length >= 2 || loneOk)) return null;
  const cells = tab.flat();
  // a column edge: shared by cells of two rows (any cell's edge, when one row is the body)
  const anchors = (f: (v: Unit) => number): number[] => {
    const vals = cells.map((v): [number, number] => [f(v), cy(v)]);
    if (tab.length === 1) return vals.map((x) => x[0]);
    return vals
      .filter(([a, ya]) =>
        vals.some(([b, yb]) => Math.abs(a - b) <= tol && Math.abs(ya - yb) > 0.5 * h)
      )
      .map((x) => x[0]);
  };
  const lefts = anchors((v) => v.bx[0]);
  const rights = anchors((v) => v.bx[2]);
  const mids = anchors((v) => (v.bx[0] + v.bx[2]) / 2);
  const words = u.words;
  // a piece is a word range [a, b)
  const aligned = (a: number, b: number): boolean => {
    const l = words[a][0];
    const r = words[b - 1][1];
    return (
      lefts.some((x) => Math.abs(l - x) <= tol) ||
      rights.some((x) => Math.abs(r - x) <= tol) ||
      mids.some((x) => Math.abs((l + r) / 2 - x) <= tol)
    );
  };
  // no cell crosses mid, and every body row holding cells on both sides leaves a wide (2+ glyph
  // heights) gap there, in two rows at least: a gutter runs down the table, while justified
  // prose cut into pieces has its wide gaps strewn
  const gutter = (mid: number): boolean => {
    if (cells.some((v) => v.bx[0] < mid && mid < v.bx[2])) return false;
    let spans = 0;
    for (const r of tab) {
      const left = r
        .filter((v) => v.bx[2] <= mid)
        .reduce((m, v) => Math.max(m, v.bx[2]), -Infinity);
      const right = r
        .filter((v) => v.bx[0] >= mid)
        .reduce((m, v) => Math.min(m, v.bx[0]), Infinity);
      if (Number.isFinite(left) && Number.isFinite(right)) {
        if (right - left < 2 * h) return false;
        spans += 1;
      }
    }
    return spans >= Math.min(tab.length, 2);
  };
  const cuts = foldedCuts(words, aligned, gutter);
  if (cuts === null) return null;
  const n = cuts.length - 1;
  if (n < 2 || cuts.slice(0, n).some((c, p) => cuts[p + 1] - c > 5)) return null;
  // a piece opening in lower case continues a sentence ("kind of information | than we do")
  for (let p = 1; p < n; p++) {
    const first = charsOf(words[cuts[p]][2])[0];
    if (first !== undefined && isLowercase(first)) return null;
  }
  // each piece over its own column: no cell lies under two pieces
  for (const v of cells) {
    let over = 0;
    for (let p = 0; p < n; p++) {
      if (Math.min(v.bx[2], words[cuts[p + 1] - 1][1]) > Math.max(v.bx[0], words[cuts[p]][0]))
        over += 1;
    }
    if (over > 1) return null;
  }
  const out: Unit[] = [];
  for (let p = 0; p < n; p++) {
    const ws = words.slice(cuts[p], cuts[p + 1]);
    out.push({
      bx: [ws[0][0], y0, ws[ws.length - 1][1], y1],
      pbox: [ws[0][0], y0, ws[ws.length - 1][1], y1],
      text: ws.map((w) => w[2]).join(" "),
      h: u.h,
      size: u.size,
      bold: u.bold,
      q: u.q,
      minor: u.minor,
      words: ws,
    });
  }
  return out;
}

/**
 * A header row PDFium emits as one run ("Saccharometer DI Water Glucose Solution ...") splits
 * where its words line up with the table body: cut at every gap no nearby table cell crosses (a
 * gutter), then fold back every piece whose left, centre or right edge matches no column edge
 * shared by two body cells. Kept only when it leaves 2+ aligned pieces of at most 5 words
 * (units.py `_split_aligned`).
 */
export function splitAligned(units: readonly Unit[]): Unit[] {
  const out: Unit[] = [];
  units.forEach((u, i) => {
    const pieces =
      !u.minor && u.words.length >= 2 && u.words.length <= 16 ? alignedPieces(i, units) : null;
    if (pieces !== null) out.push(...pieces);
    else out.push(u);
  });
  return out;
}
