// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/decode.rs (crates-v2.21.2, Apache-2.0): folding wrapped rows.

import { charCount, chars, isLowercase, trim, trimStart } from "../rust.js";
import { splitWhitespace, trimEndChars, trimStartChars, isAsciiDigit } from "../rust-extra.js";
import { median } from "./decode-link.js";
import type { GridCell } from "./types.js";

/** A lone number (thousands separators, sign, decimal, percent): values don't wrap. */
export function isNumber(text: string): boolean {
  const t = trimEndChars(trim(text), "%").replace(/[, ]/g, "");
  const cs = chars(t);
  return (
    t !== "" && cs.some(isAsciiDigit) && cs.every((c) => isAsciiDigit(c) || "+-.()$€£".includes(c))
  );
}

/** Text opening a new list item ("1.2 ...", "(a) ...", "• ..."): a sub-row, never a wrapped line. */
export function startsItem(text: string): boolean {
  const t = trimStart(text);
  const first = splitWhitespace(t)[0];
  if (first === undefined) return false;
  if (charCount(first) === 1 && "•·▪◦‣-–—*●○■□".includes(first)) return true;
  const core = trimEndChars(trimStartChars(first, "("), ").:");
  const cc = chars(core);
  const enumerator =
    core !== "" &&
    (core.split(".").every((p) => p !== "" && chars(p).every(isAsciiDigit)) ||
      (cc.length === 1 && /^[A-Za-z]$/.test(core) && first !== core));
  return enumerator && first !== t;
}

/** The rows' filled cells (a one-row cell with text), as indices. */
function filled(cells: readonly GridCell[], r: number): number[] {
  const out: number[] = [];
  cells.forEach((c, k) => {
    if (c.r0 === r && c.r1 === r && trim(c.text) !== "") out.push(k);
  });
  return out;
}

/** Fold cell `k`'s text and box into cell `j`. */
function foldInto(cells: GridCell[], k: number, j: number): void {
  const t = trim(cells[k].text);
  const b = cells[k].bx;
  const c = cells[j];
  c.text = `${trim(c.text)} ${t}`;
  c.bx = [
    Math.min(c.bx[0], b[0]),
    Math.min(c.bx[1], b[1]),
    Math.max(c.bx[2], b[2]),
    Math.max(c.bx[3], b[3]),
  ];
}

/**
 * Drop row `r` after its text moved up: its (empty) cells go, spans through it shrink, rows
 * below move up. The caller lowers its row count.
 */
function removeRow(cells: GridCell[], head: number[], r: number): void {
  for (let i = cells.length - 1; i >= 0; i--) {
    if (cells[i].r0 === r && cells[i].r1 === r) cells.splice(i, 1);
  }
  for (const c of cells) {
    if (c.r0 > r) {
      c.r0 -= 1;
      c.r1 -= 1;
    } else if (c.r1 >= r) {
      c.r1 -= 1;
    }
  }
  for (let i = head.length - 1; i >= 0; i--) {
    if (head[i] === r) head.splice(i, 1);
  }
  for (let i = 0; i < head.length; i++) {
    if (head[i] > r) head[i] -= 1;
  }
}

/** The filled cell covering `c`'s columns in the row above row `r` (first in cell order). */
function coveringAbove(
  cells: readonly GridCell[],
  c: GridCell,
  r: number,
  needText: boolean
): number {
  return cells.findIndex(
    (x) =>
      x.r0 < r &&
      r - 1 <= x.r1 &&
      x.c0 <= c.c0 &&
      c.c1 <= x.c1 &&
      (!needText || trim(x.text) !== "")
  );
}

/**
 * Rows that are a wrapped cell's continuation lines fold into the row above: a row with fewer
 * filled cells than the one above, each under a filled cell, none a number, sitting clearly
 * tighter (under 0.8x) than the table's own row pitch (measured between rows of 2+ filled cells,
 * so a dense table with uniform pitch never folds). Returns the new row count.
 */
export function foldWrappedRows(cells: GridCell[], head: number[], nRowsIn: number): number {
  let nRows = nRowsIn;
  const top = (ks: readonly number[]): number =>
    ks.reduce((m, k) => Math.min(m, cells[k].bx[1]), Infinity);
  const pitches: number[] = [];
  for (let r = 1; r < nRows; r++) {
    const a = filled(cells, r - 1);
    const b = filled(cells, r);
    if (a.length >= 2 && b.length >= 2) pitches.push(top(b) - top(a));
  }
  if (pitches.length < 2) return nRows;
  const pitch = median(pitches);
  let r = 1;
  while (r < nRows) {
    const above = filled(cells, r - 1);
    const here = filled(cells, r);
    const sameKind = head.includes(r) === head.includes(r - 1);
    const targets: number[] = [];
    const spanStarts = cells.some((c) => c.r0 === r && c.r1 > r);
    const ok =
      sameKind &&
      !spanStarts &&
      here.length > 0 &&
      here.length < above.length &&
      here.every((k) => {
        const c = cells[k];
        // the filled cell covering this column in the row above
        const j = coveringAbove(cells, c, r, false);
        if (j >= 0 && trim(cells[j].text) !== "" && !isNumber(c.text) && !startsItem(c.text)) {
          const fits =
            c.bx[1] - cells[j].bx[1] < 0.8 * pitch && c.bx[1] - cells[j].bx[3] < 0.5 * pitch;
          targets.push(j);
          return fits;
        }
        return false;
      });
    if (!ok) {
      r += 1;
      continue;
    }
    here.forEach((k, i) => foldInto(cells, k, targets[i]));
    removeRow(cells, head, r);
    nRows -= 1;
  }
  return nRows;
}

/**
 * Whether `below` reads as the next line of the same phrase as `above`: it opens lowercase or
 * with a bracket, or `above` breaks off mid-phrase (a hyphen, slash, comma, open bracket, `&`,
 * or a connective). A list of names ("Buick Reatta" under "Alfa Romeo") gives no such cue.
 */
export function continues(above: string, below: string): boolean {
  const a = trim(above);
  const b = trim(below);
  const first = chars(b)[0];
  const opens = first !== undefined && (isLowercase(first) || "([{".includes(first));
  const count = (s: string, ch: string): number => chars(s).filter((c) => c === ch).length;
  const openBrackets = count(a, "(") > count(a, ")");
  const lastWord = (splitWhitespace(a).at(-1) ?? "").toLowerCase();
  const breaks =
    /[-/,(&]$/.test(a) ||
    openBrackets ||
    ["and", "of", "the", "for", "to", "in", "on", "or", "per", "by", "with", "from"].includes(
      lastWord
    );
  return opens || breaks;
}

/**
 * Header cells wrapped over several lines ("Product" / "(active substance," / "strains)")
 * come out as one header row per line, each with as many filled cells as the line above, which
 * [`foldWrappedRows`] (fewer cells, looser than the body pitch) leaves alone. In the header
 * area (the leading rows without numbers, and any marked header rows; at most four), a row
 * folds into the one above when every filled cell sits under a filled cell, none is a number,
 * each starts within 0.6x its own line height of the cell above's bottom, and each reads as a
 * continuation ([`continues`]): wrapped lines, not a second header level (that one adds cells
 * under empty slots) nor a text-only table's next row. Returns the new row count.
 */
export function foldHeaderWraps(cells: GridCell[], head: number[], nRowsIn: number): number {
  let nRows = nRowsIn;
  // the header area: the leading rows without numbers (at most four), and any marked header
  // rows at the top
  const zone = (): number => {
    let marked = 0;
    while (marked < nRows && head.includes(marked)) marked += 1;
    let z = 0;
    while (z < Math.min(nRows, 4)) {
      const f = filled(cells, z);
      if (f.length === 0 || f.some((k) => isNumber(cells[k].text))) break;
      z += 1;
    }
    return Math.min(Math.max(z, marked), 4);
  };
  let r = 1;
  while (r < zone()) {
    const here = filled(cells, r);
    const spanStarts = cells.some((c) => c.r0 === r && c.r1 > r);
    const pairs: Array<[number, number]> = [];
    // one lone filled cell in a wider row is a body cell's wrapped tail more often than a
    // header line (a header wraps in several columns at once)
    const nCols = cells.reduce((m, c) => Math.max(m, c.c1 + 1), 0);
    const ok =
      (here.length >= 2 || nCols <= 2) &&
      !spanStarts &&
      here.every((k) => {
        const c = cells[k];
        const j = coveringAbove(cells, c, r, true);
        if (j >= 0 && !isNumber(c.text) && !startsItem(c.text)) {
          const lineH = Math.max(c.bx[3] - c.bx[1], 1e-6);
          pairs.push([k, j]);
          return c.bx[1] - cells[j].bx[3] < 0.6 * lineH && continues(cells[j].text, c.text);
        }
        return false;
      });
    if (!ok) {
      r += 1;
      continue;
    }
    for (const [k, j] of pairs) foldInto(cells, k, j);
    removeRow(cells, head, r);
    nRows -= 1;
  }
  return nRows;
}
