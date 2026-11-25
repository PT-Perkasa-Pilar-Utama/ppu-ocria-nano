// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 PT Perkasa Pilar Utama
// Port of liteparse crates/liteparse/src/markdown_layout/table_fix.rs (crates-v2.21.2, Apache-2.0): continuation-row folding.

import { f32, isAlphabetic, totalCmp, trim, trimEnd, chars } from "../../rust.js";
import { isAsciiDigit } from "../../rust-extra.js";
import type { Rect } from "../../types/geometry.js";
import { at, removeRow, single } from "./dense.js";
import type { Dense } from "./dense.js";
import { hasDigit } from "./rules.js";

/** A plain number / amount / percent / date-like value (not wrapped label text). */
export function isValue(t: string): boolean {
  const cs = chars(t);
  const digits = cs.filter(isAsciiDigit).length;
  const letters = cs.filter(isAlphabetic).length;
  return digits > 0 && digits >= letters;
}

/** `table_fix::union`: the smallest rect holding both, in f32. */
export function unionRect(a: Rect, b: Rect): Rect {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(f32(a.x + a.width), f32(b.x + b.width));
  const y1 = Math.max(f32(a.y + a.height), f32(b.y + b.height));
  return { x: x0, y: y0, width: f32(x1 - x0), height: f32(y1 - y0) };
}

function endsWithJoiner(s: string): boolean {
  return s.endsWith("-") || s.endsWith("/");
}

/** The text of a cell above joined with the text that continues it. */
function joined(up: string, t: string): string {
  const u = trimEnd(up);
  return endsWithJoiner(u) ? `${u}${t}` : `${u} ${t}`;
}

const MARKER_LEAD = ["•", "-", "*", "–"];

/** A list marker: a bullet or dash, or one to three digits and a dot (`12.`). */
function startsWithMarker(t: string): boolean {
  if (MARKER_LEAD.some((m) => t.startsWith(m))) return true;
  const p = t.split(".")[0];
  return (
    p !== "" &&
    p.length <= 3 &&
    chars(p).every(isAsciiDigit) &&
    t.length > p.length &&
    t.slice(p.length).startsWith(".")
  );
}

function cellText(d: Dense, r: number, c: number): string | null {
  const k = single(d, r, c);
  return k == null ? null : trim(d.cells[k].text);
}

/**
 * The same wrap written with spans: the record's other cells span both rows and only the wrapped
 * column has a cell of its own in row r. Returns whether row r was folded into the one above.
 */
function foldSpanned(d: Dense, r: number): boolean {
  const own: Array<[number, number]> = [];
  let spanned = 0;
  let ok = true;
  for (let c = 0; c < d.n_cols; c++) {
    const k = at(d, r, c);
    if (k != null && d.cells[k].r0 < r) {
      spanned++;
      continue;
    }
    if (k != null && d.cells[k].rs === 1 && d.cells[k].cs === 1) {
      const t = trim(d.cells[k].text);
      if (t === "") continue;
      const j = single(d, r - 1, c);
      if (j == null) {
        ok = false;
        break;
      }
      const u = trim(d.cells[j].text);
      const fits = u !== "" && (endsWithJoiner(u) || !isValue(t));
      if (fits) own.push([j, k]);
      if (!fits) {
        ok = false;
        break;
      }
      continue;
    }
    ok = false;
    break;
  }
  // a wrap continues one or two cells of a record whose other cells span it; a row with
  // more cells of its own than spanned slots is a new record under row-group labels
  let ownFilled = 0;
  for (let c = 0; c < d.n_cols; c++) {
    const k = at(d, r, c);
    if (k != null && d.cells[k].r0 === r && trim(d.cells[k].text) !== "") ownFilled++;
  }
  if (!(ok && spanned > 0 && own.length > 0 && ownFilled <= 2 && ownFilled < spanned)) return false;
  for (const [j, k] of own) {
    const t = trim(d.cells[k].text);
    d.cells[j].text = joined(d.cells[j].text, t);
    const x = d.cells[j].bbox;
    const y = d.cells[k].bbox;
    if (x != null && y != null) d.cells[j].bbox = unionRect(x, y);
  }
  removeRow(d, r);
  return true;
}

/** The column of row r-1 whose box a cell of row r overlaps most horizontally, else `c`. */
function continuationTarget(d: Dense, r: number, c: number): number {
  const k = single(d, r, c);
  const b = k == null ? null : d.cells[k].bbox;
  if (b == null) return c;
  let best: [number, number] | null = null;
  for (let cc = 0; cc < d.n_cols; cc++) {
    const j = single(d, r - 1, cc);
    const a = j == null ? null : d.cells[j].bbox;
    if (a == null) continue;
    const o = f32(Math.min(f32(b.x + b.width), f32(a.x + a.width)) - Math.max(b.x, a.x));
    if (o > f32(f32(0.5) * Math.min(b.width, a.width))) {
      // max_by keeps the last of equal maxima
      if (best == null || totalCmp(best[0], o) <= 0) best = [o, cc];
    }
  }
  return best == null ? c : best[1];
}

/** Fold a body row that continues the cells of the row above (a wrapped cell emitted as a row). */
export function foldContinuationRows(d: Dense): void {
  if (d.n_cols < 2) return;
  const body0 = d.header_rows;
  // tables whose records carry a label in the first column
  const body = Math.max(d.n_rows - body0, 0);
  let labelled = 0;
  for (let r = body0; r < d.n_rows; r++) {
    const t = cellText(d, r, 0);
    if (t != null && t !== "") labelled++;
  }
  const led = body >= 3 && labelled >= 0.6 * body;
  let r = body0 + 1;
  while (r < d.n_rows) {
    const rowT: Array<string | null> = [];
    const aboveT: Array<string | null> = [];
    for (let c = 0; c < d.n_cols; c++) {
      rowT.push(cellText(d, r, c));
      aboveT.push(cellText(d, r - 1, c));
    }
    if (rowT.some((t) => t == null) || aboveT.some((t) => t == null)) {
      if (foldSpanned(d, r)) continue;
      r++;
      continue;
    }
    // SAFETY: every entry was checked non-null above.
    const row = rowT as string[];
    // SAFETY: every entry was checked non-null above.
    const above = aboveT as string[];
    const filled: number[] = [];
    for (let c = 0; c < d.n_cols; c++) if (row[c] !== "") filled.push(c);
    const filledAbove = above.filter((t) => t !== "").length;
    // each filled cell continues the cell above it on the page: the one its box overlaps
    // most horizontally (a renderer may have put a lone continuation line in the first slot),
    // else the one in its own column
    const targets = filled.map((c) => continuationTarget(d, r, c));
    const distinct = new Set(targets).size === targets.length;
    const continues =
      filled.length > 0 &&
      distinct &&
      filled.length < filledAbove &&
      filled.every((c, i) => {
        const t = row[c];
        const tc = targets[i];
        const u = above[tc];
        return (
          u !== "" &&
          !startsWithMarker(t) &&
          (endsWithJoiner(u) || (!hasDigit(t) && led && tc !== 0 && above[0] !== ""))
        );
      });
    if (!continues) {
      r++;
      continue;
    }
    for (let i = 0; i < filled.length; i++) {
      const a = single(d, r - 1, targets[i]);
      const b = single(d, r, filled[i]);
      if (a == null || b == null) continue;
      d.cells[a].text = joined(d.cells[a].text, trim(d.cells[b].text));
      const x = d.cells[a].bbox;
      const y = d.cells[b].bbox;
      if (x != null && y != null) d.cells[a].bbox = unionRect(x, y);
    }
    removeRow(d, r);
  }
}
