// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/table_model/mod.rs `impl Grid` (crates-v2.21.2, Apache-2.0): reading a decoded grid.

import { chars, f32, isLowercase, trim, trimEnd, trimStart } from "../rust.js";
import { splitWhitespace, trimEndChars, utf8Len, isAsciiDigit } from "../rust-extra.js";
import type { SpanCell } from "../markdown-layout/block-types.js";
import type { Grid, GridCell } from "./types.js";

const ROMAN = new Set(Array.from("ivxlcdmIVXLCDM"));

/**
 * A table of contents: at most three columns, and most rows end in a page number (arabic or
 * roman) with the arabic ones non-decreasing down the table. Rendered as text, not a table.
 */
export function isToc(g: Grid): boolean {
  if (g.n_cols > 3) return false;
  const byRow: Array<Array<[number, string]>> = Array.from({ length: g.n_rows }, () => []);
  for (const c of g.cells) {
    const t = trim(c.text);
    if (t !== "") byRow[c.r0].push([c.c0, t]);
  }
  const rows = byRow.filter((r) => r.length > 0);
  let hits = 0;
  const arabic: number[] = [];
  for (const r of rows) {
    // `max_by_key` keeps the last of equal maxima
    let last = r[0];
    for (const x of r) {
      if (x[0] >= last[0]) last = x;
    }
    const text = last[1];
    const cs = chars(text);
    const roman = utf8Len(text) <= 7 && cs.every((ch) => ROMAN.has(ch));
    const num = utf8Len(text) <= 4 && cs.every(isAsciiDigit);
    if (r.length >= 2 && (roman || num)) {
      hits += 1;
      if (num) arabic.push(Number.parseInt(text, 10));
    }
  }
  let falling = 0;
  for (let i = 1; i < arabic.length; i++) {
    if (arabic[i] < arabic[i - 1]) falling += 1;
  }
  const rising = falling <= Math.floor(arabic.length / 10);
  return hits >= 3 && hits * 5 >= rows.length * 3 && rising;
}

const SENTENCE_END = new Set([".", "!", "?", ":", ";"]);

/**
 * Multi-column prose read as a table: long, mostly non-numeric cells whose text runs on
 * down each column, a cell that doesn't end a sentence followed by one that starts
 * lowercase ("calendar 2024, more than 70%" / "will be from recycled content"). A real
 * table's cells are independent, so its columns rarely flow even when one column is long.
 */
export function isProse(g: Grid): boolean {
  const words = (t: string): number => splitWhitespace(t).length;
  const cells = g.cells.filter((c) => trim(c.text) !== "");
  if (cells.length < 6) return false;
  const wc = cells.map((c) => words(c.text)).sort((a, b) => a - b);
  if (wc[Math.floor(wc.length / 2)] < 4) return false;
  const numeric = cells.filter(
    (c) => words(c.text) <= 3 && chars(c.text).some(isAsciiDigit)
  ).length;
  if (numeric * 10 >= cells.length * 3) return false;
  const cols = new Map<number, GridCell[]>();
  for (const c of cells) {
    if (c.c0 === c.c1) cols.set(c.c0, [...(cols.get(c.c0) ?? []), c]);
  }
  let pairs = 0;
  let flow = 0;
  for (const col of cols.values()) {
    col.sort((a, b) => a.r0 - b.r0);
    for (let i = 1; i < col.length; i++) {
      const [a, b] = [col[i - 1], col[i]];
      if (b.r0 > a.r1 + 2) continue; // not adjacent: more than one empty row between them
      pairs += 1;
      const up = trimEnd(a.text);
      const open = !SENTENCE_END.has(chars(up).at(-1) ?? "");
      const first = chars(trimStart(b.text))[0];
      const lower = first !== undefined && isLowercase(first);
      if (open && lower) flow += 1;
    }
  }
  return pairs >= 3 && flow * 10 >= pairs * 4;
}

// Rust's f64::from_str on the characters this code lets through (digits . - +)
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

function parseNumber(text: string): number | null {
  const t = trimEndChars(trim(text), "%").replace(/,/g, "");
  if (
    t === "" ||
    !chars(t).every((ch) => isAsciiDigit(ch) || ch === "." || ch === "-" || ch === "+")
  ) {
    return null;
  }
  return NUMBER.test(t) ? Number(t) : null;
}

/** Whether `vs` is at least three values in an evenly stepped run (tick labels). */
function stepped(vs: readonly number[]): boolean {
  if (vs.length < 3) return false;
  const d = vs.slice(1).map((v, i) => v - vs[i]);
  return d[0] !== 0 && d.every((x) => Math.abs(x - d[0]) <= 1e-6 * Math.max(Math.abs(d[0]), 1));
}

/**
 * A chart read as a table: a sparse, mostly numeric grid with an axis - some column holding
 * at least three lone numbers in an evenly stepped, monotonic run (the tick labels).
 */
export function isChart(g: Grid): boolean {
  const slots = g.n_rows * g.n_cols;
  if (slots === 0) return false;
  let filled = 0;
  let nonempty = 0;
  let numeric = 0;
  const cols = new Map<number, Array<[number, number]>>();
  const flow: Array<[[number, number], number]> = [];
  for (const c of g.cells) {
    if (trim(c.text) === "") continue;
    nonempty += 1;
    filled += (c.r1 - c.r0 + 1) * (c.c1 - c.c0 + 1);
    const v = parseNumber(c.text);
    if (v !== null) {
      numeric += 1;
      if (c.c0 === c.c1) cols.set(c.c0, [...(cols.get(c.c0) ?? []), [c.r0, v]]);
      flow.push([[c.r0, c.c0], v]);
    }
  }
  if (filled * 2 >= slots || numeric * 2 < nonempty) return false;
  // a column of ticks (y axis), or every number on the grid in reading order (an x axis of
  // years strewn diagonally, one per row)
  flow.sort((a, b) => a[0][0] - b[0][0] || a[0][1] - b[0][1]);
  if (stepped(flow.map((x) => x[1]))) return true;
  for (const vs of cols.values()) {
    vs.sort((a, b) => a[0] - b[0]);
    if (stepped(vs.map((x) => x[1]))) return true;
  }
  return false;
}

/**
 * As LiteParse's `MergedTable` rows: covered slots omitted, empty slots as empty cells; the
 * header is the run of header rows at the top (MergedTable heads only leading rows).
 */
export function toSpanRows(g: Grid): [SpanCell[][], number] {
  const at = new Map<string, number>();
  const taken = new Set<string>();
  g.cells.forEach((c, k) => {
    at.set(`${c.r0},${c.c0}`, k);
    for (let r = c.r0; r <= c.r1; r++) {
      for (let q = c.c0; q <= c.c1; q++) taken.add(`${r},${q}`);
    }
  });
  const rows: SpanCell[][] = [];
  for (let r = 0; r < g.n_rows; r++) {
    const row: SpanCell[] = [];
    let q = 0;
    while (q < g.n_cols) {
      const k = at.get(`${r},${q}`);
      if (k !== undefined) {
        const c = g.cells[k];
        const b = c.bx;
        row.push({
          text: c.text,
          colspan: c.c1 - q + 1,
          rowspan: c.r1 - r + 1,
          bbox: { x: f32(b[0]), y: f32(b[1]), width: f32(b[2] - b[0]), height: f32(b[3] - b[1]) },
          text_item_indices: [],
        });
        q = c.c1 + 1;
      } else if (taken.has(`${r},${q}`)) {
        q += 1;
      } else {
        row.push({ text: "", colspan: 1, rowspan: 1, bbox: null, text_item_indices: [] });
        q += 1;
      }
    }
    rows.push(row);
  }
  let headerRows = 0;
  while (headerRows < g.n_rows && g.head_rows.includes(headerRows)) headerRows += 1;
  return [rows, headerRows];
}
